"""
Audit trail service — backs GET /api/audit/logs and /api/audit/logs/{log_id}
(routes/audit.py), and is called from the other services/routes that record
audit-worthy actions (anomaly resolution, e-billing sync/retry, user
administration, login attempts).

Framework-agnostic on purpose (no FastAPI, no app.schemas imports) — same
convention as the other services (reconciliation.py, e_billing.py,
user_service.py).
"""
from datetime import datetime, timedelta, timezone
from typing import Optional
import uuid as uuid_lib

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.user import User


def log_action(
    db: Session,
    actor_user_id,
    action: str,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    before: Optional[dict] = None,
    after: Optional[dict] = None,
    metadata: Optional[dict] = None,
) -> AuditLog:
    """
    Adds an AuditLog row to `db` and flushes it (so it gets a generated id
    and is visible to the rest of the caller's transaction), but
    deliberately does NOT call db.commit() itself.

    The caller commits as part of its own transaction, so this audit entry
    is atomic with the action it's recording: if the main write rolls back
    (an exception, a failed validation further down, etc.), this row rolls
    back with it instead of persisting a log entry for an action that
    never actually happened. Adding a commit here — even though it's
    tempting for a "standalone" logging helper — would break that
    guarantee, so don't.
    """
    entry = AuditLog(
        actor_user_id=actor_user_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        before_value=before,
        after_value=after,
        extra_metadata=metadata,
    )
    db.add(entry)
    db.flush()
    return entry


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
