"""
Tests for services/audit/anchor_service.py.

No CDP credentials or AUDIT_ANCHOR_CONTRACT_ADDRESS are set in this test
environment, so is_configured() is False and every function below
exercises its "not configured, skipped, not an error" path — same
convention as test_alert_service.py's SMTP-unconfigured tests. That path
is what CI actually runs and what most real deployments will run until
someone deploys AuditAnchor.sol and fills in the backend's .env, so it's
the behavior most worth pinning here — the real on-chain path (a live
Base Sepolia transaction) can't be exercised without real credentials
and was instead verified manually against a throwaway Postgres DB (see
the session notes / PR description, not something a CI-safe unit test
can reproduce).

Run with: pytest tests/test_anchor_service.py -v
"""
import os
import sys

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models.audit.audit import AuditLog  # noqa: E402 — registers the table on Base.metadata
from app.models.audit.audit_anchor import AuditAnchorRecord  # noqa: E402
from app.models.audit.audit_log_batch import AuditLogBatch  # noqa: E402 — log_action() writes batch-era rows now, see docs/audit-merkle-migration.md
from app.utils.db_connection import Base  # noqa: E402
from app.services.audit.audit_service import GENESIS_PREV_HASH  # noqa: E402
from app.services.audit import anchor_service  # noqa: E402


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(
        engine, tables=[AuditLog.__table__, AuditAnchorRecord.__table__, AuditLogBatch.__table__]
    )
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def _write_legacy_row(db, *, block_index: int, prev_hash: str):
    """Directly constructs an AuditLog row shaped the way a PRE-CUTOVER
    row actually looked (block_hash/prev_block_hash set) — V1 (legacy)
    anchoring (anchor_chain_tip()/maybe_anchor_chain_tip(), and
    get_legacy_chain_tip() they're built on) only ever operates on this
    shape. log_action() no longer produces it for new writes (every row
    is batch-era now — see docs/audit-merkle-migration.md), so tests
    exercising the V1 path construct it directly. Same helper as
    test_audit_service.py's _write_legacy_row(), duplicated rather than
    imported across test files per this suite's existing convention (no
    shared test-fixture module between test_*.py files here)."""
    import hashlib
    import json
    from datetime import datetime, timezone

    event_timestamp = datetime.now(timezone.utc)
    payload = {
        "actor_user_id": None, "external_actor": None, "action": "a", "target_type": None,
        "target_id": None, "before": None, "after": None, "event_timestamp": event_timestamp.isoformat(),
    }
    data_hash = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    block_hash = hashlib.sha256(f"{block_index}|{event_timestamp.isoformat()}|{data_hash}|{prev_hash}".encode()).hexdigest()
    row = AuditLog(
        action="a", event_timestamp=event_timestamp, block_index=block_index,
        data_hash=data_hash, prev_block_hash=prev_hash, block_hash=block_hash,
    )
    db.add(row)
    db.flush()
    return row


def test_is_configured_is_false_without_credentials():
    """Documents this specific test environment's real is_configured()
    result, WITHOUT forcing it via monkeypatch (unlike every other test
    below) — this is the one test whose entire point is to observe the
    actual, unforced state. It's environment-dependent by design: it
    fails on a deployment/container whose real .env has genuine V1
    credentials configured (a live demo environment, for instance) —
    that's a true statement about that environment, not a bug in this
    test or in is_configured() itself. Every OTHER test in this file
    forces "not configured" explicitly via monkeypatch specifically so
    it doesn't depend on which of those two states the ambient
    environment happens to be in."""
    assert anchor_service.is_configured() is False


def test_get_backend_address_returns_none_when_not_configured(monkeypatch):
    monkeypatch.setattr(anchor_service, "is_configured", lambda: False)
    assert anchor_service.get_backend_address() is None


def test_anchor_chain_tip_returns_none_when_not_configured(db, monkeypatch):
    monkeypatch.setattr(anchor_service, "is_configured", lambda: False)
    _write_legacy_row(db, block_index=0, prev_hash=GENESIS_PREV_HASH)
    db.commit()
    assert anchor_service.anchor_chain_tip(db) is None
    # And doesn't write a phantom AuditAnchorRecord either.
    assert db.query(AuditAnchorRecord).count() == 0


def test_maybe_anchor_chain_tip_returns_none_when_not_configured(db, monkeypatch):
    monkeypatch.setattr(anchor_service, "is_configured", lambda: False)
    _write_legacy_row(db, block_index=0, prev_hash=GENESIS_PREV_HASH)
    db.commit()
    assert anchor_service.maybe_anchor_chain_tip(db) is None


def test_fetch_anchor_event_returns_none_when_not_configured(monkeypatch):
    monkeypatch.setattr(anchor_service, "is_configured", lambda: False)
    assert anchor_service.fetch_anchor_event(0) is None


def test_verify_on_chain_anchor_reports_not_configured(db, monkeypatch):
    monkeypatch.setattr(anchor_service, "is_configured", lambda: False)
    monkeypatch.setattr(anchor_service, "is_configured_v2", lambda: False)
    result = anchor_service.verify_on_chain_anchor(db)
    assert result == {
        "configured": False,
        "checked": False,
        "matches": None,
        "reason": "not configured",
    }


def test_anchor_chain_tip_no_ops_on_empty_chain_even_if_configured(db, monkeypatch):
    """Pins the empty-chain guard independently of the is_configured()
    gate — force is_configured() True via monkeypatch (no real
    credentials needed for this specific check) and confirm an empty
    chain still short-circuits to None rather than trying to build a
    transaction for a tip that doesn't exist."""
    monkeypatch.setattr(anchor_service, "is_configured", lambda: True)
    assert anchor_service.anchor_chain_tip(db) is None


def test_maybe_anchor_chain_tip_anchors_immediately_on_first_ever_anchor(db, monkeypatch):
    """When there's no prior AuditAnchorRecord at all, maybe_anchor_
    chain_tip() should anchor right away rather than waiting for the
    block-count/time threshold — pinned by forcing is_configured() True
    and stubbing anchor_chain_tip() itself (this test is about the
    threshold-skipping decision, not about actually sending a
    transaction)."""
    _write_legacy_row(db, block_index=0, prev_hash=GENESIS_PREV_HASH)
    db.commit()

    monkeypatch.setattr(anchor_service, "is_configured", lambda: True)
    called = {}
    monkeypatch.setattr(anchor_service, "anchor_chain_tip", lambda db: called.setdefault("called", True))

    anchor_service.maybe_anchor_chain_tip(db)
    assert called.get("called") is True


def test_maybe_anchor_chain_tip_skips_when_under_both_thresholds(db, monkeypatch):
    """A prior anchor exists, few new rows since, and it was just
    anchored — neither threshold is met, so this tick should do
    nothing."""
    from datetime import datetime, timezone

    _write_legacy_row(db, block_index=0, prev_hash=GENESIS_PREV_HASH)
    db.commit()
    first = db.query(AuditLog).filter(AuditLog.block_index == 0).one()
    tip = _write_legacy_row(db, block_index=1, prev_hash=first.block_hash)
    db.commit()

    db.add(AuditAnchorRecord(
        block_index_anchored=tip.block_index,
        chain_tip_hash=tip.block_hash,
        tx_hash="0xfake",
        anchored_at=datetime.now(timezone.utc),
    ))
    db.commit()

    monkeypatch.setattr(anchor_service, "is_configured", lambda: True)
    called = {}
    monkeypatch.setattr(anchor_service, "anchor_chain_tip", lambda db: called.setdefault("called", True))

    result = anchor_service.maybe_anchor_chain_tip(db)
    assert result is None
    assert "called" not in called
