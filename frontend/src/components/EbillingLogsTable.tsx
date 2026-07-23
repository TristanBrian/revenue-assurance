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
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
    case "failed":
      return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
    default:
      return "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300";
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
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No sync attempts recorded yet.
      </p>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-2 font-medium text-zinc-500 dark:text-zinc-400">
                Invoice ID
              </th>
              <th className="px-4 py-2 font-medium text-zinc-500 dark:text-zinc-400">
                Customer
              </th>
              <th className="px-4 py-2 font-medium text-zinc-500 dark:text-zinc-400">
                Value
              </th>
              <th className="px-4 py-2 font-medium text-zinc-500 dark:text-zinc-400">
                Status
              </th>
              <th className="px-4 py-2 font-medium text-zinc-500 dark:text-zinc-400">
                Retries
              </th>
              <th className="px-4 py-2 font-medium text-zinc-500 dark:text-zinc-400">
                Last Attempt
              </th>
              <th className="px-4 py-2 font-medium text-zinc-500 dark:text-zinc-400">
                Error
              </th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {logs.map((log, i) => (
              <tr
                key={`${log.invoice_id}-${i}`}
                className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
              >
                <td className="px-4 py-2 font-mono text-xs">{log.invoice_id}</td>
                <td className="px-4 py-2">{log.customer_name ?? "—"}</td>
                <td className="px-4 py-2">{formatKes(log.value_kes)}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(log.status)}`}
                  >
                    {log.status}
                  </span>
                </td>
                <td className="px-4 py-2">{log.retry_count}</td>
                <td className="px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                  {log.last_attempt}
                </td>
                <td className="max-w-[200px] truncate px-4 py-2 text-xs text-red-700 dark:text-red-400">
                  {log.error_message ?? "—"}
                </td>
                <td className="px-4 py-2">
                  {log.status === "failed" && (
                    <button
                      type="button"
                      onClick={() => handleRetry(log.invoice_id)}
                      disabled={retrying === log.invoice_id}
                      className="rounded bg-zinc-900 px-2 py-1 text-xs text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
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
      {error && <p className="mt-2 text-sm text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}
