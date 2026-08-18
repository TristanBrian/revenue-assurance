"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { ApiError, getMetrics, getOmcRiskProfile } from "@/lib/api";
import type { Metrics, OmcRiskProfile, MetricsResult } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { useMateriality } from "@/context/MaterialityContext";
import LiveFeed from "@/components/LiveFeed";
import StatCard from "@/components/StatCard";

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
  }, [user, materiality, canViewMetrics, canViewOmcRisk]);

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

  // Admin-only accounts have no operational metrics permission at all.
  if (user && !canViewMetrics && !canViewOmcRisk) {
    return (
      <div className="flex flex-col gap-6 max-w-5xl mx-auto">
        <header>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            KPC Platform Configuration
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">Admin Console</h1>
        </header>

        <div className="bg-card border border-border rounded-xl p-6 flex flex-col gap-4 shadow-sm">
          <h2 className="text-base font-bold text-foreground">Welcome, {user.email}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            You are logged in as a <strong className="font-semibold text-foreground">System Administrator</strong>.
            This account is designated for role management, user administration, and system-level configuration
            rather than financial operations.
          </p>
          <p className="text-sm text-status-info bg-status-info-bg border border-status-info/20 rounded-lg p-3">
            To inspect financial leakages, executive dashboards, or webhooks, please sign in with an operational
            account (e.g. Revenue Assurance or Manager).
          </p>
          {user.permissions.includes("manage_users") && (
            <Link
              href="/dashboard/admin"
              className="self-start flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90 text-xs font-semibold"
            >
              Go to User Management
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          )}
        </div>
      </div>
    );
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
                icon={<IconLeak />}
              />
            ) : (
              <StatCard
                label="Total Dispatched"
                value={formatKesCompact(metrics.total_dispatched_kes)}
                note="Across registered waybills"
                icon={<IconTruck />}
              />
            )}

            <StatCard
              label="Critical Anomalies"
              value={metrics.critical_count.toLocaleString()}
              note="Needs immediate review"
              tone={metrics.critical_count > 0 ? "critical" : "low"}
              icon={<IconAlert />}
              href={canViewAnomalyTable ? "/dashboard/anomalies" : undefined}
            />

            <StatCard
              label="Reconciliation Rate"
              value={`${metrics.reconciliation_rate.toFixed(1)}%`}
              note={`${metrics.anomaly_count.toLocaleString()} anomalies flagged`}
              tone={metrics.reconciliation_rate >= 90 ? "low" : "medium"}
              icon={<IconGauge />}
            />

            {canViewOmcRisk ? (
              <StatCard
                label="High Risk OMCs"
                value={highRiskOmcsCount.toString()}
                note="Under active review"
                tone={highRiskOmcsCount > 0 ? "high" : "low"}
                icon={<IconShield />}
                href="/dashboard/omc-risk"
              />
            ) : (
              <StatCard
                label="Total Paid Remitted"
                value={formatKesCompact(metrics.total_paid_kes)}
                note="Verified payments"
                tone="low"
                icon={<IconCheck />}
              />
            )}
          </div>

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
                      href="/dashboard/omc-risk"
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
        </div>
      )}
    </div>
  );
}

function RiskDot({ level }: { level: "Low" | "Medium" | "High" }) {
  const color = level === "High" ? "bg-status-critical" : level === "Medium" ? "bg-status-medium" : "bg-status-low";
  return <span className={`w-2 h-2 rounded-full shrink-0 ${color}`} />;
}

function IconLeak() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z" />
    </svg>
  );
}
function IconTruck() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h11v9H3V7zm11 3h4l3 3v3h-7v-6zM6.5 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm12 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
    </svg>
  );
}
function IconAlert() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
  );
}
function IconGauge() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20a8 8 0 100-16 8 8 0 000 16zm0-4l3-5" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z" />
    </svg>
  );
}
function IconCheck() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
