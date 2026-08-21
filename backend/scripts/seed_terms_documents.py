"""
Seeds v1 of the Terms & Conditions and Privacy Policy shown on the
consent-gated password reset / re-consent screens.

*** DRAFT TEXT — NOT REVIEWED BY LEGAL COUNSEL ***
The wording below (especially the confidentiality/acceptable-use clause
and its consequences language) is a placeholder to make the consent flow
functionally complete end to end. It is deliberately NOT a fixed penalty
amount, per the spec this was built against ("consequences language...
rather than a fixed penalty sum — pending legal review"). Replace this
content (bump TERMS_VERSION and re-run this script) once KPC's legal team
has reviewed and approved real text — don't ship this as-is to real users.

Idempotent / self-healing, same convention as seed_roles.py: re-running
with an unchanged TERMS_VERSION is a no-op if that version is already the
active one; bumping TERMS_VERSION deactivates the previous version and
activates the new one, which is what forces every user back through
re-consent (see services/terms_service.py, app/core/dependencies.py's guard).

Run with (from backend/, same as seed_roles.py):
    python scripts/seed_terms_documents.py
"""
import hashlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models.auth.terms_document import TermsDocument
from app.utils.db_connection import SessionLocal

TERMS_VERSION = "1.0"

TERMS_AND_CONDITIONS = """\
KPC REVENUE ASSURANCE PLATFORM — TERMS & CONDITIONS
Version 1.0 (DRAFT — pending KPC legal review)

1. ACCEPTANCE
By checking "I have read and agree to the Terms & Conditions and Privacy
Policy" and continuing, you agree to be bound by these Terms as a
condition of accessing this platform.

2. AUTHORIZED USE
This platform is provided solely for KPC's internal Order-to-Cash
reconciliation, fraud detection, and e-billing operations. Access is
granted per-account, tied to your assigned role (Depot Supervisor,
Manager, Revenue Assurance, or System Admin), and must not be shared.

3. CONFIDENTIALITY AND ACCEPTABLE USE — OMC AND KPC OPERATIONAL DATA
All data accessible through this platform — including but not limited to
dispatch records, invoices, payments, reconciliation results, anomaly
detail, OMC (Oil Marketing Company) identities and risk profiles, and any
derived report, export, or screenshot — is confidential KPC and OMC
operational data.

You must NOT disclose, transmit, reproduce, or otherwise share any such
data, in whole or in part, through any means — including but not limited
to spoken disclosure, screenshots, screen recordings, printed copies,
exported files (CSV, Excel, PDF, or any other format), email, messaging
applications, or any other channel — to any person or system not
explicitly authorized to receive it as part of your official KPC duties.

This obligation survives your access to the platform and continues after
your account is deactivated or your role changes.

Violation of this clause may result in disciplinary action up to and
including termination of employment or contract, and may result in legal
action, in accordance with KPC policy and applicable law. [Specific
penalties and procedures pending formal legal review.]

4. ACCOUNT SECURITY
You are responsible for safeguarding your credentials and for all activity
under your account. Report suspected unauthorized access immediately to
your system administrator.

5. AUDIT AND MONITORING
Your use of this platform, including login activity, data access, and
consequential actions, is logged and may be reviewed for security,
compliance, and audit purposes.

6. CHANGES TO THESE TERMS
KPC may update these Terms from time to time. Continued use of the
platform after a new version is published requires re-acceptance of the
updated Terms.

[This is placeholder text for platform development purposes and has not
been reviewed or approved by KPC legal counsel.]
"""

PRIVACY_POLICY = """\
KPC REVENUE ASSURANCE PLATFORM — PRIVACY POLICY
Version 1.0 (DRAFT — pending KPC legal review)

1. INFORMATION WE COLLECT
Account information (name, email, assigned role), authentication activity
(login timestamps, IP address, user agent), and your actions within the
platform (anomaly resolutions, exports, e-billing syncs, and similar
consequential actions) are recorded as part of the platform's audit trail.

2. HOW WE USE THIS INFORMATION
This information is used to operate the platform, enforce role-based
access control, investigate security incidents, and demonstrate compliance
with KPC's internal audit requirements. It is not used for any purpose
unrelated to these operations.

3. DATA RETENTION
Audit trail and consent records are retained for as long as your account
exists and for a reasonable period afterward, to satisfy audit and
compliance obligations.

4. YOUR CONSENT RECORD
Each time you accept this Privacy Policy or the Terms & Conditions, a
record is kept of the exact document version and text you accepted, the
time of acceptance, and the IP address/browser used — this record is
itself part of the platform's audit trail and is retained accordingly.

5. THIRD PARTIES
Reconciliation, fraud-detection, and e-billing data is not shared outside
KPC's internal systems and its authorized integration with KRA's iCMS
e-billing system, except as required by law.

[This is placeholder text for platform development purposes and has not
been reviewed or approved by KPC legal counsel.]
"""


def _hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def seed():
    db = SessionLocal()
    try:
        for document_type, content in (
            ("terms_and_conditions", TERMS_AND_CONDITIONS),
            ("privacy_policy", PRIVACY_POLICY),
        ):
            existing_active = (
                db.query(TermsDocument)
                .filter(TermsDocument.document_type == document_type, TermsDocument.is_active.is_(True))
                .first()
            )
            if existing_active and existing_active.version == TERMS_VERSION:
                print(f"{document_type} v{TERMS_VERSION} already active — nothing to do.")
                continue

            if existing_active:
                existing_active.is_active = False
                print(f"Deactivated {document_type} v{existing_active.version}")

            same_version = (
                db.query(TermsDocument)
                .filter(TermsDocument.document_type == document_type, TermsDocument.version == TERMS_VERSION)
                .first()
            )
            if same_version:
                same_version.is_active = True
                same_version.content = content
                same_version.content_hash = _hash(content)
                print(f"Reactivated existing {document_type} v{TERMS_VERSION}")
            else:
                db.add(TermsDocument(
                    document_type=document_type,
                    version=TERMS_VERSION,
                    content=content,
                    content_hash=_hash(content),
                    is_active=True,
                ))
                print(f"Created {document_type} v{TERMS_VERSION}")

        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    seed()
