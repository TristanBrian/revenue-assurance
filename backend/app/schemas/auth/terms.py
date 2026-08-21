"""
Pydantic schemas for the terms/consent endpoints in routes/auth/auth.py, backed
by services/auth/terms_service.py.
"""
from typing import Optional

from pydantic import BaseModel


class TermsDocumentOut(BaseModel):
    version: str
    content: str


class TermsBundleResponse(BaseModel):
    """GET /api/auth/terms — everything the reset-password / accept-terms
    screen needs to render. A document key is null if that document type
    hasn't been seeded yet (see terms_service.get_terms_bundle)."""
    terms_and_conditions: Optional[TermsDocumentOut] = None
    privacy_policy: Optional[TermsDocumentOut] = None
    required_version: Optional[str] = None


class AcceptTermsRequest(BaseModel):
    """POST /api/auth/accept-terms — the re-consent variant for an
    already-active user whose terms_accepted_version is stale. No password
    fields; consent_token is the short-lived token from LoginResponse.
    consent_token (create_terms_consent_token), not a normal Authorization
    bearer token."""
    consent_token: str
    checkbox_accepted: bool


class AcceptTermsResponse(BaseModel):
    """On success, a normal full session token — same shape as
    ResetPasswordResponse."""
    access_token: str
    token_type: str = "bearer"
