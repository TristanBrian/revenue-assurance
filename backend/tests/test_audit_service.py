"""
Tests for services/audit/audit_service.py.

Uses an in-memory SQLite engine bound to the real ORM Base (AuditLog's
JSONB columns fall back to plain JSON under SQLite specifically so this
works — see app/models/audit/audit.py), rather than DataFrame-only fixtures like
test_reconciliation.py, since log_action()/get_audit_logs()/get_audit_log()
are thin wrappers around a real Session and need one to exercise.

Run with: pytest tests/test_audit_service.py -v
"""
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models.audit.audit import AuditLog  # noqa: E402 — registers the table on Base.metadata
from app.models.audit.audit_log_batch import AuditLogBatch  # noqa: E402
from app.utils.db_connection import Base  # noqa: E402
from app.services.audit import merkle_service  # noqa: E402
from app.services.audit.audit_service import (  # noqa: E402
    GENESIS_PREV_HASH,
    _canonical_json,
    _hashable_timestamp,
    _sha256_hex,
    get_audit_log,
    get_audit_logs,
    log_action,
    log_ingested_record,
    recompute_block_hash_at,
    seal_batch,
    verify_chain_integrity,
)


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine, tables=[AuditLog.__table__, AuditLogBatch.__table__])
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def _write_legacy_row(db, *, block_index: int, prev_hash: str, action: str = "a", after: dict = None):
    """Directly constructs an AuditLog row shaped the way a PRE-CUTOVER
    row actually looked (block_hash/prev_block_hash set, batch_index/
    leaf_index null) — used only by TestRecomputeBlockHashAt below.
    log_action()/chain_entry() no longer produce this shape (every row
    written today is batch-era, per docs/audit-merkle-migration.md), but
    recompute_block_hash_at() specifically exists to verify pre-cutover
    on-chain anchors against exactly this shape of historical data, so
    its tests construct that shape directly rather than going through the
    (now batch-era-only) write path."""
    event_timestamp = datetime.now(timezone.utc)
    payload = {
        "actor_user_id": None,
        "external_actor": None,
        "action": action,
        "target_type": None,
        "target_id": None,
        "before": None,
        "after": after,
        "event_timestamp": _hashable_timestamp(event_timestamp),
    }
    data_hash = _sha256_hex(_canonical_json(payload))
    block_hash = _sha256_hex(f"{block_index}|{_hashable_timestamp(event_timestamp)}|{data_hash}|{prev_hash}")
    row = AuditLog(
        action=action,
        after_value=after,
        event_timestamp=event_timestamp,
        block_index=block_index,
        data_hash=data_hash,
        prev_block_hash=prev_hash,
        block_hash=block_hash,
    )
    db.add(row)
    db.flush()
    return row


def test_log_action_creates_a_row(db):
    actor_id = uuid.uuid4()
    entry = log_action(
        db,
        actor_user_id=actor_id,
        action="anomaly.resolve",
        target_type="dispatch",
        target_id="DISP-1",
        before={"status": "Pending"},
        after={"status": "Resolved"},
        metadata={"note": "test"},
    )
    db.commit()

    assert entry.id is not None
    row = db.query(AuditLog).filter(AuditLog.id == entry.id).first()
    assert row is not None
    assert row.actor_user_id == actor_id
    assert row.action == "anomaly.resolve"
    assert row.target_type == "dispatch"
    assert row.target_id == "DISP-1"
    assert row.before_value == {"status": "Pending"}
    assert row.after_value == {"status": "Resolved"}
    assert row.extra_metadata == {"note": "test"}
    assert row.created_at is not None


def test_log_action_does_not_commit(db):
    """log_action() flushes (so the row is visible/queryable within this
    transaction) but must not commit — the caller owns the transaction so
    the audit entry can roll back atomically with the action it records."""
    log_action(db, actor_user_id=None, action="auth.login_failure")

    # Visible before commit, via flush.
    assert db.query(AuditLog).count() == 1

    # Rolling back the caller's transaction should remove it — proving no
    # commit happened inside log_action() itself.
    db.rollback()
    assert db.query(AuditLog).count() == 0


def test_log_action_allows_null_actor_for_failed_login(db):
    entry = log_action(
        db,
        actor_user_id=None,
        action="auth.login_failure",
        target_type="user",
        metadata={"attempted_email": "nobody@example.com"},
    )
    db.commit()

    assert entry.actor_user_id is None
    row = db.query(AuditLog).filter(AuditLog.id == entry.id).first()
    assert row.extra_metadata == {"attempted_email": "nobody@example.com"}


@pytest.fixture
def seeded_logs(db):
    """Three actors, mixed actions/targets, spread over a few days —
    enough combinations to exercise every filter independently."""
    actor_a = uuid.uuid4()
    actor_b = uuid.uuid4()
    now = datetime.now(timezone.utc)

    rows = [
        dict(actor_user_id=actor_a, action="anomaly.resolve", target_type="dispatch",
             target_id="DISP-1", created_at=now - timedelta(days=3)),
        dict(actor_user_id=actor_a, action="ebilling.retry", target_type="invoice",
             target_id="INV-1", created_at=now - timedelta(days=2)),
        dict(actor_user_id=actor_b, action="anomaly.resolve", target_type="dispatch",
             target_id="DISP-2", created_at=now - timedelta(days=1)),
        dict(actor_user_id=None, action="auth.login_failure", target_type="user",
             target_id=None, created_at=now),
    ]
    for r in rows:
        # log_action(), not a raw AuditLog(...) construction — see
        # audit_service.py's module docstring: it's meant to be the only
        # place that builds a row, so every row (including test fixtures)
        # gets a valid hash-chain entry rather than one with
        # event_timestamp/block_index/data_hash left null.
        entry = log_action(
            db,
            actor_user_id=r["actor_user_id"],
            action=r["action"],
            target_type=r["target_type"],
            target_id=r["target_id"],
        )
        # created_at has a Python-side default of "now" — overwrite it
        # directly so the fixture controls ordering/date-range filtering.
        # (event_timestamp is left as log_action()'s own default — these
        # filter/pagination tests only ever query on created_at.)
        entry.created_at = r["created_at"]
    db.commit()
    return db, actor_a, actor_b


def test_get_audit_logs_filters_by_actor(seeded_logs):
    db, actor_a, actor_b = seeded_logs
    rows, total = get_audit_logs(db, actor_user_id=str(actor_a))
    assert total == 2
    assert {r.target_id for r in rows} == {"DISP-1", "INV-1"}


def test_get_audit_logs_filters_by_action(seeded_logs):
    db, actor_a, actor_b = seeded_logs
    rows, total = get_audit_logs(db, action="anomaly.resolve")
    assert total == 2
    assert {r.target_id for r in rows} == {"DISP-1", "DISP-2"}


def test_get_audit_logs_filters_by_date_range(seeded_logs):
    db, actor_a, actor_b = seeded_logs
    now = datetime.now(timezone.utc)
    rows, total = get_audit_logs(db, date_from=now - timedelta(days=1, hours=1), date_to=now + timedelta(minutes=1))
    # Only the last two rows (1 day ago, and just now) fall in this window.
    assert total == 2
    assert {r.action for r in rows} == {"anomaly.resolve", "auth.login_failure"}


def test_get_audit_logs_combines_filters_with_and(seeded_logs):
    db, actor_a, actor_b = seeded_logs
    rows, total = get_audit_logs(db, actor_user_id=str(actor_a), action="ebilling.retry")
    assert total == 1
    assert rows[0].target_id == "INV-1"


def test_get_audit_logs_invalid_actor_uuid_returns_empty(seeded_logs):
    db, actor_a, actor_b = seeded_logs
    rows, total = get_audit_logs(db, actor_user_id="not-a-uuid")
    assert rows == []
    assert total == 0


def test_get_audit_logs_pagination_math(seeded_logs):
    db, actor_a, actor_b = seeded_logs
    rows, total = get_audit_logs(db, page=1, page_size=3)
    assert total == 4
    assert len(rows) == 3
    # Newest first.
    assert rows[0].action == "auth.login_failure"

    rows_page2, total_page2 = get_audit_logs(db, page=2, page_size=3)
    assert total_page2 == 4
    assert len(rows_page2) == 1


def test_get_audit_log_returns_single_entry(seeded_logs):
    db, actor_a, actor_b = seeded_logs
    existing = db.query(AuditLog).first()
    found = get_audit_log(db, str(existing.id))
    assert found.id == existing.id


def test_get_audit_log_raises_value_error_when_not_found(db):
    with pytest.raises(ValueError):
        get_audit_log(db, str(uuid.uuid4()))


def test_get_audit_log_raises_value_error_on_malformed_id(db):
    with pytest.raises(ValueError):
        get_audit_log(db, "not-a-uuid")


# =============================================================================
# Batch Merkle chain (post-cutover) — see docs/audit-merkle-migration.md.
# Every row written via log_action()/log_ingested_record() today is
# batch-era: data_hash set, block_hash/prev_block_hash NULL,
# batch_index/leaf_index set instead. See TestRecomputeBlockHashAt below
# for the legacy (pre-cutover) shape, and TestBatchMerkleChain for
# sealing/tamper-detection coverage of the new scheme.
# =============================================================================

class TestHashChain:
    def test_first_row_is_batch_zero_leaf_zero(self, db):
        entry = log_action(db, actor_user_id=None, action="auth.login_failure")
        db.commit()
        assert entry.block_index == 0
        assert entry.batch_index == 0
        assert entry.leaf_index == 0
        # No per-row hash chain for a batch-era row — that commitment
        # only exists once its batch is sealed (see seal_batch()).
        assert entry.block_hash is None
        assert entry.prev_block_hash is None

    def test_sequential_block_index_and_leaf_index(self, db):
        a = log_action(db, actor_user_id=None, action="a")
        db.commit()
        b = log_action(db, actor_user_id=None, action="b")
        db.commit()
        c = log_action(db, actor_user_id=None, action="c")
        db.commit()

        assert [a.block_index, b.block_index, c.block_index] == [0, 1, 2]
        # All three land in the same still-open batch (batch 0), advancing
        # leaf_index within it — block_index keeps its own separate,
        # never-reset global sequence regardless of batch boundaries.
        assert [a.batch_index, b.batch_index, c.batch_index] == [0, 0, 0]
        assert [a.leaf_index, b.leaf_index, c.leaf_index] == [0, 1, 2]

    def test_in_platform_and_ingestion_paths_share_one_sequence(self, db):
        """Both write paths chain into the same block_index/batch
        sequence — no separate chain per source, per the extension's
        'one chain, both directions' guiding principle, now expressed as
        shared batch membership rather than a per-row hash link."""
        a = log_action(db, actor_user_id=None, action="anomaly.resolve", target_type="dispatch", target_id="DISP-1")
        db.commit()
        b = log_ingested_record(
            db,
            external_actor="CLERK-NAI-01",
            target_type="dispatch",
            target_id="DISP-999",
            record={"dispatch_id": "DISP-999", "value_kes": 12345},
            event_timestamp=datetime.now(timezone.utc),
        )
        db.commit()

        assert b.block_index == a.block_index + 1
        assert b.batch_index == a.batch_index
        assert b.leaf_index == a.leaf_index + 1

    def test_log_ingested_record_sets_action_and_external_actor(self, db):
        entry = log_ingested_record(
            db,
            external_actor="OFF-001",
            target_type="attendance",
            target_id="ATT-001",
            record={"attendance_id": "ATT-001"},
            event_timestamp=datetime.now(timezone.utc),
        )
        db.commit()

        assert entry.action == "ingested"
        assert entry.external_actor == "OFF-001"
        assert entry.actor_user_id is None
        assert entry.before_value is None
        assert entry.after_value == {"attendance_id": "ATT-001"}

    def test_log_ingested_record_allows_null_actor_for_payments(self, db):
        """payments.csv has no natural human actor (bank-to-bank
        remittance) — external_actor=None is a valid, realistic
        attribution, not a bug. See generate_kpc_data.py's comment above
        KPC_FINANCE_STAFF."""
        entry = log_ingested_record(
            db,
            external_actor=None,
            target_type="payment",
            target_id="PAY-001",
            record={"payment_id": "PAY-001"},
            event_timestamp=datetime.now(timezone.utc),
        )
        db.commit()
        assert entry.external_actor is None
        assert entry.actor_user_id is None


class TestVerifyChainIntegrity:
    def test_empty_chain_is_intact(self, db):
        result = verify_chain_integrity(db)
        assert result["intact"] is True
        assert result["chain_length"] == 0

    def test_unsealed_rows_are_pending_not_counted_or_broken(self, db):
        """Rows written but never sealed into a batch aren't yet
        checkable against anything stored (sealing is what produces the
        merkle_root to check against) — reported as pending_rows, not
        counted in chain_length, and NOT treated as a break."""
        log_action(db, actor_user_id=None, action="a")
        db.commit()
        log_ingested_record(
            db, external_actor="CLERK-NAI-01", target_type="dispatch", target_id="DISP-1",
            record={"dispatch_id": "DISP-1"}, event_timestamp=datetime.now(timezone.utc),
        )
        db.commit()
        log_action(db, actor_user_id=None, action="b")
        db.commit()

        result = verify_chain_integrity(db)
        assert result["intact"] is True
        assert result["chain_length"] == 0
        assert result["pending_rows"] == 3
        assert result["batch_count"] == 0

    def test_intact_chain_after_sealing(self, db):
        log_action(db, actor_user_id=None, action="a")
        db.commit()
        log_ingested_record(
            db, external_actor="CLERK-NAI-01", target_type="dispatch", target_id="DISP-1",
            record={"dispatch_id": "DISP-1"}, event_timestamp=datetime.now(timezone.utc),
        )
        db.commit()
        c = log_action(db, actor_user_id=None, action="b")
        db.commit()
        seal_batch(db, 0)
        db.commit()

        result = verify_chain_integrity(db)
        assert result["intact"] is True
        assert result["chain_length"] == 3
        assert result["pending_rows"] == 0
        assert result["batch_count"] == 1
        assert result["tip_block_index"] == c.block_index

    def test_tampering_after_value_breaks_verification_at_the_right_batch_and_block(self, db):
        log_action(db, actor_user_id=None, action="a")
        db.commit()
        tampered = log_action(db, actor_user_id=None, action="anomaly.resolve", after={"status": "Pending"})
        db.commit()
        log_action(db, actor_user_id=None, action="c")
        db.commit()
        seal_batch(db, 0)
        db.commit()

        tampered.after_value = {"status": "TAMPERED"}
        db.commit()

        result = verify_chain_integrity(db)
        assert result["intact"] is False
        assert result["broken_at_batch_index"] == 0
        assert result["broken_at_block_index"] is None  # not a legacy break
        assert result["batch_results"][0]["broken_at_block_index"] == tampered.block_index


class TestBatchMerkleChain:
    """Coverage for the batch Merkle scheme itself — sealing, tamper
    localization within a batch, and tamper detection across the
    batch_root_hash chain of multiple sealed batches. Complements
    TestVerifyChainIntegrity above (which exercises the same code paths
    end to end via verify_chain_integrity()) with more direct assertions
    on seal_batch()'s own output and the merkle_service primitives."""

    def test_seal_batch_computes_a_real_merkle_root(self, db):
        log_action(db, actor_user_id=None, action="a")
        db.commit()
        log_action(db, actor_user_id=None, action="b")
        db.commit()
        log_action(db, actor_user_id=None, action="c")
        db.commit()

        batch = seal_batch(db, 0)
        db.commit()

        assert batch is not None
        assert batch.batch_index == 0
        assert batch.row_count == 3
        assert batch.start_block_index == 0
        assert batch.end_block_index == 2
        assert batch.prev_batch_root_hash == GENESIS_PREV_HASH
        assert len(batch.merkle_root) == 64  # sha256 hex digest

    def test_seal_batch_returns_none_for_empty_batch(self, db):
        assert seal_batch(db, 0) is None

    def test_second_batch_chains_to_the_first(self, db):
        log_action(db, actor_user_id=None, action="a")
        db.commit()
        first = seal_batch(db, 0)
        db.commit()

        log_action(db, actor_user_id=None, action="b")
        db.commit()
        second = seal_batch(db, 1)
        db.commit()

        assert second.prev_batch_root_hash == first.batch_root_hash
        assert second.batch_root_hash != first.batch_root_hash

    def test_tampering_one_row_invalidates_its_leaf_batch_and_every_later_batch_root(self, db):
        """Acceptance criterion from docs/audit-merkle-migration.md:
        tampering with any single row's content invalidates that row's
        leaf, its batch's merkle_root, that batch's batch_root_hash, and
        every subsequent batch_root_hash — and the break is correctly
        localized to that batch, not just reported as 'somewhere'."""
        log_action(db, actor_user_id=None, action="a")
        db.commit()
        tampered = log_action(db, actor_user_id=None, action="anomaly.resolve", after={"status": "Pending"})
        db.commit()
        batch0 = seal_batch(db, 0)
        db.commit()
        original_merkle_root = batch0.merkle_root
        original_batch_root_hash = batch0.batch_root_hash

        log_action(db, actor_user_id=None, action="c")
        db.commit()
        batch1 = seal_batch(db, 1)
        db.commit()

        # Tamper a row inside the ALREADY-SEALED batch 0.
        tampered.after_value = {"status": "TAMPERED"}
        db.commit()

        result = verify_chain_integrity(db)
        assert result["intact"] is False
        # Localized to batch 0, not batch 1 — even though batch 1 is
        # "downstream" of the tamper in wall-clock time, verification
        # walks batches in order and reports the FIRST break, same
        # "first break is the real point of tampering" convention the
        # legacy per-row walk always used.
        assert result["broken_at_batch_index"] == 0
        assert result["batch_results"][0]["intact"] is False
        assert result["batch_results"][0]["broken_at_block_index"] == tampered.block_index

        # Independently: recomputing batch 0's tree directly (not via
        # verify_chain_integrity()) confirms the tamper really did
        # change its merkle_root — not just that *some* check failed.
        from app.services.audit.audit_service import _verify_one_batch

        direct = _verify_one_batch(db, batch0)
        assert direct["intact"] is False

        # And batch 1 (untampered on its own) still recomputes its OWN
        # merkle_root/batch_root_hash correctly in isolation — the
        # tamper is detected via batch 0's own check, not by batch 1
        # somehow also failing; batch_root_hash's cascade property is
        # what verify_chain_integrity()'s ordered walk (batch 0 first)
        # relies on to catch it at the true point of tampering rather
        # than reporting batch 1 instead.
        assert merkle_service.compute_batch_root_hash(
            batch_index=1, start_block_index=batch1.start_block_index,
            end_block_index=batch1.end_block_index, merkle_root_hex=batch1.merkle_root,
            prev_batch_root_hash_hex=original_batch_root_hash,
        ) == batch1.batch_root_hash
        assert original_merkle_root == batch0.merkle_root  # stored column unchanged by the tamper (only the payload was edited)
        assert original_batch_root_hash == batch0.batch_root_hash  # ditto

    def test_tampering_prev_batch_root_hash_breaks_verification(self, db):
        """Batch-era equivalent of a prev_block_hash tamper — the
        chain-of-custody link between two sealed batches, not a
        within-batch content tamper."""
        log_action(db, actor_user_id=None, action="a")
        db.commit()
        seal_batch(db, 0)
        db.commit()
        log_action(db, actor_user_id=None, action="b")
        db.commit()
        second = seal_batch(db, 1)
        db.commit()

        second.prev_batch_root_hash = "0" * 64  # pretend it chains to genesis instead of batch 0
        db.commit()

        result = verify_chain_integrity(db)
        assert result["intact"] is False
        assert result["broken_at_batch_index"] == 1

    def test_merkle_proof_round_trips_for_every_leaf_in_a_real_batch(self, db):
        """merkle_service's own proof/verify primitives, exercised
        against a REAL sealed batch's actual rows (not just synthetic
        hex strings, as in merkle_service's own inline sanity checks) —
        O(log n) single-row proof verification, independent of
        verify_chain_integrity()'s full-batch recompute."""
        for action in ("a", "b", "c", "d", "e"):
            log_action(db, actor_user_id=None, action=action)
            db.commit()
        batch = seal_batch(db, 0)
        db.commit()

        rows = db.query(AuditLog).filter(AuditLog.batch_index == 0).order_by(AuditLog.leaf_index.asc()).all()
        tree = merkle_service.build_merkle_tree([r.data_hash for r in rows])
        assert tree.root_hex == batch.merkle_root

        for row in rows:
            proof = merkle_service.get_merkle_proof(tree, row.leaf_index)
            assert merkle_service.verify_row_in_batch(row.data_hash, proof, tree.root)


class TestRecomputeBlockHashAt:
    """recompute_block_hash_at() backs anchor_service.verify_on_chain_
    anchor()'s comparison against the immutable on-chain value for
    PRE-CUTOVER anchors — it must NOT be foolable by a tamper that also
    rewrites the target row's own stored block_hash column to match (a
    stronger attack than a plain stored-vs-stored comparison would
    defend against). Operates on directly-constructed legacy-shaped rows
    (see _write_legacy_row() above) since log_action()/chain_entry() no
    longer produce that shape for new writes — see
    docs/audit-merkle-migration.md."""

    def test_matches_the_stored_hash_when_untampered(self, db):
        a = _write_legacy_row(db, block_index=0, prev_hash=GENESIS_PREV_HASH)
        db.commit()
        assert recompute_block_hash_at(db, a.block_index) == a.block_hash

    def test_returns_none_for_a_block_index_that_does_not_exist(self, db):
        _write_legacy_row(db, block_index=0, prev_hash=GENESIS_PREV_HASH)
        db.commit()
        assert recompute_block_hash_at(db, 999) is None

    def test_field_tamper_alone_changes_the_recomputed_hash(self, db):
        """The naive tamper: edit a field, leave every hash column
        alone. _verify_legacy_chain() already catches this; this test
        confirms recompute_block_hash_at() would too, independently."""
        entry = _write_legacy_row(db, block_index=0, prev_hash=GENESIS_PREV_HASH, action="anomaly.resolve", after={"status": "Pending"})
        db.commit()
        original_hash = entry.block_hash

        entry.after_value = {"status": "TAMPERED"}
        db.commit()

        assert recompute_block_hash_at(db, entry.block_index) != original_hash

    def test_full_rewrite_tamper_still_changes_the_recomputed_hash(self, db):
        """The sophisticated tamper: edit a field AND recompute+overwrite
        every stored hash column forward from that point, so the stored
        chain looks locally self-consistent again (verify_chain_
        integrity() would report intact=True here). This is exactly the
        attack recompute_block_hash_at() exists to still catch — it
        ignores every stored hash column, not just the target row's, so
        a full local rewrite still can't make it agree with what's
        already permanently committed on-chain."""
        a = _write_legacy_row(db, block_index=0, prev_hash=GENESIS_PREV_HASH, action="anomaly.resolve", after={"status": "Pending"})
        db.commit()
        original_hash_at_a = a.block_hash

        # Tamper, then "launder" the chain by recomputing every stored
        # hash column forward from the tampered row via chain_entry()'s
        # own (retired) hashing logic — simulating an attacker
        # sophisticated enough to not just edit a field and hope nobody
        # notices.
        a.after_value = {"status": "TAMPERED"}
        payload = {
            "actor_user_id": None,
            "external_actor": a.external_actor,
            "action": a.action,
            "target_type": a.target_type,
            "target_id": a.target_id,
            "before": a.before_value,
            "after": a.after_value,
            "event_timestamp": _hashable_timestamp(a.event_timestamp),
        }
        laundered_data_hash = _sha256_hex(_canonical_json(payload))
        laundered_block_hash = _sha256_hex(
            f"{a.block_index}|{_hashable_timestamp(a.event_timestamp)}|{laundered_data_hash}|{a.prev_block_hash}"
        )
        a.data_hash = laundered_data_hash
        a.block_hash = laundered_block_hash
        db.commit()

        # _verify_legacy_chain() (via verify_chain_integrity()) is
        # fooled — the stored chain is locally self-consistent again
        # (this is the gap recompute_block_hash_at() closes, not a flaw
        # being asserted here).
        assert verify_chain_integrity(db)["intact"] is True
        assert a.block_hash != original_hash_at_a  # confirms the laundering actually changed it

        # But recompute_block_hash_at() still disagrees, because it
        # ignores the stored (laundered) block_hash entirely and derives
        # its own from the raw field values.
        assert recompute_block_hash_at(db, a.block_index) == laundered_block_hash
        # And critically: that recomputed value is NOT what an on-chain
        # anchor made before the tamper would have recorded.
        assert recompute_block_hash_at(db, a.block_index) != original_hash_at_a
