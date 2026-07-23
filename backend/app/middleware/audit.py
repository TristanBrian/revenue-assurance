"""
Audit Middleware – Automatically logs all API requests
"""
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from app.services.audit import create_audit_log
from app.utils.db_connection import SessionLocal


class AuditMiddleware(BaseHTTPMiddleware):
    SKIP_PATHS = ["/health", "/docs", "/openapi.json", "/redoc", "/favicon.ico"]

    async def dispatch(self, request: Request, call_next):
        # Skip logging for certain paths
        if any(request.url.path.startswith(p) for p in self.SKIP_PATHS):
            return await call_next(request)

        user_id = getattr(request.state, "user_id", None)
        username = getattr(request.state, "username", None)

        response = await call_next(request)

        # Log asynchronously (avoid blocking response)
        try:
            db = SessionLocal()
            create_audit_log(
                db=db,
                user_id=user_id,
                username=username,
                action=f"API_{request.method}",
                resource=request.url.path.split("/")[2] if len(request.url.path.split("/")) > 2 else "API",
                method=request.method,
                endpoint=request.url.path,
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
                status_code=response.status_code,
                success=1 if 200 <= response.status_code < 400 else 0,
                details={"query_params": dict(request.query_params)}
            )
            db.close()
        except Exception as e:
            # Never let audit logging break the main flow
            pass

        return response
