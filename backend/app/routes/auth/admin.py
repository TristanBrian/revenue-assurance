from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.dependencies import get_db, require_permission
from app.core.password_policy import PasswordPolicyError
from app.core.email import send_email
from app.models.auth.user import User
from app.models.audit.audit import AuditLog
from app.schemas.auth.user import AdminCreateUserRequest, ResendTempPasswordResponse, UpdateUserRequest, UserOut
from app.services.auth.user_service import (
    CannotDeleteSelfError,
    EmailAlreadyRegisteredError,
    LastSystemAdminError,
    RoleNotFoundError,
    UserNotFoundError,
    delete_user,
    list_users,
    provision_user_with_temp_password,
    regenerate_temp_password,
    update_user,
)

router = APIRouter()  # prefix="/api/admin" and tags=["Admin"] are supplied by main.py's include_router()


ADMIN_SECURITY_ACTIONS = (
    AuditLog.action.like("user.%"),
    AuditLog.action.like("auth.%"),
    AuditLog.action.like("admin.%"),
)


def _send_temp_password_email(user: User, temp_password: str) -> None:
    """Hooks directly into the existing alert module's send function
    (app.core.email.send_email) rather than alert_service.create_alert() —
    create_alert() always persists its message as an in-app Alert row,
    which would store the plaintext temp password in the DB. That's exactly
    what the spec says never to do, so this bypasses the in-app-alert path
    entirely and only ever emails it. Never raises: a delivery failure here
    shouldn't fail user creation — the admin can always use the
    resend-temp-password action to retry."""
    expiry_local = user.temp_password_expires_at.strftime("%Y-%m-%d %H:%M UTC") if user.temp_password_expires_at else "in 48 hours"
    send_email(
        to=[user.email],
        subject="Your KPC Revenue Assurance account",
        html_body=(
            f"<p>An account has been created for you on KPC Revenue Assurance.</p>"
            f"<p><strong>Email:</strong> {user.email}<br>"
            f"<strong>Temporary password:</strong> <code>{temp_password}</code></p>"
            f"<p>This password expires <strong>{expiry_local}</strong> and must be changed on first login. "
            f"If it expires before you log in, ask an administrator to resend a new one.</p>"
        ),
        text_body=(
            f"An account has been created for you on KPC Revenue Assurance.\n"
            f"Email: {user.email}\nTemporary password: {temp_password}\n"
            f"Expires: {expiry_local}. You must change it on first login."
        ),
    )


@router.get("/users", response_model=list[UserOut])
def get_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("manage_users")),
):
    return list_users(db)


@router.get("/security-events")
def get_security_events(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("manage_users")),
):
    """Return only authentication and administration events to system admins.

    This deliberately does not grant the admin access to Oil or Inuka audit
    records. It gives the platform operator enough security visibility to
    investigate account provisioning, resets, logins, and role changes.
    """
    query = db.query(AuditLog).filter(or_(*ADMIN_SECURITY_ACTIONS)).order_by(AuditLog.created_at.desc())
    total = query.count()
    rows = query.offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [
            {
                "id": str(row.id),
                "action": row.action,
                "target_type": row.target_type,
                "target_id": row.target_id,
                "actor_user_id": str(row.actor_user_id) if row.actor_user_id else None,
                "created_at": row.created_at.isoformat(),
                "metadata": row.extra_metadata,
            }
            for row in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_provisioned_user(
    payload: AdminCreateUserRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_permission("manage_users")),
):
    """
    Admin-provisioned user creation — no password field. A random temp
    password is generated, only its hash is stored, and the plaintext is
    emailed once (see _send_temp_password_email) and never returned in
    this response or logged. Distinct from POST /api/auth/register (which
    still takes an admin-supplied password, used by seed scripts).
    """
    try:
        user, temp_password = provision_user_with_temp_password(
            db,
            email=payload.email,
            full_name=payload.full_name,
            role_name=payload.role_name,
            actor_user_id=admin.id,
        )
    except EmailAlreadyRegisteredError:
        raise HTTPException(status_code=400, detail="Email already registered")
    except RoleNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))

    _send_temp_password_email(user, temp_password)
    return user


@router.post("/users/{user_id}/resend-temp-password", response_model=ResendTempPasswordResponse)
def resend_temp_password(
    user_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_permission("manage_users")),
):
    """Regenerates and re-emails a temp password — for an expired original
    or a failed delivery (spec item 5). Works whether the user has never
    logged in or is already active; either way they're forced back through
    the reset flow on next login."""
    try:
        user, temp_password = regenerate_temp_password(db, user_id=user_id, actor_user_id=admin.id)
    except UserNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    _send_temp_password_email(user, temp_password)
    return {"status": "success", "user": user}


@router.patch("/users/{user_id}", response_model=UserOut)
def edit_user(
    user_id: str,
    payload: UpdateUserRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_permission("manage_users")),
):
    try:
        return update_user(
            db,
            user_id=user_id,
            email=payload.email,
            full_name=payload.full_name,
            role_name=payload.role_name,
            password=payload.password,
            is_active=payload.is_active,
            actor_user_id=admin.id,
        )
    except UserNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    except EmailAlreadyRegisteredError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
    except RoleNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except PasswordPolicyError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.delete("/users/{user_id}")
def remove_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("manage_users")),
):
    try:
        delete_user(db, user_id=user_id, requesting_user_id=current_user.id)
    except UserNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    except CannotDeleteSelfError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete your own account")
    except LastSystemAdminError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete the last system_admin")
    return {"status": "success", "message": "User deleted"}
