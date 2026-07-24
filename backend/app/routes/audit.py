from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.dependencies import get_db, require_permission
from app.models.user import User
from app.schemas.audit import AuditLogListResponse, AuditLogOut, AuditSummaryResponse
from app.services.audit_service import get_audit_log, get_audit_logs, get_audit_summary

router = APIRouter()  # prefix="/api/audit" and tags=["Audit"] are supplied by main.py's include_router(), matching every other route file


@router.get("/logs", response_model=AuditLogListResponse)
def list_audit_logs(
    actor_user_id: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    target_type: Optional[str] = Query(None),
    target_id: Optional[str] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    page: int = Query(1, description="Page number", ge=1),
    page_size: int = Query(50, description="Items per page", ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("view_audit")),
):
    items, total = get_audit_logs(
        db,
        actor_user_id=actor_user_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        date_from=date_from,
        date_to=date_to,
        page=page,
        page_size=page_size,
    )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/logs/{log_id}", response_model=AuditLogOut)
def read_audit_log(
    log_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("view_audit")),
):
    try:
        return get_audit_log(db, log_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit log not found")


@router.get("/summary", response_model=AuditSummaryResponse)
def audit_summary(
    days: int = Query(7, description="Number of days to summarize", ge=1, le=90),
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("view_audit")),
):
    return get_audit_summary(db, days=days)


@router.get("/me", response_model=AuditLogListResponse)
def my_audit_logs(
    page: int = Query(1, description="Page number", ge=1),
    page_size: int = Query(50, description="Items per page", ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("view_audit")),
):
    """
    Unlike GET /logs, this is scoped to the caller's own activity rather
    than filterable by any actor — actor_user_id is fixed to the current
    user, not accepted as a query param.
    """
    items, total = get_audit_logs(db, actor_user_id=str(user.id), page=page, page_size=page_size)
    return {"items": items, "total": total, "page": page, "page_size": page_size}
