from fastapi import FastAPI, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from app.core.response_envelope import ResponseEnvelopeMiddleware
from app.middleware.audit import AuditMiddleware
from app.routes.reconciliation import reconcile, heatmap
from app.routes.ebilling import e_billing
from app.routes.feed import feed
from app.routes.auth import auth, admin
from app.routes.fraud import detective, graph
from app.routes.audit import audit
from app.routes.alerts import alerts
from app.routes.reports import report_verify

# import sqlite3  # replaced by SQLAlchemy engine (see app.utils.db_connection)
from sqlalchemy import text
from app.utils.db_connection import get_engine
from app.services.audit.anchor_service import run_periodic_anchor_check
from contextlib import asynccontextmanager
import asyncio
import contextlib
import logging
import time

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
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

    # Periodic on-chain anchor check (immutable audit trail) — always
    # started; it's cheap to poll and no-ops immediately if anchoring
    # isn't configured (no AUDIT_ANCHOR_CONTRACT_ADDRESS / CDP
    # credentials yet), same as everything else in this app that
    # degrades gracefully when a third-party integration isn't set up.
    # See services/audit/anchor_service.py's module docstring.
    anchor_task = asyncio.create_task(run_periodic_anchor_check())
    yield
    anchor_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await anchor_task

# ============================================================================
# FASTAPI APP
# ============================================================================
app = FastAPI(
    title="KPC Revenue Assurance API",
    description="Order-to-Cash Leakage Detection & E-Billing Integration",
    version="2.0.0",
    lifespan=lifespan
)

# ✅ CORS – must be the FIRST middleware (outermost)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],                 # Allow all origins during debugging
    allow_credentials=False,             # Must be False when using "*"
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers — order here also drives the grouping/order Swagger UI
# displays tags in, so it's kept in sync with the strategic ordering in
# root()'s "endpoints" list below: Auth first (everything else needs a
# token), then Live Feed, Reconciliation, Heatmap, E-Billing, Graph,
# Detective (risk analytics), Admin, Audit.
app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])  # <-- ADDED auth router
app.include_router(feed.router, prefix="/api", tags=["Live Feed"])      # <-- NEW
app.include_router(reconcile.router, prefix="/api", tags=["Reconciliation"])
app.include_router(heatmap.router, prefix="/api", tags=["Heatmap"])    # <-- NEW
app.include_router(e_billing.router, prefix="/api", tags=["E-Billing"])
app.include_router(graph.router, prefix="/api/graph", tags=["Graph"])  # <-- NEW
app.include_router(detective.router, prefix="/api/detective", tags=["Detective"])  # <-- NEW
app.include_router(admin.router, prefix="/api/admin", tags=["Admin"])  # <-- NEW
app.include_router(audit.router, prefix="/api/audit", tags=["Audit"])  # <-- NEW
app.include_router(alerts.router, prefix="/api/alerts", tags=["Alerts"])  # <-- NEW
app.include_router(report_verify.router, prefix="/api/reports", tags=["Report Verification"])

# Envelope and audit middlewares
app.add_middleware(ResponseEnvelopeMiddleware)
app.add_middleware(AuditMiddleware)

# ============================================================================
# MANUAL OPTIONS HANDLER FOR LOGIN (fallback)
# ============================================================================
@app.options("/api/auth/login")
async def options_login():
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Max-Age": "86400",
        }
    )

# ============================================================================
# ROOT AND HEALTH ENDPOINTS (with HEAD support)
# ============================================================================

@app.get("/")
async def root():
    return {
        "message": "KPC Revenue Assurance API",
        "status": "running",
        "version": "2.0.0",
        "endpoints": [
            # -- Auth: everything else needs a token from here first --
            "POST /api/auth/login - Log in, returns a JWT (or a scoped reset_token if must_reset_password)",
            "POST /api/auth/reset-password - Redeem a reset_token + set a new password + accept Terms/Privacy (forced-reset flow)",
            "GET /api/auth/terms - Current Terms & Conditions / Privacy Policy text + required version",
            "POST /api/auth/accept-terms - Redeem a consent_token to re-accept a newer Terms/Privacy version",
            "POST /api/auth/register - Create a user and assign a role (manage_users)",
            "GET /api/auth/me - Current user's profile, roles, permissions",
            "GET /api/feed - Live anomaly feed",
            "POST /api/reconcile/metrics - Executive metrics (DB)",
            "GET /api/reconcile/anomalies - Paginated anomaly table (DB)",
            "GET /api/reconcile/omc-risk-profile - OMC risk profile (DB)",
            "POST /api/reconcile/upload - Run reconciliation (CSV Upload)",
            "GET /api/reconcile/template/{type} - Download CSV template",
            "POST /api/reconcile/update - Update anomaly status",
            "GET /api/reconcile/export - Download Excel report",
            "POST /api/reconcile/sync - Sync anomalies to E-Billing",
            "GET /api/heatmap - Leakage heatmap (OMC × Product)",
            "GET /api/e-billing/status - E-Billing integration status",
            "POST /api/e-billing/sync - Sync invoices to KRA iCMS",
            "POST /api/e-billing/sync/async - Async sync (returns task_id)",
            "GET /api/e-billing/task/{task_id} - Check async task status",
            "POST /api/e-billing/retry/{invoice_id} - Retry failed sync",
            "GET /api/e-billing/logs - View sync logs",
            "GET /api/e-billing/pending - List pending invoices",
            "POST /api/e-billing/webhook - KRA webhook callback",
            "GET /api/e-billing/reconcile - E-Billing reconciliation dashboard",
            "GET /api/e-billing/monitor - Failure rate monitoring",
            "GET /api/graph - Anomaly-based fraud graph (OMC<->Depot leakage, Louvain communities)",
            "GET /api/graph/network - OMC/depot structural network graph",
            "GET /api/graph/communities - Detected risk communities (structural graph)",
            "GET /api/graph/omc/{omc_id} - Risk features + community info for one OMC",
            "GET /api/detective/risk-features - OMC risk features (all OMCs)",
            "GET /api/detective/risk-features/{omc_id} - OMC risk features (single OMC)",
            "GET /api/detective/risk-features/export - Download risk features as CSV",

            # -- Admin: user/permission management, not a revenue-assurance feature --
            "GET /api/admin/users - List all users (with account_status)",
            "POST /api/admin/users - Provision a user with an emailed temp password, forced reset on first login",
            "POST /api/admin/users/{user_id}/resend-temp-password - Regenerate + re-email a temp password",
            "PATCH /api/admin/users/{user_id} - Edit a user (email/name/role/password/is_active)",
            "DELETE /api/admin/users/{user_id} - Delete a user",
            "GET /api/audit/logs - Paginated, filterable audit trail",
            "GET /api/audit/logs/{log_id} - Single audit log entry",
            "GET /api/audit/summary - Aggregate audit stats for the last N days",
            "GET /api/audit/me - Current user's own audit trail",

            # -- Alerts: in-app + email notifications (system-triggered and manual) --
            "GET /api/alerts - Current user's alert inbox",
            "GET /api/alerts/unread-count - Unread alert badge count",
            "POST /api/alerts/{alert_id}/read - Mark one alert read",
            "POST /api/alerts/read-all - Mark every visible alert read",
            "POST /api/alerts - Broadcast a manual alert (manage_alerts)",

            # -- Infra --
            "GET /health - Health check"
        ]
    }

@app.head("/")
async def head_root():
    return Response(status_code=200)

@app.get("/version")
async def version():
    return {
        "version": "2.0.0",
        "service": "kpc-revenue-assurance",
        "status": "production-ready",
        "endpoints_count": len(app.routes)
    }

@app.get("/health")
async def health_check():
    db_status = "disconnected"
    start_time = time.time()
    try:
        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_status = "connected"
    except Exception as e:
        db_status = f"error: {str(e)}"
    return {
        "status": "healthy" if db_status == "connected" else "unhealthy",
        "database": db_status,
        "version": "2.0.0",
        "service": "kpc-revenue-assurance",
        "uptime": round(time.time() - start_time, 2)
    }

@app.head("/health")
async def head_health():
    return Response(status_code=200)

@app.get("/api/health")
async def api_health():
    return await health_check()

@app.get("/ping")
async def ping():
    return {"status": "ok"}