"""
Audit trail service — backs GET /api/audit/logs and /api/audit/logs/{log_id}
(routes/audit/audit.py), and is called from the other services/routes that record
audit-worthy actions (anomaly resolution, e-billing sync/retry, user
administration, login attempts, and every ingested inbound/outbound record
— see log_ingested_record(), called from scripts/etl_pipeline.py).

Framework-agnostic on purpose (no FastAPI, no app.schemas imports) — same
convention as the other services (reconciliation.py, e_billing.py,
user_service.py).

Immutable hash chain
---------------------
Every row written through log_action()/log_ingested_record() — regardless
of whether it's an in-platform action or an ETL ingestion event, inbound
or outbound — gets chained into ONE sequence: block_index increments by
exactly 1 each time, prev_block_hash is the immediately preceding row's
block_hash, and block_hash commits to (block_index, event_timestamp,
data_hash, prev_block_hash). See models/audit/audit.py's column comments
for why block_index=0's prev_block_hash is a defined genesis value
instead of null.

This is intentionally the ONLY place that constructs an AuditLog row —
routes/services never build one directly — so "every row is chained
correctly" is a property of this module, not something every call site
has to get right independently.
"""
import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Optional
import uuid as uuid_lib

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.audit.audit import AuditLog
from app.models.auth.user import User

# Fixed 64-hex-char stand-in for "no prior block" — block_index=0's
# prev_block_hash, so genesis is a real, hashable value rather than a
# null every downstream reader (including /audit/verify) has to special-
# case.
GENESIS_PREV_HASH = "0" * 64


def _canonical_json(payload: dict) -> str:
    """Deterministic JSON serialization — sorted keys, no whitespace,
    non-JSON-native values (UUID, datetime, Decimal, ...) coerced via
    str() — so the same logical payload always hashes to the same
    data_hash regardless of dict insertion order or Python type.
    default=str is intentionally lossy (a datetime and its ISO string
    hash the same); that's fine here since the payload passed in already
    went through explicit .isoformat()/str() conversion for anything that
    matters to the hash (see chain_entry() below), this is just a safety
    net for anything that wasn't."""
    return json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))


def _sha256_hex(material: str) -> str:
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _hashable_timestamp(dt: datetime) -> str:
    """Canonical ISO8601 string for hashing, independent of whether `dt`
    is tz-aware or naive by the time it reaches this function. Every
    event_timestamp this system ever sets is UTC (chain_entry() defaults
    to datetime.now(timezone.utc); the ETL passes explicit UTC values) —
    a naive datetime here is treated as already-UTC, not the process's
    local tz. This matters because it's *possible* for a value to survive
    a DB round-trip naive even though the column is TIMESTAMPTZ (a raw
    query executed outside the ORM, a different driver, ...) — belt and
    suspenders alongside storing event_timestamp as timezone=True (see
    models/audit/audit.py's comment on that column for the bug this
    combination fixes, caught via a live migration test against
    Postgres: a plain, non-tz TIMESTAMP silently drops tzinfo on write,
    so the same moment hashed as tz-aware at write time and read back
    naive at verify time produced two different strings and broke every
    verify_chain_integrity() call)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat()


def _json_safe(value):
    """Recursively coerces a value into JSON-native types before it's
    hashed and stored in a JSONB column. Ingestion-path `after` payloads
    come from pandas .to_dict(orient='records') rows (numpy int64/
    float64, pandas Timestamp/NaT, occasionally Decimal) — none of those
    round-trip through psycopg2's JSON adapter or hash stably via
    _canonical_json's default=str fallback (repr() of a numpy scalar
    isn't guaranteed identical across calls/versions the way a plain
    Python float's str() is), so this runs BEFORE both storage and
    hashing rather than leaving it to json.dumps's fallback."""
    import math

    import numpy as np
    import pandas as pd
    from decimal import Decimal

    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if value is None:
        return None
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        f = float(value)
        return 0 if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(value, float):
        return 0 if (math.isnan(value) or math.isinf(value)) else value
    try:
        # Catches pandas NaT and other pandas-null scalars that aren't
        # `is None` and aren't plain float('nan'). isinstance-checked
        # types above are handled first since pd.isna() on a dict/list
        # raises or misbehaves.
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


def _get_chain_tip(db: Session) -> Optional[AuditLog]:
    """Row with the highest block_index, locked for update on dialects
    that support SELECT ... FOR UPDATE (Postgres, production) so two
    concurrent writers (e.g. the ETL ingestion path and an in-platform
    action landing at the same moment) can't both read the same tip and
    compute the same next block_index/prev_block_hash — the second
    writer blocks until the first commits, then sees the updated tip.
    SQLite (tests, local dev) doesn't support row-level locking the same
    way; with_for_update() is skipped there rather than erroring on an
    unsupported dialect, relying on SQLite's own single-writer file
    locking instead — acceptable for tests/local dev, not a claim this
    is race-safe under SQLite specifically."""
    query = db.query(AuditLog).order_by(AuditLog.block_index.desc())
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        query = query.with_for_update()
    return query.first()


def get_chain_tip(db: Session) -> Optional[AuditLog]:
    """Public, unlocked read of the current chain tip — for callers that
    just want to know where the chain currently stands (anchor_service.py
    deciding what to anchor, /audit/verify's summary) rather than ones
    about to write the next row. Deliberately NOT the same as
    _get_chain_tip(): that one locks the row on Postgres so two writers
    can't race; a read-only peek taking that same lock would hold it for
    however long the caller takes to act on it (anchor_chain_tip() can be
    mid-flight on an on-chain transaction for many seconds), needlessly
    blocking real writers in the meantime."""
    return db.query(AuditLog).order_by(AuditLog.block_index.desc()).first()


def _build_chain_row(
    db: Session,
    *,
    next_index: int,
    prev_hash: str,
    actor_user_id=None,
    external_actor: Optional[str] = None,
    action: str,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    before: Optional[dict] = None,
    after: Optional[dict] = None,
    metadata: Optional[dict] = None,
    event_timestamp: Optional[datetime] = None,
    flush: bool = True,
) -> AuditLog:
    """
    Builds and adds ONE chained AuditLog row, given an already-known
    next_index/prev_hash — the actual row-construction logic shared by
    chain_entry() (looks up the tip itself, safe for any single call) and
    ChainWriter (looks up the tip once, advances in memory across many
    calls — see that class's docstring for why bulk ingestion needs this
    instead of chain_entry() called once per row).

    flush=False lets ChainWriter batch many rows into one flush (id is a
    Python-side uuid4() default, not DB-generated, so entry.id/
    entry.block_hash are usable immediately either way — flush only
    matters for whether the row is *queryable* by other code sharing this
    session before the batch finishes).
    """
    event_timestamp = event_timestamp or datetime.now(timezone.utc)
    # Sanitize BEFORE both hashing and storage, so data_hash always
    # commits to exactly what's persisted in before_value/after_value —
    # not to a pre-sanitize dict that happened to hash differently.
    before = _json_safe(before)
    after = _json_safe(after)

    # The hashed payload — deliberately built from the same values written
    # to the row below, not derived from the ORM object after insert
    # (which would tie data_hash to SQLAlchemy's column ordering/types
    # rather than to values this function itself controls).
    payload = {
        "actor_user_id": str(actor_user_id) if actor_user_id else None,
        "external_actor": external_actor,
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "before": before,
        "after": after,
        "event_timestamp": _hashable_timestamp(event_timestamp),
    }
    data_hash = _sha256_hex(_canonical_json(payload))
    block_hash = _sha256_hex(f"{next_index}|{_hashable_timestamp(event_timestamp)}|{data_hash}|{prev_hash}")

    entry = AuditLog(
        actor_user_id=actor_user_id,
        external_actor=external_actor,
        action=action,
        target_type=target_type,
        target_id=target_id,
        before_value=before,
        after_value=after,
        extra_metadata=metadata,
        event_timestamp=event_timestamp,
        block_index=next_index,
        data_hash=data_hash,
        prev_block_hash=prev_hash,
        block_hash=block_hash,
    )
    db.add(entry)
    if flush:
        db.flush()
    return entry


def chain_entry(
    db: Session,
    *,
    actor_user_id=None,
    external_actor: Optional[str] = None,
    action: str,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    before: Optional[dict] = None,
    after: Optional[dict] = None,
    metadata: Optional[dict] = None,
    event_timestamp: Optional[datetime] = None,
) -> AuditLog:
    """
    Builds and chains one AuditLog row, looking up the current tip itself
    (via _get_chain_tip(), locked on Postgres). Shared by log_action()
    (in-platform actions) and any single ad-hoc ingestion write — same
    chaining logic, same table, same block_index sequence, per the
    extension's "one chain, both directions" guiding principle.

    Safe under concurrent callers (each call re-reads and locks the tip).
    NOT what scripts/etl_pipeline.py uses for its per-row ingestion writes
    — see ChainWriter below for why a tens-of-thousands-of-rows bulk load
    needs a different access pattern than "one query per row".

    Adds the row to `db` and flushes it (so it gets a generated id and is
    visible to the rest of the caller's transaction), but deliberately
    does NOT call db.commit() itself — see log_action()'s docstring for
    why (unchanged from before this extension).
    """
    tip = _get_chain_tip(db)
    next_index = (tip.block_index + 1) if tip is not None else 0
    prev_hash = tip.block_hash if tip is not None else GENESIS_PREV_HASH

    return _build_chain_row(
        db,
        next_index=next_index,
        prev_hash=prev_hash,
        actor_user_id=actor_user_id,
        external_actor=external_actor,
        action=action,
        target_type=target_type,
        target_id=target_id,
        before=before,
        after=after,
        metadata=metadata,
        event_timestamp=event_timestamp,
        flush=True,
    )


class ChainWriter:
    """
    Batch-efficient chain writer for scripts/etl_pipeline.py's ingestion
    path: fetches the chain tip ONCE (one query, still locked on Postgres
    against any concurrent in-platform write happening at the same
    moment), then advances block_index/prev_block_hash in memory for
    every subsequent row instead of re-querying the DB per row. Produces
    exactly the rows chain_entry() would have produced called once per
    row — this is purely a round-trip optimization for a single run that
    ingests tens of thousands of rows (10k+ dispatches alone), not a
    different chaining algorithm.

    NOT safe to share across concurrent writers against the same table —
    it caches the tip in-process for the lifetime of the writer, so a
    second, independent writer (or a route handler calling log_action())
    active at the same time would not see rows added through this
    instance until finalize() flushes them. etl_pipeline.py runs as a
    standalone script/boot step with no concurrent writer for the
    duration of one run, so that constraint holds for its actual use.

    Usage:
        writer = ChainWriter(db)
        for row in records:
            writer.write_ingested(...)
        writer.finalize()   # flushes any rows not yet flushed
        db.commit()
    """

    _FLUSH_EVERY = 500

    def __init__(self, db: Session):
        self.db = db
        tip = _get_chain_tip(db)
        self._next_index = (tip.block_index + 1) if tip is not None else 0
        self._prev_hash = tip.block_hash if tip is not None else GENESIS_PREV_HASH
        self._pending = 0

    def write_ingested(
        self,
        *,
        external_actor: Optional[str],
        target_type: str,
        target_id: str,
        record: dict,
        event_timestamp: datetime,
    ) -> AuditLog:
        entry = _build_chain_row(
            self.db,
            next_index=self._next_index,
            prev_hash=self._prev_hash,
            actor_user_id=None,
            external_actor=external_actor,
            action="ingested",
            target_type=target_type,
            target_id=str(target_id),
            before=None,
            after=record,
            metadata=None,
            event_timestamp=event_timestamp,
            flush=False,
        )
        self._next_index += 1
        self._prev_hash = entry.block_hash
        self._pending += 1
        if self._pending >= self._FLUSH_EVERY:
            self.db.flush()
            self._pending = 0
        return entry

    def finalize(self) -> None:
        """Flushes any rows added since the last periodic flush. Does
        NOT commit — the caller (etl_pipeline.py) owns the transaction,
        same commit-boundary convention as log_action()/chain_entry()."""
        if self._pending:
            self.db.flush()
            self._pending = 0


def log_action(
    db: Session,
    actor_user_id,
    action: str,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    before: Optional[dict] = None,
    after: Optional[dict] = None,
    metadata: Optional[dict] = None,
    external_actor: Optional[str] = None,
    event_timestamp: Optional[datetime] = None,
) -> AuditLog:
    """
    In-platform action path (anomaly resolution, e-billing sync/retry,
    user administration, login attempts, ...). Unchanged call signature
    for every existing caller (external_actor/event_timestamp are new,
    optional, and unused by any pre-existing call site) — now chains into
    the hash chain via chain_entry() rather than inserting a bare row.

    See chain_entry()'s docstring for the commit-boundary guarantee this
    preserves: the caller commits as part of its own transaction, so this
    audit entry is atomic with the action it's recording.
    """
    return chain_entry(
        db,
        actor_user_id=actor_user_id,
        external_actor=external_actor,
        action=action,
        target_type=target_type,
        target_id=target_id,
        before=before,
        after=after,
        metadata=metadata,
        event_timestamp=event_timestamp,
    )


def log_ingested_record(
    db: Session,
    *,
    external_actor: Optional[str],
    target_type: str,
    target_id: str,
    record: dict,
    event_timestamp: datetime,
) -> AuditLog:
    """
    Ingestion-path audit entry — called from scripts/etl_pipeline.py for
    every dispatch/invoice/payment/attendance/stipend_authorization/
    disbursement row that passes Gate D (referential integrity). Actor is
    whoever the SOURCE record itself names (dispatched_by/prepared_by/
    authorized_by/officer_id/processed_by — see
    generate_kpc_data.py's actor-attribution constants), never a generic
    "ETL system" actor and never the authenticated user running the
    pipeline (there usually isn't one — this runs as a script/boot step).
    external_actor=None is valid and means "this record genuinely has no
    natural human actor" (payments — see generate_kpc_data.py's comment
    above KPC_FINANCE_STAFF), not a missed lookup.

    before=None always: an ingested record is new-to-this-platform by
    definition (ETL replaces these tables wholesale every run — see
    alembic/env.py's NOT_ALEMBIC_MANAGED_TABLES), there's no prior version
    to diff against.
    """
    return chain_entry(
        db,
        actor_user_id=None,
        external_actor=external_actor,
        action="ingested",
        target_type=target_type,
        target_id=str(target_id),
        before=None,
        after=record,
        event_timestamp=event_timestamp,
    )


def _coerce_uuid(value):
    """Returns a uuid.UUID, or None if `value` isn't a valid UUID string.
    Used for filter/lookup params that come from query strings — an
    unparseable id should mean "no match", not a 500 from the DB driver
    rejecting the type."""
    if value is None:
        return None
    try:
        return uuid_lib.UUID(str(value))
    except ValueError:
        return None


def get_audit_logs(
    db: Session,
    actor_user_id: Optional[str] = None,
    action: Optional[str] = None,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[AuditLog], int]:
    """Filterable, paginated query. All filters are optional and combine
    with AND. Returns (rows_for_this_page, total_count matching the
    filters) so the route can build pagination metadata."""
    if actor_user_id is not None:
        actor_uuid = _coerce_uuid(actor_user_id)
        if actor_uuid is None:
            return [], 0
        actor_user_id = actor_uuid

    query = db.query(AuditLog)
    if actor_user_id is not None:
        query = query.filter(AuditLog.actor_user_id == actor_user_id)
    if action is not None:
        query = query.filter(AuditLog.action == action)
    if target_type is not None:
        query = query.filter(AuditLog.target_type == target_type)
    if target_id is not None:
        query = query.filter(AuditLog.target_id == target_id)
    if date_from is not None:
        query = query.filter(AuditLog.created_at >= date_from)
    if date_to is not None:
        query = query.filter(AuditLog.created_at <= date_to)

    total = query.count()
    rows = (
        query.order_by(AuditLog.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return rows, total


def get_audit_log(db: Session, log_id) -> AuditLog:
    uid = _coerce_uuid(log_id)
    if uid is not None:
        entry = db.query(AuditLog).filter(AuditLog.id == uid).first()
        if entry is not None:
            return entry
    raise ValueError(f"No audit log with id: {log_id}")


def get_audit_summary(db: Session, days: int = 7) -> dict:
    """Aggregate stats over the last `days` days: total actions, a count
    per action type, and a count per actor (keyed by email where the
    actor is known, bucketed under "(system)" for null-actor entries —
    failed logins, or requests the AuditMiddleware fallback logged before
    any auth check ran)."""
    since = datetime.now(timezone.utc) - timedelta(days=days)

    total = db.query(AuditLog).filter(AuditLog.created_at >= since).count()

    by_type = dict(
        db.query(AuditLog.action, func.count(AuditLog.id))
        .filter(AuditLog.created_at >= since)
        .group_by(AuditLog.action)
        .all()
    )

    actor_rows = (
        db.query(User.email, func.count(AuditLog.id))
        .select_from(AuditLog)
        .outerjoin(User, User.id == AuditLog.actor_user_id)
        .filter(AuditLog.created_at >= since)
        .group_by(User.email)
        .all()
    )
    by_actor = {(email or "(system)"): count for email, count in actor_rows}

    return {
        "total_actions": total,
        "actions_by_type": by_type,
        "actions_by_actor": by_actor,
        "period_days": days,
        "since": since,
    }


def verify_chain_integrity(db: Session) -> dict:
    """
    Local half of GET /audit/verify (routes/audit/audit.py) — the other
    half, the on-chain cross-check, lives in anchor_service.py since it
    needs an RPC connection this module deliberately doesn't depend on.

    Walks every row from block_index=0 to the current tip, recomputing
    data_hash and block_hash exactly as chain_entry() originally computed
    them and comparing against what's stored. Returns the first
    block_index where a recomputed hash doesn't match, if any — a
    tampered row (edited directly in the DB, bypassing this service
    entirely) breaks its own data_hash/block_hash immediately, and breaks
    every later row's prev_block_hash too, but only the FIRST break is
    the actual point of tampering; the rest are just downstream fallout,
    which is why this stops at the first mismatch rather than listing
    every row after it.
    """
    rows = db.query(AuditLog).order_by(AuditLog.block_index.asc()).all()
    expected_prev = GENESIS_PREV_HASH
    expected_index = 0
    for row in rows:
        if row.block_index != expected_index:
            return {
                "intact": False,
                "broken_at_block_index": row.block_index,
                "reason": (
                    f"block_index sequence has a gap or duplicate — expected "
                    f"{expected_index}, found {row.block_index}"
                ),
                "chain_length": len(rows),
            }

        if row.prev_block_hash != expected_prev:
            return {
                "intact": False,
                "broken_at_block_index": row.block_index,
                "reason": "prev_block_hash does not match the preceding block's block_hash",
                "chain_length": len(rows),
            }

        payload = {
            "actor_user_id": str(row.actor_user_id) if row.actor_user_id else None,
            "external_actor": row.external_actor,
            "action": row.action,
            "target_type": row.target_type,
            "target_id": row.target_id,
            "before": row.before_value,
            "after": row.after_value,
            "event_timestamp": _hashable_timestamp(row.event_timestamp),
        }
        recomputed_data_hash = _sha256_hex(_canonical_json(payload))
        if recomputed_data_hash != row.data_hash:
            return {
                "intact": False,
                "broken_at_block_index": row.block_index,
                "reason": "data_hash does not match a recomputed hash of the stored payload — before_value/after_value/action/target were edited after the row was written",
                "chain_length": len(rows),
            }

        recomputed_block_hash = _sha256_hex(
            f"{row.block_index}|{_hashable_timestamp(row.event_timestamp)}|{recomputed_data_hash}|{expected_prev}"
        )
        if recomputed_block_hash != row.block_hash:
            return {
                "intact": False,
                "broken_at_block_index": row.block_index,
                "reason": "block_hash does not match a recomputed hash — block_index, event_timestamp, data_hash, or prev_block_hash was edited after the row was written",
                "chain_length": len(rows),
            }

        expected_prev = row.block_hash
        expected_index += 1

    return {
        "intact": True,
        "broken_at_block_index": None,
        "reason": None,
        "chain_length": len(rows),
        "tip_block_index": rows[-1].block_index if rows else None,
        "tip_block_hash": rows[-1].block_hash if rows else None,
    }


def recompute_block_hash_at(db: Session, block_index: int) -> Optional[str]:
    """
    Recomputes the hash chain from genesis (block_index=0) forward
    through the given block_index, deriving data_hash/block_hash fresh
    from each row's raw field values at every step — ignoring every
    stored data_hash/prev_block_hash/block_hash column entirely, not
    just the target row's. Returns the recomputed hash at block_index,
    or None if no row has that block_index.

    This is what anchor_service.verify_on_chain_anchor() compares
    against the immutable on-chain value — deliberately NOT the target
    row's own stored block_hash column, which a naive tamper (edit a
    field, leave the hash columns alone) already gets caught by
    verify_chain_integrity() for, but a MORE careful tamper (edit a
    field, then also recompute and overwrite every hash column forward
    from that point so the stored chain looks locally self-consistent
    again) would NOT get caught by comparing stored-vs-stored — both
    sides would agree with each other, just not with reality. Comparing
    the on-chain value against a hash independently rederived from raw
    field values, trusting no stored hash column at all, is what keeps
    that stronger attack visible: the attacker would additionally have
    to have rewritten what's permanently committed on Base Sepolia,
    which is exactly the guarantee anchoring exists to provide.

    O(block_index) — walks the whole prefix every call. Fine for an
    on-demand admin verification endpoint; don't call this from a hot
    path.
    """
    rows = (
        db.query(AuditLog)
        .filter(AuditLog.block_index <= block_index)
        .order_by(AuditLog.block_index.asc())
        .all()
    )
    if not rows or rows[-1].block_index != block_index:
        return None

    recomputed_prev = GENESIS_PREV_HASH
    recomputed_hash = None
    for row in rows:
        payload = {
            "actor_user_id": str(row.actor_user_id) if row.actor_user_id else None,
            "external_actor": row.external_actor,
            "action": row.action,
            "target_type": row.target_type,
            "target_id": row.target_id,
            "before": row.before_value,
            "after": row.after_value,
            "event_timestamp": _hashable_timestamp(row.event_timestamp),
        }
        data_hash = _sha256_hex(_canonical_json(payload))
        recomputed_hash = _sha256_hex(
            f"{row.block_index}|{_hashable_timestamp(row.event_timestamp)}|{data_hash}|{recomputed_prev}"
        )
        recomputed_prev = recomputed_hash

    return recomputed_hash
