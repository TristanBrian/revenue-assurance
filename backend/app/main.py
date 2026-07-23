from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.response_envelope import ResponseEnvelopeMiddleware
from app.middleware.audit import AuditMiddleware
from app.routes import reconcile, e_billing, feed, heatmap, auth, detective, graph, admin, audit
from sqlalchemy import text
from app.utils.db_connection import get_engine
from contextlib import asynccontextmanager
import logging
import time


logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("kpc.startup")


# ============================================================================
# CREATE AUDIT TABLE ON STARTUP (AUTOMATIC!)
# ============================================================================
def create_audit_table_if_not_exists():
    """Create the audit_logs table if it doesn't exist.

    Raw SQL rather than an Alembic migration, matching how this table
    shipped upstream — flagged as worth migrating to Alembic later for
    consistency with every other table in this app, not changed here.
    """
    engine = get_engine()
    try:
        with engine.connect() as conn:
            # Check if table exists (SQLite/PostgreSQL compatible)
            if engine.dialect.name == "sqlite":
                result = conn.execute(text(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='audit_logs'"
                ))
                exists = result.fetchone() is not None
            else:  # PostgreSQL
                result = conn.execute(text(
                    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='audit_logs')"
                ))
                exists = result.fetchone()[0]

            if not exists:
                logger.info("📋 Creating audit_logs table...")
                conn.execute(text("""
                    CREATE TABLE audit_logs (
                        id              INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id         INTEGER,
                        user_username   TEXT,
                        action          TEXT NOT NULL,
                        resource        TEXT,
                        resource_id     TEXT,
                        method          TEXT,
                        endpoint        TEXT,
                        ip_address      TEXT,
                        user_agent      TEXT,
                        status_code     INTEGER,
                        success         INTEGER DEFAULT 1,
                        error_message   TEXT,
                        details         TEXT,
                        previous_state  TEXT,
                        new_state       TEXT,
                        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """))
                conn.execute(text("CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_logs (user_id)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs (action)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs (created_at)"))
                conn.commit()
                logger.info("✅ audit_logs table created successfully!")
            else:
                logger.info("✅ audit_logs table already exists.")
    except Exception as e:
        logger.error(f"❌ Failed to create audit_logs table: {e}")


# ============================================================================
# LIFESPAN (Runs on startup)
# ============================================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create audit table on startup
    create_audit_table_if_not_exists()

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
# every route, plus the audit-logging middleware — both added before
# CORSMiddleware so CORS ends up outermost in the middleware stack and
# still applies its headers to the wrapped/audited response (and to error
# responses from either middleware itself).
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

# Include Routers
app.include_router(reconcile.router, prefix="/api", tags=["Reconciliation"])
app.include_router(e_billing.router, prefix="/api", tags=["E-Billing"])
app.include_router(feed.router, prefix="/api", tags=["Live Feed"])
app.include_router(heatmap.router, prefix="/api", tags=["Heatmap"])
app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(detective.router, prefix="/api/detective", tags=["Detective"])
app.include_router(graph.router, prefix="/api/graph", tags=["Graph"])
app.include_router(admin.router, prefix="/api/admin", tags=["Admin"])
app.include_router(audit.router, prefix="/api", tags=["Audit"])


@app.get("/")
async def root():
    return {
        "message": "KPC Revenue Assurance API",
        "status": "running",
        "version": "2.0.0",
        "endpoints": [
            "POST /api/reconcile/metrics - Executive metrics (DB)",
            "GET /api/reconcile/anomalies - Paginated anomaly table (DB)",
            "GET /api/reconcile/omc-risk-profile - OMC risk profile (DB)",
            "POST /api/reconcile/upload - Run reconciliation (CSV Upload)",
            "POST /api/reconcile/sync - Sync anomalies to E-Billing",
            "POST /api/reconcile/update - Update anomaly status",
            "GET /api/reconcile/export - Download Excel report",
            "GET /api/reconcile/template/{type} - Download CSV template",
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
            "GET /api/feed - Live anomaly feed",
            "GET /api/heatmap - Leakage heatmap (OMC × Product)",
            "GET /api/detective/risk-features - OMC risk features (all OMCs)",
            "GET /api/detective/risk-features/{omc_id} - OMC risk features (single OMC)",
            "GET /api/detective/risk-features/export - Download risk features as CSV",
            "GET /api/graph - Anomaly-based fraud graph (OMC<->Depot leakage, Louvain communities)",
            "GET /api/graph/network - OMC/depot structural network graph",
            "GET /api/graph/communities - Detected risk communities (structural graph)",
            "GET /api/graph/omc/{omc_id} - Risk features + community info for one OMC",
            "GET /api/admin/users - List all users",
            "PATCH /api/admin/users/{user_id} - Edit a user (email/name/role/password/is_active)",
            "DELETE /api/admin/users/{user_id} - Delete a user",
            "GET /api/audit/logs - Paginated audit log (view_audit)",
            "GET /api/audit/summary - Audit summary for the last N days (view_audit)",
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
