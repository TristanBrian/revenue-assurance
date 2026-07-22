// Mirrors the actual JSON returned by POST /api/reconcile (backend/app/services/reconciliation.py,
// run_reconciliation_on_dataframes) — NOT the unused Pydantic models in backend/app/models/reconciliation.py,
// whose field names have drifted from what the route actually returns.

export type BreakType =
  | "Missing Invoice"
  | "Missing Payment"
  | "Underpayment"
  | "Overpayment"
  | "Reconciled";

export type AnomalyStatus = "Critical" | "Pending" | "Review Required";

export interface Metrics {
  total_dispatched_kes: number;
  total_invoiced_kes: number;
  total_paid_kes: number;
  total_leakage_kes: number;
  reconciliation_rate: number;
  missing_invoice_leak: number;
  missing_payment_leak: number;
  underpayment_leak: number;
  overpayment_leak: number;
  anomaly_count: number;
  critical_count: number;
  pending_count: number;
  review_count: number;
}

export interface Anomaly {
  dispatch_id: string;
  invoice_id: string | null;
  customer: string;
  product: string;
  dispatched_kes: number;
  invoiced_kes: number;
  paid_kes: number;
  leakage_kes: number;
  break_type: BreakType;
  status: AnomalyStatus;
  ebilling_status: string;
  ebilling_sync_date: string | null;
  age_days: number;
  created_at: string;
}

export interface DataQuality {
  total_rows: number;
  null_volume: number;
  null_value: number;
  zero_volume: number;
  zero_value: number;
  invalid_customer: number;
  quality_score: number;
}

export interface OmcRiskProfile {
  customer: string;
  leakage_kes: number;
  anomaly_count: number;
  risk_level: "Low" | "Medium" | "High";
}

export interface ReconcileResult {
  metrics: Metrics;
  anomalies: Anomaly[];
  summary: {
    total_anomalies: number;
    total_leakage_kes: number;
    reconciliation_rate: number;
    critical_count: number;
    pending_count: number;
    review_count: number;
  };
  performance: {
    processing_time_seconds: number;
    rows_processed: number;
    rows_per_second: number;
  };
  data_quality: DataQuality;
  ebilling_status: {
    system: string;
    connected: boolean;
    total_pending: number;
    total_synced: number;
    last_sync: string | null;
  };
  duplicate_anomalies: unknown[];
  omc_risk_profile: OmcRiskProfile[];
}

// The route wraps the above in {status, data}
export interface ReconcileResponse {
  status: string;
  data: ReconcileResult;
}
