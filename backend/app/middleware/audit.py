"""
Fallback audit-logging middleware.

Catches mutating requests (POST/PUT/PATCH/DELETE) that aren't already
covered by an explicit audit_service.log_action() call at a specific
business action point — e.g. CSV uploads, the KRA webhook — and logs them
generically. GET is never logged here: the point is to catch writes with
no targeted log_action() call yet, not to duplicate the (read-heavy)
business audit trail with routine HTTP noise.

Writes into the same audit_logs table as the targeted calls (via
audit_service.log_action()), tagged with a generic "http.<method>" action
so a curated query like get_audit_logs(action="anomaly.resolve") never
picks up this middleware's rows by mistake.

EXPLICITLY_AUDITED_PATH_PREFIXES lists every path that already gets a
targeted log_action() call elsewhere (services/user_service.py,
services/e_billing.py's update_anomaly_status, routes/auth.py's
login/register, routes/reconcile.py's /update and /sync) — this
middleware skips those entirely rather than double-logging the same
request once specifically and once generically. Keep this list in sync
whenever a new explicit log_action() call is added.
"""
from fastapi import Request
from jose import JWTError
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.security import decode_access_token
from app.models.user import User
from app.services.audit_service import log_action
from app.utils.db_connection import SessionLocal

SKIP_PATH_PREFIXES = ("/health", "/docs", "/openapi.json", "/redoc", "/favicon.ico")

EXPLICITLY_AUDITED_PATH_PREFIXES = (
    "/api/reconcile/update",
    "/api/reconcile/sync",
    "/api/e-billing/sync",   # also covers /api/e-billing/sync/async
    "/api/e-billing/retry",  # covers /api/e-billing/retry/{invoice_id}
    "/api/auth/login",
    "/api/auth/register",
    "/api/admin/users",      # covers /api/admin/users/{user_id}
)

MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if (
            request.method not in MUTATING_METHODS
            or path.startswith(SKIP_PATH_PREFIXES)
            or path.startswith(EXPLICITLY_AUDITED_PATH_PREFIXES)
        ):
            return await call_next(request)

        actor_user_id = await self._resolve_actor(request)
        response = await call_next(request)

        try:
            db = SessionLocal()
            try:
                log_action(
                    db,
                    actor_user_id=actor_user_id,
                    action=f"http.{request.method.lower()}",
                    target_type="endpoint",
                    target_id=path,
                    after={"status_code": response.status_code},
                    metadata={
                        "query_params": dict(request.query_params),
                        "client_ip": request.client.host if request.client else None,
                    },
                )
                db.commit()
            finally:
                db.close()
        except Exception:
            # Never let audit logging break the actual response.
            pass

        return response

    @staticmethod
    async def _resolve_actor(request: Request):
        """Best-effort JWT decode, same claim (sub = email) as
        get_current_user — but never raises. An invalid/missing/expired
        token here just means an unattributed (actor_user_id=None) row,
        not a 401; the real 401/403 (if any) still comes from the
        endpoint's own auth dependency, this only affects attribution."""
        auth_header = request.headers.get("authorization", "")
        if not auth_header.lower().startswith("bearer "):
            return None
        token = auth_header[len("bearer "):].strip()
        try:
            payload = decode_access_token(token)
        except JWTError:
            return None
        email = payload.get("sub")
        if not email:
            return None

        db = SessionLocal()
        try:
            user = db.query(User).filter(User.email == email).first()
            return user.id if user else None
        finally:
            db.close()
