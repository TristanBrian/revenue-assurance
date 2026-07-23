"""
Pydantic schemas for routes/auth.py (backed by app/models/user.py's User/
Role/Permission SQLAlchemy models).
"""
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


class RoleOut(BaseModel):
    id: str
    name: str
    description: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", mode="before")
    @classmethod
    def _stringify_id(cls, v: Any) -> str:
        # ORM primary key is a uuid.UUID; Pydantic's plain `str` type does
        # not auto-coerce UUID -> str, so do it explicitly.
        return str(v)


class PermissionOut(BaseModel):
    id: str
    code: str
    description: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", mode="before")
    @classmethod
    def _stringify_id(cls, v: Any) -> str:
        return str(v)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: Optional[str] = None
    role_name: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    """Response shape for /register and /me. Deliberately excludes
    hashed_password and any raw ORM relationship objects — only id, email,
    full_name, and flattened role/permission name lists.

    User.roles is a list of Role ORM objects (not strings), and User has no
    "permissions" attribute at all (only a permission_codes() method), so
    plain from_attributes extraction can't produce this shape on its own.
    The model_validator below adapts a raw User ORM object into the right
    shape before per-field validation runs, so routes can do
    `return user` (the ORM object) with response_model=UserOut and never
    need to hand-build this dict themselves.
    """
    id: str
    email: str
    full_name: Optional[str] = None
    roles: list[str]
    permissions: list[str]

    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="before")
    @classmethod
    def _adapt_orm_user(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return data  # already shaped (e.g. in tests) — pass through
        return {
            "id": str(data.id),
            "email": data.email,
            "full_name": data.full_name,
            "roles": [r.name for r in data.roles],
            "permissions": sorted(data.permission_codes()),
        }
