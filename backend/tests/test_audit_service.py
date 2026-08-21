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
from app.utils.db_connection import Base  # noqa: E402
from app.services.audit.audit_service import (  # noqa: E402
    GENESIS_PREV_HASH,
    get_audit_log,
    get_audit_logs,
    log_action,
    log_ingested_record,
    recompute_block_hash_at,
    verify_chain_integrity,
)


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine, tables=[AuditLog.__table__])
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


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
# Immutable hash chain
# =============================================================================

class TestHashChain:
    def test_first_row_is_genesis(self, db):
        entry = log_action(db, actor_user_id=None, action="auth.login_failure")
        db.commit()
        assert entry.block_index == 0
        assert entry.prev_block_hash == GENESIS_PREV_HASH

    def test_sequential_block_index_and_prev_hash_chaining(self, db):
        a = log_action(db, actor_user_id=None, action="a")
        db.commit()
        b = log_action(db, actor_user_id=None, action="b")
        db.commit()
        c = log_action(db, actor_user_id=None, action="c")
        db.commit()

        assert [a.block_index, b.block_index, c.block_index] == [0, 1, 2]
        assert b.prev_block_hash == a.block_hash
        assert c.prev_block_hash == b.block_hash

    def test_in_platform_and_ingestion_paths_share_one_sequence(self, db):
        """Both write paths chain into the same block_index sequence —
        no separate chain per source, per the extension's 'one chain,
        both directions' guiding principle."""
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
        assert b.prev_block_hash == a.block_hash

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

    def test_intact_chain_after_several_writes(self, db):
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
        assert result["chain_length"] == 3
        assert result["tip_block_index"] == 2

    def test_tampering_after_value_breaks_verification_at_the_right_block(self, db):
        log_action(db, actor_user_id=None, action="a")
        db.commit()
        tampered = log_action(db, actor_user_id=None, action="anomaly.resolve", after={"status": "Pending"})
        db.commit()
        log_action(db, actor_user_id=None, action="c")
        db.commit()

        tampered.after_value = {"status": "TAMPERED"}
        db.commit()

        result = verify_chain_integrity(db)
        assert result["intact"] is False
        assert result["broken_at_block_index"] == tampered.block_index

    def test_tampering_prev_block_hash_breaks_verification(self, db):
        a = log_action(db, actor_user_id=None, action="a")
        db.commit()
        b = log_action(db, actor_user_id=None, action="b")
        db.commit()

        b.prev_block_hash = "0" * 64  # pretend it's genesis
        db.commit()

        result = verify_chain_integrity(db)
        assert result["intact"] is False
        assert result["broken_at_block_index"] == b.block_index


class TestRecomputeBlockHashAt:
    """recompute_block_hash_at() backs anchor_service.verify_on_chain_
    anchor()'s comparison against the immutable on-chain value — it must
    NOT be foolable by a tamper that also rewrites the target row's own
    stored block_hash column to match (a stronger attack than
    verify_chain_integrity() alone defends against; see that function's
    docstring)."""

    def test_matches_the_stored_hash_when_untampered(self, db):
        a = log_action(db, actor_user_id=None, action="a")
        db.commit()
        assert recompute_block_hash_at(db, a.block_index) == a.block_hash

    def test_returns_none_for_a_block_index_that_does_not_exist(self, db):
        log_action(db, actor_user_id=None, action="a")
        db.commit()
        assert recompute_block_hash_at(db, 999) is None

    def test_field_tamper_alone_changes_the_recomputed_hash(self, db):
        """The naive tamper: edit a field, leave every hash column
        alone. verify_chain_integrity() already catches this; this test
        confirms recompute_block_hash_at() would too, independently."""
        entry = log_action(db, actor_user_id=None, action="anomaly.resolve", after={"status": "Pending"})
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
        a = log_action(db, actor_user_id=None, action="anomaly.resolve", after={"status": "Pending"})
        db.commit()
        original_hash_at_a = a.block_hash

        # Tamper, then "launder" the chain by recomputing every stored
        # hash column forward from the tampered row via chain_entry()'s
        # own hashing logic — simulating an attacker sophisticated
        # enough to not just edit a field and hope nobody notices.
        from app.services.audit.audit_service import _canonical_json, _hashable_timestamp, _sha256_hex

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

        # verify_chain_integrity() is fooled — the stored chain is
        # locally self-consistent again (this is the gap
        # recompute_block_hash_at() closes, not a flaw being asserted
        # here).
        assert verify_chain_integrity(db)["intact"] is True
        assert a.block_hash != original_hash_at_a  # confirms the laundering actually changed it

        # But recompute_block_hash_at() still disagrees, because it
        # ignores the stored (laundered) block_hash entirely and derives
        # its own from the raw field values.
        assert recompute_block_hash_at(db, a.block_index) == laundered_block_hash
        # And critically: that recomputed value is NOT what an on-chain
        # anchor made before the tamper would have recorded.
        assert recompute_block_hash_at(db, a.block_index) != original_hash_at_a
