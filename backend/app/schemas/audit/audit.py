"""
Pydantic schemas for routes/audit/audit.py, backed by app/models/audit/audit.py's
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
    """GET /api/audit/logs, GET /api/audit/me"""
    items: list[AuditLogOut]
    total: int
    page: int
    page_size: int


class AuditSummaryResponse(BaseModel):
    """GET /api/audit/summary"""
    total_actions: int
    actions_by_type: dict[str, int]
    actions_by_actor: dict[str, int]
    period_days: int
    since: datetime


# --- GET /api/audit/verify — immutable audit trail extension ---
# Mirrors the dict shapes services/audit/audit_service.verify_chain_
# integrity() and services/audit/anchor_service.verify_on_chain_anchor()
# actually return (verified via AST inspection, same convention as this
# module's header note) — both intentionally return a plain dict rather
# than a dataclass since their shape varies by which branch runs (an
# unconfigured/never-anchored/mismatched result carries different keys
# than a fully-checked one); Optional=None here for whichever keys a
# given branch doesn't set.

class LocalChainVerification(BaseModel):
    intact: bool
    broken_at_block_index: Optional[int] = None
    reason: Optional[str] = None
    chain_length: int
    tip_block_index: Optional[int] = None
    tip_block_hash: Optional[str] = None


class OnChainAnchorVerification(BaseModel):
    configured: bool
    checked: bool
    matches: Optional[bool] = None
    reason: Optional[str] = None
    anchor_block_index: Optional[int] = None
    local_block_hash: Optional[str] = None
    on_chain_chain_tip_hash: Optional[str] = None
    tx_hash: Optional[str] = None
    base_block_number: Optional[int] = None
    anchored_at: Optional[datetime] = None


class AuditVerifyResponse(BaseModel):
    """GET /api/audit/verify — two independent results, deliberately not
    collapsed into one "is everything okay" boolean: local_chain.intact
    answers "has any row been tampered with", on_chain_anchor.matches
    answers "does even the DB admin's own view of the chain agree with
    what was independently committed on Base Sepolia" — see that
    endpoint's docstring for why both are shown separately in the demo."""
    status: str
    local_chain: LocalChainVerification
    on_chain_anchor: OnChainAnchorVerification
