"""
Pydantic response schemas for routes/e_billing.py.

Field lists below were taken directly from the actual dict literals returned
by app/services/e_billing.py (verified via AST inspection, not copied from
the old unused schemas in app/models/e_billing.py — those had drifted: e.g.
the old EBillingSyncResponse was missing 'status' and 'message', which the
real sync_invoices_to_ebilling() return dict always includes).

A few service functions return genuinely different key sets depending on
the code path (e.g. retry_failed_sync() omits invoice_id/new_status/
retry_count/timestamp on its "not found"/"not failed" early-return paths;
check_failure_rate() omits 'threshold' when there are zero sync attempts).
Those fields are typed Optional[...] = None here to cover every path
without changing what the routes actually return.
"""
from typing import Optional, List

from pydantic import BaseModel


# ============================================================================
# PAGINATION SCHEMA (NEW)
# ============================================================================

class Pagination(BaseModel):
    """Pagination metadata for paginated endpoints."""
    page: int
    page_size: int
    total: int
    total_pages: int
    has_next: bool
    has_prev: bool


# ============================================================================
# E-BILLING STATUS
# ============================================================================

class EBillingStatus(BaseModel):
    """Inner shape of GET /e-billing/status's "integration" field (get_ebilling_status())."""
    system: str
    connected: bool
    last_sync: Optional[str] = None
    total_invoices: int
    synced_count: int
    pending_count: int
    failed_count: int
    not_attempted: int
    api_endpoint: str
    response_time_ms: int


class EBillingStatusResponse(BaseModel):
    status: str
    integration: EBillingStatus


# ============================================================================
# E-BILLING SYNC
# ============================================================================

class EBillingSyncResult(BaseModel):
    """Return shape of sync_invoices_to_ebilling() — used directly by POST
    /e-billing/sync, and nested inside EBillingTaskStatus.result and
    reconciliation.SyncAnomaliesResponse.sync_result."""
    status: str
    message: str
    synced: int
    failed: int
    total_processed: int
    failed_ids: list[str]
    sync_time: str


class EBillingAsyncSyncResponse(BaseModel):
    status: str
    task_id: str
    message: str


class EBillingTaskStatus(BaseModel):
    """GET /e-billing/task/{task_id}. The "not_found" state 404s before
    reaching response_model, so only the running/completed/failed shapes
    apply here — fields absent on "running" are Optional."""
    status: str
    progress: Optional[int] = None
    result: Optional[EBillingSyncResult] = None
    error: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


# ============================================================================
# E-BILLING LOGS
# ============================================================================

class EBillingLogEntry(BaseModel):
    """One row of get_ebilling_sync_logs()'s SELECT e.*, i.customer_name,
    i.value_kes ... LEFT JOIN invoices — customer_name/value_kes can be
    None if the invoice row is missing."""
    invoice_id: str
    status: str
    sync_date: Optional[str] = None
    error_message: Optional[str] = None
    retry_count: int
    last_attempt: Optional[str] = None
    customer_name: Optional[str] = None
    value_kes: Optional[float] = None


class EBillingLogsResponse(BaseModel):
    status: str
    logs: list[EBillingLogEntry]
    count: int


# ============================================================================
# E-BILLING LOGS – PAGINATED (NEW)
# ============================================================================

class EBillingLogsPaginatedResponse(BaseModel):
    """GET /e-billing/logs/paginated – returns paginated logs with metadata."""
    status: str
    data: list[EBillingLogEntry]
    pagination: Pagination


# ============================================================================
# E-BILLING RETRY
# ============================================================================

class EBillingRetryResponse(BaseModel):
    """POST /e-billing/retry/{invoice_id}. retry_failed_sync() has 3 return
    shapes: not-found / not-failed (status+message only) and success
    (all 6 fields) — the extra fields are Optional to cover all 3."""
    status: str
    message: str
    invoice_id: Optional[str] = None
    new_status: Optional[str] = None
    retry_count: Optional[int] = None
    timestamp: Optional[str] = None


# ============================================================================
# E-BILLING PENDING
# ============================================================================

class EBillingPendingResponse(BaseModel):
    status: str
    pending_count: int
    invoice_ids: list[str]


# ============================================================================
# E-BILLING PENDING – PAGINATED (NEW)
# ============================================================================

class EBillingPendingItem(BaseModel):
    """One pending invoice with details."""
    invoice_id: str
    customer_name: Optional[str] = None
    value_kes: Optional[float] = None
    date: Optional[str] = None
    status: Optional[str] = None
    retry_count: Optional[int] = None


class EBillingPendingPaginatedResponse(BaseModel):
    """GET /e-billing/pending/paginated – returns paginated pending invoices with metadata."""
    status: str
    data: list[EBillingPendingItem]
    pagination: Pagination


# ============================================================================
# E-BILLING WEBHOOK
# ============================================================================

class EBillingWebhookResponse(BaseModel):
    """POST /e-billing/webhook. handle_webhook() omits invoice_id/new_status
    entirely on its "missing invoice_id in payload" error path."""
    status: str
    message: str
    invoice_id: Optional[str] = None
    new_status: Optional[str] = None


# ============================================================================
# E-BILLING RECONCILIATION
# ============================================================================

class EBillingReconciliation(BaseModel):
    """Inner shape of GET /e-billing/reconcile's "data" field (get_ebilling_reconciliation())."""
    total_invoices: int
    synced: int
    pending: int
    failed: int
    dlq_count: int
    reconciliation_rate: float
    status: str


class EBillingReconciliationResponse(BaseModel):
    status: str
    data: EBillingReconciliation


# ============================================================================
# E-BILLING MONITOR
# ============================================================================

class EBillingFailureMonitor(BaseModel):
    """Inner shape of GET /e-billing/monitor's "monitoring" field
    (check_failure_rate()). 'threshold' is absent when there are zero
    sync attempts recorded yet."""
    failure_rate: float
    alert: bool
    threshold: Optional[int] = None
    message: str


class EBillingMonitorResponse(BaseModel):
    status: str
    monitoring: EBillingFailureMonitor


# ============================================================================
# E-BILLING CACHE REFRESH (NEW)
# ============================================================================

class EBillingCacheRefreshResponse(BaseModel):
    """POST /e-billing/cache/refresh – response for manual cache invalidation."""
    status: str
    message: str