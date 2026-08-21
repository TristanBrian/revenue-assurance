"""
ConsentRecord — full audit history of every consent a user has given,
independent of users.terms_accepted_version/terms_accepted_at (which only
cache the *latest* state for fast checks — see services/auth/terms_service.py).
One row per document per acceptance event: accepting the combined "Terms &
Conditions and Privacy Policy" checkbox writes two rows here (one per
document_type), not one, so each document's version/hash history is
individually reconstructable later (e.g. "what exact text did this user
agree to on this date").
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.utils.db_connection import Base


class ConsentRecord(Base):
    __tablename__ = "consent_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    document_type = Column(String(50), nullable=False, index=True)  # terms_and_conditions | privacy_policy
    document_version = Column(String(50), nullable=False)
    document_hash = Column(String(64), nullable=False)  # SHA-256 hex of the exact text shown at acceptance time
    accepted_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(Text, nullable=True)
