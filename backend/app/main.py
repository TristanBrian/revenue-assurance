from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import reconcile, e_billing

app = FastAPI(
    title="KPC Revenue Assurance API",
    description="Order-to-Cash Leakage Detection & E-Billing Integration",
    version="3.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://*.vercel.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(reconcile.router, prefix="/api", tags=["Reconciliation"])
app.include_router(e_billing.router, prefix="/api", tags=["E-Billing"])

@app.get("/")
async def root():
    return {
        "message": "KPC Revenue Assurance API",
        "status": "running",
        "version": "3.0.0",
        "endpoints": [
            "POST /api/reconcile - Run reconciliation (DB)",
            "POST /api/reconcile/upload - Run reconciliation (CSV Upload)",
            "POST /api/reconcile/sync - Sync to E-Billing",
            "POST /api/reconcile/update - Update anomaly status",
            "GET /api/e-billing/status - E-Billing integration status"
        ]
    }

@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "database": "connected"}
