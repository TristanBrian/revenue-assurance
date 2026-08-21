"""
Password hashing + JWT issuing/verification.

Requires env vars (add to .env):
    SECRET_KEY=<generate with: openssl rand -hex 32>
    ALGORITHM=HS256
    ACCESS_TOKEN_EXPIRE_MINUTES=60
"""
import hashlib
import os
import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

from app import config

SECRET_KEY = os.environ.get("SECRET_KEY")
if not SECRET_KEY:
    raise ValueError("SECRET_KEY environment variable is not set")

ALGORITHM = os.environ.get("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))


RESET_TOKEN_EXPIRE_MINUTES = 15

# Short-lived, single-purpose token issued by /api/auth/login when a user's
# terms_accepted_version is stale but their password is fine — scoped only
# to /api/auth/accept-terms, same shape/reasoning as the reset token above.
TERMS_CONSENT_TOKEN_EXPIRE_MINUTES = 15

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain_password: str) -> str:
    return pwd_context.hash(plain_password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(subject: str, extra_claims: Optional[dict] = None) -> str:
    """subject is typically the user's email or id, stored as the JWT 'sub' claim.
    Tagged with type=access so get_current_user() can reject a reset token
    (type=password_reset) presented at a normal route — see decode_reset_token."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {"sub": subject, "exp": expire, "type": "access"}
    if extra_claims:
        to_encode.update(extra_claims)
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Raises jose.JWTError if invalid/expired — caller should catch and 401."""
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


# ============================================================================
# TEMP PASSWORDS (admin-provisioned users) + SCOPED RESET TOKEN
# ============================================================================

_TEMP_PASSWORD_ALPHABET = {
    "upper": string.ascii_uppercase,
    "lower": string.ascii_lowercase,
    "digit": string.digits,
    "symbol": "!@#$%^&*()-_=+?",
}


def generate_temp_password(length: int = 12) -> str:
    """Cryptographically secure random password (secrets, not random),
    guaranteed at least one uppercase/lowercase/digit/symbol character.
    Never stored or logged anywhere by callers — only its hash is
    persisted (see services/auth/user_service.py) and the plaintext is handed
    once to app.core.email.send_email for delivery."""
    if length < 4:
        raise ValueError("length must be at least 4 to fit one of each character class")

    rng = secrets.SystemRandom()
    required = [rng.choice(chars) for chars in _TEMP_PASSWORD_ALPHABET.values()]
    all_chars = "".join(_TEMP_PASSWORD_ALPHABET.values())
    remainder = [rng.choice(all_chars) for _ in range(length - len(required))]

    password_chars = required + remainder
    rng.shuffle(password_chars)
    return "".join(password_chars)


def password_fingerprint(hashed_password: str) -> str:
    """Short, non-reversible fingerprint of a user's current hashed_password,
    embedded in a reset token at issuance (see create_reset_token). Not a
    security boundary by itself (it's derived from a public-ish column) —
    its job is purely to make the token self-invalidating: once
    hashed_password changes (the reset succeeds, or an admin regenerates
    the temp password), any previously issued token's fingerprint stops
    matching, without needing a server-side token blacklist/jti store."""
    return hashlib.sha256(hashed_password.encode("utf-8")).hexdigest()[:16]


def create_reset_token(subject: str, hashed_password: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=RESET_TOKEN_EXPIRE_MINUTES)
    to_encode = {
        "sub": subject,
        "exp": expire,
        "type": "password_reset",
        "pwd_fp": password_fingerprint(hashed_password),
    }
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_reset_token(token: str) -> dict:
    """Raises jose.JWTError if invalid/expired, or if a normal access token
    is presented here instead of a reset token — caller should catch and
    401 either way, same contract as decode_access_token."""
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    if payload.get("type") != "password_reset":
        raise JWTError("Not a password-reset token")
    return payload


# ============================================================================
# TERMS-CONSENT TOKEN (re-consent flow for already-active users)
# ============================================================================

def create_terms_consent_token(subject: str, current_terms_accepted_version: str | None) -> str:
    """Bound to the user's terms_accepted_version *at issuance* (not the
    version they're being asked to accept) — same self-invalidation trick
    as create_reset_token, just keyed on a different field: once the user
    actually accepts and that column changes, any token issued before the
    change carries a stale fingerprint and decode_terms_consent_token's
    caller rejects it. Covers the token-already-redeemed case without a
    server-side blacklist."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=TERMS_CONSENT_TOKEN_EXPIRE_MINUTES)
    to_encode = {
        "sub": subject,
        "exp": expire,
        "type": "terms_consent",
        "prior_version_fp": current_terms_accepted_version or "",
    }
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_terms_consent_token(token: str) -> dict:
    """Raises jose.JWTError if invalid/expired, or if a token of any other
    type is presented here — same contract as decode_reset_token."""
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    if payload.get("type") != "terms_consent":
        raise JWTError("Not a terms-consent token")
    return payload
