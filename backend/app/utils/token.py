import os
import time
from typing import Optional
import jwt

# Secret key for token signing – should be set in environment
_SHARE_SECRET = os.getenv("SHARE_SECRET", "default_share_secret")

def create_audit_share_token(user_id: str, expires_in: int = 3600) -> str:
    """Create a JWT token for sharing audit data.

    Args:
        user_id: Identifier of the user requesting the share link.
        expires_in: Seconds until the token expires (default 1 hour).
    Returns:
        Signed JWT as a string.
    """
    payload = {
        "sub": user_id,
        "iat": int(time.time()),
        "exp": int(time.time()) + expires_in,
        "scope": "audit_share",
    }
    return jwt.encode(payload, _SHARE_SECRET, algorithm="HS256")

def verify_audit_share_token(token: str) -> Optional[str]:
    """Verify a share token and return the ``user_id`` if valid.

    Returns ``None`` when verification fails.
    """
    try:
        decoded = jwt.decode(token, _SHARE_SECRET, algorithms=["HS256"], options={"require": ["exp", "iat", "sub"]})
        if decoded.get("scope") != "audit_share":
            return None
        return decoded.get("sub")
    except Exception:
        return None
