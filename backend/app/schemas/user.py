"""
Pydantic schemas for routes/auth.py and routes/admin.py (backed by
app/models/user.py's User/Role/Permission SQLAlchemy models).
"""
from datetime import datetime
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


class AdminCreateUserRequest(BaseModel):
    """POST /api/admin/users — the admin-provisioned flow. Deliberately has
    no password field: the backend generates a random temp password and
    emails it (see user_service.provision_user_with_temp_password)."""
    email: EmailStr
    full_name: Optional[str] = None
    role_name: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    """POST /api/auth/login returns one of three shapes:
      - Normal login: access_token set, everything else null/False.
      - reset_required=True (must_reset_password): reset_token set instead
        — a 15-minute, reset-endpoint-only token (see core/security.py's
        create_reset_token). The reset-password screen also bundles terms/
        privacy consent into that same submission (see ResetPasswordRequest),
        so this case never also sets terms_required.
      - terms_required=True (password is fine, but terms_accepted_version
        is stale or never set): consent_token set instead — same idea, but
        scoped to POST /api/auth/accept-terms (create_terms_consent_token).
    In every "required" case, access_token stays null — the client should
    store the given token and navigate to `redirect` instead of treating
    the response as an authenticated session.
    """
    access_token: Optional[str] = None
    token_type: str = "bearer"
    reset_required: bool = False
    reset_token: Optional[str] = None
    terms_required: bool = False
    consent_token: Optional[str] = None
    redirect: Optional[str] = None


class ResetPasswordRequest(BaseModel):
    """POST /api/auth/reset-password. reset_token is the short-lived token
    from LoginResponse.reset_token — not a normal Authorization bearer
    token, so it travels in the body like the password does.

    Consent is bundled into this same submission (spec: "rather than as a
    separate screen") — checkbox_accepted covers both the Terms &
    Conditions and Privacy Policy shown alongside the password fields.
    confirm_password is validated server-side, not just in the UI —
    client-side matching is a UX nicety only.
    """
    reset_token: str
    new_password: str = Field(min_length=8)
    confirm_password: str
    checkbox_accepted: bool


class ResetPasswordResponse(BaseModel):
    """On success, a normal full session token — same shape as LoginResponse's
    success case — so the client can proceed exactly as if login() had
    succeeded outright."""
    access_token: str
    token_type: str = "bearer"




class UserOut(BaseModel):
    """Response shape for /register, /me, and routes/admin.py's user list/
    edit endpoints. Deliberately excludes hashed_password and any raw ORM
    relationship objects — only id, email, full_name, is_active,
    created_at, and flattened role/permission name lists.

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
    is_active: bool
    created_at: datetime
    roles: list[str]
    permissions: list[str]
    # Admin user-list status indicator (spec: "Invited / Pending first
    # login" vs "Active"), derived from must_reset_password + whether the
    # user has ever logged in successfully — not raw DB fields, since a
    # forced reset on an already-active user is meaningfully different
    # from a fresh invite that's never been touched.
    account_status: str

    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="before")
    @classmethod
    def _adapt_orm_user(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return data  # already shaped (e.g. in tests) — pass through
        if getattr(data, "must_reset_password", False):
            account_status = "Invited / Pending first login" if data.last_login_at is None else "Reset Required"
        else:
            account_status = "Active"
        return {
            "id": str(data.id),
            "email": data.email,
            "full_name": data.full_name,
            "is_active": data.is_active,
            "created_at": data.created_at,
            "roles": [r.name for r in data.roles],
            "permissions": sorted(data.permission_codes()),
            "account_status": account_status,
        }


class ResendTempPasswordResponse(BaseModel):
    status: str
    user: UserOut


class UpdateUserRequest(BaseModel):
    """PATCH /api/admin/users/{user_id}. All fields optional — only the
    ones provided are changed. role_name replaces the user's role list
    entirely (users have exactly one role in this system, same as
    RegisterRequest)."""
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    role_name: Optional[str] = None
    password: Optional[str] = Field(default=None, min_length=8)
    is_active: Optional[bool] = None
