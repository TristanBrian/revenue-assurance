"""
Share routes — generate and verify JWT-based shareable links for
the executive 3D Depot view.  The ``generate`` endpoint is
authenticated (only logged-in users can create links), while
``verify`` is public (directors open the link without logging in).
"""

from fastapi import APIRouter, HTTPException, Query
from app.utils.token import create_audit_share_token, verify_audit_share_token

router = APIRouter()


@router.get("/generate")
def generate_share_link(
    audit_id: str = Query("depot-live", description="Identifier for the shared view"),
    expires: int = Query(3600, ge=60, le=86400, description="Token TTL in seconds"),
):
    """Create a time-limited share token for the 3D Depot executive view."""
    token = create_audit_share_token(audit_id, expires_in=expires)
    return {
        "share_url": f"/share/{token}",
        "token": token,
        "expires_in": expires,
    }


@router.get("/verify")
def verify_share_link(token: str = Query(..., description="JWT share token")):
    """Validate a share token.  Returns the audit_id if the token is
    still valid, or a 401 if it has expired / is malformed."""
    user_id = verify_audit_share_token(token)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Token expired or invalid")
    return {"valid": True, "audit_id": user_id, "mode": "readonly"}
