from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import reconcile, e_billing, feed, heatmap, auth  # <-- ADDED feed, heatmap, auth
# import sqlite3  # replaced by SQLAlchemy engine (see app.utils.db_connection)
from sqlalchemy import text
from app.utils.db_connection import get_engine
from contextlib import asynccontextmanager
import logging
import os
import time


logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("kpc.startup")


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
    yield


app = FastAPI(
    title="KPC Revenue Assurance API",
    description="Order-to-Cash Leakage Detection & E-Billing Integration",
    version="2.0.0",
    lifespan=lifespan
)

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
app.include_router(feed.router, prefix="/api", tags=["Live Feed"])      # <-- NEW
app.include_router(heatmap.router, prefix="/api", tags=["Heatmap"])    # <-- NEW
app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])  # <-- ADDED auth router


@app.get("/")
async def root():
    return {
        "message": "KPC Revenue Assurance API",
        "status": "running",
        "version": "2.0.0",
        "endpoints": [
            "POST /api/reconcile - Run reconciliation (DB)",
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
            "GET /api/feed - Live anomaly feed",          # <-- NEW
            "GET /api/heatmap - Leakage heatmap (OMC × Product)",  # <-- NEW
            "GET /health - Health check"
        ]
    }


@app.get("/health")
async def health_check():
    """
    Health check endpoint for monitoring and cloud deployments.
    """
    db_status = "disconnected"
    start_time = time.time()
    # --- Old SQLite-only version (kept for reference) ---
    # try:
    #     db_path = os.path.join(os.path.dirname(__file__), '..', 'kpc.db')
    #     if not os.path.exists(db_path):
    #         db_status = "file_not_found"
    #     else:
    #         conn = sqlite3.connect(db_path)
    #         cursor = conn.cursor()
    #         cursor.execute("SELECT 1")
    #         cursor.fetchone()
    #         conn.close()
    #         db_status = "connected"
    # except Exception as e:
    #     db_status = f"error: {str(e)}"
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