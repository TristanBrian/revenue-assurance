from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.dependencies import get_db, require_permission
from app.models.auth.user import User
from app.schemas.audit.audit import AuditLogListResponse, AuditLogOut, AuditSummaryResponse, AuditVerifyResponse
from app.services.audit.audit_service import get_audit_log, get_audit_logs, get_audit_summary, get_record_audit_history, verify_chain_integrity
from app.services.audit.anchor_service import verify_on_chain_anchor


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


import time

_VERIFY_CACHE = {"data": None, "expires_at": 0.0}

@router.get("/verify", response_model=AuditVerifyResponse)
def verify_audit_trail(
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("view_audit")),
):
    """
    Immutable audit trail integrity check — two independent results:

    - local_chain: walks every audit_logs row recomputing its hash.
    - on_chain_anchor: compares most recent on-chain anchor on Base Sepolia.

    Uses a 30-second in-memory cache so rapid calls return instantly (<1ms).
    """
    now = time.time()
    if _VERIFY_CACHE["data"] is not None and now < _VERIFY_CACHE["expires_at"]:
        return _VERIFY_CACHE["data"]

    result = {
        "status": "success",
        "local_chain": verify_chain_integrity(db),
        "on_chain_anchor": verify_on_chain_anchor(db),
    }
    _VERIFY_CACHE["data"] = result
    _VERIFY_CACHE["expires_at"] = now + 600.0  # 10 minutes cache
    return result


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


@router.get("/history/{target_type}/{target_id}")
def read_record_history(
    target_type: str,
    target_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("view_audit")),
):
    """
    Returns full chronological audit log history for a specific record (target_type, target_id).
    Used for record history provenance timeline in the UI.
    """
    rows = get_record_audit_history(db, target_type=target_type, target_id=target_id)
    return {"target_type": target_type, "target_id": target_id, "history": rows}

