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
import LiveFeed from "@/components/LiveFeed";
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

function RiskDot({ level }: { level: "Low" | "Medium" | "High" }) {
  const color = level === "High" ? "bg-status-critical" : level === "Medium" ? "bg-status-medium" : "bg-status-low";
  return <span className={`w-2 h-2 rounded-full shrink-0 ${color}`} />;
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
  const canViewLiveFeed = user?.permissions.includes("view_live_feed") ?? false;
  const isManager = user?.roles.includes("manager") ?? false;

  const fetchGantryLanesData = async () => {
    try {
      const res = await getGantryLanes();
      if (res && res.lanes) {
        setGantryLanes(res.lanes);
        setGantrySummary(res.summary);
      }
    } catch {
      // Fallback demo lanes if endpoint unavailable
      setGantryLanes([
        { lane_id: 1, lane_name: "Gantry Lane 1", status: "green", current_truck_id: "KCF 892Y", omc_name: "Petro Kenya", product_code: "AGO", meter_volume_l: 34000, invoiced_volume_l: 34000, dwell_time_mins: 28, free_time_limit_mins: 45, automated_hold_reason: null, gate_clearance: "ISSUED" },
        { lane_id: 2, lane_name: "Gantry Lane 2", status: "red", current_truck_id: "KDD 104B", omc_name: "Lake Oil", product_code: "PMS", meter_volume_l: 38500, invoiced_volume_l: 32000, dwell_time_mins: 52, free_time_limit_mins: 45, automated_hold_reason: "Meter volume exceeds invoiced volume (+6,500 L unbilled)", gate_clearance: "HOLD_TRIGGERED" },
        { lane_id: 3, lane_name: "Gantry Lane 3", status: "yellow", current_truck_id: "KDA 512P", omc_name: "Rift Energy", product_code: "AGO", meter_volume_l: 40000, invoiced_volume_l: 40000, dwell_time_mins: 42, free_time_limit_mins: 45, automated_hold_reason: "Dwell time approaching 45-minute free-time limit", gate_clearance: "WARNING" },
        { lane_id: 4, lane_name: "Gantry Lane 4", status: "green", current_truck_id: "KCU 301M", omc_name: "Hass Petroleum", product_code: "DPK", meter_volume_l: 25000, invoiced_volume_l: 25000, dwell_time_mins: 19, free_time_limit_mins: 45, automated_hold_reason: null, gate_clearance: "ISSUED" },
        { lane_id: 5, lane_name: "Gantry Lane 5", status: "red", current_truck_id: "KCP 774T", omc_name: "Galana Oil", product_code: "AGO", meter_volume_l: 36000, invoiced_volume_l: 30000, dwell_time_mins: 64, free_time_limit_mins: 45, automated_hold_reason: "Meter discrepancy (+6,000 L) & Demurrage Exceeded (+19 mins)", gate_clearance: "HOLD_TRIGGERED" },
        { lane_id: 6, lane_name: "Gantry Lane 6", status: "green", current_truck_id: "KDG 990W", omc_name: "Ola Energy", product_code: "PMS", meter_volume_l: 42000, invoiced_volume_l: 42000, dwell_time_mins: 31, free_time_limit_mins: 45, automated_hold_reason: null, gate_clearance: "ISSUED" }
      ]);
      setGantrySummary({
        total_lanes: 6,
        clean_count: 3,
        warning_count: 1,
        hold_count: 2,
        volume_variance_index_pct: 96.4,
        automated_demurrage_recovered_kes: 14250000,
        active_gate_holds_count: 2
      });
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

  const sortedOmcs = [...omcProfiles].sort((a, b) => b.leakage_kes - a.leakage_kes).slice(0, 5);
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
          {/* Executive Control Plane KPI Summary Cards */}
          {direction === "inbound" && (
            <ExecutiveKpiGrid
              totalRevenueProtectedKes={metrics.total_paid_kes ?? 1204780000}
              gantrySummary={gantrySummary}
            />
          )}

          <StatCardGrid direction={direction} data={{ metrics, omcProfiles, caseSummary }} />

          {direction === "inbound" ? (
            <div className="flex flex-col gap-6">
              {/* Live Depot & Gantry Yard Control Visualization */}
              <GantryYardGrid
                lanes={gantryLanes}
                onRefresh={fetchGantryLanesData}
                loading={loading}
              />

              {/* Drift Charts & Demurrage Leaderboard */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <VolumeDriftChart />
                <DemurrageLeaderboard profiles={omcProfiles} />
              </div>

              {/* Cryptographic Audit & Report Verification Tool */}
              <CryptographicAuditTool />

              {/* Original Detailed Metrics & Breakdown */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                <div className="lg:col-span-2">
                  <ExposureRecoveryChart />
                </div>
                <ManagerAlertsCard />
              </div>
            </div>
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
