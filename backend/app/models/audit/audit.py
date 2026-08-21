"""
AuditLog model — persists the security/compliance audit trail (anomaly
resolution, e-billing sync/retry, user administration, login attempts).
Real ORM class (UUID PK), same pattern as models/user.py, since audit logs
need real filtering/querying (by actor, action, target, date range) unlike
the raw-pandas reconciliation/e-billing tables.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, JSON, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.utils.db_connection import Base

# JSONB in Postgres (production); falls back to the generic JSON type
# under SQLite so tests/test_audit_service.py can exercise the real model
# against an in-memory SQLite engine without a Postgres dependency.
_JSONVariant = JSONB().with_variant(JSON(), "sqlite")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    # Nullable: null = no authenticated actor exists yet (failed login
    # attempt) or a system-triggered action. ON DELETE SET NULL rather than
    # the FK default (RESTRICT) so deleting a user later (DELETE
    # /api/admin/users/{id}) can't be blocked by that user's own audit
    # history — the log entry survives, just loses the actor reference.
    actor_user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action = Column(Text, nullable=False, index=True)  # stable code, e.g. "anomaly.resolve", "user.create"
    target_type = Column(Text, nullable=True, index=True)  # e.g. "dispatch", "invoice", "user"
    target_id = Column(Text, nullable=True, index=True)
    before_value = Column(_JSONVariant, nullable=True)
    after_value = Column(_JSONVariant, nullable=True)
    extra_metadata = Column(_JSONVariant, nullable=True)
    created_at = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True
    )
