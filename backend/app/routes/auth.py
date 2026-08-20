from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError
from sqlalchemy.orm import Session
import logging

from app.core.dependencies import get_current_user, get_db, require_permission
from app.core.security import (
    create_access_token,
    create_reset_token,
    decode_reset_token,
    hash_password,
    password_fingerprint,
    verify_password,
)
from app.models.user import User
from app.schemas.user import (
    LoginRequest,
    LoginResponse,
    RegisterRequest,
    ResetPasswordRequest,
    ResetPasswordResponse,
    UserOut,
)
from app.services.alert_service import notify_forced_reset_completed, notify_temp_password_expired
from app.services.audit_service import log_action
from app.services.user_service import EmailAlreadyRegisteredError, RoleNotFoundError, register_user

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_permission("manage_users")),
):
    try:
        user = register_user(
            db,
            email=payload.email,
            password=payload.password,
            full_name=payload.full_name,
            role_name=payload.role_name,
            actor_user_id=admin.id,
        )
    except EmailAlreadyRegisteredError:
        raise HTTPException(status_code=400, detail="Email already registered")
    except RoleNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return user


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    try:
        user = db.query(User).filter(User.email == payload.email).first()
        if not user or not verify_password(payload.password, user.hashed_password):
            log_action(
                db,
                actor_user_id=None,
                action="auth.login_failure",
                target_type="user",
                metadata={"attempted_email": payload.email},
            )
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect email or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
        if not user.is_active:
            log_action(
                db,
                actor_user_id=None,
                action="auth.login_failure",
                target_type="user",
                target_id=str(user.id),
                metadata={"attempted_email": payload.email, "reason": "inactive"},
            )
            db.commit()
            raise HTTPException(status_code=403, detail="User is inactive")

        log_action(db, actor_user_id=user.id, action="auth.login_success", target_type="user", target_id=str(user.id))
        db.commit()

        token = create_access_token(subject=user.email)
        return {"access_token": token, "token_type": "bearer"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login error: {e}", exc_info=True)
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error during login",
        )
    if not user.is_active:
        log_action(
            db,
            actor_user_id=None,
            action="auth.login_failure",
            target_type="user",
            target_id=str(user.id),
            metadata={"attempted_email": payload.email, "reason": "inactive"},
        )
        db.commit()
        raise HTTPException(status_code=403, detail="User is inactive")

    if user.must_reset_password:
        now = datetime.now(timezone.utc)
        expires_at = user.temp_password_expires_at
        if expires_at is not None and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at is not None and now > expires_at:
            log_action(
                db, actor_user_id=user.id, action="auth.login_failure", target_type="user",
                target_id=str(user.id), metadata={"reason": "temp_password_expired"},
            )
            notify_temp_password_expired(db, user)
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Temporary password has expired. Ask an administrator to resend a new one.",
            )

        log_action(
            db, actor_user_id=user.id, action="auth.login_temp_password", target_type="user",
            target_id=str(user.id),
        )
        db.commit()

        reset_token = create_reset_token(subject=user.email, hashed_password=user.hashed_password)
        return {
            "access_token": None,
            "reset_required": True,
            "reset_token": reset_token,
            "redirect": "/reset-password",
        }

    user.last_login_at = datetime.now(timezone.utc)
    log_action(db, actor_user_id=user.id, action="auth.login_success", target_type="user", target_id=str(user.id))
    db.commit()

    token = create_access_token(subject=user.email)
    return {"access_token": token, "token_type": "bearer"}


@router.post("/reset-password", response_model=ResetPasswordResponse)
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    """
    Forced-reset flow's second step. Accepts only the short-lived reset
    token from login()'s reset_required response — never a normal session
    token (get_current_user isn't used here on purpose, since a user in
    this flow doesn't have a normal session token yet).
    """
    invalid_token = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Reset link is invalid or has expired. Log in again to request a new temporary password.",
    )
    try:
        claims = decode_reset_token(payload.reset_token)
    except JWTError:
        raise invalid_token

    email = claims.get("sub")
    user = db.query(User).filter(User.email == email).first() if email else None
    if user is None or not user.is_active:
        raise invalid_token

    # must_reset_password False here means either this token was already
    # redeemed, or an admin cleared the flag some other way — either way
    # this token no longer applies.
    if not user.must_reset_password:
        raise invalid_token

    # Self-invalidation: a token issued before the temp password was
    # regenerated (admin resend) carries a stale fingerprint and is
    # rejected here, same as a token already redeemed once (see
    # create_reset_token's docstring in core/security.py).
    if claims.get("pwd_fp") != password_fingerprint(user.hashed_password):
        raise invalid_token

    if verify_password(payload.new_password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from the temporary password.",
        )

    user.hashed_password = hash_password(payload.new_password)
    user.must_reset_password = False
    user.temp_password_expires_at = None
    user.last_login_at = datetime.now(timezone.utc)

    log_action(
        db, actor_user_id=user.id, action="auth.password_reset", target_type="user",
        target_id=str(user.id),
    )
    notify_forced_reset_completed(db, user)
    db.commit()

    token = create_access_token(subject=user.email)
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=UserOut)
def read_current_user(user: User = Depends(get_current_user)):
    try:
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return user
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in /me: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error",
        )