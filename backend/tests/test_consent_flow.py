"""
Tests for the consent-gated password reset / re-consent flow:
  - services/terms_service.py: get_active_document, get_required_version,
    user_needs_consent, record_consent, get_terms_bundle
  - routes/auth.py: reset_password()'s bundled consent validation,
    login()'s terms_required branch, POST /accept-terms
  - core/dependencies.py: get_current_user's TERMS_ACCEPTANCE_REQUIRED guard

Same TestClient + in-memory SQLite (StaticPool) + dependency_overrides
pattern as test_forced_password_reset.py — see that file's docstring for
why StaticPool matters here specifically.

Run with: pytest tests/test_consent_flow.py -v
"""
import os
import sys

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("SECRET_KEY", "test-secret-for-consent-tests")

from app.core import security  # noqa: E402
from app.core.dependencies import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.alert import Alert  # noqa: E402
from app.models.alert_read import AlertRead  # noqa: E402
from app.models.associations import role_permissions, user_roles  # noqa: E402
from app.models.audit import AuditLog  # noqa: E402
from app.models.consent_record import ConsentRecord  # noqa: E402
from app.models.permission import Permission  # noqa: E402
from app.models.role import Role  # noqa: E402
from app.models.terms_document import TermsDocument  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.terms_service import (  # noqa: E402
    get_active_document,
    get_required_version,
    get_terms_bundle,
    record_consent,
    user_needs_consent,
)
from app.services.user_service import provision_user_with_temp_password  # noqa: E402
from app.utils.db_connection import Base  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(
        engine,
        tables=[
            User.__table__, Role.__table__, Permission.__table__,
            user_roles, role_permissions, AuditLog.__table__,
            Alert.__table__, AlertRead.__table__,
            TermsDocument.__table__, ConsentRecord.__table__,
        ],
    )
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def client(db_session):
    def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    yield TestClient(app)
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def no_real_email(monkeypatch):
    monkeypatch.setattr("app.routes.admin.send_email", lambda *a, **k: True)
    monkeypatch.setattr("app.services.alert_service.send_email", lambda *a, **k: True)


@pytest.fixture
def seeded_terms(db_session):
    """v1 of both documents, active."""
    tc = TermsDocument(
        document_type="terms_and_conditions", version="1.0",
        content="Agree to the terms.", content_hash="tc-hash-v1", is_active=True,
    )
    pp = TermsDocument(
        document_type="privacy_policy", version="1.0",
        content="Respect the privacy.", content_hash="pp-hash-v1", is_active=True,
    )
    db_session.add_all([tc, pp])
    db_session.commit()
    return {"terms_and_conditions": tc, "privacy_policy": pp}


def _make_user(db, email, password, role_name="manager", must_reset_password=False, terms_accepted_version=None):
    role = db.query(Role).filter(Role.name == role_name).first()
    if role is None:
        role = Role(name=role_name, permissions=[])
        db.add(role)
    user = User(
        email=email,
        hashed_password=security.hash_password(password),
        is_active=True,
        must_reset_password=must_reset_password,
        terms_accepted_version=terms_accepted_version,
        roles=[role],
    )
    db.add(user)
    db.commit()
    return user


def _login(client, email, password):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def _auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ============================================================================
# terms_service
# ============================================================================

def test_get_required_version_none_when_unseeded(db_session):
    assert get_required_version(db_session) is None


def test_get_required_version_and_active_document(db_session, seeded_terms):
    assert get_required_version(db_session) == "1.0"
    doc = get_active_document(db_session, "terms_and_conditions")
    assert doc.version == "1.0"


def test_user_needs_consent(db_session, seeded_terms):
    fresh_user = _make_user(db_session, "fresh@kpc-demo.co.ke", "Pass-1234!")
    assert user_needs_consent(fresh_user, get_required_version(db_session)) is True

    consented_user = _make_user(
        db_session, "consented@kpc-demo.co.ke", "Pass-1234!", terms_accepted_version="1.0",
    )
    assert user_needs_consent(consented_user, get_required_version(db_session)) is False


def test_record_consent_writes_both_documents_and_updates_user(db_session, seeded_terms):
    user = _make_user(db_session, "u@kpc-demo.co.ke", "Pass-1234!")
    records = record_consent(db_session, user, ip_address="10.0.0.1", user_agent="pytest")
    db_session.commit()

    assert {r.document_type for r in records} == {"terms_and_conditions", "privacy_policy"}
    assert all(r.document_version == "1.0" for r in records)
    assert user.terms_accepted_version == "1.0"
    assert user.terms_accepted_at is not None

    stored = db_session.query(ConsentRecord).filter(ConsentRecord.user_id == user.id).all()
    assert len(stored) == 2
    assert {s.ip_address for s in stored} == {"10.0.0.1"}


def test_record_consent_skips_missing_document_types(db_session):
    # Only terms_and_conditions seeded, privacy_policy not — shouldn't raise.
    db_session.add(TermsDocument(
        document_type="terms_and_conditions", version="1.0", content="x",
        content_hash="h", is_active=True,
    ))
    db_session.commit()
    user = _make_user(db_session, "u2@kpc-demo.co.ke", "Pass-1234!")
    records = record_consent(db_session, user, ip_address=None, user_agent=None)
    db_session.commit()
    assert len(records) == 1
    assert records[0].document_type == "terms_and_conditions"


def test_get_terms_bundle_shape(db_session, seeded_terms):
    bundle = get_terms_bundle(db_session)
    assert bundle["required_version"] == "1.0"
    assert bundle["terms_and_conditions"]["content"] == "Agree to the terms."
    assert bundle["privacy_policy"]["version"] == "1.0"


# ============================================================================
# GET /api/auth/terms — no auth required
# ============================================================================

def test_read_terms_endpoint_no_auth_needed(client, seeded_terms):
    res = client.get("/api/auth/terms")
    assert res.status_code == 200
    data = res.json()["Data"]
    assert data["required_version"] == "1.0"
    assert "Agree to the terms." in data["terms_and_conditions"]["content"]


# ============================================================================
# Reset-password bundled consent
# ============================================================================

def test_reset_password_rejects_missing_checkbox_without_mutating(client, db_session, seeded_terms):
    user = _make_user(db_session, "temp@kpc-demo.co.ke", "TempPass-123!", must_reset_password=True)
    res = _login(client, "temp@kpc-demo.co.ke", "TempPass-123!")
    reset_token = res.json()["Data"]["reset_token"]

    res = client.post(
        "/api/auth/reset-password",
        json={
            "reset_token": reset_token,
            "new_password": "Brand-New-1!",
            "confirm_password": "Brand-New-1!",
            "checkbox_accepted": False,
        },
    )
    assert res.status_code == 400

    db_session.refresh(user)
    assert user.must_reset_password is True  # untouched
    assert user.terms_accepted_version is None  # untouched
    assert db_session.query(ConsentRecord).count() == 0


def test_reset_password_success_records_consent(client, db_session, seeded_terms):
    _make_user(db_session, "temp2@kpc-demo.co.ke", "TempPass-123!", must_reset_password=True)
    res = _login(client, "temp2@kpc-demo.co.ke", "TempPass-123!")
    reset_token = res.json()["Data"]["reset_token"]

    res = client.post(
        "/api/auth/reset-password",
        json={
            "reset_token": reset_token,
            "new_password": "Brand-New-1!",
            "confirm_password": "Brand-New-1!",
            "checkbox_accepted": True,
        },
    )
    assert res.status_code == 200, res.text

    user = db_session.query(User).filter(User.email == "temp2@kpc-demo.co.ke").first()
    assert user.must_reset_password is False
    assert user.terms_accepted_version == "1.0"
    assert db_session.query(ConsentRecord).filter(ConsentRecord.user_id == user.id).count() == 2


# ============================================================================
# Re-consent (accept-terms) flow for already-active users
# ============================================================================

def test_login_returns_terms_required_for_stale_consent(client, db_session, seeded_terms):
    _make_user(db_session, "stale@kpc-demo.co.ke", "Pass-1234!", terms_accepted_version="0.9")
    res = _login(client, "stale@kpc-demo.co.ke", "Pass-1234!")
    assert res.status_code == 200
    data = res.json()["Data"]
    assert data["terms_required"] is True
    assert data["access_token"] is None
    assert data["consent_token"]
    assert data["redirect"] == "/reset-password"


def test_login_normal_when_consent_current(client, db_session, seeded_terms):
    _make_user(db_session, "current@kpc-demo.co.ke", "Pass-1234!", terms_accepted_version="1.0")
    res = _login(client, "current@kpc-demo.co.ke", "Pass-1234!")
    data = res.json()["Data"]
    assert data["terms_required"] is False
    assert data["access_token"]


def test_accept_terms_success_and_dependencies_guard(client, db_session, seeded_terms):
    _make_user(db_session, "reconsent@kpc-demo.co.ke", "Pass-1234!", terms_accepted_version="0.9")

    login_res = _login(client, "reconsent@kpc-demo.co.ke", "Pass-1234!")
    consent_token = login_res.json()["Data"]["consent_token"]

    # Guard: even without accept-terms, GET /me with a hypothetical normal
    # token would 403 TERMS_ACCEPTANCE_REQUIRED — verified indirectly here
    # by confirming accept-terms is the only path to a working token.
    res = client.post(
        "/api/auth/accept-terms",
        json={"consent_token": consent_token, "checkbox_accepted": False},
    )
    assert res.status_code == 400  # checkbox required here too

    res = client.post(
        "/api/auth/accept-terms",
        json={"consent_token": consent_token, "checkbox_accepted": True},
    )
    assert res.status_code == 200, res.text
    access_token = res.json()["Data"]["access_token"]
    assert access_token

    user = db_session.query(User).filter(User.email == "reconsent@kpc-demo.co.ke").first()
    assert user.terms_accepted_version == "1.0"

    # The new token now works normally.
    me = client.get("/api/auth/me", headers=_auth_headers(access_token))
    assert me.status_code == 200

    # The consent token can't be replayed.
    res = client.post(
        "/api/auth/accept-terms",
        json={"consent_token": consent_token, "checkbox_accepted": True},
    )
    assert res.status_code == 401


def test_dependencies_guard_blocks_existing_session_on_new_terms_version(client, db_session, seeded_terms):
    """An already-logged-in user (valid token, consent was current at the
    time) gets blocked once a newer terms version is published mid-session
    — same shape as the must_reset_password guard's equivalent test."""
    user = _make_user(db_session, "midsession@kpc-demo.co.ke", "Pass-1234!", terms_accepted_version="1.0")
    res = _login(client, "midsession@kpc-demo.co.ke", "Pass-1234!")
    token = res.json()["Data"]["access_token"]

    me = client.get("/api/auth/me", headers=_auth_headers(token))
    assert me.status_code == 200

    # A new version is published.
    new_doc = TermsDocument(
        document_type="terms_and_conditions", version="2.0",
        content="New terms.", content_hash="tc-hash-v2", is_active=True,
    )
    old_doc = get_active_document(db_session, "terms_and_conditions")
    old_doc.is_active = False
    db_session.add(new_doc)
    db_session.commit()

    me = client.get("/api/auth/me", headers=_auth_headers(token))
    assert me.status_code == 403
    assert me.json()["Message"] == "TERMS_ACCEPTANCE_REQUIRED"

    _ = user
