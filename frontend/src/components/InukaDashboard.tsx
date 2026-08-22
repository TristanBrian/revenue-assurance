"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ApiError, getAnomalies, getInukaCases, getMetrics } from "@/lib/api";
import type { Anomaly, InukaCaseSummary, Metrics } from "@/lib/types";
import StatCard from "@/components/StatCard";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatKesCompact(value: number): string {
  if (value >= 1e9) return `KES ${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `KES ${(value / 1e6).toFixed(2)}M`;
  return formatKes(value);
}

const BREAK_TYPES: { key: keyof Metrics; label: string; color: string }[] = [
  { key: "missing_invoice_leak", label: "Missing authorization", color: "var(--chart-1)" },
  { key: "missing_payment_leak", label: "Missing disbursement", color: "var(--chart-2)" },
  { key: "ghost_payment_leak", label: "Ghost payment", color: "var(--chart-3)" },
  { key: "duplicate_disbursement_leak", label: "Duplicate disbursement", color: "var(--chart-4)" },
];

export default function InukaDashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [caseSummary, setCaseSummary] = useState<InukaCaseSummary | null>(null);
  const [qualityScore, setQualityScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }
    });

    Promise.all([
      getMetrics(0, "outbound"),
      getAnomalies(0, 1, 8, {}, "outbound"),
      getInukaCases({ page: 1, pageSize: 1 }),
    ])
      .then(([metricsResult, anomalyResult, casesResult]) => {
        if (cancelled) return;
        setMetrics(metricsResult.metrics);
        setQualityScore(metricsResult.data_quality.quality_score);
        setAnomalies(anomalyResult.anomalies);
        setCaseSummary(casesResult.summary);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load Inuka reconciliation data.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const maxBreakLeak = metrics
    ? Math.max(...BREAK_TYPES.map(({ key }) => Number(metrics[key] ?? 0)), 1)
    : 1;

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Inuka Program Assurance</p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">Inuka Disbursement Assurance</h1>
          <p className="text-sm text-muted-foreground mt-1">Find errors and anomalies in training-program payouts.</p>
        </div>
      </header>

      {error && <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg p-4 text-sm text-status-critical">{error}</div>}
      {loading && !error && <div className="flex items-center justify-center p-12"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>}

      {metrics && !loading && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Eligible program funds" value={formatKesCompact(metrics.total_dispatched_kes)} note="Attendance-linked amount" />
            <StatCard label="Open assurance cases" value={(caseSummary?.case_count ?? metrics.anomaly_count).toLocaleString()} note="Explainable cases to review" tone={(caseSummary?.critical_count ?? metrics.critical_count) ? "critical" : "low"} href="/dashboard/inuka/anomalies" />
            <StatCard label="Reconciliation rate" value={`${metrics.reconciliation_rate.toFixed(1)}%`} progress={metrics.reconciliation_rate} tone={metrics.reconciliation_rate >= 90 ? "low" : "medium"} />
            <StatCard label="Funds at risk" value={formatKesCompact(caseSummary?.amount_at_risk ?? metrics.total_leakage_kes)} note={`${caseSummary?.critical_count ?? metrics.critical_count} critical cases`} tone="info" href="/dashboard/inuka/anomalies" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            <section className="lg:col-span-2 bg-card border border-border rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-bold text-foreground">Priority payout anomalies</h2>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Sorted by exposed program funds</p>
                </div>
                <Link href="/dashboard/inuka/anomalies" className="text-xs font-medium text-muted-foreground hover:text-foreground">View all</Link>
              </div>
              {anomalies.length === 0 ? (
                <p className="text-sm text-muted-foreground italic py-8 text-center">No payout anomalies match the current threshold.</p>
              ) : (
                <div className="divide-y divide-border">
                  {anomalies.map((anomaly) => (
                    <div key={`${anomaly.dispatch_id}-${anomaly.break_type}`} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{anomaly.beneficiary_id || "Unknown beneficiary"}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{anomaly.break_type} · Officer {anomaly.officer_id || "unassigned"}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-mono font-semibold text-status-critical">{formatKes(anomaly.leakage_kes)}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{anomaly.status}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="bg-card border border-border rounded-xl p-5 shadow-sm">
              <h2 className="text-sm font-bold text-foreground">Exposure by control</h2>
              <div className="flex flex-col gap-3 mt-4">
                {BREAK_TYPES.map(({ key, label, color }) => {
                  const value = Number(metrics[key] ?? 0);
                  return (
                    <div key={key} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground font-medium">{label}</span><span className="font-mono font-semibold text-foreground">{formatKesCompact(value)}</span></div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.round((value / maxBreakLeak) * 100)}%`, backgroundColor: color }} /></div>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-border pt-3 mt-5 flex items-center justify-between"><span className="text-[11px] text-muted-foreground">Source data quality</span><span className="text-xs font-bold text-status-low">{qualityScore === null ? "—" : `${qualityScore.toFixed(1)}%`}</span></div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
