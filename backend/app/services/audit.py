"""
Audit Service – Logging and retrieving audit events
"""
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from app.models.audit_log import AuditLog
from datetime import datetime, timedelta
import json


def create_audit_log(
    db: Session,
    user_id: int = None,
    username: str = None,
    action: str = None,
    resource: str = None,
    resource_id: str = None,
    method: str = None,
    endpoint: str = None,
    ip_address: str = None,
    user_agent: str = None,
    status_code: int = None,
    success: int = 1,
    error_message: str = None,
    details: dict = None,
    previous_state: dict = None,
    new_state: dict = None,
) -> AuditLog:
    """Create a new audit log entry."""
    log = AuditLog(
        user_id=user_id,
        user_username=username,
        action=action,
        resource=resource,
        resource_id=resource_id,
        method=method,
        endpoint=endpoint,
        ip_address=ip_address,
        user_agent=user_agent,
        status_code=status_code,
        success=success,
        error_message=error_message,
        details=json.dumps(details) if details else None,
        previous_state=json.dumps(previous_state) if previous_state else None,
        new_state=json.dumps(new_state) if new_state else None,
        created_at=datetime.utcnow()
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def get_audit_logs(
    db: Session,
    page: int = 1,
    page_size: int = 20,
    user_id: int = None,
    action: str = None,
    resource: str = None,
    success: bool = None,
) -> dict:
    """Get paginated audit logs with optional filters."""
    query = db.query(AuditLog)

    if user_id:
        query = query.filter(AuditLog.user_id == user_id)
    if action:
        query = query.filter(AuditLog.action == action)
    if resource:
        query = query.filter(AuditLog.resource == resource)
    if success is not None:
        query = query.filter(AuditLog.success == (1 if success else 0))

    total = query.count()
    offset = (page - 1) * page_size
    logs = query.order_by(desc(AuditLog.created_at)).offset(offset).limit(page_size).all()

    return {
        "logs": logs,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": total,
            "total_pages": (total + page_size - 1) // page_size if total > 0 else 1
        }
    }


def get_audit_summary(
    db: Session,
    days: int = 7
) -> dict:
    """
    Get audit summary for the last N days.
    """
    start_date = datetime.now() - timedelta(days=days)

    # Total actions
    total = db.query(AuditLog).filter(AuditLog.created_at >= start_date).count()

    # Actions by type
    actions_by_type = db.query(
        AuditLog.action,
        func.count(AuditLog.id).label("count")
    ).filter(AuditLog.created_at >= start_date).group_by(AuditLog.action).all()

    # Actions by user
    actions_by_user = db.query(
        AuditLog.user_username,
        func.count(AuditLog.id).label("count")
    ).filter(
        AuditLog.created_at >= start_date,
        AuditLog.user_username.isnot(None)
    ).group_by(AuditLog.user_username).all()

    # Success rate
    success_count = db.query(AuditLog).filter(
        AuditLog.created_at >= start_date,
        AuditLog.success == 1
    ).count()

    success_rate = round((success_count / total) * 100, 2) if total > 0 else 0

    return {
        "total_actions": total,
        "actions_by_type": {item[0]: item[1] for item in actions_by_type},
        "actions_by_user": {item[0]: item[1] for item in actions_by_user},
        "success_rate": success_rate,
        "period": {
            "start": start_date.isoformat(),
            "end": datetime.now().isoformat(),
            "days": days
        }
    }


def log_anomaly_resolution(
    db: Session,
    user_id: int,
    username: str,
    dispatch_id: str,
    previous_status: str,
    new_status: str,
    notes: str = ""
):
    """Log an anomaly resolution event."""
    return create_audit_log(
        db=db,
        user_id=user_id,
        username=username,
        action="RESOLVE_ANOMALY",
        resource="ANOMALY",
        resource_id=dispatch_id,
        details={
            "previous_status": previous_status,
            "new_status": new_status,
            "notes": notes
        },
        previous_state={"status": previous_status},
        new_state={"status": new_status},
        success=1
    )


def log_sync_event(
    db: Session,
    user_id: int = None,
    username: str = None,
    sync_type: str = "EBILLING",
    synced_count: int = 0,
    failed_count: int = 0,
    failed_ids: list = None
):
    """Log an E-Billing sync event."""
    return create_audit_log(
        db=db,
        user_id=user_id,
        username=username or "system",
        action="SYNC_EBILLING",
        resource="INVOICE",
        details={
            "sync_type": sync_type,
            "synced_count": synced_count,
            "failed_count": failed_count,
            "failed_ids": (failed_ids or [])[:10]
        },
        success=1 if failed_count == 0 else 0,
        error_message=f"{failed_count} invoices failed to sync" if failed_count > 0 else None
    )
