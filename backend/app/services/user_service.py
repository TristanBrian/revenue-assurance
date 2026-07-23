"""
User registration business logic.

Framework-agnostic on purpose (no FastAPI, no app.schemas imports) — same
convention as the other services (reconciliation.py, e_billing.py), which
raise plain exceptions and let the routes translate them into HTTPException.
Callers pass individual fields rather than a Pydantic model, so this stays
usable from anywhere (routes, scripts, tests) without pulling in the API
layer.
"""
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
