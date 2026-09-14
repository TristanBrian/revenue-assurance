from fastapi import FastAPI, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from app.core.response_envelope import ResponseEnvelopeMiddleware
from app.middleware.audit import AuditMiddleware
# from app.middleware.masking import BeneficiaryMaskingMiddleware  # <-- REMOVE THIS
from app.routes.reconciliation import reconcile, heatmap
from app.routes.ebilling import e_billing
from app.routes.feed import feed
from app.routes.auth import auth, admin
from app.routes.fraud import detective, graph, scoring
from app.routes.audit import audit
from app.routes.alerts import alerts
from app.routes import inuka
from app.routes import report_verify
from app.routes import control
from app.routes import control_plane
from app.routes import integrations
# from app.routes import chatbot

from app.config import settings
from sqlalchemy import text
from app.utils.db_connection import get_engine
from app.services.audit.anchor_service import run_periodic_anchor_check
from app.services.fraud.graph_snapshot_service import run_periodic_graph_snapshot_refresh
from app.services.fraud.fraud_scoring_service import run_periodic_retrain_check
from app.services.inuka_stream import run_inuka_stream
from contextlib import asynccontextmanager
import asyncio
import contextlib
import logging
import os
import time

_log_level_name = os.getenv("LOG_LEVEL", "INFO").upper()
_log_level = getattr(logging, _log_level_name, logging.INFO)
logging.basicConfig(level=_log_level, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("kpc.startup")

# ============================================================================
# LIFESPAN (Runs on startup)
# ============================================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    engine = get_engine()
    safe_url = engine.url.render_as_string(hide_password=True)
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        logger.info(f"✅ Database connected successfully ({safe_url})")
    except Exception as e:
        logger.error(f"❌ Database connection failed ({safe_url}): {e}")

    anchor_task = asyncio.create_task(run_periodic_anchor_check())

    graph_snapshot_task = asyncio.create_task(run_periodic_graph_snapshot_refresh())
    retrain_check_task = asyncio.create_task(run_periodic_retrain_check())
    inuka_stream_task = asyncio.create_task(run_inuka_stream())

    background_tasks = [anchor_task, graph_snapshot_task, retrain_check_task, inuka_stream_task]
    yield
    for task in background_tasks:
        task.cancel()
    for task in background_tasks:
        with contextlib.suppress(asyncio.CancelledError):
            await task

# ============================================================================
# FASTAPI APP
# ============================================================================
app = FastAPI(
    title=f"{settings.app_name} API",
    description=f"{settings.app_tagline} – Order-to-Cash Leakage Detection & E-Billing Integration",
    version=settings.app_version,
    lifespan=lifespan
)

# CORS configuration
_raw_cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001")
_cors_origins = [origin.strip() for origin in _raw_cors_origins.split(",") if origin.strip()]
if not _cors_origins:
    raise RuntimeError("CORS_ORIGINS must contain at least one allowed origin")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

# ============================================================================
# MIDDLEWARE REGISTRATION
# ============================================================================

# Envelope and audit middlewares ONLY
app.add_middleware(ResponseEnvelopeMiddleware)
# app.add_middleware(BeneficiaryMaskingMiddleware)  # <-- REMOVED - causes Content-Length error
app.add_middleware(AuditMiddleware)

# Include Routers
app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(feed.router, prefix="/api", tags=["Live Feed"])
app.include_router(reconcile.router, prefix="/api", tags=["Reconciliation"])
app.include_router(heatmap.router, prefix="/api", tags=["Heatmap"])
app.include_router(e_billing.router, prefix="/api", tags=["E-Billing"])
app.include_router(graph.router, prefix="/api/graph", tags=["Graph"])
app.include_router(detective.router, prefix="/api/detective", tags=["Detective"])
app.include_router(scoring.router, prefix="/api/fraud", tags=["Fraud Scoring"])
app.include_router(admin.router, prefix="/api/admin", tags=["Admin"])
app.include_router(audit.router, prefix="/api/audit", tags=["Audit"])
app.include_router(alerts.router, prefix="/api/alerts", tags=["Alerts"])
app.include_router(inuka.router, prefix="/api/inuka", tags=["Inuka Assurance"])
app.include_router(report_verify.router, prefix="/api/reports", tags=["Report Verification"])
app.include_router(control.router)
app.include_router(control_plane.router, prefix="/api", tags=["Control Plane"])
app.include_router(integrations.router)

# ============================================================================
# ROOT AND HEALTH ENDPOINTS
# ============================================================================

@app.get("/")
async def root():
    return {
        "message": f"{settings.app_name} API",
        "tagline": settings.app_tagline,
        "status": "running",
        "version": settings.app_version,
        "legacy_name": settings.app_name_legacy,
        "legacy_version": settings.app_version_legacy,
        "endpoints": [
            "GET /api/system/info",
            "POST /api/auth/login",
            "POST /api/auth/reset-password",
            "GET /api/auth/terms",
            "POST /api/auth/accept-terms",
            "POST /api/auth/register",
            "GET /api/auth/me",
            "GET /api/feed",
            "POST /api/reconcile/metrics",
            "GET /api/reconcile/anomalies",
            "GET /api/reconcile/omc-risk-profile",
            "POST /api/reconcile/upload",
            "GET /api/reconcile/template/{type}",
            "POST /api/reconcile/update",
            "GET /api/reconcile/export",
            "POST /api/reconcile/sync",
            "GET /api/heatmap",
            "GET /api/e-billing/status",
            "POST /api/e-billing/sync",
            "POST /api/e-billing/sync/async",
            "GET /api/e-billing/task/{task_id}",
            "POST /api/e-billing/retry/{invoice_id}",
            "GET /api/e-billing/logs",
            "GET /api/e-billing/pending",
            "POST /api/e-billing/webhook",
            "GET /api/e-billing/reconcile",
            "GET /api/e-billing/monitor",
            "GET /api/graph",
            "GET /api/graph/network",
            "GET /api/graph/communities",
            "GET /api/graph/omc/{omc_id}",
            "GET /api/detective/risk-features",
            "GET /api/detective/risk-features/{omc_id}",
            "GET /api/detective/risk-features/export",
            "GET /api/admin/users",
            "POST /api/admin/users",
            "POST /api/admin/users/{user_id}/resend-temp-password",
            "PATCH /api/admin/users/{user_id}",
            "DELETE /api/admin/users/{user_id}",
            "GET /api/audit/logs",
            "GET /api/audit/logs/{log_id}",
            "GET /api/audit/summary",
            "GET /api/audit/me",
            "GET /api/alerts",
            "GET /api/alerts/unread-count",
            "POST /api/alerts/{alert_id}/read",
            "POST /api/alerts/read-all",
            "POST /api/alerts",
            "GET /health"
        ]
    }

@app.head("/")
async def head_root():
    return Response(status_code=200)

@app.get("/api/system/info", tags=["System"])
async def system_info():
    return {
        "name": settings.app_name,
        "tagline": settings.app_tagline,
        "version": settings.app_version,
        "legacy_name": settings.app_name_legacy,
        "legacy_version": settings.app_version_legacy,
        "status": "active"
    }

@app.get("/version")
async def version():
    return {
        "name": settings.app_name,
        "tagline": settings.app_tagline,
        "version": settings.app_version,
        "legacy_name": settings.app_name_legacy,
        "legacy_version": settings.app_version_legacy,
        "service": f"{settings.app_name.lower()}-api",
        "status": "production-ready",
        "endpoints_count": len(app.routes)
    }

@app.get("/health")
async def health_check(response: Response):
    db_status = "disconnected"
    start_time = time.time()
    try:
        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_status = "connected"
    except Exception:
        logger.exception("Database readiness check failed")
        response.status_code = 503
    return {
        "status": "healthy" if db_status == "connected" else "unhealthy",
        "database": db_status,
        "version": "2.0.0",
        "service": "kpc-revenue-assurance",
        "uptime": round(time.time() - start_time, 2)
    }

@app.head("/health")
async def head_health():
    response = Response()
    await health_check(response)
    return response

@app.get("/api/health")
async def api_health(response: Response):
    return await health_check(response)

@app.get("/ping")
async def ping():
    return {"status": "ok"}