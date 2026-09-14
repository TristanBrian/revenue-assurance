"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, getAnomalies } from "@/lib/api";
import { useMateriality } from "@/context/MaterialityContext";
import type { Anomaly } from "@/lib/types";

function formatKesFull(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

const LIMIT = 6;

/**
 * Manager/Revenue Assurance alert card — critical anomalies across every
 * depot (unscoped, unlike the topbar bell's depot_supervisor-only version).
 * Real data via GET /api/reconcile/anomalies (already sorted by leakage_kes
 * desc server-side), not a static mock.
 */
export default function ManagerAlertsCard() {
  const { materiality } = useMateriality();
  const [items, setItems] = useState<Anomaly[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAnomalies(materiality, 1, LIMIT, { status: "Critical" }, "inbound")
      .then((data) => {
        if (cancelled) return;
        setItems(data.anomalies);
        setTotal(data.pagination.total);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load alerts.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [materiality]);

  return (
    <div className="flex h-full flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-foreground">Critical Alerts</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Across every depot</p>
        </div>
        <Link
          href="/dashboard/inbound/anomalies"
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          View all
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 17L17 7M17 7H8m9 0v9" />
          </svg>
        </Link>
      </div>

      {error && (
        <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg p-3 text-xs text-status-critical">
          {error}
        </div>
      )}

      {loading && !error && (
        <div className="flex items-center justify-center py-10">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-ring/30 border-t-ring" />
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <p className="py-8 text-center text-sm italic text-muted-foreground">No critical alerts right now.</p>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="flex flex-col divide-y divide-border">
          {items.map((a) => (
            <Link
              key={a.dispatch_id}
              href="/dashboard/inbound/anomalies"
              className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0 transition-colors hover:bg-accent/40 -mx-1 px-1 rounded"
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-status-critical" />
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-foreground">
                    {a.customer} — {a.break_type}
                  </h3>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {a.depot ?? "Unknown depot"} · {a.dispatch_id} · {a.age_days}d ago
                  </p>
                </div>
              </div>
              <span className="shrink-0 font-mono text-sm font-semibold text-status-critical">
                {formatKesFull(a.leakage_kes)}
              </span>
            </Link>
          ))}
        </div>
      )}

      {total > LIMIT && (
        <div className="mt-auto border-t border-border pt-3 text-center">
          <span className="text-[11px] text-muted-foreground">{total} critical alerts total</span>
        </div>
      )}
    </div>
  );
}
