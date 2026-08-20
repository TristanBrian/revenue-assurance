from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.models.user import User
from app.utils.db_connection import SessionLocal

bearer_scheme = HTTPBearer(auto_error=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None:
        raise credentials_exception

    try:
        payload = decode_access_token(credentials.credentials)
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
        # Reject a password-reset token (type="password_reset") presented
        # here — it's scoped only to POST /auth/reset-password (see
        # core/security.py's create_reset_token/decode_reset_token), never
        # a substitute for a real session token on any other route.
        if payload.get("type", "access") != "access":
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.email == email).first()
    if user is None or not user.is_active:
        raise credentials_exception

    # Forced-reset guard (spec: "any authenticated route/middleware must
    # check must_reset_password... force-redirect to /reset-password").
    # Structurally, a user can't normally hold a valid access token while
    # must_reset_password is True — login() issues a reset token instead
    # (see routes/auth.py) — except when an admin sets it on an
    # *already-active* user who still has an unexpired token from before
    # (services/user_service.py's regenerate_temp_password). This is the
    # guard that closes that gap: a distinct, greppable detail string
    # ("PASSWORD_RESET_REQUIRED") rather than the generic 401 message so
    # the frontend can tell "reset required" apart from "not logged in"
    # and redirect instead of just bouncing to /login.
    if user.must_reset_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="PASSWORD_RESET_REQUIRED",
        )

    return user


def require_permission(permission_code: str):
    def _check(user: User = Depends(get_current_user)) -> User:
        if not user.has_permission(permission_code):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required permission: {permission_code}",
            )
        return user
    return _check