"use client";

import { useState } from "react";
import { ApiError, retryEbillingSync } from "@/lib/api";
import type { EbillingLogEntry } from "@/lib/types";

function formatKes(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

function statusClass(status: EbillingLogEntry["status"]): string {
  switch (status) {
    case "synced":
      return "bg-status-low-bg text-status-low";
    case "failed":
      return "bg-status-critical-bg text-status-critical";
    default:
      return "bg-status-medium-bg text-status-medium";
  }
}

export default function EbillingLogsTable({
  logs,
  onRetried,
}: {
  logs: EbillingLogEntry[];
  onRetried: () => void;
}) {
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRetry(invoiceId: string) {
    setRetrying(invoiceId);
    setError(null);
    try {
      await retryEbillingSync(invoiceId);
      onRetried();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not reach the retry endpoint.",
      );
    } finally {
      setRetrying(null);
    }
  }

  if (logs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No sync attempts recorded yet.
      </p>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Invoice ID
              </th>
              <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Customer
              </th>
              <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Value
              </th>
              <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Status
              </th>
              <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Retries
              </th>
              <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Last Attempt
              </th>
              <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Error
              </th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {logs.map((log, i) => (
              <tr key={`${log.invoice_id}-${i}`} className="transition-colors hover:bg-accent/40">
                <td className="px-4 py-2.5 font-mono text-xs text-foreground/90">{log.invoice_id}</td>
                <td className="px-4 py-2.5 text-foreground/90">{log.customer_name ?? "—"}</td>
                <td className="px-4 py-2.5 font-mono text-foreground/90">{formatKes(log.value_kes)}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-bold ${statusClass(log.status)}`}
                  >
                    {log.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-foreground/90">{log.retry_count}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {log.last_attempt}
                </td>
                <td className="max-w-[200px] truncate px-4 py-2.5 text-xs text-status-critical">
                  {log.error_message ?? "—"}
                </td>
                <td className="px-4 py-2.5">
                  {log.status === "failed" && (
                    <button
                      type="button"
                      onClick={() => handleRetry(log.invoice_id)}
                      disabled={retrying === log.invoice_id}
                      className="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
                    >
                      {retrying === log.invoice_id ? "Retrying…" : "Retry"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="mt-2 text-sm text-status-critical">{error}</p>}
    </div>
  );
}
