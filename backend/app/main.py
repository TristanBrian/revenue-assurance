from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.response_envelope import ResponseEnvelopeMiddleware
from app.middleware.audit import AuditMiddleware
from app.routes import reconcile, e_billing, feed, heatmap, auth, detective, graph, admin, audit  # <-- ADDED feed, heatmap, auth, detective, graph, admin, audit
# import sqlite3  # replaced by SQLAlchemy engine (see app.utils.db_connection)
from sqlalchemy import text
from app.utils.db_connection import get_engine
from contextlib import asynccontextmanager
import logging
import time


logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("kpc.startup")


# ============================================================================
# LIFESPAN (Runs on startup)
# ============================================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Check database connection
    engine = get_engine()
    safe_url = engine.url.render_as_string(hide_password=True)
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        logger.info(f"✅ Database connected successfully ({safe_url})")
    except Exception as e:
        logger.error(f"❌ Database connection failed ({safe_url}): {e}")

    yield


# ============================================================================
# FASTAPI APP
# ============================================================================
app = FastAPI(
    title="KPC Revenue Assurance API",
    description="Order-to-Cash Leakage Detection & E-Billing Integration",
    version="2.0.0",
    lifespan=lifespan
)

# Standardized {Success, Message, Data, Timestamp} response envelope for
# every route, plus the fallback audit-logging middleware — both added
# before CORSMiddleware so CORS ends up outermost in the middleware stack
# and still applies its headers to the wrapped/audited response (and to
# error responses from either middleware itself).
app.add_middleware(ResponseEnvelopeMiddleware)
app.add_middleware(AuditMiddleware)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://*.vercel.app", "https://*.railway.app"],
    allow_credentials=True,
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


@app.get("/")
async def root():
    return {
        "message": "KPC Revenue Assurance API",
        "status": "running",
        "version": "2.0.0",
        "endpoints": [
            # -- Auth: everything else needs a token from here first --
            "POST /api/auth/login - Log in, returns a JWT",
            "POST /api/auth/register - Create a user and assign a role (manage_users)",
            "GET /api/auth/me - Current user's profile, roles, permissions",

            # -- Live Feed: real-time entry point, every role sees it --
            "GET /api/feed - Live anomaly feed",

            # -- Reconciliation: the core leakage-detection workflow --
            "POST /api/reconcile/metrics - Executive metrics (DB)",
            "GET /api/reconcile/anomalies - Paginated anomaly table (DB)",
            "GET /api/reconcile/omc-risk-profile - OMC risk profile (DB)",
            "POST /api/reconcile/upload - Run reconciliation (CSV Upload)",
            "GET /api/reconcile/template/{type} - Download CSV template",
            "POST /api/reconcile/update - Update anomaly status",
            "GET /api/reconcile/export - Download Excel report",
            "POST /api/reconcile/sync - Sync anomalies to E-Billing",

            # -- Heatmap: visual complement to reconciliation --
            "GET /api/heatmap - Leakage heatmap (OMC × Product)",

            # -- E-Billing: downstream KRA iCMS integration --
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

            # -- Fraud Graph: network/structural leakage analysis --
            "GET /api/graph - Anomaly-based fraud graph (OMC<->Depot leakage, Louvain communities)",
            "GET /api/graph/network - OMC/depot structural network graph",
            "GET /api/graph/communities - Detected risk communities (structural graph)",
            "GET /api/graph/omc/{omc_id} - Risk features + community info for one OMC",

            # -- Risk Analytics: statistical/EDA counterpart to the graph --
            "GET /api/detective/risk-features - OMC risk features (all OMCs)",
            "GET /api/detective/risk-features/{omc_id} - OMC risk features (single OMC)",
            "GET /api/detective/risk-features/export - Download risk features as CSV",

            # -- Admin: user/permission management, not a revenue-assurance feature --
            "GET /api/admin/users - List all users",
            "PATCH /api/admin/users/{user_id} - Edit a user (email/name/role/password/is_active)",
            "DELETE /api/admin/users/{user_id} - Delete a user",

            # -- Audit: who did what, across everything above --
            "GET /api/audit/logs - Paginated, filterable audit trail",
            "GET /api/audit/logs/{log_id} - Single audit log entry",
            "GET /api/audit/summary - Aggregate audit stats for the last N days",
            "GET /api/audit/me - Current user's own audit trail",

            # -- Infra --
            "GET /health - Health check"
        ]
    }


@app.get("/version")
async def version():
    """
    Returns API version information for monitoring and CI/CD.
    """
    return {
        "version": "2.0.0",
        "service": "kpc-revenue-assurance",
        "status": "production-ready",
        "endpoints_count": len(app.routes)
    }


@app.get("/health")
async def health_check():
    """
    Health check endpoint for monitoring and cloud deployments.
    """
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


@app.get("/api/health")
async def api_health():
    return await health_check()
