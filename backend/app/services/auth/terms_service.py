"""
Terms/consent business logic — backs routes/auth.py's terms bundle,
reset-password, and accept-terms endpoints. Framework-agnostic on purpose
(no FastAPI imports), same convention as the other services.

Both tracked documents (terms_and_conditions, privacy_policy) are versioned
together by convention — scripts/seed_terms_documents.py always seeds them
with the same version string when bumping either, since the product
presents them as one combined checkbox/acceptance action, and users only
has a single terms_accepted_version column to cache against (see
models/user.py). Nothing here *enforces* the two staying in lockstep — if
you ever need them versioned independently, users would need a second
cache column and get_required_version()'s "one version to rule them all"
assumption would need to change with it.
"""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.models.auth.consent_record import ConsentRecord
from app.models.auth.terms_document import TermsDocument
from app.models.auth.user import User
from app.services.audit.audit_service import log_action

DOCUMENT_TYPES = ("terms_and_conditions", "privacy_policy")


def get_active_document(db: Session, document_type: str) -> Optional[TermsDocument]:
    return (
        db.query(TermsDocument)
        .filter(TermsDocument.document_type == document_type, TermsDocument.is_active.is_(True))
        .order_by(TermsDocument.created_at.desc())
        .first()
    )


def get_required_version(db: Session) -> Optional[str]:
    """The version every user must have accepted. Derived from the active
    terms_and_conditions document specifically (see module docstring) —
    None if nothing's been seeded yet, which callers should treat as
    "consent gating isn't configured", not "block everyone forever"."""
    doc = get_active_document(db, "terms_and_conditions")
    return doc.version if doc else None


def user_needs_consent(user: User, required_version: Optional[str]) -> bool:
    if required_version is None:
        return False
    return user.terms_accepted_version != required_version


def get_terms_bundle(db: Session) -> dict:
    """GET /api/auth/terms — the full text + version for both documents,
    for the frontend to render. No auth required (see routes/auth.py's
    docstring on why): a user in the middle of the reset/consent flow
    doesn't have a normal session token yet."""
    bundle = {}
    for doc_type in DOCUMENT_TYPES:
        doc = get_active_document(db, doc_type)
        bundle[doc_type] = (
            {"version": doc.version, "content": doc.content} if doc else None
        )
    bundle["required_version"] = get_required_version(db)
    return bundle


def record_consent(
    db: Session,
    user: User,
    ip_address: Optional[str],
    user_agent: Optional[str],
    actor_user_id=None,
) -> list[ConsentRecord]:
    """
    Writes one ConsentRecord per currently-active document (both
    terms_and_conditions and privacy_policy, if configured), then updates
    users.terms_accepted_version/at as the fast-check cache. Does NOT
    commit — same contract as audit_service.log_action / alert_service.
    create_alert: caller commits as part of its own transaction, so
    consent is atomic with whatever action it's gating (password reset or
    the standalone accept-terms call).

    A document_type with no active row is silently skipped, not an error —
    lets terms_and_conditions and privacy_policy be introduced independently
    (e.g. privacy_policy not seeded yet in an early deployment) without
    this raising.
    """
    records = []
    required_version = get_required_version(db)

    for doc_type in DOCUMENT_TYPES:
        doc = get_active_document(db, doc_type)
        if doc is None:
            continue
        record = ConsentRecord(
            user_id=user.id,
            document_type=doc_type,
            document_version=doc.version,
            document_hash=doc.content_hash,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        db.add(record)
        records.append(record)

    if required_version is not None:
        user.terms_accepted_version = required_version
        user.terms_accepted_at = datetime.now(timezone.utc)

    log_action(
        db,
        actor_user_id=actor_user_id if actor_user_id is not None else user.id,
        action="consent.accepted",
        target_type="user",
        target_id=str(user.id),
        after={"terms_accepted_version": required_version, "documents": [r.document_type for r in records]},
    )

    return records
