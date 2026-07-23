"""
Pydantic schemas for routes/audit.py, backed by app/models/audit.py's
AuditLog SQLAlchemy model.
"""
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, field_validator


class AuditLogOut(BaseModel):
    id: str
    actor_user_id: Optional[str] = None
    action: str
    target_type: Optional[str] = None
    target_id: Optional[str] = None
    before_value: Optional[Any] = None
    after_value: Optional[Any] = None
    extra_metadata: Optional[Any] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", "actor_user_id", mode="before")
    @classmethod
    def _stringify_uuid(cls, v: Any) -> Optional[str]:
        # ORM id / actor_user_id are uuid.UUID; Pydantic's plain `str`
        # type does not auto-coerce UUID -> str, so do it explicitly.
        return str(v) if v is not None else v


class AuditLogListResponse(BaseModel):
    """GET /api/audit/logs"""
    items: list[AuditLogOut]
    total: int
    page: int
    page_size: int
