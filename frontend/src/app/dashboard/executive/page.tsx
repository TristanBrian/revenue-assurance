"use client";

import { useEffect, useState } from "react";
import { ApiError, reconcile } from "@/lib/api";
import type { Metrics, OmcRiskProfile as OmcRiskProfileEntry } from "@/lib/types";
import BreakTypeBreakdown from "@/components/BreakTypeBreakdown";
import OmcRiskProfile from "@/components/OmcRiskProfile";
import RequirePermission from "@/components/RequirePermission";

const DEFAULT_MATERIALITY = 100000;
const TOP_OMC_COUNT = 5;

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{value}</p>
    </div>
  );
}

function ExecutiveContent() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [omcRiskProfile, setOmcRiskProfile] = useState<OmcRiskProfileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    reconcile(DEFAULT_MATERIALITY)
      .then((data) => {
        if (!cancelled) {
          setMetrics(data.metrics);
          setOmcRiskProfile(data.omc_risk_profile);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Could not reach the reconciliation API. Is the backend running?",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {error}
      </div>
    );
  }

  if (loading || !metrics) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading executive summary…</p>;
  }

  const topRisk = [...omcRiskProfile]
    .sort((a, b) => b.leakage_kes - a.leakage_kes)
    .slice(0, TOP_OMC_COUNT);

  const highRiskCount = omcRiskProfile.filter((p) => p.risk_level === "High").length;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Executive Summary
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Order-to-Cash revenue leakage — at a glance
        </p>
      </header>

      {/* Hero figure — the one number this view leads with */}
      <div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Total Revenue at Risk</p>
        <p className="mt-1 text-5xl font-semibold text-red-600 dark:text-red-400">
          {formatKes(metrics.total_leakage_kes)}
        </p>
        <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Across {metrics.anomaly_count.toLocaleString()} flagged transactions, KPC is currently
          reconciling {metrics.reconciliation_rate.toFixed(1)}% of{" "}
          {formatKes(metrics.total_dispatched_kes)} in dispatched volume —{" "}
          {metrics.critical_count.toLocaleString()} cases are critical
          {highRiskCount > 0 &&
            ` and ${highRiskCount} OMC${highRiskCount === 1 ? " is" : "s are"} flagged High risk`}
          .
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Reconciliation Rate" value={`${metrics.reconciliation_rate.toFixed(1)}%`} />
        <StatTile label="Total Dispatched" value={formatKes(metrics.total_dispatched_kes)} />
        <StatTile label="Flagged Anomalies" value={metrics.anomaly_count.toLocaleString()} />
        <StatTile label="Critical Cases" value={metrics.critical_count.toLocaleString()} />
      </div>

      <BreakTypeBreakdown metrics={metrics} />

      <OmcRiskProfile profiles={topRisk} />
      <p className="-mt-6 text-xs text-zinc-500 dark:text-zinc-400">
        Top {TOP_OMC_COUNT} of {omcRiskProfile.length} OMCs, by leakage.
      </p>
    </div>
  );
}

export default function ExecutivePage() {
  return (
    <RequirePermission code="view_risk_profile">
      <ExecutiveContent />
    </RequirePermission>
  );
}
