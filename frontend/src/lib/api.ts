import type { ReconcileResponse, ReconcileResult } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parseErrorDetail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") return body.detail;
  } catch {
    // response wasn't JSON — fall through to the generic message
  }
  return `Request failed with status ${res.status}`;
}

export async function reconcile(materiality = 100000): Promise<ReconcileResult> {
  const url = new URL("/api/reconcile", API_URL);
  url.searchParams.set("materiality", String(materiality));

  const res = await fetch(url, { method: "POST" });

  if (!res.ok) {
    throw new ApiError(await parseErrorDetail(res), res.status);
  }

  const body: ReconcileResponse = await res.json();
  return body.data;
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

  const res = await fetch(url, { method: "POST", body: formData });

  if (!res.ok) {
    throw new ApiError(await parseErrorDetail(res), res.status);
  }

  const body: ReconcileResponse = await res.json();
  return body.data;
}

export type TemplateType = "dispatches" | "invoices" | "payments";

export function templateUrl(fileType: TemplateType): string {
  return new URL(`/api/reconcile/template/${fileType}`, API_URL).toString();
}
