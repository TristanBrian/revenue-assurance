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

from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.role import Role
from app.models.user import User
from app.services.audit_service import log_action


class EmailAlreadyRegisteredError(Exception):
    pass


class RoleNotFoundError(Exception):
    def __init__(self, role_name: str):
        self.role_name = role_name
        super().__init__(f"Unknown role: {role_name}")


# Ordered so more specific/longer keywords don't get shadowed by shorter
# ones — e.g. "supervisor" must be checked before a hypothetical bare "s".
# Callers pass free-text role names ("supervisor", "Depo", "MANAGER",
# "revenue"), and we map that to the canonical role name seeded by
# scripts/seed_roles.py rather than requiring an exact match.
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
    db.commit()
    db.refresh(user)
    return user


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
    log_action(
        db,
        actor_user_id=requesting_user_id,
        action="user.delete",
        target_type="user",
        target_id=str(user.id),
        before=before,
    )
    db.delete(user)
    db.commit()
