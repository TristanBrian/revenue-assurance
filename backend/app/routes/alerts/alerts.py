from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user, get_db, require_permission
from app.models.auth.user import User
from app.schemas.alerts.alert import (
    AlertCreateRequest,
    AlertCreateResponse,
    AlertListResponse,
    MarkReadResponse,
    UnreadCountResponse,
)
from app.services.alerts.alert_service import (
    create_alert,
    get_unread_count,
    list_alerts_for_user,
    mark_all_read,
    mark_alert_read,
)

router = APIRouter()  # prefix="/api/alerts" and tags=["Alerts"] supplied by main.py's include_router()


@router.get("", response_model=AlertListResponse)
def list_my_alerts(
    unread_only: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Every authenticated user's own alert inbox — no extra permission gate
    beyond being logged in, since visibility is already scoped per-alert by
    target_user_id/target_permissions/target_roles (see alert_service._user_can_see).
    """
    items, total, unread_count = list_alerts_for_user(
        db, user, unread_only=unread_only, page=page, page_size=page_size
    )
    return {"items": items, "total": total, "unread_count": unread_count, "page": page, "page_size": page_size}


@router.get("/unread-count", response_model=UnreadCountResponse)
def unread_count(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return {"unread_count": get_unread_count(db, user)}


@router.post("/{alert_id}/read", response_model=MarkReadResponse)
def read_alert(alert_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        newly_read = mark_alert_read(db, alert_id, user.id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
    db.commit()
    return {"status": "success", "marked_read": 1 if newly_read else 0}


@router.post("/read-all", response_model=MarkReadResponse)
def read_all_alerts(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    count = mark_all_read(db, user)
    db.commit()
    return {"status": "success", "marked_read": count}


@router.post("", response_model=AlertCreateResponse)
def broadcast_alert(
    payload: AlertCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("manage_alerts")),
):
    """Manually create/broadcast an alert — the same create_alert() system
    triggers use, so it goes through the same in-app + email path."""
    alert = create_alert(
        db,
        title=payload.title,
        message=payload.message,
        severity=payload.severity,
        category="manual",
        target_permissions=payload.target_permissions,
        target_roles=payload.target_roles,
        target_user_id=payload.target_user_id,
        created_by_user_id=user.id,
        notify_email=payload.notify_email,
    )
    db.commit()
    alert.is_read = False
    return {"status": "success", "alert": alert}
