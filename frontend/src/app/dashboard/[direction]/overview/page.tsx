"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ApiError, getInukaCases, getMetrics, getOmcRiskProfile } from "@/lib/api";
import type { InukaCaseSummary, InukaRiskCase, Metrics, OmcRiskProfile as OmcRiskProfileEntry } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { useMateriality } from "@/context/MaterialityContext";
import type { WorkspaceDirection } from "@/lib/workspace";
import StatCardGrid from "@/components/StatCardGrid";
import ExposureRecoveryChart from "@/components/ExposureRecoveryChart";
import ManagerAlertsCard from "@/components/ManagerAlertsCard";
import InukaCaseModal from "@/components/InukaCaseModal";
import { GantryYardControl } from "@/components/GantryYardControl";
import CsvUploadPanel from "@/components/CsvUploadPanel";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(value);
}

function formatKesCompact(value: number): string {
  if (value >= 1e9) return `KES ${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `KES ${(value / 1e6).toFixed(2)}M`;
  return formatKes(value);
}

const INBOUND_BREAK_TYPES: { key: keyof Metrics; label: string; color: string }[] = [
  { key: "missing_invoice_leak", label: "Missing Invoice", color: "var(--chart-1)" },
  { key: "missing_payment_leak", label: "Missing Payment", color: "var(--chart-2)" },
  { key: "underpayment_leak", label: "Underpayment", color: "var(--chart-3)" },
  { key: "overpayment_leak", label: "Overpayment", color: "var(--chart-4)" },
];

const OUTBOUND_BREAK_TYPES: { key: keyof Metrics; label: string; color: string }[] = [
  { key: "missing_invoice_leak", label: "Missing authorization", color: "var(--chart-1)" },
  { key: "missing_payment_leak", label: "Missing disbursement", color: "var(--chart-2)" },
  { key: "ghost_payment_leak", label: "Ghost payment", color: "var(--chart-3)" },
  { key: "duplicate_disbursement_leak", label: "Duplicate disbursement", color: "var(--chart-4)" },
];

export default function OverviewPage() {
  const { direction } = useParams<{ direction: WorkspaceDirection }>();
  const { user } = useAuth();
  const { materiality, setMateriality } = useMateriality();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [omcProfiles, setOmcProfiles] = useState<OmcRiskProfileEntry[]>([]);
  const [caseSummary, setCaseSummary] = useState<InukaCaseSummary | null>(null);
  const [priorityCases, setPriorityCases] = useState<InukaRiskCase[]>([]);
  const [selectedCase, setSelectedCase] = useState<InukaRiskCase | null>(null);
  const [qualityScore, setQualityScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);
  const canViewMetrics = user?.permissions.includes("view_metrics") ?? false;
  const canReview = user?.permissions.includes("view_anomaly_table") ?? false;
  const canViewOmcRisk = direction === "inbound" && (user?.permissions.includes("view_omc_risk_profile") ?? false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    setMetrics(null);
    setCaseSummary(null);
    setPriorityCases([]);
    setOmcProfiles([]);

    const promises: Promise<unknown>[] = [
      canViewMetrics ? getMetrics(direction === "outbound" ? 100000 : materiality, direction) : Promise.resolve(null),
      canViewOmcRisk ? getOmcRiskProfile(materiality, direction) : Promise.resolve(null),
      direction === "outbound" && canReview ? getInukaCases({ page: 1, pageSize: 5, status: "Critical" }) : Promise.resolve(null),
      direction === "outbound" && canReview ? getInukaCases({ page: 1, pageSize: 1 }).then((r) => r.summary) : Promise.resolve(null),
    ];

    Promise.all(promises)
      .then(([metricsResult, riskResult, priorityResult, summaryResult]) => {
        if (cancelled) return;
        const metricsData = metricsResult as Awaited<ReturnType<typeof getMetrics>> | null;
        if (metricsData) {
          setMetrics(metricsData.metrics);
          setQualityScore(metricsData.data_quality.quality_score);
        }
        if (riskResult) setOmcProfiles(riskResult as OmcRiskProfileEntry[]);
        if (priorityResult) setPriorityCases((priorityResult as { cases: InukaRiskCase[] }).cases);
        if (summaryResult) setCaseSummary(summaryResult as InukaCaseSummary);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not reach the reconciliation API. Is the database online?");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user, materiality, direction, canViewMetrics, canViewOmcRisk, canReview, refreshKey]);

  const breakTypes = direction === "inbound" ? INBOUND_BREAK_TYPES : OUTBOUND_BREAK_TYPES;
  const maxBreakLeak = metrics ? Math.max(...breakTypes.map((b) => Number(metrics[b.key] ?? 0)), 1) : 1;

  const eyebrow = direction === "inbound" ? "KPC ORDER-TO-CASH" : "INUKA PROGRAM ASSURANCE";
  const title = direction === "inbound" ? "Executive Dashboard" : "Inuka Disbursement Assurance";

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto">
      {/* Sleek Executive Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-border/60">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-bold text-primary uppercase tracking-widest">{eyebrow}</p>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-foreground font-['Outfit',sans-serif] mt-0.5">{title}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {direction === "inbound"
              ? "Autonomous Order-to-Cash revenue protection & volumetric depot control"
              : "End-to-end stipend governance & ghost disbursement prevention"}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {direction === "inbound" && (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-1.5 shadow-sm">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Materiality Threshold</span>
              <input
                aria-label="Minimum material exposure in KES"
                type="range"
                min="0"
                max="1000000"
                step="25000"
                value={materiality}
                onChange={(e) => setMateriality(Number(e.target.value))}
                className="w-20 h-1 accent-primary cursor-pointer"
              />
              <span className="text-xs font-mono font-bold text-foreground">{formatKesCompact(materiality)}</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsUploadModalOpen(true)}
            className="rounded-xl border border-primary/40 bg-primary/10 text-primary px-3.5 py-1.5 text-xs font-extrabold hover:bg-primary/20 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
          >
            <span>📤</span> Upload Invoices
          </button>

          <button
            type="button"
            aria-label="Refresh overview"
            onClick={() => setRefreshKey((key) => key + 1)}
            disabled={loading}
            className="rounded-xl border border-border bg-card px-3.5 py-1.5 text-xs font-bold text-foreground hover:bg-muted transition-colors disabled:opacity-50 flex items-center gap-1.5 shadow-sm cursor-pointer"
          >
            <span>🔄</span> Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-status-critical/30 bg-status-critical-bg p-4 text-sm text-status-critical font-medium">{error}</div>
      )}

      {loading && !error && (
        <div className="flex items-center justify-center p-16">
          <div className="w-8 h-8 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {metrics && !loading && !error && (
        <div className="flex flex-col gap-6">
          {/* Top Executive KPI Row */}
          <StatCardGrid direction={direction} data={{ metrics, omcProfiles, caseSummary }} />

          {/* Primary Feature: Interactive 3D Control Plane Engine */}
          {direction === "inbound" ? (
            <>
              <GantryYardControl />

              {/* Recovery Chart & Manager Alerts */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                <div className="lg:col-span-2">
                  <ExposureRecoveryChart key={refreshKey} />
                </div>
                {canReview && <ManagerAlertsCard key={refreshKey} />}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              <section className="lg:col-span-2 bg-card border border-border rounded-2xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-base font-bold text-foreground font-['Outfit',sans-serif]">Priority Review Queue</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Critical stipend cases requiring evidence audit</p>
                  </div>
                  <Link href="/dashboard/outbound/anomalies" className="text-xs font-semibold text-primary hover:underline">View All Cases →</Link>
                </div>
                {priorityCases.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic py-8 text-center">No critical cases require review.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {priorityCases.map((item) => (
                      <button type="button" key={item.case_id} onClick={() => setSelectedCase(item)} className="flex w-full items-center justify-between gap-4 py-3 text-left first:pt-0 last:pb-0 hover:bg-muted/30 transition-colors rounded-lg px-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{item.title}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{item.pillar_id || "Unassigned pillar"} · {item.beneficiary_id || "Unknown beneficiary"}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-mono font-bold text-status-critical">{formatKes(item.amount_at_risk)}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Open Case</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="bg-card border border-border rounded-2xl p-5 shadow-sm">
                <h2 className="text-base font-bold text-foreground font-['Outfit',sans-serif]">Exposure by Control</h2>
                <div className="flex flex-col gap-3.5 mt-4">
                  {breakTypes.map((b) => {
                    const value = Number(metrics[b.key] ?? 0);
                    return (
                      <div key={b.key} className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-xs font-semibold">
                          <span className="text-muted-foreground">{b.label}</span>
                          <span className="font-mono text-foreground">{formatKesCompact(value)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.round((value / maxBreakLeak) * 100)}%`, backgroundColor: b.color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="border-t border-border pt-3 mt-5 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Source Data Quality</span>
                  <span className="text-xs font-bold text-status-low">{qualityScore === null ? "—" : `${qualityScore.toFixed(1)}%`}</span>
                </div>
              </section>
            </div>
          )}
        </div>
      )}

      {/* Floating CSV Upload Modal Dialog (Does not distort or shift the dashboard layout) */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-2xl bg-card border border-border rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-lg font-bold text-foreground font-['Outfit',sans-serif]">📤 Reconcile Invoices, Waybills & Remittances</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Upload CSV files to run 3-way server-side reconciliation engine.</p>
              </div>
              <button
                onClick={() => setIsUploadModalOpen(false)}
                className="w-8 h-8 rounded-full bg-muted hover:bg-muted/80 text-foreground flex items-center justify-center font-bold text-sm transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <CsvUploadPanel
              materiality={materiality}
              onUploaded={() => {
                setRefreshKey((k) => k + 1);
                setIsUploadModalOpen(false);
              }}
            />

            <div className="flex justify-end border-t border-border pt-3">
              <button
                onClick={() => setIsUploadModalOpen(false)}
                className="px-4 py-1.5 rounded-xl bg-muted text-foreground text-xs font-bold hover:bg-muted/80 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedCase && <InukaCaseModal item={selectedCase} onClose={() => setSelectedCase(null)} />}
    </div>
  );
}
