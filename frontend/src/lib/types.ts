// Mirrors the actual JSON returned by POST /api/reconcile (backend/app/services/reconciliation.py,
// run_reconciliation_on_dataframes) — NOT the unused Pydantic models in backend/app/models/reconciliation.py,
// whose field names have drifted from what the route actually returns.

export type BreakType =
  | "Missing Invoice"
  | "Missing Payment"
  | "Underpayment"
  | "Overpayment"
  | "Reconciled"
  // Outbound (stipend/disbursement) — Stage 2. See GHOST_PAYMENT_LABEL /
  // DUPLICATE_DISBURSEMENT_LABEL / the outbound break_type choices in
  // backend/app/services/reconciliation/reconciliation.py.
  | "Missing Authorization"
  | "Missing Disbursement"
  | "Ghost Payment"
  | "Duplicate Disbursement";

// "inbound" (OMC fuel revenue) | "outbound" (Inuka Foundation stipends) —
// mirrors the Anomaly.flow_direction field below.
export type FlowDirection = "inbound" | "outbound";

export type AnomalyStatus =
  | "Critical"
  | "Pending"
  | "Review Required"
  | "Resolved";

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
  // Outbound (stipend/disbursement) — Stage 2. Absent/undefined on a
  // pure-inbound (direction=inbound) result.
  ghost_payment_leak?: number;
  duplicate_disbursement_leak?: number;
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
  // Outbound (stipend/disbursement) — Stage 2. Optional/nullable: not set
  // at all on a pure-inbound anomaly (see the Optional[str] = None
  // rationale in backend/app/schemas/reconciliation/reconciliation.py).
  flow_direction?: FlowDirection | null;
  officer_id?: string | null;
  beneficiary_id?: string | null;
  // Fraud scoring layer (ML). Optional/nullable: null whenever the
  // fraud-scoring model isn't trained yet (services/fraud/
  // fraud_scoring_service.py's is_configured() gate) — reconciliation
  // itself always succeeds either way, scoring is a best-effort
  // enrichment on top of it, never a blocker.
  fraud_score?: number | null;
  fraud_tier?: FraudTier | null;
}

export type FraudTier = "Likely Fraud" | "Suspicious" | "Likely Benign";

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
  // Set by run_sync_task()'s batch loop (backend/app/services/e_billing.py) —
  // absent until the first batch reports in, so all optional.
  total?: number;
  synced_so_far?: number;
  failed_so_far?: number;
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
// "officer"/"beneficiary" are the outbound (stipend/disbursement) node
// types — Stage 2, graph_engine.build_outbound_fraud_graph_from_dataframes().
export type GraphNodeType = "omc" | "depot" | "officer" | "beneficiary";

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
  // Outbound-only (Stage 2): true for a direct beneficiary<->beneficiary
  // shared-disbursing_account ring edge rather than an officer<->
  // beneficiary leakage edge. See schemas/fraud/graph.py's GraphEdge.
  shared_account?: boolean;
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

// Mirrors backend/app/schemas/fraud/scoring.py — the fraud scoring
// layer's explainability endpoints (GET /api/fraud/explain/{id},
// POST /api/fraud/chat).

export interface ShapContributor {
  feature: string;
  value: number;
  contribution: number;
  direction: "toward_fraud" | "toward_benign";
}

export interface FraudExplainData {
  anomaly_id: string;
  fraud_score: number | null;
  fraud_tier: FraudTier | null;
  base_value: number;
  contributors: ShapContributor[];
}

// Mirrors backend/app/schemas/user.py — the response shapes for /api/auth/*.

// access_token is null and reset_required is true when the account has
// must_reset_password set — see reset_token/redirect and
// POST /api/auth/reset-password below. terms_required is the sibling case
// for an already-active account whose terms_accepted_version is stale —
// see consent_token and POST /api/auth/accept-terms.
export interface LoginResponse {
  access_token: string | null;
  token_type: string;
  reset_required: boolean;
  reset_token: string | null;
  terms_required: boolean;
  consent_token: string | null;
  redirect: string | null;
}

export interface ResetPasswordResponse {
  access_token: string;
  token_type: string;
}

export interface AcceptTermsResponse {
  access_token: string;
  token_type: string;
}

// Mirrors backend/app/schemas/terms.py.
export interface TermsDocument {
  version: string;
  content: string;
}

export interface TermsBundle {
  terms_and_conditions: TermsDocument | null;
  privacy_policy: TermsDocument | null;
  required_version: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  full_name: string | null;
  roles: string[];
  permissions: string[];
}

// Mirrors backend/app/schemas/user.py's UserOut — the /api/admin/users shape.
// account_status is derived server-side from must_reset_password + whether
// the user has ever logged in — "Invited / Pending first login",
// "Reset Required" (admin forced a reset on an already-active account), or
// "Active". See RegisterRequest.
export interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
  created_at: string;
  roles: string[];
  permissions: string[];
  account_status: "Invited / Pending first login" | "Reset Required" | "Active";
}

// POST /api/admin/users — admin-provisioned, no password field: the
// backend generates a random temp password and emails it.
export interface CreateUserPayload {
  email: string;
  full_name?: string;
  role_name: string;
}

// Mirrors UpdateUserRequest — every field optional, only what's provided changes.
export interface UpdateUserPayload {
  email?: string;
  full_name?: string;
  role_name?: string;
  password?: string;
  is_active?: boolean;
}

export const ROLE_NAMES = [
  "depot_supervisor",
  "manager",
  "revenue_assurance",
  "inuka_manager",
  "system_admin",
] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

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
