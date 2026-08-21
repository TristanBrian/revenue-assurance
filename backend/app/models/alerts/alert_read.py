"""
Per-user read-state for alerts. A broadcast Alert (visible to every user
holding its target_permission) is one row shared by many viewers, so "has
this user read it" can't live on the Alert row itself — each viewer needs
their own read marker without mutating the shared alert. See alert.py.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.utils.db_connection import Base


class AlertRead(Base):
    __tablename__ = "alert_reads"
    __table_args__ = (UniqueConstraint("alert_id", "user_id", name="uq_alert_reads_alert_user"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    alert_id = Column(UUID(as_uuid=True), ForeignKey("alerts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    read_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    alert = relationship("Alert", back_populates="reads")
