// Mirrors the actual JSON returned by POST /api/reconcile (backend/app/services/reconciliation.py,
// run_reconciliation_on_dataframes) — NOT the unused Pydantic models in backend/app/models/reconciliation.py,
// whose field names have drifted from what the route actually returns.

export type BreakType =
  | "Missing Invoice"
  | "Missing Payment"
  | "Underpayment"
  | "Overpayment"
  | "Reconciled";

export type AnomalyStatus = "Critical" | "Pending" | "Review Required" | "Resolved";

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

export interface ReconciliationSummary {
  total_anomalies: number;
  total_leakage_kes: number;
  reconciliation_rate: number;
  critical_count: number;
  pending_count: number;
  review_count: number;
}

export interface PerformanceStats {
  processing_time_seconds: number;
  rows_processed: number;
  rows_per_second: number;
}

export interface ReconciliationEbillingStatus {
  system: string;
  connected: boolean;
  total_pending: number;
  total_synced: number;
  last_sync: string | null;
}

export interface ReconcileResult {
  metrics: Metrics;
  anomalies: Anomaly[];
  summary: ReconciliationSummary;
  performance: PerformanceStats;
  data_quality: DataQuality;
  ebilling_status: ReconciliationEbillingStatus;
  duplicate_anomalies: unknown[];
  omc_risk_profile: OmcRiskProfile[];
}

export interface Pagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

// GET /api/reconcile/metrics — the "Executive Metrics" feature (view_metrics).
export interface MetricsResult {
  metrics: Metrics;
  summary: ReconciliationSummary;
  performance: PerformanceStats;
  data_quality: DataQuality;
  ebilling_status: ReconciliationEbillingStatus;
  duplicate_anomalies: unknown[];
}

// GET /api/reconcile/anomalies — the "Anomaly Table" feature (view_anomaly_table).
export interface AnomalyTableResult {
  anomalies: Anomaly[];
  pagination: Pagination;
}

// GET /api/reconcile/omc-risk-profile — its own feature (view_omc_risk_profile).
export interface OmcRiskProfileResult {
  omc_risk_profile: OmcRiskProfile[];
}

// Mirrors backend/app/services/e_billing.py response shapes.

export interface EbillingIntegrationStatus {
  system: string;
  connected: boolean;
  last_sync: string | null;
  total_invoices: number;
  synced_count: number;
  pending_count: number;
  failed_count: number;
  not_attempted: number;
  api_endpoint: string;
  response_time_ms: number;
}

export type EbillingSyncStatus = "pending" | "synced" | "failed";

export interface EbillingLogEntry {
  invoice_id: string;
  status: EbillingSyncStatus;
  sync_date: string | null;
  error_message: string | null;
  retry_count: number;
  last_attempt: string;
  customer_name: string | null;
  value_kes: number | null;
}

export interface SyncTaskResult {
  status: "success" | "error" | "warning";
  message: string;
  synced: number;
  failed: number;
  total_processed: number;
  failed_ids: string[];
  sync_time: string;
}

export type TaskState = "running" | "completed" | "failed" | "not_found";

export interface TaskStatusResponse {
  status: TaskState;
  progress?: number;
  result?: SyncTaskResult | null;
  error?: string | null;
  started_at?: string;
  completed_at?: string;
}

export interface RetrySyncResult {
  status: "success" | "failed" | "error" | "warning";
  message: string;
  invoice_id?: string;
  new_status?: string;
  retry_count?: number;
  timestamp?: string;
}

export interface FailureRateMonitor {
  failure_rate: number;
  alert: boolean;
  threshold?: number;
  message: string;
}

// Mirrors backend/app/services/graph_engine.py's build_fraud_graph() shape.

export type RiskLevel = "Low" | "Medium" | "High";
export type GraphNodeType = "omc" | "depot";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  leakage_kes: number;
  anomaly_count: number;
  community: number;
  risk_level: RiskLevel;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  anomaly_count: number;
}

export interface GraphCommunity {
  id: number;
  node_ids: string[];
  member_count: number;
  total_leakage_kes: number;
  risk_level: RiskLevel;
}

export interface TopRiskEntity {
  id: string;
  label: string;
  type: GraphNodeType;
  leakage_kes: number;
  risk_level: RiskLevel;
}

export interface FraudGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  communities: GraphCommunity[];
  summary: {
    node_count: number;
    edge_count: number;
    community_count: number;
    top_risk_entities: TopRiskEntity[];
  };
}

// Mirrors backend/app/schemas/user.py — the response shapes for /api/auth/*.

export interface LoginResponse {
  access_token: string;
  token_type: string;
}

export interface AuthUser {
  id: string;
  email: string;
  full_name: string | null;
  roles: string[];
  permissions: string[];
}

// Mirrors backend/app/schemas/feed.py.
export interface FeedData {
  anomalies: Anomaly[];
  last_updated: string | null;
  total_count: number;
}

// Mirrors UpdateAnomalyResponse in backend/app/schemas/reconciliation.py.
export interface UpdateAnomalyResponse {
  status: string;
  message: string;
  dispatch_id: string;
  new_status: string;
  timestamp: string;
}

// Mirrors backend/app/schemas/heatmap.py.
export interface HeatmapData {
  data: number[][];
  omcs: string[];
  products: string[];
  total_leakage: number;
}
