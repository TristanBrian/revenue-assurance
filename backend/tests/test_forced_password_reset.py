"""
Tests for the admin-provisioned temp-password / forced-reset flow:
  - core/security.py: generate_temp_password, password_fingerprint,
    create_reset_token/decode_reset_token
  - services/user_service.py: provision_user_with_temp_password,
    regenerate_temp_password
  - routes/auth.py: login()'s reset_required branch, POST /reset-password
  - routes/admin.py: POST /users, POST /users/{id}/resend-temp-password
  - core/dependencies.py: get_current_user's must_reset_password guard and
    reset-token-can't-be-used-as-a-session-token guard

Route-level tests use FastAPI's TestClient against an isolated in-memory
SQLite engine (dependency_overrides on get_db) rather than the app's
configured DATABASE_URL — same reasoning as test_audit_service.py/
test_alert_service.py's own in-memory fixtures, just applied at the route
layer here since this flow spans routes/services/dependencies together.
app.core.email.send_email is monkeypatched everywhere — this must never
place a real SMTP call using whatever real credentials are in .env.

Run with: pytest tests/test_forced_password_reset.py -v
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest
from jose import jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("SECRET_KEY", "test-secret-for-forced-reset-tests")

from app.core import security  # noqa: E402
from app.core.dependencies import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.alert import Alert  # noqa: E402
from app.models.alert_read import AlertRead  # noqa: E402
from app.models.associations import role_permissions, user_roles  # noqa: E402
from app.models.audit import AuditLog  # noqa: E402
from app.models.permission import Permission  # noqa: E402
from app.models.role import Role  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.user_service import (  # noqa: E402
    provision_user_with_temp_password,
    regenerate_temp_password,
)
from app.utils.db_connection import Base  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture
def db_session():
    # StaticPool: TestClient runs the route handler in a worker thread
    # (FastAPI's run_in_threadpool) — SQLAlchemy's default pool for
    # sqlite:///:memory: hands out a fresh (empty) in-memory DB per thread
    # otherwise, so plain create_engine() here would silently 404 every
    # query issued from inside a request. StaticPool shares the one
    # connection (and its :memory: DB) across every thread/session.
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(
        engine,
        tables=[
            User.__table__, Role.__table__, Permission.__table__,
            user_roles, role_permissions, AuditLog.__table__,
            Alert.__table__, AlertRead.__table__,
        ],
    )
    Session = sessionmaker(bind=engine)
    session = Session()
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
    """Every test in this file gets a mocked send_email — captures calls
    instead of hitting real SMTP. Access via the `sent` list.

    Two separate import bindings need mocking, not one: app.routes.admin's
    (the plaintext temp-password email) and app.services.alert_service's
    (provisioning a user now also fires a four-eyes admin_sensitive_action
    alert — see user_service.py). Each module did `from app.core.email
    import send_email`, which binds its own name in its own namespace, so
    patching app.core.email.send_email itself wouldn't reach either. The
    alert_service one is intentionally NOT recorded into `sent` — tests in
    this file assert on `sent`'s exact contents (the temp-password email
    specifically), and mixing in unrelated admin-notification emails would
    change what index/length assertions like `sent[-1]`/`len(sent) == 1` mean."""
    sent = []

    def fake_send_email(to, subject, html_body, text_body=None):
        sent.append({"to": list(to), "subject": subject, "html_body": html_body, "text_body": text_body})
        return True

    monkeypatch.setattr("app.routes.admin.send_email", fake_send_email)
    monkeypatch.setattr("app.services.alert_service.send_email", lambda *a, **k: True)
    return sent


@pytest.fixture
def admin_user(db_session):
    """A normal (not must_reset_password) system_admin, for calling the
    manage_users-gated admin routes. Also seeds a bare "manager" role, since
    every provisioning test below targets role_name="manager"."""
    perm = Permission(code="manage_users", description="manage_users")
    db_session.add(perm)
    role = Role(name="system_admin", permissions=[perm])
    db_session.add(role)
    db_session.add(Role(name="manager", permissions=[]))
    user = User(
        email="admin@kpc-demo.co.ke",
        hashed_password=security.hash_password("Admin-Pass-123!"),
        is_active=True,
        roles=[role],
    )
    db_session.add(user)
    db_session.commit()
    return user


def _login(client, email, password):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def _admin_token(client, admin_user):
    res = _login(client, "admin@kpc-demo.co.ke", "Admin-Pass-123!")
    assert res.status_code == 200, res.text
    return res.json()["Data"]["access_token"]


def _auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ============================================================================
# core/security.py
# ============================================================================

def test_generate_temp_password_meets_complexity_and_length():
    pw = security.generate_temp_password()
    assert len(pw) == 12
    assert any(c.isupper() for c in pw)
    assert any(c.islower() for c in pw)
    assert any(c.isdigit() for c in pw)
    assert any(c in security._TEMP_PASSWORD_ALPHABET["symbol"] for c in pw)


def test_generate_temp_password_is_random():
    assert security.generate_temp_password() != security.generate_temp_password()


def test_password_fingerprint_changes_when_hash_changes():
    h1 = security.hash_password("temp-pw-1")
    h2 = security.hash_password("temp-pw-2")
    assert security.password_fingerprint(h1) != security.password_fingerprint(h2)
    assert security.password_fingerprint(h1) == security.password_fingerprint(h1)


def test_reset_token_round_trip():
    h = security.hash_password("temp-pw")
    token = security.create_reset_token(subject="user@kpc-demo.co.ke", hashed_password=h)
    claims = security.decode_reset_token(token)
    assert claims["sub"] == "user@kpc-demo.co.ke"
    assert claims["type"] == "password_reset"
    assert claims["pwd_fp"] == security.password_fingerprint(h)


def test_decode_reset_token_rejects_a_normal_access_token():
    token = security.create_access_token(subject="user@kpc-demo.co.ke")
    with pytest.raises(Exception):
        security.decode_reset_token(token)


# ============================================================================
# services/user_service.py
# ============================================================================

def test_provision_user_with_temp_password_never_persists_plaintext(db_session):
    role = Role(name="manager", permissions=[])
    db_session.add(role)
    db_session.commit()

    user, temp_password = provision_user_with_temp_password(
        db_session, email="new@kpc-demo.co.ke", full_name="New Guy", role_name="manager",
    )

    assert user.must_reset_password is True
    assert user.temp_password_expires_at is not None
    assert user.hashed_password != temp_password
    assert security.verify_password(temp_password, user.hashed_password)
    # Confirm the plaintext really is nowhere on the row.
    for col in User.__table__.columns:
        value = getattr(user, col.name)
        if isinstance(value, str):
            assert temp_password not in value


def test_regenerate_temp_password_changes_hash_and_rearms_flag(db_session):
    role = Role(name="manager", permissions=[])
    db_session.add(role)
    db_session.commit()
    user, first_pw = provision_user_with_temp_password(
        db_session, email="new2@kpc-demo.co.ke", full_name=None, role_name="manager",
    )
    user.must_reset_password = False  # simulate: they already completed reset once
    db_session.commit()

    user2, second_pw = regenerate_temp_password(db_session, user_id=str(user.id))

    assert second_pw != first_pw
    assert user2.must_reset_password is True
    assert security.verify_password(second_pw, user2.hashed_password)
    assert not security.verify_password(first_pw, user2.hashed_password)


# ============================================================================
# Full route-level flow
# ============================================================================

def test_admin_create_user_emails_temp_password_not_returned_in_response(client, admin_user, no_real_email):
    token = _admin_token(client, admin_user)
    res = client.post(
        "/api/admin/users",
        json={"email": "invitee@kpc-demo.co.ke", "full_name": "Invitee", "role_name": "manager"},
        headers=_auth_headers(token),
    )
    assert res.status_code == 201, res.text
    body = res.json()["Data"]
    assert body["email"] == "invitee@kpc-demo.co.ke"
    assert body["account_status"] == "Invited / Pending first login"
    assert "password" not in body  # never returned to the caller

    assert len(no_real_email) == 1
    assert no_real_email[0]["to"] == ["invitee@kpc-demo.co.ke"]
    assert "Temporary password" in no_real_email[0]["text_body"]


def test_full_first_login_forced_reset_flow(client, admin_user, no_real_email):
    token = _admin_token(client, admin_user)
    client.post(
        "/api/admin/users",
        json={"email": "flow@kpc-demo.co.ke", "full_name": "Flow", "role_name": "manager"},
        headers=_auth_headers(token),
    )
    # Pull the temp password out of the mocked email body (plaintext lives
    # nowhere else — this mirrors what the real user would read in their inbox).
    body_text = no_real_email[-1]["text_body"]
    temp_password = body_text.split("Temporary password: ")[1].split("\n")[0]

    # 1. Login with the temp password -> reset_required, no access_token.
    res = _login(client, "flow@kpc-demo.co.ke", temp_password)
    assert res.status_code == 200, res.text
    data = res.json()["Data"]
    assert data["reset_required"] is True
    assert data["access_token"] is None
    assert data["redirect"] == "/reset-password"
    reset_token = data["reset_token"]
    assert reset_token

    # 2. A reset token can't authenticate a normal route.
    me = client.get("/api/auth/me", headers=_auth_headers(reset_token))
    assert me.status_code == 401

    # 3. New password same as temp password -> rejected.
    res = client.post("/api/auth/reset-password", json={"reset_token": reset_token, "new_password": temp_password})
    assert res.status_code == 400

    # 4. Successful reset -> normal access token issued.
    res = client.post(
        "/api/auth/reset-password",
        json={"reset_token": reset_token, "new_password": "Brand-New-Pass-1!"},
    )
    assert res.status_code == 200, res.text
    access_token = res.json()["Data"]["access_token"]
    assert access_token

    # 5. The now-redeemed reset token can't be replayed.
    res = client.post(
        "/api/auth/reset-password",
        json={"reset_token": reset_token, "new_password": "Another-Pass-2!"},
    )
    assert res.status_code == 401

    # 6. Old temp password no longer works; new one logs in normally.
    res = _login(client, "flow@kpc-demo.co.ke", temp_password)
    assert res.status_code == 401

    res = _login(client, "flow@kpc-demo.co.ke", "Brand-New-Pass-1!")
    assert res.status_code == 200, res.text
    data = res.json()["Data"]
    assert data["reset_required"] is False
    assert data["access_token"]


def test_login_rejects_expired_temp_password(client, admin_user, db_session, no_real_email):
    token = _admin_token(client, admin_user)
    client.post(
        "/api/admin/users",
        json={"email": "expired@kpc-demo.co.ke", "full_name": None, "role_name": "manager"},
        headers=_auth_headers(token),
    )
    user = db_session.query(User).filter(User.email == "expired@kpc-demo.co.ke").first()
    user.temp_password_expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
    db_session.commit()

    body_text = no_real_email[-1]["text_body"]
    temp_password = body_text.split("Temporary password: ")[1].split("\n")[0]

    res = _login(client, "expired@kpc-demo.co.ke", temp_password)
    assert res.status_code == 401
    assert "expired" in res.json()["Message"].lower()


def test_admin_resend_temp_password_invalidates_old_reset_token(client, admin_user, no_real_email):
    token = _admin_token(client, admin_user)
    res = client.post(
        "/api/admin/users",
        json={"email": "resend@kpc-demo.co.ke", "full_name": None, "role_name": "manager"},
        headers=_auth_headers(token),
    )
    user_id = res.json()["Data"]["id"]

    login_res = _login(client, "resend@kpc-demo.co.ke", no_real_email[-1]["text_body"].split("Temporary password: ")[1].split("\n")[0])
    old_reset_token = login_res.json()["Data"]["reset_token"]

    # Admin resends before the user ever completes the reset.
    res = client.post(f"/api/admin/users/{user_id}/resend-temp-password", headers=_auth_headers(token))
    assert res.status_code == 200, res.text
    assert res.json()["Data"]["user"]["account_status"] == "Invited / Pending first login"
    assert len(no_real_email) >= 2

    # The reset token issued against the old temp password is now stale.
    res = client.post(
        "/api/auth/reset-password",
        json={"reset_token": old_reset_token, "new_password": "Whatever-Pass-1!"},
    )
    assert res.status_code == 401


def test_must_reset_password_guard_blocks_an_existing_session(client, admin_user, db_session):
    """Covers the gap the guard exists for: an admin sets
    must_reset_password on an already-active user who still holds an
    unexpired normal access token from before."""
    role = db_session.query(Role).filter(Role.name == "manager").first()
    user = User(
        email="active@kpc-demo.co.ke",
        hashed_password=security.hash_password("Original-Pass-1!"),
        is_active=True,
        must_reset_password=False,
        roles=[role],
    )
    db_session.add(user)
    db_session.commit()

    res = _login(client, "active@kpc-demo.co.ke", "Original-Pass-1!")
    assert res.status_code == 200
    live_token = res.json()["Data"]["access_token"]

    me = client.get("/api/auth/me", headers=_auth_headers(live_token))
    assert me.status_code == 200

    # Admin forces a reset while that token is still live.
    user.must_reset_password = True
    db_session.commit()

    me = client.get("/api/auth/me", headers=_auth_headers(live_token))
    assert me.status_code == 403
    assert me.json()["Message"] == "PASSWORD_RESET_REQUIRED"
