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


class EmailAlreadyRegisteredError(Exception):
    pass


class RoleNotFoundError(Exception):
    def __init__(self, role_name: str):
        self.role_name = role_name
        super().__init__(f"Unknown role: {role_name}")


class UserNotFoundError(Exception):
    def __init__(self, user_id: str):
        self.user_id = user_id
        super().__init__(f"No user with id: {user_id}")


class CannotDeleteSelfError(Exception):
    pass


class LastSystemAdminError(Exception):
    """Raised when deleting a user would leave zero system_admin accounts."""
    pass


def register_user(db: Session, email: str, password: str, full_name: str | None, role_name: str) -> User:
    if db.query(User).filter(User.email == email).first():
        raise EmailAlreadyRegisteredError(email)

    role = db.query(Role).filter(Role.name == role_name).first()
    if not role:
        raise RoleNotFoundError(role_name)

    user = User(
        email=email,
        full_name=full_name,
        hashed_password=hash_password(password),
        roles=[role],
    )
    db.add(user)
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
) -> User:
    user = _get_user_or_raise(db, user_id)

    if email is not None and email != user.email:
        if db.query(User).filter(User.email == email).first():
            raise EmailAlreadyRegisteredError(email)
        user.email = email

    if full_name is not None:
        user.full_name = full_name

    if role_name is not None:
        role = db.query(Role).filter(Role.name == role_name).first()
        if not role:
            raise RoleNotFoundError(role_name)
        user.roles = [role]

    if password is not None:
        user.hashed_password = hash_password(password)

    if is_active is not None:
        user.is_active = is_active

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

    db.delete(user)
    db.commit()
