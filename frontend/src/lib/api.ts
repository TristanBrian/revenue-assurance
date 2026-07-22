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
