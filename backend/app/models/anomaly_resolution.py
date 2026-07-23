"""
AnomalyResolution model — persists the human resolution workflow state
("Resolved" / "Reviewed" / "Assigned" / whatever the caller sends — not
enforced as an enum here, matching the existing /reconcile/update route's
untyped `status: str` param) for a reconciliation anomaly, keyed by
dispatch_id.

dispatch_id is deliberately NOT a ForeignKey to dispatches.dispatch_id:
dispatches is owned by scripts/etl_pipeline.py, which drops and recreates
that table on every run (pandas .to_sql(if_exists='replace')). An FK here
would either block that drop or require ON DELETE CASCADE — which would
silently wipe every resolution the next time synthetic data regenerates,
defeating the point of persisting them. The trade-off is no DB-level
referential integrity: a resolution can reference a dispatch_id that no
longer exists in the current dispatches table.
"""
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Text

from app.utils.db_connection import Base


class AnomalyResolution(Base):
    __tablename__ = "anomaly_resolutions"

    dispatch_id = Column(Text, primary_key=True)
    status = Column(Text, nullable=False)
    notes = Column(Text, nullable=True)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
