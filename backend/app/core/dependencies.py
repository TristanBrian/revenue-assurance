"""
FastAPI dependencies for auth-gated routes.

Usage in a route:

    from app.core.dependencies import get_current_user, require_permission

    @router.post("/reconcile/update")
    def update_anomaly(
        payload: ...,
        user: User = Depends(require_permission("resolve_anomaly")),
    ):
        ...
"""
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.models.user import User
from app.utils.db_connection import SessionLocal  # adjust to match your existing session factory

# HTTPBearer (not OAuth2PasswordBearer) deliberately: you already have a
# token from POST /api/auth/login, so Swagger's "Authorize" dialog should
# just ask for that token to paste in — not re-run the whole username/
# password (+ unused client_id/client_secret) OAuth2 password-flow form
# for every other endpoint. /api/auth/login itself is unaffected — it
# takes a plain {email, password} JSON body, unrelated to this scheme.
#
# auto_error=False: HTTPBearer's default (auto_error=True) raises 403
# itself, before this module's code ever runs, whenever the Authorization
# header is missing or malformed — which collides with "401 = not
# authenticated, 403 = authenticated but not permitted" (RFC 7235). With
# auto_error=False it instead returns None for those cases, and
# get_current_user below raises the 401 explicitly, so a missing token and
# an invalid/expired one both consistently 401.
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
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.email == email).first()
    if user is None or not user.is_active:
        raise credentials_exception
    return user


def require_permission(permission_code: str):
    """Returns a dependency that 403s unless the current user holds the given permission."""

    def _check(user: User = Depends(get_current_user)) -> User:
        if not user.has_permission(permission_code):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required permission: {permission_code}",
            )
        return user

    return _check
