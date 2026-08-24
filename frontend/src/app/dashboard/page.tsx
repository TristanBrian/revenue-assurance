"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { ApiError, getMetrics, getOmcRiskProfile } from "@/lib/api";
import type { Metrics, OmcRiskProfile, MetricsResult } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { useMateriality } from "@/context/MaterialityContext";
import LiveFeed from "@/components/LiveFeed";
import StatCard from "@/components/StatCard";
import ExposureRecoveryChart from "@/components/ExposureRecoveryChart";
import ManagerAlertsCard from "@/components/ManagerAlertsCard";
import UserManagementTable from "@/components/UserManagementTable";
import InukaDashboard from "@/components/InukaDashboard";

function formatKesCompact(value: number): string {
  if (value >= 1e9) return `KES ${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `KES ${(value / 1e6).toFixed(2)}M`;
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatKesFull(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

const BREAK_TYPES: { key: keyof Metrics; label: string; color: string }[] = [
  { key: "missing_invoice_leak", label: "Missing Invoice", color: "var(--chart-1)" },
  { key: "missing_payment_leak", label: "Missing Payment", color: "var(--chart-2)" },
  { key: "underpayment_leak", label: "Underpayment", color: "var(--chart-3)" },
  { key: "overpayment_leak", label: "Overpayment", color: "var(--chart-4)" },
];

export default function ExecutiveDashboardPage() {
  const { user } = useAuth();
  const { materiality, setMateriality } = useMateriality();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [omcProfiles, setOmcProfiles] = useState<OmcRiskProfile[]>([]);
  const [qualityScore, setQualityScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canViewMetrics = user?.permissions.includes("view_metrics") ?? false;
  const canViewOmcRisk = user?.permissions.includes("view_omc_risk_profile") ?? false;
  const canViewLiveFeed = user?.permissions.includes("view_live_feed") ?? false;
  const isManager = user?.roles.includes("manager") ?? false;
  const isInukaManager = user?.roles.includes("inuka_manager") ?? false;
  const canViewAnomalyTable = user?.permissions.includes("view_anomaly_table") ?? false;

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }
    });

    if (isInukaManager) {
      Promise.resolve().then(() => {
        if (!cancelled) setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }

    const promises = [
      canViewMetrics ? getMetrics(materiality) : Promise.resolve(null),
      canViewOmcRisk ? getOmcRiskProfile(materiality) : Promise.resolve(null),
    ];

    Promise.all(promises)
      .then((results) => {
        const metricsData = results[0] as MetricsResult | null;
        const riskData = results[1] as OmcRiskProfile[] | null;
        if (!cancelled) {
          if (metricsData) {
            setMetrics(metricsData.metrics);
            setQualityScore(metricsData.data_quality.quality_score);
          }
          if (riskData) setOmcProfiles(riskData);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Could not reach the reconciliation API. Is the database online?",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user, materiality, canViewMetrics, canViewOmcRisk, isInukaManager]);

  const totalLeakage = useMemo(() => {
    if (!omcProfiles.length) return 0;
    return omcProfiles.reduce((acc, o) => acc + o.leakage_kes, 0);
  }, [omcProfiles]);

  const highRiskOmcsCount = useMemo(
    () => omcProfiles.filter((o) => o.risk_level === "High").length,
    [omcProfiles],
  );

  const sortedOmcs = useMemo(
    () => [...omcProfiles].sort((a, b) => b.leakage_kes - a.leakage_kes).slice(0, 5),
    [omcProfiles],
  );

  const maxBreakLeak = metrics
    ? Math.max(...BREAK_TYPES.map((b) => metrics[b.key] as number), 1)
    : 1;

  if (isInukaManager) return <InukaDashboard />;

  // Admin-only accounts have no operational metrics permission at all —
  // their "dashboard" is user management, not the executive KPI view.
  if (user && !canViewMetrics && !canViewOmcRisk) {
    if (!user.permissions.includes("manage_users")) {
      return (
        <div className="mx-auto flex max-w-5xl flex-col gap-6">
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h2 className="text-base font-bold text-foreground">Welcome, {user.email}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Your account has no dashboard sections enabled yet. Contact a System Administrator to have a role
              assigned.
            </p>
          </div>
        </div>
      );
    }
    return <UserManagementTable />;
  }

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">KPC Order-to-Cash</p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">Executive Dashboard</h1>
        </div>

        <div className="flex items-center gap-2.5 rounded-md border border-border bg-card px-3 py-1.5">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
            Materiality
          </span>
          <input
            type="range"
            min="0"
            max="1000000"
            step="25000"
            value={materiality}
            onChange={(e) => setMateriality(Number(e.target.value))}
            className="w-24 h-1 accent-primary cursor-pointer"
          />
          <span className="text-xs font-mono font-semibold text-foreground w-20 text-right">
            {formatKesCompact(materiality)}
          </span>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg p-4 text-sm text-status-critical">
          {error}
        </div>
      )}

      {loading && !error && (
        <div className="flex items-center justify-center p-12">
          <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {metrics && !loading && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {canViewOmcRisk ? (
              <StatCard
                label="Total Leakage"
                value={formatKesCompact(totalLeakage)}
                note="Across all flagged OMCs"
              />
            ) : (
              <StatCard
                label="Total Dispatched"
                value={formatKesCompact(metrics.total_dispatched_kes)}
                note="Across registered waybills"
              />
            )}

            <StatCard
              label="Critical Anomalies"
              value={metrics.critical_count.toLocaleString()}
              note="Needs immediate review"
              tone={metrics.critical_count > 0 ? "critical" : "low"}
              notePill
              href={canViewAnomalyTable ? "/dashboard/anomalies" : undefined}
            />

            <StatCard
              label="Reconciliation Rate"
              value={`${metrics.reconciliation_rate.toFixed(1)}%`}
              progress={metrics.reconciliation_rate}
              tone={metrics.reconciliation_rate >= 90 ? "low" : "medium"}
            />

            {canViewOmcRisk ? (
              <StatCard
                label="High Risk OMCs"
                value={highRiskOmcsCount.toString()}
                note="Under active review"
                tone={highRiskOmcsCount > 0 ? "high" : "low"}
                href="/dashboard/heatmap"
              />
            ) : (
              <StatCard
                label="Total Paid Remitted"
                value={formatKesCompact(metrics.total_paid_kes)}
                note="Verified payments"
                tone="low"
              />
            )}
          </div>

          {isManager ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              <div className="lg:col-span-2">
                <ExposureRecoveryChart />
              </div>
              <ManagerAlertsCard />
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              <div className="lg:col-span-2">
                {canViewOmcRisk ? (
                  <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-4 shadow-sm h-full">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-sm font-bold text-foreground">Top Leaking OMCs</h2>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Materiality &gt; {formatKesCompact(materiality)}
                        </p>
                      </div>
                      <Link
                        href="/dashboard/heatmap"
                        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        View all
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7 17L17 7M17 7H8m9 0v9" />
                        </svg>
                      </Link>
                    </div>

                    {sortedOmcs.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic py-8 text-center">
                        No leakages match the current materiality criteria.
                      </p>
                    ) : (
                      <div className="flex flex-col divide-y divide-border">
                        {sortedOmcs.map((omc) => (
                          <div key={omc.customer} className="flex justify-between items-center py-3 first:pt-0 last:pb-0">
                            <div className="flex items-center gap-3 min-w-0">
                              <RiskDot level={omc.risk_level} />
                              <div className="min-w-0">
                                <h3 className="text-sm font-semibold text-foreground truncate">{omc.customer}</h3>
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                  {omc.anomaly_count} anomalies · {omc.risk_level} risk
                                </p>
                              </div>
                            </div>
                            <span className="text-sm font-semibold text-status-critical font-mono shrink-0 ml-3">
                              {formatKesFull(omc.leakage_kes)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  canViewLiveFeed && <LiveFeed />
                )}
              </div>

              <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-4 shadow-sm h-full">
                <h2 className="text-sm font-bold text-foreground">Leakage by Break Type</h2>
                <div className="flex flex-col gap-3">
                  {BREAK_TYPES.map((b) => {
                    const value = metrics[b.key] as number;
                    const pct = Math.round((value / maxBreakLeak) * 100);
                    return (
                      <div key={b.key} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground font-medium">{b.label}</span>
                          <span className="font-mono font-semibold text-foreground">{formatKesCompact(value)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${pct}%`, backgroundColor: b.color }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="border-t border-border pt-3 mt-auto flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">Data quality score</span>
                  <span className="text-xs font-bold text-status-low">
                    {qualityScore !== null ? `${qualityScore.toFixed(1)}%` : "—"}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RiskDot({ level }: { level: "Low" | "Medium" | "High" }) {
  const color = level === "High" ? "bg-status-critical" : level === "Medium" ? "bg-status-medium" : "bg-status-low";
  return <span className={`w-2 h-2 rounded-full shrink-0 ${color}`} />;
}
