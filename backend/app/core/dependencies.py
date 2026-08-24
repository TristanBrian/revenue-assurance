from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.models.auth.user import User
from app.services.auth.terms_service import get_required_version, user_needs_consent
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
    # (see routes/auth/auth.py) — except when an admin sets it on an
    # *already-active* user who still has an unexpired token from before
    # (services/auth/user_service.py's regenerate_temp_password). This is the
    # guard that closes that gap: a distinct, greppable detail string
    # ("PASSWORD_RESET_REQUIRED") rather than the generic 401 message so
    # the frontend can tell "reset required" apart from "not logged in"
    # and redirect instead of just bouncing to /login.
    if user.must_reset_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="PASSWORD_RESET_REQUIRED",
        )

    # Same guard, same reasoning, for stale consent: a user whose password
    # is fine but who hasn't accepted the currently-active Terms &
    # Conditions/Privacy Policy version (never accepted at all, or a newer
    # version was published since) is blocked from every other route until
    # they re-consent via POST /api/auth/accept-terms — see routes/auth/auth.py
    # and services/auth/terms_service.py. Distinct detail string so the
    # frontend routes to the consent-only variant of /reset-password
    # instead of the full password-reset form.
    required_version = get_required_version(db)
    if user_needs_consent(user, required_version):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="TERMS_ACCEPTANCE_REQUIRED",
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


def enforce_reconciliation_scope(user: User, direction: str) -> str:
    """Apply the server-side portal boundary for direction-scoped features.

    Inuka is a separate operational portal over the outbound program-funds
    domain. Its UI is intentionally outbound-only, but the boundary must also
    hold when a caller manually changes the query string.
    """
    if direction not in {"inbound", "outbound", "all"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="direction must be inbound, outbound, or all")
    role_names = {role.name for role in user.roles}
    if "inuka_manager" in role_names and direction != "outbound":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inuka accounts are restricted to outbound reconciliation")
    if "depot_supervisor" in role_names and direction != "inbound":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Depot Supervisor accounts are restricted to inbound reconciliation")
    return direction
