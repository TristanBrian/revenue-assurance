"""
TermsDocument — the versioned, server-side source of truth for legal text
(Terms & Conditions, Privacy Policy) shown on the consent-gated reset/
accept-terms screens. Content lives here, not in the frontend, so a
version bump is a data change (see scripts/seed_terms_documents.py), not a
frontend deploy.

Exactly one row per document_type should have is_active=True at a time —
enforced at the application layer (services/terms_service.py), not a DB
constraint, since "deactivate the old one, activate the new one" is a
two-statement operation anyway.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.utils.db_connection import Base


class TermsDocument(Base):
    __tablename__ = "terms_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    document_type = Column(String(50), nullable=False, index=True)  # terms_and_conditions | privacy_policy
    version = Column(String(50), nullable=False)
    content = Column(Text, nullable=False)
    content_hash = Column(String(64), nullable=False)  # SHA-256 hex of `content`, computed at seed time
    is_active = Column(Boolean, nullable=False, default=False, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
