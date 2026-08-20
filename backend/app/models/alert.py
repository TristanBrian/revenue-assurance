"""
Alert model — backs GET/POST /api/alerts and services/alert_service.py.
Every alert's tier and audience are driven by services/alert_types.py's
registry (see that module's docstring for the target_permissions vs.
target_roles distinction) rather than each caller inventing its own.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, JSON, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.utils.db_connection import Base

# JSONB in Postgres, falling back to plain JSON under SQLite — same pattern
# as models/audit.py, for the same reason (tests run against in-memory SQLite).
_JSONVariant = JSONB().with_variant(JSON(), "sqlite")


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    severity = Column(String(20), nullable=False, default="info")  # info | warning | critical
    tier = Column(String(20), nullable=False, default="immediate")  # immediate | digested | throttled | transactional
    category = Column(String(50), nullable=False, default="manual", index=True)
    # e.g. "critical_anomaly", "ebilling_dlq" — an AlertType value (see
    # alert_types.py), or "manual" for an admin-broadcast alert.

    # Visibility: a specific user (target_user_id) if set, otherwise every
    # active user holding ANY permission in target_permissions OR ANY role
    # in target_roles — OR semantics across both lists. All three unset =
    # visible to every authenticated user (a general announcement).
    target_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    target_permissions = Column(_JSONVariant, nullable=True)  # list[str] or null
    target_roles = Column(_JSONVariant, nullable=True)  # list[str] or null
    # Four-eyes exclusion (e.g. admin_sensitive_action): the acting user is
    # excluded from BOTH channels, not just the email — persisted here
    # rather than only applied transiently at creation time, so they also
    # never see their own action surface in their own in-app inbox.
    exclude_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # Mirrors audit.py's target_type/target_id: what this alert is about.
    # Used to de-duplicate system-generated alerts (see
    # alert_service.alert_exists()) so re-running reconciliation doesn't
    # re-alert/re-email for a dispatch already flagged.
    related_type = Column(String(50), nullable=True)
    related_id = Column(String(100), nullable=True, index=True)

    email_sent = Column(Boolean, nullable=False, default=False)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)

    reads = relationship("AlertRead", back_populates="alert", cascade="all, delete-orphan")
