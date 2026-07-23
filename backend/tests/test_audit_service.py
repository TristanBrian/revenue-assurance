"""
Tests for services/audit_service.py.

Uses an in-memory SQLite engine bound to the real ORM Base (AuditLog's
JSONB columns fall back to plain JSON under SQLite specifically so this
works — see app/models/audit.py), rather than DataFrame-only fixtures like
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

from app.models.audit import AuditLog  # noqa: E402 — registers the table on Base.metadata
from app.utils.db_connection import Base  # noqa: E402
from app.services.audit_service import get_audit_log, get_audit_logs, log_action  # noqa: E402


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
        entry = AuditLog(
            actor_user_id=r["actor_user_id"],
            action=r["action"],
            target_type=r["target_type"],
            target_id=r["target_id"],
        )
        db.add(entry)
        db.flush()
        # created_at has a Python-side default of "now" — overwrite it
        # directly so the fixture controls ordering/date-range filtering.
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
