import type {
  AcceptTermsResponse,
  AdminUser,
  AlertListResult,
  BeneficiaryConsentResult,
  AnomalyAction,
  AdminSecurityEvent,
  PasswordPolicy,
  AnomalyTableResult,
  AuthUser,
  CreateUserPayload,
  DepotAlertsResult,
  DepotRiskResult,
  OmcDepotMapResult,
  EbillingIntegrationStatus,
  EbillingLogEntry,
  ExposureRecoveryTrendResult,
  FailureRateMonitor,
  FeedData,
  FraudExplainData,
  FraudGraphData,
  HeatmapData,
  LoginResponse,
  MetricsResult,
  InukaCasesResult,
  InukaRiskCase,
  InukaCaseSummary,
  InukaDimensionSummary,
  InukaStreamStatus,
  InukaBeneficiaryDetail,
  OmcRiskProfile,
  OmcRiskProfileResult,
  ReconcileResult,
  ResetPasswordResponse,
  RetrySyncResult,
  TaskStatusResponse,
  TermsBundle,
  UpdateAnomalyResponse,
  UpdateUserPayload,
} from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Plain (non-HttpOnly) cookie, set client-side after login — readable by
// proxy.ts for the redirect-if-missing check, and by authFetch below to
// attach the bearer token. Known tradeoff: readable by any injected script,
// same risk class as localStorage. Acceptable for this stage; an HttpOnly
// cookie via a Next.js Route Handler would close that gap at the cost of a
// backend-for-frontend layer this codebase has never had.
const TOKEN_COOKIE = "kpc_auth_token";

export function getAuthToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${TOKEN_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function setAuthToken(token: string): void {
  // 8h expiry, comfortably longer than the backend's 60min access token —
  // an expired-but-present cookie fails at the API call (401), not silently.
  document.cookie = `${TOKEN_COOKIE}=${encodeURIComponent(token)}; path=/; max-age=${8 * 60 * 60}; SameSite=Lax`;
}

export function clearAuthToken(): void {
  document.cookie = `${TOKEN_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

// The forced-reset token from a reset_required login response is
// deliberately NOT stored alongside the normal auth cookie: it's a
// separate, single-purpose, 15-minute credential scoped only to
// POST /auth/reset-password (see backend/app/core/security.py's
// create_reset_token), not a session token proxy.ts or authFetch should
// ever attach to a normal request. sessionStorage (not a cookie) keeps it
// out of every other request automatically and clears itself when the tab
// closes.
const RESET_TOKEN_KEY = "kpc_reset_token";

export function setResetToken(token: string): void {
  if (typeof window !== "undefined") window.sessionStorage.setItem(RESET_TOKEN_KEY, token);
}

export function getResetToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(RESET_TOKEN_KEY);
}

export function clearResetToken(): void {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(RESET_TOKEN_KEY);
}

// Sibling of the reset token above, for an already-active account that
// just needs to re-accept a newer Terms/Privacy Policy version — scoped
// only to POST /auth/accept-terms. Kept in a separate key so the
// reset-password page can tell "full reset form" and "consent-only form"
// apart by which token is actually present.
const CONSENT_TOKEN_KEY = "kpc_consent_token";

export function setConsentToken(token: string): void {
  if (typeof window !== "undefined") window.sessionStorage.setItem(CONSENT_TOKEN_KEY, token);
}

export function getConsentToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(CONSENT_TOKEN_KEY);
}

export function clearConsentToken(): void {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(CONSENT_TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Every JSON response leaving the backend is wrapped in a standard
 * {Success, Message, Data, Timestamp} envelope (app/core/response_envelope.py) —
 * unwraps that envelope and throws ApiError(Message) on a non-2xx status. */
async function unwrap<T>(res: Response): Promise<T> {
  let body: { Success?: number; Message?: string; Data?: unknown } | null = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON body — falls through to the generic message below on error
  }
  if (!res.ok) {
    throw new ApiError(body?.Message ?? `Request failed with status ${res.status}`, res.status);
  }
  return (body?.Data ?? null) as T;
}

async function parseErrorDetail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.Message === "string") return body.Message;
  } catch {
    // response wasn't JSON — fall through to the generic message
  }
  return `Request failed with status ${res.status}`;
}

/** fetch() wrapper that attaches the bearer token when one is present. Every
 * authenticated call below routes through this instead of raw fetch(). */
export async function authFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

/**
 * Unified beneficiary masking – "bank statement" style.
 * - BEN-0158 → BEN-****0158
 * - Audrey Anderson → BEN-****5837 (consistent hash-based)
 * - Company names (e.g., Vivo Energy) remain unchanged
 */
function maskBeneficiaryId(id: string | undefined | null): string {
  if (!id) return "Beneficiary";

  // If it's already a BEN-XXXX format, mask it
  if (id.startsWith("BEN-")) {
    const clean = id.replace(/^BEN-/, "");
    if (clean.includes('****')) return id;
    const suffix = clean.length >= 4 ? clean.slice(-4) : clean.padStart(4, '0');
    return `BEN-****${suffix}`;
  }

  // If it contains a space (likely a person's name like "Audrey Anderson")
  if (id.includes(' ')) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash) + id.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }
    const suffix = String(Math.abs(hash) % 10000).padStart(4, '0');
    return `BEN-****${suffix}`;
  }

  // If it looks like a name pattern (First Last without space)
  if (id.length > 8 && id !== id.toUpperCase() && !id.includes('ENERGY') && !id.includes('OIL')) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash) + id.charCodeAt(i);
      hash = hash & hash;
    }
    const suffix = String(Math.abs(hash) % 10000).padStart(4, '0');
    return `BEN-****${suffix}`;
  }

  // Company names remain unchanged (e.g., "Vivo Energy", "Dalbit Petroleum")
  return id;
}

/** Returns the full envelope rather than just the token — callers must
 * check reset_required before treating this as a normal session (see
 * auth-context.tsx's login()). */
export async function login(email: string, password: string): Promise<LoginResponse> {
  const res = await fetch(new URL("/api/auth/login", API_URL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return unwrap<LoginResponse>(res);
}

export async function getPasswordPolicy(): Promise<PasswordPolicy> {
  return unwrap<PasswordPolicy>(await fetch(new URL("/api/auth/password-policy", API_URL)));
}

/** Fetches the current Terms & Conditions / Privacy Policy text + required
 * version for the reset-password / accept-terms screen to render. No auth
 * — a user in either flow doesn't have a normal session token yet. */
export async function getTermsBundle(): Promise<TermsBundle> {
  const res = await fetch(new URL("/api/auth/terms", API_URL));
  return unwrap<TermsBundle>(res);
}

/** Redeems the short-lived reset_token from a reset_required login
 * response for a new password — consent (checkboxAccepted) is bundled
 * into this same call, not a separate screen/request, matching the
 * backend's single combined validation. On success returns a normal
 * access token, same as a successful login(). */
export async function resetPassword(
    resetToken: string,
    newPassword: string,
    confirmPassword: string,
    checkboxAccepted: boolean,
): Promise<ResetPasswordResponse> {
  const res = await fetch(new URL("/api/auth/reset-password", API_URL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reset_token: resetToken,
      new_password: newPassword,
      confirm_password: confirmPassword,
      checkbox_accepted: checkboxAccepted,
    }),
  });
  return unwrap<ResetPasswordResponse>(res);
}

/** Re-consent variant for an already-active user (no password fields) —
 * redeems the short-lived consent_token from a terms_required login
 * response. */
export async function acceptTerms(
    consentToken: string,
    checkboxAccepted: boolean,
): Promise<AcceptTermsResponse> {
  const res = await fetch(new URL("/api/auth/accept-terms", API_URL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ consent_token: consentToken, checkbox_accepted: checkboxAccepted }),
  });
  return unwrap<AcceptTermsResponse>(res);
}

export async function getCurrentUser(): Promise<AuthUser> {
  const res = await authFetch(new URL("/api/auth/me", API_URL));
  return unwrap<AuthUser>(res);
}

// /api/reconcile was split into three independently-permissioned endpoints
// (view_metrics / view_anomaly_table / view_omc_risk_profile) so a role that
// can't see the anomaly table doesn't need to hit an endpoint that could
// return it at all. Each of the three below matches one.

// "inbound" | "outbound" | "all" — mirrors backend's ?direction= query
// param, added to reconcile/heatmap/fraud-graph/export in Stage 2 rather
// than as new endpoints. Defaults to "all" everywhere it's optional here,
// matching the backend's own default.
export type Direction = "inbound" | "outbound" | "all";

export async function getMetrics(materiality = 100000, direction: Direction = "all"): Promise<MetricsResult> {
  const url = new URL("/api/reconcile/metrics", API_URL);
  url.searchParams.set("materiality", String(materiality));
  url.searchParams.set("direction", direction);
  const res = await authFetch(url, { method: "POST" });
  return unwrap<MetricsResult>(res);
}

export async function getDepotAlerts(): Promise<DepotAlertsResult> {
  const res = await authFetch(new URL("/api/reconcile/depot-alerts", API_URL));
  return unwrap<DepotAlertsResult>(res);
}

export async function getAlerts(params: { page?: number; pageSize?: number; unreadOnly?: boolean; workspace?: "inbound" | "outbound" } = {}): Promise<AlertListResult> {
  const url = new URL("/api/alerts", API_URL);
  url.searchParams.set("page", String(params.page ?? 1));
  url.searchParams.set("page_size", String(params.pageSize ?? 25));
  if (params.unreadOnly) url.searchParams.set("unread_only", "true");
  if (params.workspace) url.searchParams.set("workspace", params.workspace);
  return unwrap<AlertListResult>(await authFetch(url));
}

export async function markAlertRead(alertId: string): Promise<void> {
  const url = new URL("/api/alerts/" + encodeURIComponent(alertId) + "/read", API_URL);
  await unwrap<{ status: string; marked_read: number }>(await authFetch(url, { method: "POST" }));
}

export async function markAllAlertsRead(): Promise<void> {
  const url = new URL("/api/alerts/read-all", API_URL);
  await unwrap<{ status: string; marked_read: number }>(await authFetch(url, { method: "POST" }));
}

export async function getDepotRisk(): Promise<DepotRiskResult> {
  const res = await authFetch(new URL("/api/reconcile/depot-risk", API_URL));
  return unwrap<DepotRiskResult>(res);
}

export async function getOmcDepotMap(): Promise<OmcDepotMapResult> {
  const res = await authFetch(new URL("/api/reconcile/omc-depot-map", API_URL));
  return unwrap<OmcDepotMapResult>(res);
}

export async function getExposureRecoveryTrend(days = 30): Promise<ExposureRecoveryTrendResult> {
  const url = new URL("/api/reconcile/trend", API_URL);
  url.searchParams.set("days", String(days));
  const res = await authFetch(url);
  return unwrap<ExposureRecoveryTrendResult>(res);
}

export interface AnomalyFilters {
  breakType?: string;
  status?: string;
  search?: string;
  minLeakage?: number;
  maxLeakage?: number;
  /** Outbound only — see backend/app/routes/reconciliation/reconcile.py's
   * pillar_id/officer_id query params (added for DimensionGroupGrid's
   * scoped drill-down: /dashboard/outbound/anomalies/[groupId]). No-op
   * against inbound rows, same as every other filter here. */
  pillarId?: string;
  officerId?: string;
}

export async function getAnomalies(
    materiality = 100000,
    page = 1,
    pageSize = 20,
    filters: AnomalyFilters = {},
    direction: Direction = "all",
): Promise<AnomalyTableResult> {
  const url = new URL("/api/reconcile/anomalies", API_URL);
  url.searchParams.set("materiality", String(materiality));
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", String(pageSize));
  url.searchParams.set("direction", direction);
  if (filters.breakType) url.searchParams.set("break_type", filters.breakType);
  if (filters.status) url.searchParams.set("status", filters.status);
  if (filters.search) url.searchParams.set("search", filters.search);
  if (filters.minLeakage !== undefined) url.searchParams.set("min_leakage", String(filters.minLeakage));
  if (filters.maxLeakage !== undefined) url.searchParams.set("max_leakage", String(filters.maxLeakage));
  if (filters.pillarId) url.searchParams.set("pillar_id", filters.pillarId);
  if (filters.officerId) url.searchParams.set("officer_id", filters.officerId);
  const res = await authFetch(url);
  const result = await unwrap<AnomalyTableResult>(res);

  // Beneficiary masking belongs only to the outbound/Inuka domain. Applying
  // it to inbound rows turns valid OMC names into beneficiary-style IDs and
  // blurs the strict domain separation used throughout the report module.
  if (result?.anomalies && Array.isArray(result.anomalies)) {
    result.anomalies = result.anomalies.map((anomaly) => ({
      ...anomaly,
      customer: anomaly.flow_direction === "outbound"
        ? maskBeneficiaryId(anomaly.customer)
        : anomaly.customer,
    }));
  }

  return result;
}

export async function getInukaStreamStatus(): Promise<InukaStreamStatus> {
  return unwrap<InukaStreamStatus>(await authFetch("/api/inuka/stream/status"));
}

export async function getBeneficiaryConsents(params: { page?: number; pageSize?: number; status?: string; consentType?: string; search?: string } = {}): Promise<BeneficiaryConsentResult> {
  const url = new URL("/api/inuka/consents", API_URL);
  url.searchParams.set("page", String(params.page ?? 1));
  url.searchParams.set("page_size", String(params.pageSize ?? 25));
  if (params.status) url.searchParams.set("status", params.status);
  if (params.consentType) url.searchParams.set("consent_type", params.consentType);
  if (params.search) url.searchParams.set("search", params.search);
  return unwrap<BeneficiaryConsentResult>(await authFetch(url));
}

export async function getInukaSummary(): Promise<InukaCaseSummary> {
  const res = await authFetch(new URL("/api/inuka/summary", API_URL));
  return unwrap<InukaCaseSummary>(res);
}

export async function getInukaCases(params: {
  page?: number;
  pageSize?: number;
  status?: string;
  riskType?: string;
  pillarId?: string;
  programId?: string;
  officerId?: string;
  period?: string;
  search?: string;
} = {}): Promise<InukaCasesResult> {
  const url = new URL("/api/inuka/cases", API_URL);
  url.searchParams.set("page", String(params.page ?? 1));
  url.searchParams.set("page_size", String(params.pageSize ?? 25));
  if (params.status) url.searchParams.set("status", params.status);
  if (params.riskType) url.searchParams.set("risk_type", params.riskType);
  if (params.pillarId) url.searchParams.set("pillar_id", params.pillarId);
  if (params.programId) url.searchParams.set("program_id", params.programId);
  if (params.officerId) url.searchParams.set("officer_id", params.officerId);
  if (params.period) url.searchParams.set("period", params.period);
  if (params.search) url.searchParams.set("search", params.search);
  const res = await authFetch(url);
  return unwrap<InukaCasesResult>(res);
}

export async function getInukaCase(caseId: string): Promise<InukaRiskCase> {
  const res = await authFetch(new URL(`/api/inuka/cases/${encodeURIComponent(caseId)}`, API_URL));
  return unwrap<InukaRiskCase>(res);
}

export interface InukaCaseAction {
  id: string;
  action: string;
  note: string;
  created_at: string;
  actor_user_id?: string | null;
}

export async function getInukaCaseActions(caseId: string): Promise<InukaCaseAction[]> {
  const res = await authFetch(new URL(`/api/inuka/cases/${encodeURIComponent(caseId)}/actions`, API_URL));
  return (await unwrap<{ actions: InukaCaseAction[] }>(res)).actions;
}

export async function createInukaCaseAction(caseId: string, action: string, note = ""): Promise<InukaCaseAction> {
  const res = await authFetch(new URL(`/api/inuka/cases/${encodeURIComponent(caseId)}/actions`, API_URL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, note }),
  });
  return unwrap<InukaCaseAction>(res);
}

export async function getInukaPillars(): Promise<InukaDimensionSummary[]> {
  const res = await authFetch(new URL("/api/inuka/pillars", API_URL));
  return (await unwrap<{ items: InukaDimensionSummary[] }>(res)).items;
}

export async function getInukaOfficers(): Promise<InukaDimensionSummary[]> {
  const res = await authFetch(new URL("/api/inuka/officers", API_URL));
  return (await unwrap<{ items: InukaDimensionSummary[] }>(res)).items;
}

export async function getInukaBeneficiary(beneficiaryId: string): Promise<InukaBeneficiaryDetail> {
  const res = await authFetch(new URL(`/api/inuka/beneficiaries/${encodeURIComponent(beneficiaryId)}`, API_URL));
  return unwrap<InukaBeneficiaryDetail>(res);
}

export async function getOmcRiskProfile(materiality = 100000, direction: Direction = "all"): Promise<OmcRiskProfile[]> {
  const url = new URL("/api/reconcile/omc-risk-profile", API_URL);
  url.searchParams.set("materiality", String(materiality));
  url.searchParams.set("direction", direction);
  const res = await authFetch(url);
  const body = await unwrap<OmcRiskProfileResult>(res);
  return body.omc_risk_profile;
}

// ============================================================
// AUDIT TRAIL
// ============================================================

export interface AuditLog {
  id: string;
  actor_user_id: string | null;
  external_actor: string | null;
  action: string;
  target_type: string;
  target_id: string;
  before_value: unknown;
  after_value: unknown;
  extra_metadata: unknown;
  event_timestamp: string;
  created_at: string;
  block_index: number;
  data_hash: string;
  prev_block_hash: string;
  block_hash: string;
}

export interface AuditSummary {
  total_actions: number;
  actions_by_type: Record<string, number>;
  actions_by_actor: Record<string, number>;
  period_days: number;
  since: string;
}

// Define a proper response type for getAuditLogs
interface AuditLogsResponse {
  logs?: AuditLog[];
  items?: AuditLog[];
  total?: number;
}

/**
 * Fetch audit logs with pagination and filters.
 * The backend may return the list under either 'logs' or 'items' key.
 * This function normalises both cases.
 */
export async function getAuditLogs(params?: {
  limit?: number;
  offset?: number;
  actor?: string;
  action?: string;
  target?: string;
  date_from?: string;
  date_to?: string;
}): Promise<{ logs: AuditLog[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.limit) query.append('limit', String(params.limit));
  if (params?.offset) query.append('offset', String(params.offset));
  if (params?.actor) query.append('actor', params.actor);
  if (params?.action) query.append('action', params.action);
  if (params?.target) query.append('target', params.target);
  if (params?.date_from) query.append('date_from', params.date_from);
  if (params?.date_to) query.append('date_to', params.date_to);
  const url = `/api/audit/logs${query.toString() ? '?' + query.toString() : ''}`;
  const res = await authFetch(new URL(url, API_URL));
  // Use the typed unwrap
  const result = await unwrap<AuditLogsResponse>(res);
  // Normalise: try 'logs', then 'items', then fallback to an empty array.
  const logs = result.logs || result.items || [];
  const total = result.total || logs.length || 0;
  return { logs, total };
}

export async function getAuditSummary(days: number = 7): Promise<AuditSummary> {
  const url = new URL('/api/audit/summary', API_URL);
  url.searchParams.set('days', String(days));
  const res = await authFetch(url);
  return unwrap<AuditSummary>(res);
}

export async function getAuditLog(id: string): Promise<AuditLog> {
  const url = new URL(`/api/audit/logs/${id}`, API_URL);
  const res = await authFetch(url);
  return unwrap<AuditLog>(res);
}

// Mirrors backend/app/services/audit/audit_service.py's
// verify_chain_integrity() per-batch result.
export interface AuditVerifyBatchResult {
  batch_index: number;
  intact: boolean;
  reason: string | null;
  broken_at_block_index: number | null;
  row_count: number;
  merkle_root: string;
}

// Mirrors verify_chain_integrity()'s overall return shape — the local
// (DB-only) half of GET /api/audit/verify.
export interface AuditVerifyLocalChain {
  intact: boolean;
  broken_at_block_index: number | null;
  reason: string | null;
  chain_length: number;
  tip_block_index: number;
  tip_block_hash: string;
  broken_at_batch_index: number | null;
  legacy_row_count: number;
  batch_count: number;
  pending_rows: number;
  batch_results: AuditVerifyBatchResult[];
}

// Mirrors anchor_service.verify_on_chain_anchor() — the on-chain half.
// Every field below "configured"/"checked"/"matches"/"reason" is
// version-dependent (V1 vs V2 anchor — see anchor_service.py's module
// docstring), hence all optional; UI code should treat presence, not
// v1/v2 branching, as the signal for what to render.
export interface AuditVerifyOnChainAnchor {
  configured: boolean;
  checked: boolean;
  matches: boolean | null;
  reason: string | null;
  anchor_version?: "v1" | "v2" | null;
  anchor_block_index?: number | null;
  anchor_batch_index?: number | null;
  local_block_hash?: string | null;
  on_chain_chain_tip_hash?: string | null;
  local_merkle_root?: string | null;
  local_batch_root_hash?: string | null;
  on_chain_merkle_root?: string | null;
  on_chain_batch_root_hash?: string | null;
  tx_hash?: string | null;
  base_block_number?: number | null;
  anchored_at?: string | null;
}

export interface AuditVerifyResult {
  status: string;
  local_chain: AuditVerifyLocalChain;
  on_chain_anchor: AuditVerifyOnChainAnchor;
}

export async function getAuditVerify(): Promise<AuditVerifyResult> {
  const url = new URL("/api/audit/verify", API_URL);
  const res = await authFetch(url);
  return unwrap<AuditVerifyResult>(res);
}

// ============================================================
// RECONCILIATION UPLOAD
// ============================================================

interface ReconcileUploadFiles {
  dispatches: File;
  invoices: File;
  payments: File;
}

export async function reconcileUpload(
    files: ReconcileUploadFiles,
    materiality = 100000,
): Promise<ReconcileResult> {
  const url = new URL("/api/reconcile/upload", API_URL);
  url.searchParams.set("materiality", String(materiality));

  const formData = new FormData();
  formData.append("dispatches_file", files.dispatches);
  formData.append("invoices_file", files.invoices);
  formData.append("payments_file", files.payments);

  const res = await authFetch(url, { method: "POST", body: formData });
  const body = await unwrap<{ data: ReconcileResult }>(res);
  return body.data;
}

/** Same call as reconcileUpload(), but reports real upload-percentage via
 * onProgress as the files transfer. fetch() has no cross-browser way to
 * observe upload progress (only download-stream progress), so this uses
 * XMLHttpRequest instead — the one place in this file that isn't authFetch/
 * fetch-based, for that reason alone. onProgress fires up to 100 once the
 * bytes are fully sent; there's no equivalent signal for the server-side
 * reconciliation work that happens after that (POST /reconcile/upload is a
 * single synchronous response, not a polled task like e-billing sync), so
 * callers should treat "upload progress hit 100" as "now reconciling" with
 * no further percentage rather than inventing one. */
export function reconcileUploadWithProgress(
    files: ReconcileUploadFiles,
    materiality: number,
    onProgress: (percent: number) => void,
): Promise<ReconcileResult> {
  const url = new URL("/api/reconcile/upload", API_URL);
  url.searchParams.set("materiality", String(materiality));

  const formData = new FormData();
  formData.append("dispatches_file", files.dispatches);
  formData.append("invoices_file", files.invoices);
  formData.append("payments_file", files.payments);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    const token = getAuthToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      let parsed: { Success?: number; Message?: string; Data?: { data?: ReconcileResult } } | null = null;
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON body — falls through to the generic message below
      }
      if (xhr.status >= 200 && xhr.status < 300 && parsed?.Data?.data) {
        resolve(parsed.Data.data);
      } else {
        reject(new ApiError(parsed?.Message ?? `Request failed with status ${xhr.status}`, xhr.status));
      }
    };

    xhr.onerror = () => reject(new ApiError("Network error during upload", 0));

    xhr.send(formData);
  });
}

export type TemplateType = "dispatches" | "invoices" | "payments";

/** Triggers a client-side file download. Downloads can't carry an
 * Authorization header via a plain <a href> — both template and export
 * endpoints are permission-gated now, so this fetches as a blob (with the
 * auth header) and saves it via a synthetic link instead. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadTemplate(fileType: TemplateType): Promise<void> {
  const res = await authFetch(new URL(`/api/reconcile/template/${fileType}`, API_URL));
  if (!res.ok) throw new ApiError(await parseErrorDetail(res), res.status);
  saveBlob(await res.blob(), `${fileType}_template.csv`);
}

export async function downloadExport(
    materiality = 100000,
    direction: Direction = "all",
    format: "xlsx" | "csv" | "json" = "xlsx",
    filters: AnomalyFilters = {},
): Promise<void> {
  const url = new URL("/api/reconcile/export", API_URL);
  url.searchParams.set("materiality", String(materiality));
  url.searchParams.set("direction", direction);
  url.searchParams.set("format", format);
  if (filters.breakType) url.searchParams.set("break_type", filters.breakType);
  if (filters.status) url.searchParams.set("status", filters.status);
  if (filters.search) url.searchParams.set("search", filters.search);
  if (filters.minLeakage !== undefined) url.searchParams.set("min_leakage", String(filters.minLeakage));
  if (filters.maxLeakage !== undefined) url.searchParams.set("max_leakage", String(filters.maxLeakage));
  const res = await authFetch(url);
  if (!res.ok) throw new ApiError(await parseErrorDetail(res), res.status);
  saveBlob(await res.blob(), `reconciliation_report.${format}`);
}

export async function downloadExportWithFields(
    materiality = 100000,
    fields?: string[],
    direction: Direction = "all",
    maskSensitive = true,
    format: "xlsx" | "csv" | "json" = "xlsx",
    filters: AnomalyFilters = {},
): Promise<Blob> {
  const url = new URL("/api/reconcile/export", API_URL);
  url.searchParams.set("materiality", String(materiality));
  url.searchParams.set("direction", direction);
  url.searchParams.set("mask_sensitive", String(maskSensitive));
  url.searchParams.set("format", format);
  if (filters.breakType) url.searchParams.set("break_type", filters.breakType);
  if (filters.status) url.searchParams.set("status", filters.status);
  if (filters.search) url.searchParams.set("search", filters.search);
  if (filters.minLeakage !== undefined) url.searchParams.set("min_leakage", String(filters.minLeakage));
  if (filters.maxLeakage !== undefined) url.searchParams.set("max_leakage", String(filters.maxLeakage));
  if (fields && fields.length > 0) {
    url.searchParams.set("fields", fields.join(","));
  }
  const res = await authFetch(url);
  if (!res.ok) throw new ApiError(await parseErrorDetail(res), res.status);
  return await res.blob();
}


export async function getEbillingStatus(): Promise<EbillingIntegrationStatus> {
  const res = await authFetch(new URL("/api/e-billing/status", API_URL));
  const body = await unwrap<{ integration: EbillingIntegrationStatus }>(res);
  return body.integration;
}

export async function getEbillingMonitor(): Promise<FailureRateMonitor> {
  const res = await authFetch(new URL("/api/e-billing/monitor", API_URL));
  const body = await unwrap<{ monitoring: FailureRateMonitor }>(res);
  return body.monitoring;
}

export async function getEbillingLogs(limit = 50): Promise<EbillingLogEntry[]> {
  const url = new URL("/api/e-billing/logs", API_URL);
  url.searchParams.set("limit", String(limit));
  const res = await authFetch(url);
  const body = await unwrap<{ logs: EbillingLogEntry[] }>(res);
  return body.logs;
}

export async function startEbillingSync(): Promise<{ task_id: string }> {
  const res = await authFetch(new URL("/api/e-billing/sync/async", API_URL), { method: "POST" });
  return unwrap<{ task_id: string }>(res);
}

export async function getEbillingTask(taskId: string): Promise<TaskStatusResponse> {
  try {
    const res = await authFetch(new URL(`/api/e-billing/task/${taskId}`, API_URL));
    return await unwrap<TaskStatusResponse>(res);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { status: "completed", progress: 100 };
    }
    throw err;
  }
}

export async function retryEbillingSync(invoiceId: string): Promise<RetrySyncResult> {
  const res = await authFetch(new URL(`/api/e-billing/retry/${invoiceId}`, API_URL), {
    method: "POST",
  });
  return unwrap<RetrySyncResult>(res);
}

export async function explainAnomalyScore(anomalyId: string, direction: Direction = "inbound"): Promise<FraudExplainData> {
  const url = new URL(`/api/fraud/explain/${encodeURIComponent(anomalyId)}`, API_URL);
  url.searchParams.set("direction", direction);
  const res = await authFetch(url);
  const body = await unwrap<{ status: string; data: FraudExplainData }>(res);
  return body.data;
}

export async function fraudChat(message: string, anomalyId?: string, direction: Direction = "inbound"): Promise<string> {
  const res = await authFetch(new URL(`/api/fraud/chat?direction=${direction}`, API_URL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, anomaly_id: anomalyId }),
  });
  const body = await unwrap<{ status: string; reply: string }>(res);
  return body.reply;
}

export async function getFraudGraph(materiality = 0, direction: Direction = "all"): Promise<FraudGraphData> {
  const url = new URL("/api/graph", API_URL);
  url.searchParams.set("materiality", String(materiality));
  url.searchParams.set("direction", direction);
  const res = await authFetch(url);
  const body = await unwrap<{ status: string; data: FraudGraphData; message?: string }>(res);
  if (body.status === "error") {
    throw new ApiError(body.message ?? "Fraud graph request failed", 500);
  }
  return body.data;
}

export async function getFeed(limit = 20): Promise<FeedData> {
  const url = new URL("/api/feed", API_URL);
  url.searchParams.set("limit", String(limit));
  const res = await authFetch(url);
  const body = await unwrap<{ status: string; data: FeedData; message?: string }>(res);
  if (body.status === "error") {
    throw new ApiError(body.message ?? "Live feed request failed", 500);
  }
  return body.data;
}

export async function getHeatmap(materiality = 0, direction: Direction = "all"): Promise<HeatmapData> {
  const url = new URL("/api/heatmap", API_URL);
  url.searchParams.set("materiality", String(materiality));
  url.searchParams.set("direction", direction);
  const res = await authFetch(url);
  const body = await unwrap<{ status: string; data: HeatmapData; message?: string }>(res);
  if (body.status === "error") {
    throw new ApiError(body.message ?? "Heatmap request failed", 500);
  }

  // MASK THE OMC NAMES IN HEATMAP
  if (body.data && body.data.omcs && Array.isArray(body.data.omcs)) {
    body.data.omcs = body.data.omcs.map((name: string) => maskBeneficiaryId(name));
  }

  return body.data;
}

// "confirmed_fraud" | "false_positive" | "resolved_benign" — feeds the
// fraud-scoring layer's retraining loop (fraud_feedback table). Optional
// and independent of `status`: status tracks workflow state, this
// tracks a fraud judgment, a different axis entirely.
export type FraudFeedbackLabel = "confirmed_fraud" | "false_positive" | "resolved_benign";

export async function updateAnomalyStatus(
    dispatchId: string,
    status: string,
    notes = "",
    fraudFeedbackLabel?: FraudFeedbackLabel,
): Promise<UpdateAnomalyResponse> {
  const url = new URL("/api/reconcile/update", API_URL);
  url.searchParams.set("dispatch_id", dispatchId);
  url.searchParams.set("status", status);
  url.searchParams.set("notes", notes);
  if (fraudFeedbackLabel) url.searchParams.set("fraud_feedback_label", fraudFeedbackLabel);
  const res = await authFetch(url, { method: "POST" });
  return unwrap<UpdateAnomalyResponse>(res);
}

export async function getAnomalyActions(dispatchId: string, direction: Direction = "all"): Promise<AnomalyAction[]> {
  const url = new URL(`/api/reconcile/anomalies/${encodeURIComponent(dispatchId)}/actions`, API_URL);
  url.searchParams.set("direction", direction);
  const res = await authFetch(url);
  const body = await unwrap<{ actions: AnomalyAction[] }>(res);
  return body.actions;
}

export async function createAnomalyAction(dispatchId: string, action: string, note = "", direction: Direction = "all"): Promise<AnomalyAction> {
  const url = new URL(`/api/reconcile/anomalies/${encodeURIComponent(dispatchId)}/actions`, API_URL);
  url.searchParams.set("direction", direction);
  const res = await authFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note }) });
  return unwrap<AnomalyAction>(res);
}

export async function sendEbillingWebhook(payload: {
  invoice_id: string;
  status: string;
  message?: string;
}): Promise<Record<string, unknown>> {
  const res = await fetch(new URL("/api/e-billing/webhook", API_URL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return unwrap<Record<string, unknown>>(res);
}

// User administration — gated on manage_users (system_admin only).

export async function getUsers(): Promise<AdminUser[]> {
  const res = await authFetch(new URL("/api/admin/users", API_URL));
  return unwrap<AdminUser[]>(res);
}

export async function getAdminSecurityEvents(page = 1, pageSize = 25): Promise<{ items: AdminSecurityEvent[]; total: number }> {
  const url = new URL("/api/admin/security-events", API_URL);
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", String(pageSize));
  return unwrap<{ items: AdminSecurityEvent[]; total: number }>(await authFetch(url));
}

/** Admin-provisioned user — no password field. The backend generates a
 * random temp password and emails it; must_reset_password forces the new
 * user through /reset-password on their first login. */
export async function createUser(payload: CreateUserPayload): Promise<AdminUser> {
  const res = await authFetch(new URL("/api/admin/users", API_URL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return unwrap<AdminUser>(res);
}

/** Regenerates and re-emails a temp password — for an expired original or
 * a failed delivery. Re-arms must_reset_password even for an already-active user. */
export async function resendTempPassword(userId: string): Promise<AdminUser> {
  const res = await authFetch(new URL(`/api/admin/users/${userId}/resend-temp-password`, API_URL), {
    method: "POST",
  });
  const body = await unwrap<{ status: string; user: AdminUser }>(res);
  return body.user;
}

export async function updateUser(userId: string, payload: UpdateUserPayload): Promise<AdminUser> {
  const res = await authFetch(new URL(`/api/admin/users/${userId}`, API_URL), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return unwrap<AdminUser>(res);
}

export async function deleteUser(userId: string): Promise<void> {
  const res = await authFetch(new URL(`/api/admin/users/${userId}`, API_URL), { method: "DELETE" });
  await unwrap<{ status: string; message: string }>(res);
}

// Governance & Verification APIs

export async function verifyReportFile(file: File): Promise<{
  status: "VERIFIED" | "UNKNOWN" | "ALTERED";
  filename: string;
  file_hash: string;
  signature: string;
  audit_match?: {
    log_id: string;
    created_at: string;
    report_type: string;
    rows_exported: number;
    contains_sensitive_omc_pii: boolean;
  };
}> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await authFetch(new URL("/api/reports/verify", API_URL), {
    method: "POST",
    body: formData,
  });

  return unwrap(res);
}

export async function getRecordHistory(targetType: string, targetId: string): Promise<{
  target_type: string;
  target_id: string;
  history: Array<{
    id: string;
    actor_user_id: string | null;
    action: string;

    before_value: Record<string, unknown> | null;
    after_value: Record<string, unknown> | null;
    extra_metadata: Record<string, unknown> | null;
    created_at: string;
  }>;
}> {
  const res = await authFetch(new URL(`/api/audit/history/${targetType}/${targetId}`, API_URL));
  return unwrap(res);
}

export async function getGantryLanes(): Promise<{
  status: string;
  lanes: import("./types").GantryLane[];
  summary: import("./types").GantrySummary;
}> {
  const res = await authFetch(new URL("/api/reconcile/gantry-lanes", API_URL));
  return unwrap(res);
}
