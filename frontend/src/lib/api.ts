import type {
  AdminUser,
  AnomalyTableResult,
  AuthUser,
  CreateUserPayload,
  EbillingIntegrationStatus,
  EbillingLogEntry,
  FailureRateMonitor,
  FeedData,
  FraudGraphData,
  HeatmapData,
  LoginResponse,
  MetricsResult,
  OmcRiskProfile,
  OmcRiskProfileResult,
  ReconcileResult,
  RetrySyncResult,
  TaskStatusResponse,
  UpdateAnomalyResponse,
  UpdateUserPayload,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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
async function authFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export async function login(email: string, password: string): Promise<string> {
  const res = await fetch(new URL("/api/auth/login", API_URL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await unwrap<LoginResponse>(res);
  return data.access_token;
}

export async function getCurrentUser(): Promise<AuthUser> {
  const res = await authFetch(new URL("/api/auth/me", API_URL));
  return unwrap<AuthUser>(res);
}

// /api/reconcile was split into three independently-permissioned endpoints
// (view_metrics / view_anomaly_table / view_omc_risk_profile) so a role that
// can't see the anomaly table doesn't need to hit an endpoint that could
// return it at all. Each of the three below matches one.

export async function getMetrics(materiality = 100000): Promise<MetricsResult> {
  const url = new URL("/api/reconcile/metrics", API_URL);
  url.searchParams.set("materiality", String(materiality));
  const res = await authFetch(url, { method: "POST" });
  return unwrap<MetricsResult>(res);
}

export async function getAnomalies(
  materiality = 100000,
  page = 1,
  pageSize = 20,
): Promise<AnomalyTableResult> {
  const url = new URL("/api/reconcile/anomalies", API_URL);
  url.searchParams.set("materiality", String(materiality));
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", String(pageSize));
  const res = await authFetch(url);
  return unwrap<AnomalyTableResult>(res);
}

export async function getOmcRiskProfile(materiality = 100000): Promise<OmcRiskProfile[]> {
  const url = new URL("/api/reconcile/omc-risk-profile", API_URL);
  url.searchParams.set("materiality", String(materiality));
  const res = await authFetch(url);
  const body = await unwrap<OmcRiskProfileResult>(res);
  return body.omc_risk_profile;
}

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

export async function downloadExport(materiality = 100000): Promise<void> {
  const url = new URL("/api/reconcile/export", API_URL);
  url.searchParams.set("materiality", String(materiality));
  const res = await authFetch(url);
  if (!res.ok) throw new ApiError(await parseErrorDetail(res), res.status);
  saveBlob(await res.blob(), "reconciliation_report.xlsx");
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
  const res = await authFetch(new URL(`/api/e-billing/task/${taskId}`, API_URL));
  return unwrap<TaskStatusResponse>(res);
}

export async function retryEbillingSync(invoiceId: string): Promise<RetrySyncResult> {
  const res = await authFetch(new URL(`/api/e-billing/retry/${invoiceId}`, API_URL), {
    method: "POST",
  });
  return unwrap<RetrySyncResult>(res);
}

export async function getFraudGraph(materiality = 0): Promise<FraudGraphData> {
  const url = new URL("/api/graph", API_URL);
  url.searchParams.set("materiality", String(materiality));
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

export async function getHeatmap(materiality = 0): Promise<HeatmapData> {
  const url = new URL("/api/heatmap", API_URL);
  url.searchParams.set("materiality", String(materiality));
  const res = await authFetch(url);
  const body = await unwrap<{ status: string; data: HeatmapData; message?: string }>(res);
  if (body.status === "error") {
    throw new ApiError(body.message ?? "Heatmap request failed", 500);
  }
  return body.data;
}

export async function updateAnomalyStatus(
  dispatchId: string,
  status: string,
  notes = "",
): Promise<UpdateAnomalyResponse> {
  const url = new URL("/api/reconcile/update", API_URL);
  url.searchParams.set("dispatch_id", dispatchId);
  url.searchParams.set("status", status);
  url.searchParams.set("notes", notes);
  const res = await authFetch(url, { method: "POST" });
  return unwrap<UpdateAnomalyResponse>(res);
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

export async function createUser(payload: CreateUserPayload): Promise<AdminUser> {
  const res = await authFetch(new URL("/api/auth/register", API_URL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return unwrap<AdminUser>(res);
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

