from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class Anomaly(BaseModel):
    dispatch_id: str
    invoice_id: Optional[str] = None
    customer: str
    product: str
    dispatched_kes: int
    invoiced_kes: Optional[int] = 0
    paid_kes: Optional[int] = 0
    leakage_kes: int
    break_type: str  # "Missing Invoice", "Missing Payment", "Underpayment", "Overpayment"
    status: str      # "New", "Synced", "Resolved", "Failed"
    ebilling_status: str = "Pending"  # "Pending", "Synced", "Failed"
    ebilling_sync_date: Optional[str] = None
    age_days: int
    created_at: str

class Metrics(BaseModel):
    total_dispatched_kes: int
    total_invoiced_kes: int
    total_paid_kes: int
    total_leakage_kes: int
    reconciliation_rate: float
    missing_invoice_leak: int
    missing_payment_leak: int
    underpayment_leak: int
    anomaly_count: int
    critical_count: int
    pending_sync_count: int

class ReconciliationResponse(BaseModel):
    status: str
    metrics: Metrics
    anomalies: List[Anomaly]
    summary: dict
    ebilling_status: dict  # Overall integration health