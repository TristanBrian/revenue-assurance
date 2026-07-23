"""
Audit Routes – Endpoints for viewing audit logs
"""
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from app.services.audit import get_audit_logs, get_audit_summary
from app.utils.db_connection import SessionLocal

router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/audit/logs")
async def get_audit_logs_endpoint(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user_id: int = Query(None),
    action: str = Query(None),
    resource: str = Query(None),
    success: bool = Query(None),
    db: Session = Depends(get_db)
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
    db: Session = Depends(get_db)
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
    db: Session = Depends(get_db)
):
    """
    Get audit logs for the current user.
    """
    # In a real app, you'd get the current user from auth
    return {
        "status": "success",
        "message": "User authentication required for this endpoint",
        "logs": []
    }
