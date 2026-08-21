"""
FraudFeedback model — one row per investigator resolution that carries a
fraud judgment, feeding the retraining loop in services/fraud/
fraud_scoring_service.py.

Deliberately a separate table from AnomalyResolution (models/
reconciliation/anomaly_resolution.py), not an extra column on it:
AnomalyResolution is upserted (one row per anomaly, latest workflow
status wins — see that model's docstring) and dispatch_id is its primary
key; FraudFeedback needs the FULL HISTORY of every fraud judgment ever
given for retraining (an anomaly resolved, reopened, and re-resolved with
a different judgment should keep every judgment, not just the latest),
so it's an append-only log with its own surrogate key instead.

anomaly_id (not a ForeignKey, same reasoning as AnomalyResolution.
dispatch_id): the anomaly's own natural key (dispatch_id-shaped —
dispatch_id/attendance_id/disbursement_id depending on direction). No FK
to any ETL-owned table for the same reason AnomalyResolution has none —
those tables are dropped and recreated by scripts/etl_pipeline.py every
run.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID

from app.utils.db_connection import Base


class FraudFeedback(Base):
    __tablename__ = "fraud_feedback"

    feedback_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    anomaly_id = Column(Text, nullable=False, index=True)
    # "confirmed_fraud" | "false_positive" | "resolved_benign" — not
    # enforced as a DB enum, same untyped-string convention
    # AnomalyResolution.status already uses for this codebase's resolution
    # fields.
    resolution_label = Column(Text, nullable=False)
    resolved_by = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    resolved_at = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True
    )
