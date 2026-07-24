"""
Wraps every JSON response leaving the app in a standard envelope:

    {"Success": 1, "Message": "...", "Data": {...}, "Timestamp": "..."}

Success is 1 for 2xx responses and 0 for anything else (reserved for
future non-binary codes per product decision). Implemented as a single
middleware rather than touching every route/schema individually — Data is
whatever the route already returned, unchanged, so routes that already
carry their own 'status'/'message' key will have it nested inside Data.

Excluded entirely: /docs, /redoc, /openapi.json (would break Swagger/
ReDoc, which expect their own untouched shapes), and any non-JSON
response (StreamingResponse CSV/xlsx downloads, HTML, etc.) — those pass
through unchanged.
"""
import json
from datetime import datetime, timezone

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

EXCLUDED_PATHS = {"/openapi.json", "/docs", "/redoc", "/docs/oauth2-redirect"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _extract_error_message(body: object) -> tuple[str, object]:
    """FastAPI's default HTTPException/validation-error bodies are
    {"detail": "..."} (string) or {"detail": [...]} (422 validation error
    list). Returns (Message, Data) for the error envelope."""
    if isinstance(body, dict) and "detail" in body:
        detail = body["detail"]
        if isinstance(detail, str):
            return detail, None
        return "Validation error", {"errors": detail}
    return "Error", None


class ResponseEnvelopeMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        if request.url.path in EXCLUDED_PATHS:
            return response

        content_type = response.headers.get("content-type", "")
        is_json = "application/json" in content_type

        if not is_json:
            # Safety net: an unhandled exception can produce a non-JSON
            # 5xx body (Starlette's default plain-text error response).
            # Everything else (CSV/xlsx downloads, HTML docs, etc.)
            # passes through untouched.
            if response.status_code < 500:
                return response
            envelope = {
                "Success": 0,
                "Message": "Internal Server Error",
                "Data": None,
                "Timestamp": _now_iso(),
            }
            return JSONResponse(content=envelope, status_code=response.status_code)

        body_bytes = b"".join([chunk async for chunk in response.body_iterator])

        try:
            original = json.loads(body_bytes) if body_bytes else None
        except json.JSONDecodeError:
            return Response(
                content=body_bytes,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.media_type,
            )

        success = response.status_code < 400
        if success:
            message, data = "Success", original
        else:
            message, data = _extract_error_message(original)

        envelope = {
            "Success": 1 if success else 0,
            "Message": message,
            "Data": data,
            "Timestamp": _now_iso(),
        }
        return JSONResponse(content=envelope, status_code=response.status_code)
