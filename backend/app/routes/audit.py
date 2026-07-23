"""
Audit Routes – Endpoints for viewing audit logs

Gated on view_audit (Manager + Revenue Assurance per the README's
permission matrix) — these came over from upstream with no auth at all,
which would let anyone read every user's activity, IPs, and endpoints hit
with no token required. view_audit already exists in scripts/seed_roles.py
for exactly this "Audit Trail" feature row; it just wasn't wired to
anything until now.
"""
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from app.core.dependencies import get_db, require_permission
from app.models.user import User
from app.services.audit import get_audit_logs, get_audit_summary

router = APIRouter()


@router.get("/audit/logs")
async def get_audit_logs_endpoint(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user_id: int = Query(None),
    action: str = Query(None),
    resource: str = Query(None),
    success: bool = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("view_audit")),
):
    """
    Get paginated audit logs with optional filters.
    """
    try:
        result = get_audit_logs(db, page, page_size, user_id, action, resource, success)
        
        return {
            "status": "success",
            "logs": [{
                "id": log.id,
                "user": log.user_username,
                "action": log.action,
                "resource": log.resource,
                "resource_id": log.resource_id,
                "endpoint": log.endpoint,
                "status_code": log.status_code,
                "success": log.success,
                "created_at": log.created_at.isoformat() if log.created_at else None
            } for log in result["logs"]],
            "pagination": result["pagination"]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/audit/summary")
async def get_audit_summary_endpoint(
    days: int = Query(7, ge=1, le=90, description="Number of days to summarize"),
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("view_audit")),
):
    """
    Get audit summary for the last N days.
    """
    try:
        result = get_audit_summary(db, days)
        return {"status": "success", **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/audit/me")
async def get_my_audit_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("view_audit")),
):
    """
    Get audit logs for the current user.

    Still returns an empty list in practice: AuditMiddleware never
    populates request.state.user_id (nothing in the auth flow sets it), so
    every row in audit_logs has user_id NULL regardless of who made the
    request. Gated on view_audit rather than left open now, but the
    per-user filtering itself needs that wiring to actually do anything —
    flagging as a follow-up rather than fixing here.
    """
    return {
        "status": "success",
        "message": "Per-user audit attribution isn't wired up yet — see the docstring above.",
        "logs": []
    }
