"""
Pydantic schemas for routes/alerts/alerts.py, backed by app/models/alerts/alert.py's
Alert SQLAlchemy model (see also alert_read.py). Same UUID-stringify
convention as schemas/audit.py.
"""
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AlertOut(BaseModel):
    id: str
    title: str
    message: str
    severity: str
    tier: str
    category: str
    target_permissions: Optional[list[str]] = None
    target_roles: Optional[list[str]] = None
    related_type: Optional[str] = None
    related_id: Optional[str] = None
    email_sent: bool
    created_at: datetime
    # Not a DB column — set per-request by alert_service.list_alerts_for_user()
    # / get_alert_for_user() from the viewer's own alert_reads row.
    is_read: bool = False

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", "related_type", "related_id", mode="before")
    @classmethod
    def _stringify(cls, v: Any) -> Optional[str]:
        return str(v) if v is not None else v


class AlertListResponse(BaseModel):
    """GET /api/alerts"""
    items: list[AlertOut]
    total: int
    unread_count: int
    page: int
    page_size: int


class UnreadCountResponse(BaseModel):
    """GET /api/alerts/unread-count"""
    unread_count: int


class MarkReadResponse(BaseModel):
    """POST /api/alerts/{alert_id}/read, POST /api/alerts/read-all"""
    status: str
    marked_read: int


class AlertCreateRequest(BaseModel):
    """POST /api/alerts — manual/broadcast alert, gated by manage_alerts."""
    title: str = Field(..., min_length=1, max_length=255)
    message: str = Field(..., min_length=1)
    severity: str = Field("info", pattern="^(info|warning|critical)$")
    # target_user_id takes precedence if set; otherwise visible to anyone
    # holding any permission in target_permissions OR any role in
    # target_roles (OR semantics across both). All unset = visible to
    # every authenticated user (see alert_service.create_alert's docstring).
    target_permissions: Optional[list[str]] = None
    target_roles: Optional[list[str]] = None
    target_user_id: Optional[str] = None
    notify_email: bool = True


class AlertCreateResponse(BaseModel):
    status: str
    alert: AlertOut
