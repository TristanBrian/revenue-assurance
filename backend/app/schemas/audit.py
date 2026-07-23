"""
Pydantic schemas for audit logs
"""
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime


# --- Request Schemas ---
class AuditFilter(BaseModel):
    user_id: Optional[int] = None
    action: Optional[str] = None
    resource: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    success: Optional[bool] = None
    status_code: Optional[int] = None


class AuditCreate(BaseModel):
    user_id: Optional[int] = None
    user_username: Optional[str] = None
    action: str
    resource: Optional[str] = None
    resource_id: Optional[str] = None
    method: Optional[str] = None
    endpoint: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    status_code: Optional[int] = None
    success: int = 1
    error_message: Optional[str] = None
    details: Optional[Dict[str, Any]] = None
    previous_state: Optional[Dict[str, Any]] = None
    new_state: Optional[Dict[str, Any]] = None


# --- Response Schemas ---
class AuditLogOut(BaseModel):
    id: int
    user_id: Optional[int] = None
    user_username: Optional[str] = None
    action: str
    resource: Optional[str] = None
    resource_id: Optional[str] = None
    method: Optional[str] = None
    endpoint: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    status_code: Optional[int] = None
    success: int
    error_message: Optional[str] = None
    details: Optional[Dict[str, Any]] = None
    previous_state: Optional[Dict[str, Any]] = None
    new_state: Optional[Dict[str, Any]] = None
    created_at: datetime

    class Config:
        from_attributes = True


class AuditLogsResponse(BaseModel):
    status: str
    logs: List[AuditLogOut]
    pagination: Dict[str, Any]


class AuditSummary(BaseModel):
    total_actions: int
    actions_by_type: Dict[str, int]
    actions_by_user: Dict[str, int]
    success_rate: float
    period: Dict[str, str]