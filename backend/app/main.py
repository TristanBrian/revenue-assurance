from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import reconcile, e_billing, feed, heatmap  # <-- ADDED feed, heatmap
import sqlite3
import os
import time

app = FastAPI(
    title="KPC Revenue Assurance API",
    description="Order-to-Cash Leakage Detection & E-Billing Integration",
    version="2.0.0"
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
    try:
        db_path = os.path.join(os.path.dirname(__file__), '..', 'kpc.db')
        if not os.path.exists(db_path):
            db_status = "file_not_found"
        else:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
            conn.close()
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