"""
Pydantic response schemas for routes/reconcile.py.

Field lists below were taken directly from the dict literals actually built
in app/services/reconciliation.py and app/services/e_billing.py's
update_anomaly_status() (verified via AST inspection), not copied from the
old unused schemas in this module — those had drifted from reality: the old
Metrics was missing 'overpayment_leak', 'pending_count' and 'review_count',
and had a 'pending_sync_count' field that doesn't exist in the real dict at
all (the real key is 'pending_count').

Two endpoints are intentionally left without response_model:
- GET /reconcile/template/{file_type} returns a StreamingResponse (CSV bytes)
- GET /reconcile/export returns a StreamingResponse (xlsx bytes)
Both bypass response_model entirely (FastAPI passes a returned Response
subclass straight through), so declaring one would just be misleading/wrong
in the OpenAPI schema without actually doing anything.
"""
from typing import Any, Optional

from pydantic import BaseModel

from app.schemas.e_billing import EBillingSyncResult, Pagination


# ============================================================================
# RECONCILIATION SCHEMAS
# ============================================================================

class Anomaly(BaseModel):
    dispatch_id: str
    invoice_id: Optional[str] = None
    customer: str
    product: str
    dispatched_kes: int
    invoiced_kes: int
    paid_kes: int
    leakage_kes: int
    break_type: str
    status: str
    ebilling_status: str
    ebilling_sync_date: Optional[str] = None
    age_days: int
    created_at: str
    # Persisted overlay from anomaly_resolutions (app/models/anomaly_resolution.py) —
    # None until someone calls POST /reconcile/update for this dispatch_id.
    # Doesn't affect whether this anomaly appears at all; see
    # services/reconciliation.py's resolution-overlay comment.
    resolution_status: Optional[str] = None
    resolution_notes: Optional[str] = None
    resolution_updated_at: Optional[str] = None


class Metrics(BaseModel):
    total_dispatched_kes: int
    total_invoiced_kes: int
    total_paid_kes: int
    total_leakage_kes: int
    reconciliation_rate: float
    missing_invoice_leak: int
    missing_payment_leak: int
    underpayment_leak: int
    overpayment_leak: int
    anomaly_count: int
    critical_count: int
    pending_count: int
    review_count: int


class ReconciliationSummary(BaseModel):
    total_anomalies: int
    total_leakage_kes: int
    reconciliation_rate: float
    critical_count: int
    pending_count: int
    review_count: int


class PerformanceStats(BaseModel):
    processing_time_seconds: float
    rows_processed: int
    rows_per_second: float


class DataQuality(BaseModel):
    total_rows: int
    null_volume: int
    null_value: int
    zero_volume: int
    zero_value: int
    invalid_customer: int
    quality_score: float


class ReconciliationEbillingStatus(BaseModel):
    """The small e-billing summary embedded in a reconciliation result.
    NOT the same shape as e_billing.EBillingStatus (that one has 10 fields
    from the real ebilling_sync table; this one is a fixed 5-field stub
    built inline in run_reconciliation_on_dataframes())."""
    system: str
    connected: bool
    total_pending: int
    total_synced: int
    last_sync: Optional[str] = None


class DuplicateAnomaly(BaseModel):
    type: str
    column: str
    label: str
    duplicate_count: int
    # Raw duplicated rows via DataFrame.to_dict(orient='records') — columns
    # vary by which CSV (dispatches vs invoices) and which upload, so this
    # genuinely has no fixed shape.
    details: list[dict[str, Any]]


class OmcRiskProfile(BaseModel):
    customer: str
    leakage_kes: int
    anomaly_count: int
    risk_level: str


class ReconciliationData(BaseModel):
    metrics: Metrics
    anomalies: list[Anomaly]  # This is now the PAGINATED list
    summary: ReconciliationSummary
    performance: PerformanceStats
    data_quality: DataQuality
    ebilling_status: ReconciliationEbillingStatus
    duplicate_anomalies: list[DuplicateAnomaly]
    omc_risk_profile: list[OmcRiskProfile]


# ============================================================================
# RESPONSE SCHEMAS (WITH PAGINATION)
# ============================================================================

class MetricsResponse(BaseModel):
    """POST /reconcile/metrics – Executive Metrics feature (gated view_metrics).
    Everything from ReconciliationData except the anomaly table and OMC risk
    profile, which are gated separately and live in their own endpoints."""
    status: str
    metrics: Metrics
    summary: ReconciliationSummary
    performance: PerformanceStats
    data_quality: DataQuality
    ebilling_status: ReconciliationEbillingStatus
    duplicate_anomalies: list[DuplicateAnomaly]


class AnomalyTableResponse(BaseModel):
    """GET /reconcile/anomalies – Anomaly Table feature (gated view_anomaly_table)."""
    status: str
    anomalies: list[Anomaly]
    pagination: Pagination


class OmcRiskProfileResponse(BaseModel):
    """GET /reconcile/omc-risk-profile – OMC Risk Profile feature (gated view_omc_risk_profile)."""
    status: str
    omc_risk_profile: list[OmcRiskProfile]


class ReconciliationUploadResponse(BaseModel):
    """POST /reconcile/upload – returns reconciliation data with pagination."""
    status: str
    data: ReconciliationData
    pagination: Pagination  # <-- Explicitly included
    message: str


class SyncAnomaliesResponse(BaseModel):
    """POST /reconcile/sync"""
    status: str
    sync_result: EBillingSyncResult
    pending_count: int


class UpdateAnomalyResponse(BaseModel):
    """POST /reconcile/update (update_anomaly_status() in services/e_billing.py
    — implemented there, but the route it backs lives in routes/reconcile.py)."""
    status: str
    message: str
    dispatch_id: str
    new_status: str
    timestamp: str