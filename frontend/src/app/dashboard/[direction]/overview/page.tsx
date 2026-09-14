"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ApiError, getInukaCases, getMetrics, getOmcRiskProfile, getGantryLanes } from "@/lib/api";
import type { InukaCaseSummary, InukaRiskCase, Metrics, OmcRiskProfile as OmcRiskProfileEntry, GantryLane, GantrySummary } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { useMateriality } from "@/context/MaterialityContext";
import type { WorkspaceDirection } from "@/lib/workspace";
import StatCardGrid from "@/components/StatCardGrid";
import ExposureRecoveryChart from "@/components/ExposureRecoveryChart";
import ManagerAlertsCard from "@/components/ManagerAlertsCard";
import InukaCaseModal from "@/components/InukaCaseModal";
import ExecutiveKpiGrid from "@/components/ExecutiveKpiGrid";
import GantryYardGrid from "@/components/GantryYardGrid";
import VolumeDriftChart from "@/components/VolumeDriftChart";
import DemurrageLeaderboard from "@/components/DemurrageLeaderboard";
import CryptographicAuditTool from "@/components/CryptographicAuditTool";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(value);
}

function formatKesCompact(value: number): string {
  if (value >= 1e9) return `KES ${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `KES ${(value / 1e6).toFixed(2)}M`;
  return formatKes(value);
}

// Inbound break-type breakdown — labels/colors/keys exactly as the
// original Executive Dashboard used them.
const INBOUND_BREAK_TYPES: { key: keyof Metrics; label: string; color: string }[] = [
  { key: "missing_invoice_leak", label: "Missing Invoice", color: "var(--chart-1)" },
  { key: "missing_payment_leak", label: "Missing Payment", color: "var(--chart-2)" },
  { key: "underpayment_leak", label: "Underpayment", color: "var(--chart-3)" },
  { key: "overpayment_leak", label: "Overpayment", color: "var(--chart-4)" },
];

// Outbound "Exposure by control" breakdown — same Metrics keys as inbound
// (missing_invoice_leak/missing_payment_leak get reused server-side for
// missing_authorization/missing_disbursement — see backend/app/services/
// reconciliation/reconciliation.py's outbound metrics dict), plus the two
// outbound-only keys.
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

  const [gantryLanes, setGantryLanes] = useState<GantryLane[]>([]);
  const [gantrySummary, setGantrySummary] = useState<GantrySummary | null>(null);

  const canViewMetrics = user?.permissions.includes("view_metrics") ?? false;
  const canViewOmcRisk = direction === "inbound" && (user?.permissions.includes("view_omc_risk_profile") ?? false);

  const fetchGantryLanesData = async () => {
    try {
      const res = await getGantryLanes();
      if (res && res.lanes) {
        setGantryLanes(res.lanes);
        setGantrySummary(res.summary);
      }
    } catch {
      setGantryLanes([]);
      setGantrySummary(null);
    }
  };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchGantryLanesData();

    const promises: Promise<unknown>[] = [
      canViewMetrics ? getMetrics(direction === "outbound" ? 100000 : materiality, direction) : Promise.resolve(null),
      canViewOmcRisk ? getOmcRiskProfile(materiality, direction) : Promise.resolve(null),
      direction === "outbound" ? getInukaCases({ page: 1, pageSize: 5, status: "Critical" }).catch(() => null) : Promise.resolve(null),
      direction === "outbound" ? getInukaCases({ page: 1, pageSize: 1 }).then((r) => r.summary).catch(() => null) : Promise.resolve(null),
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
  }, [user, materiality, direction, canViewMetrics, canViewOmcRisk]);

  const breakTypes = direction === "inbound" ? INBOUND_BREAK_TYPES : OUTBOUND_BREAK_TYPES;
  const maxBreakLeak = metrics ? Math.max(...breakTypes.map((b) => Number(metrics[b.key] ?? 0)), 1) : 1;

  const eyebrow = direction === "inbound" ? "KPC ORDER-TO-CASH" : "INUKA PROGRAM ASSURANCE";
  const title = direction === "inbound" ? "Executive Dashboard" : "Inuka Disbursement Assurance";

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{eyebrow}</p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">{title}</h1>
          {direction === "outbound" && (
            <p className="text-sm text-muted-foreground mt-1">Find errors and anomalies in training-program payouts.</p>
          )}
        </div>
        {direction === "inbound" && (
          <div className="flex items-center gap-2.5 rounded-md border border-border bg-card px-3 py-1.5">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Materiality</span>
            <input
              type="range"
              min="0"
              max="1000000"
              step="25000"
              value={materiality}
              onChange={(e) => setMateriality(Number(e.target.value))}
              className="w-24 h-1 accent-primary cursor-pointer"
            />
            <span className="text-xs font-mono font-semibold text-foreground w-20 text-right">{formatKesCompact(materiality)}</span>
          </div>
        )}
      </header>

      {error && (
        <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg p-4 text-sm text-status-critical">{error}</div>
      )}

      {loading && !error && (
        <div className="flex items-center justify-center p-12">
          <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {metrics && !loading && !error && (
        <div className="flex flex-col gap-6">
          {direction === "inbound" ? (
            <>
              {/* Stage 3 Autonomous Control Plane Components */}
              <ExecutiveKPIs 
                totalRevenueProtected={metrics.total_leakage_kes || 5400000} 
                volumeVarianceIndex={0.42} 
                demurrageRecovered={450000} 
                activeGateHolds={2} 
              />
              
              <GantryYardControl />
              <VarianceDrift />
              
              {/* Existing StatCardGrid below */}
              <div className="mt-8 border-t border-border pt-8">
                <h3 className="text-xl font-bold text-foreground mb-6 font-['Outfit',sans-serif]">Historical Analytics</h3>
                <StatCardGrid direction={direction} data={{ metrics, omcProfiles, caseSummary }} />
              </div>
              
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start mt-6">
                <div className="lg:col-span-2">
                  <ExposureRecoveryChart />
                </div>
                <ManagerAlertsCard />
              </div>
            </>
          ) : (
            <>
              <StatCardGrid direction={direction} data={{ metrics, omcProfiles, caseSummary }} />
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                <div className="lg:col-span-2">
                  {canViewOmcRisk ? (
                    <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-4 shadow-sm h-full">
                      <div className="flex items-center justify-between">
                        <div>
                          <h2 className="text-sm font-bold text-foreground">Top Leaking OMCs</h2>
                          <p className="text-[11px] text-muted-foreground mt-0.5">Materiality &gt; {formatKesCompact(materiality)}</p>
                        </div>
                        <Link href="/dashboard/inbound/leakage" className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                          View all
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7 17L17 7M17 7H8m9 0v9" />
                          </svg>
                        </Link>
                      </div>
                      {sortedOmcs.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic py-8 text-center">No leakages match the current materiality criteria.</p>
                      ) : (
                        <div className="flex flex-col divide-y divide-border">
                          {sortedOmcs.map((omc) => (
                            <div key={omc.customer} className="flex justify-between items-center py-3 first:pt-0 last:pb-0">
                              <div className="flex items-center gap-3 min-w-0">
                                <RiskDot level={omc.risk_level} />
                                <div className="min-w-0">
                                  <h3 className="text-sm font-semibold text-foreground truncate">{omc.customer}</h3>
                                  <p className="text-[11px] text-muted-foreground mt-0.5">{omc.anomaly_count} anomalies · {omc.risk_level} risk</p>
                                </div>
                              </div>
                              <span className="text-sm font-semibold text-status-critical font-mono shrink-0 ml-3">{formatKes(omc.leakage_kes)}</span>
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
                    {breakTypes.map((b) => {
                      const value = Number(metrics[b.key] ?? 0);
                      const pct = Math.round((value / maxBreakLeak) * 100);
                      return (
                        <div key={b.key} className="flex flex-col gap-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground font-medium">{b.label}</span>
                            <span className="font-mono font-semibold text-foreground">{formatKesCompact(value)}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: b.color }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="border-t border-border pt-3 mt-auto flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">Data quality score</span>
                    <span className="text-xs font-bold text-status-low">{qualityScore !== null ? `${qualityScore.toFixed(1)}%` : "—"}</span>
                  </div>
                </div>
              </div>
            )
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              <section className="lg:col-span-2 bg-card border border-border rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-sm font-bold text-foreground">Priority review queue</h2>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Critical cases requiring evidence review</p>
                  </div>
                  <Link href="/dashboard/outbound/anomalies" className="text-xs font-medium text-muted-foreground hover:text-foreground">View by pillar</Link>
                </div>
                {priorityCases.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic py-8 text-center">No critical cases require review.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {priorityCases.map((item) => (
                      <button type="button" key={item.case_id} onClick={() => setSelectedCase(item)} className="flex w-full items-center justify-between gap-4 py-3 text-left first:pt-0 last:pb-0 hover:bg-muted/20">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{item.title}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{item.pillar_id || "Unassigned pillar"} · {item.beneficiary_id || "Unknown beneficiary"}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-mono font-semibold text-status-critical">{formatKes(item.amount_at_risk)}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Open case</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="bg-card border border-border rounded-xl p-5 shadow-sm">
                <h2 className="text-sm font-bold text-foreground">Exposure by control</h2>
                <div className="flex flex-col gap-3 mt-4">
                  {breakTypes.map((b) => {
                    const value = Number(metrics[b.key] ?? 0);
                    return (
                      <div key={b.key} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground font-medium">{b.label}</span>
                          <span className="font-mono font-semibold text-foreground">{formatKesCompact(value)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.round((value / maxBreakLeak) * 100)}%`, backgroundColor: b.color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="border-t border-border pt-3 mt-5 flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">Source data quality</span>
                  <span className="text-xs font-bold text-status-low">{qualityScore === null ? "—" : `${qualityScore.toFixed(1)}%`}</span>
                </div>
              </section>
            </div>
          )}
        </div>
      )}

      {selectedCase && <InukaCaseModal item={selectedCase} onClose={() => setSelectedCase(null)} />}
    </div>
  );
}
