"""
User registration/administration business logic.

Framework-agnostic on purpose (no FastAPI, no app.schemas imports) — same
convention as the other services (reconciliation.py, e_billing.py), which
raise plain exceptions and let the routes translate them into HTTPException.
Callers pass individual fields rather than a Pydantic model, so this stays
usable from anywhere (routes, scripts, tests) without pulling in the API
layer.
"""
import uuid as uuid_lib
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.security import generate_temp_password, hash_password
from app.models.auth.role import Role
from app.models.auth.user import User
from app.services.alerts.alert_service import (
    notify_admin_sensitive_action,
    notify_role_changed,
    notify_user_deactivated_or_reactivated,
)
from app.services.audit.audit_service import log_action

TEMP_PASSWORD_WINDOW_HOURS = 48


class EmailAlreadyRegisteredError(Exception):
    pass


class RoleNotFoundError(Exception):
    def __init__(self, role_name: str):
        self.role_name = role_name
        super().__init__(f"Unknown role: {role_name}")



_ROLE_KEYWORDS: list[tuple[str, list[str]]] = [
    ("depot_supervisor", ["depot_supervisor", "supervisor", "depot", "depo"]),
    ("manager", ["manager", "mgr", "man"]),
    ("revenue_assurance", ["revenue_assurance", "revenue", "assurance"]),
]


def normalize_role_name(raw: str) -> str:
    """Maps loose free-text input to a canonical role name. Falls back to
    the lowercased/trimmed input unchanged if nothing matches (e.g.
    "system_admin"), so exact-match lookups downstream still work."""
    cleaned = raw.strip().lower()
    for canonical, keywords in _ROLE_KEYWORDS:
        if any(kw in cleaned for kw in keywords):
            return canonical
    return cleaned


class UserNotFoundError(Exception):
    def __init__(self, user_id: str):
        self.user_id = user_id
        super().__init__(f"No user with id: {user_id}")


class CannotDeleteSelfError(Exception):
    pass


class LastSystemAdminError(Exception):
    """Raised when deleting a user would leave zero system_admin accounts."""
    pass


def register_user(
    db: Session,
    email: str,
    password: str,
    full_name: str | None,
    role_name: str,
    actor_user_id=None,
) -> User:
    if db.query(User).filter(User.email == email).first():
        raise EmailAlreadyRegisteredError(email)

    role = db.query(Role).filter(Role.name == normalize_role_name(role_name)).first()
    if not role:
        raise RoleNotFoundError(role_name)

    user = User(
        email=email,
        full_name=full_name,
        hashed_password=hash_password(password),
        roles=[role],
    )
    db.add(user)
    # User.id's default=uuid.uuid4 is a column default, applied when the
    # INSERT is emitted (flush time) — not at object construction — so
    # user.id is still None here until this explicit flush populates it.
    db.flush()
    log_action(
        db,
        actor_user_id=actor_user_id,
        action="user.create",
        target_type="user",
        target_id=str(user.id),
        after={"email": email, "full_name": full_name, "role_name": role.name},
    )
    notify_admin_sensitive_action(
        db, action="user created", summary=f"{email} was created with role {role.name}.",
        actor_user_id=actor_user_id, target_id=str(user.id),
    )
    db.commit()
    db.refresh(user)
    return user


def provision_user_with_temp_password(
    db: Session,
    email: str,
    full_name: str | None,
    role_name: str,
    actor_user_id=None,
) -> tuple[User, str]:
    """
    Admin-provisioned user, per the forced-password-reset spec: the admin
    never supplies or sees a password. Generates one, persists only its
    hash plus must_reset_password=True and a 48h expiry, and returns the
    plaintext alongside the created User — the *only* place that plaintext
    exists outside memory-in-transit. The caller (routes/auth/admin.py) must
    pass it straight to app.core.email.send_email and then drop it; it
    must never be logged, returned in an API response, or handed to
    alert_service.create_alert() (that persists its message to the DB,
    which would defeat "never store the plaintext").

    Distinct from register_user() (used by seed scripts with a known,
    deterministic password) rather than replacing it — see PROGRESS.md/
    scripts/seed_demo_users.py's dependency on register_user's signature.
    """
    if db.query(User).filter(User.email == email).first():
        raise EmailAlreadyRegisteredError(email)

    role = db.query(Role).filter(Role.name == normalize_role_name(role_name)).first()
    if not role:
        raise RoleNotFoundError(role_name)

    temp_password = generate_temp_password()
    user = User(
        email=email,
        full_name=full_name,
        hashed_password=hash_password(temp_password),
        roles=[role],
        must_reset_password=True,
        temp_password_expires_at=datetime.now(timezone.utc) + timedelta(hours=TEMP_PASSWORD_WINDOW_HOURS),
    )
    db.add(user)
    db.flush()
    log_action(
        db,
        actor_user_id=actor_user_id,
        action="user.provision",
        target_type="user",
        target_id=str(user.id),
        after={"email": email, "full_name": full_name, "role_name": role.name, "must_reset_password": True},
    )
    notify_admin_sensitive_action(
        db, action="user created", summary=f"{email} was provisioned with role {role.name}.",
        actor_user_id=actor_user_id, target_id=str(user.id),
    )
    db.commit()
    db.refresh(user)
    return user, temp_password


def regenerate_temp_password(db: Session, user_id: str, actor_user_id=None) -> tuple[User, str]:
    """Admin 'resend temp password' action — for an expired original or a
    failed email delivery. Overwrites the password hash with a fresh
    random temp password, resets the 48h window, and re-arms
    must_reset_password (covers both a still-pending invite and an
    already-active user the admin wants to force back through reset).
    Same plaintext-handling contract as provision_user_with_temp_password."""
    user = _get_user_or_raise(db, user_id)

    temp_password = generate_temp_password()
    user.hashed_password = hash_password(temp_password)
    user.must_reset_password = True
    user.temp_password_expires_at = datetime.now(timezone.utc) + timedelta(hours=TEMP_PASSWORD_WINDOW_HOURS)

    log_action(
        db,
        actor_user_id=actor_user_id,
        action="user.temp_password_resend",
        target_type="user",
        target_id=str(user.id),
        after={"must_reset_password": True},
    )
    db.commit()
    db.refresh(user)
    return user, temp_password


def _get_user_or_raise(db: Session, user_id: str) -> User:
    try:
        uid = uuid_lib.UUID(str(user_id))
    except ValueError:
        raise UserNotFoundError(user_id)
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        raise UserNotFoundError(user_id)
    return user


def list_users(db: Session) -> list[User]:
    return db.query(User).order_by(User.created_at.desc()).all()


def update_user(
    db: Session,
    user_id: str,
    email: str | None = None,
    full_name: str | None = None,
    role_name: str | None = None,
    password: str | None = None,
    is_active: bool | None = None,
    actor_user_id=None,
) -> User:
    user = _get_user_or_raise(db, user_id)

    before = {}
    after = {}

    if email is not None and email != user.email:
        if db.query(User).filter(User.email == email).first():
            raise EmailAlreadyRegisteredError(email)
        before["email"] = user.email
        user.email = email
        after["email"] = email

    if full_name is not None and full_name != user.full_name:
        before["full_name"] = user.full_name
        user.full_name = full_name
        after["full_name"] = full_name

    if role_name is not None:
        role = db.query(Role).filter(Role.name == normalize_role_name(role_name)).first()
        if not role:
            raise RoleNotFoundError(role_name)
        before_roles = [r.name for r in user.roles]
        if before_roles != [role.name]:
            before["roles"] = before_roles
            user.roles = [role]
            after["roles"] = [role.name]

    if password is not None:
        user.hashed_password = hash_password(password)
        after["password"] = "changed"  # never log the actual password/hash

    if is_active is not None and is_active != user.is_active:
        before["is_active"] = user.is_active
        user.is_active = is_active
        after["is_active"] = is_active

    if after:
        log_action(
            db,
            actor_user_id=actor_user_id,
            action="user.edit",
            target_type="user",
            target_id=str(user.id),
            before=before or None,
            after=after,
        )

    if "roles" in after:
        notify_role_changed(db, user, after["roles"][0])
        notify_admin_sensitive_action(
            db, action="role changed", summary=f"{user.email}'s role changed to {after['roles'][0]}.",
            actor_user_id=actor_user_id, target_id=str(user.id),
        )

    if "is_active" in after:
        notify_user_deactivated_or_reactivated(db, user, after["is_active"])

    db.commit()
    db.refresh(user)
    return user


def delete_user(db: Session, user_id: str, requesting_user_id) -> None:
    user = _get_user_or_raise(db, user_id)

    if str(user.id) == str(requesting_user_id):
        raise CannotDeleteSelfError()

    if any(r.name == "system_admin" for r in user.roles):
        remaining_admins = (
            db.query(User)
            .join(User.roles)
            .filter(Role.name == "system_admin", User.id != user.id)
            .count()
        )
        if remaining_admins == 0:
            raise LastSystemAdminError()

    before = {"email": user.email, "full_name": user.full_name, "roles": [r.name for r in user.roles]}
    deleted_email = user.email
    deleted_id = str(user.id)
    log_action(
        db,
        actor_user_id=requesting_user_id,
        action="user.delete",
        target_type="user",
        target_id=deleted_id,
        before=before,
    )
    notify_admin_sensitive_action(
        db, action="user deleted", summary=f"{deleted_email} was deleted.",
        actor_user_id=requesting_user_id, target_id=deleted_id,
    )
    db.delete(user)
    db.commit()
