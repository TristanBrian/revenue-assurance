import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from jose import JWTError
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user, get_db, require_permission
from app.core.security import (
    create_access_token,
    create_reset_token,
    create_terms_consent_token,
    decode_reset_token,
    decode_terms_consent_token,
    hash_password,
    password_fingerprint,
    verify_password,
)
from app.models.user import User
from app.schemas.terms import AcceptTermsRequest, AcceptTermsResponse, TermsBundleResponse
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
from app.services.terms_service import get_required_version, get_terms_bundle, record_consent, user_needs_consent
from app.services.user_service import EmailAlreadyRegisteredError, RoleNotFoundError, register_user

logger = logging.getLogger(__name__)

router = APIRouter()  # prefix="/api/auth" and tags=["Auth"] are supplied by main.py's include_router(), matching every other route file


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _user_agent(request: Request) -> str | None:
    return request.headers.get("user-agent")


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_permission("manage_users")),
):
    """
    Creates a new user and assigns a role. Requires the caller to already
    hold manage_users (i.e. be a system_admin) — the very first
    system_admin is created via scripts/seed_admin.py instead, which
    writes directly to the DB and bypasses this endpoint entirely, since
    nothing exists yet to grant manage_users to anyone at that point.
    """
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


@router.get("/terms", response_model=TermsBundleResponse)
def read_terms(db: Session = Depends(get_db)):
    """
    Full Terms & Conditions / Privacy Policy text + the currently required
    version — no auth required on purpose: a user in the middle of the
    forced-reset or re-consent flow doesn't have a normal session token
    yet (see reset_password/accept_terms below), and this is where the
    reset-password screen fetches the text it renders.
    """
    return get_terms_bundle(db)


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

        # Password's fine — but the currently-active Terms & Conditions/
        # Privacy Policy version might not be. Bundled into the SAME
        # reset-password screen (consent-only variant) rather than a
        # separate page — see services/terms_service.py.
        required_version = get_required_version(db)
        if user_needs_consent(user, required_version):
            log_action(
                db, actor_user_id=user.id, action="auth.terms_required", target_type="user",
                target_id=str(user.id), metadata={"required_version": required_version},
            )
            db.commit()

            consent_token = create_terms_consent_token(
                subject=user.email, current_terms_accepted_version=user.terms_accepted_version,
            )
            return {
                "access_token": None,
                "terms_required": True,
                "consent_token": consent_token,
                "redirect": "/reset-password",
            }

        user.last_login_at = datetime.now(timezone.utc)
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


@router.post("/reset-password", response_model=ResetPasswordResponse)
def reset_password(payload: ResetPasswordRequest, request: Request, db: Session = Depends(get_db)):
    """
    Forced-reset flow's second step. Accepts only the short-lived reset
    token from login()'s reset_required response — never a normal session
    token (get_current_user isn't used here on purpose, since a user in
    this flow doesn't have a normal session token yet).

    Consent (checkbox_accepted) and confirm_password are validated here,
    server-side, alongside the existing token/password checks — ALL of
    them before any mutation happens, so a failure on any one leaves the
    account exactly as it was (still must_reset_password=True, no
    password set, no consent recorded). Client-side validation of the
    same three conditions is a UX nicety only, not relied on.
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

    if not payload.checkbox_accepted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You must accept the Terms & Conditions and Privacy Policy to continue.",
        )

    if payload.new_password != payload.confirm_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passwords do not match.")

    if verify_password(payload.new_password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from the temporary password.",
        )

    # Every check passed — now, and only now, mutate.
    user.hashed_password = hash_password(payload.new_password)
    user.must_reset_password = False
    user.temp_password_expires_at = None
    user.last_login_at = datetime.now(timezone.utc)

    log_action(
        db, actor_user_id=user.id, action="auth.password_reset", target_type="user",
        target_id=str(user.id),
    )
    record_consent(db, user, ip_address=_client_ip(request), user_agent=_user_agent(request), actor_user_id=user.id)
    notify_forced_reset_completed(db, user)
    db.commit()

    token = create_access_token(subject=user.email)
    return {"access_token": token, "token_type": "bearer"}


@router.post("/accept-terms", response_model=AcceptTermsResponse)
def accept_terms(payload: AcceptTermsRequest, request: Request, db: Session = Depends(get_db)):
    """
    Re-consent variant for an already-active user (must_reset_password is
    already False) whose terms_accepted_version is stale — a newer Terms/
    Privacy Policy version was published since they last accepted. No
    password fields; gated by the short-lived consent_token from login()'s
    terms_required response, same non-session-token pattern as
    reset_password above.
    """
    invalid_token = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="This consent link is invalid or has expired. Log in again to continue.",
    )
    try:
        claims = decode_terms_consent_token(payload.consent_token)
    except JWTError:
        raise invalid_token

    email = claims.get("sub")
    user = db.query(User).filter(User.email == email).first() if email else None
    if user is None or not user.is_active:
        raise invalid_token

    # A user who still needs a password reset belongs in reset_password
    # above, not here — the token from that different flow doesn't decode
    # as a terms_consent token anyway, but the state check makes the
    # reason explicit rather than relying only on that.
    if user.must_reset_password:
        raise invalid_token

    required_version = get_required_version(db)
    if not user_needs_consent(user, required_version):
        # Already consented (token already redeemed) or nothing to
        # consent to any more — either way this token no longer applies.
        raise invalid_token

    # Self-invalidation: a token issued before terms_accepted_version last
    # changed carries a stale fingerprint (see create_terms_consent_token).
    if claims.get("prior_version_fp") != (user.terms_accepted_version or ""):
        raise invalid_token

    if not payload.checkbox_accepted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You must accept the Terms & Conditions and Privacy Policy to continue.",
        )

    record_consent(db, user, ip_address=_client_ip(request), user_agent=_user_agent(request), actor_user_id=user.id)
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()

    token = create_access_token(subject=user.email)
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=UserOut)
def read_current_user(user: User = Depends(get_current_user)):
    return user
