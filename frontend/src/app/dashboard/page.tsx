"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { ApiError, getMetrics, getOmcRiskProfile } from "@/lib/api";
import type {
  Metrics,
  OmcRiskProfile,
  ReconcileResult,
  MetricsResult,
} from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { useMateriality } from "@/context/MaterialityContext";
import CsvUploadPanel from "@/components/CsvUploadPanel";
import LiveFeed from "@/components/LiveFeed";

type DataSource = "database" | "upload";

function formatKesCompact(value: number): string {
  if (value >= 1e6) {
    return `KES ${(value / 1e6).toFixed(2)}M`;
  }
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

export default function ExecutiveDashboardPage() {
  const { user } = useAuth();
  const { materiality, setMateriality } = useMateriality();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [omcProfiles, setOmcProfiles] = useState<OmcRiskProfile[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const [uploadedResult, setUploadedResult] = useState<ReconcileResult | null>(
    null,
  );
  const [source, setSource] = useState<DataSource>("database");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Permission Checks
  const canViewMetrics = user?.permissions.includes("view_metrics") ?? false;
  const canViewOmcRisk =
    user?.permissions.includes("view_omc_risk_profile") ?? false;
  const canViewLiveFeed = user?.permissions.includes("view_live_feed") ?? false;

  useEffect(() => {
    if (!user || source === "upload") return;

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
          if (metricsData) setMetrics(metricsData.metrics);
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
  }, [user, materiality, reloadToken, source, canViewMetrics, canViewOmcRisk]);

  function handleUploaded(data: ReconcileResult) {
    setUploadedResult(data);
    setSource("upload");
    setShowUploadModal(false);
  }

  function handleSwitchToLive() {
    setSource("database");
    setUploadedResult(null);
    setReloadToken((t) => t + 1);
  }

  const currentMetrics =
    source === "database" ? metrics : uploadedResult?.metrics;
  const currentOmcs =
    source === "database" ? omcProfiles : uploadedResult?.omc_risk_profile;

  // Total leakage calculation (only if we have permission to view OMC risk profiles)
  const totalLeakage = useMemo(() => {
    if (!currentOmcs) return 0;
    return currentOmcs.reduce((acc, o) => acc + o.leakage_kes, 0);
  }, [currentOmcs]);

  const criticalAnomaliesCount = currentMetrics?.anomaly_count ?? 0;
  const synchedTransactionsRate = currentMetrics?.reconciliation_rate ?? 0;

  const highRiskOmcsCount = useMemo(() => {
    if (!currentOmcs) return 0;
    return currentOmcs.filter((o) => o.risk_level === "High").length;
  }, [currentOmcs]);

  // Top Leaking OMCs sorted
  const sortedOmcs = useMemo(() => {
    if (!currentOmcs) return [];
    return [...currentOmcs]
      .sort((a, b) => b.leakage_kes - a.leakage_kes)
      .slice(0, 3);
  }, [currentOmcs]);

  // Render Admin Welcomer if user has NO operational metrics permissions
  if (user && !canViewMetrics && !canViewOmcRisk) {
    return (
      <div className="flex flex-col gap-6 max-w-5xl mx-auto text-zinc-800 dark:text-zinc-100">
        <header>
          <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest leading-none">
            KPC PLATFORM CONFIGURATION
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-white mt-1.5">
            Admin Console
          </h1>
        </header>

        <div className="bg-zinc-900/35 border border-zinc-900 rounded-xl p-6 flex flex-col gap-4 shadow-lg">
          <h2 className="text-base font-bold text-white">
            Welcome, {user.email}
          </h2>
          <p className="text-xs text-zinc-400 leading-relaxed">
            You are logged in as a{" "}
            <strong className="font-bold text-zinc-200">
              System Administrator
            </strong>
            . This account is designated for role management, user
            administration, and system-level configuration rather than financial
            operations.
          </p>
          <p className="text-xs text-indigo-650 dark:text-indigo-400 font-semibold bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/30 rounded p-3">
            💡 To inspect financial leakages, executive dashboards, or webhooks,
            please sign in with an operational account (e.g. Revenue Assurance
            or Manager).
          </p>
          {user.permissions.includes("manage_users") && (
            <Link
              href="/dashboard/admin"
              className="self-start flex items-center gap-1.5 px-3.5 py-2 rounded bg-indigo-600 hover:bg-indigo-500 transition-colors text-xs font-bold text-white shadow-[0_0_15px_rgba(99,102,241,0.25)]"
            >
              Go to User Management
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17 8l4 4m0 0l-4 4m4-4H3"
                />
              </svg>
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto text-zinc-800 dark:text-zinc-100">
      {/* Header section */}
      <header className="flex items-center justify-between">
        <div>
          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-500 uppercase tracking-widest leading-none">
            KPC Order-to-Cash
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-white mt-1.5">
            Executive Dashboard
          </h1>
        </div>

        <div className="flex items-center gap-4">
          {/* LIVE Slider/Toggle */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
              Live
            </span>
            <input
              type="range"
              min="0"
              max="1000000"
              step="25000"
              value={materiality}
              onChange={(e) => setMateriality(Number(e.target.value))}
              className="w-20 h-1 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
            />
          </div>

          {/* Upload CSV button */}
          {user?.permissions.includes("upload_csv") && (
            <button
              onClick={() => setShowUploadModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 bg-white dark:bg-zinc-900 transition-colors text-xs font-semibold text-zinc-700 dark:text-zinc-200 shadow-sm"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                />
              </svg>
              <span>Upload CSV</span>
            </button>
          )}
        </div>
      </header>

      {source === "upload" && (
        <div className="flex items-center justify-between bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-150 dark:border-indigo-900/40 rounded-lg px-4 py-2.5 text-xs text-indigo-650 dark:text-indigo-400">
          <span>
            Currently inspecting custom uploaded reconciliation datasets.
          </span>
          <button
            onClick={handleSwitchToLive}
            className="underline hover:text-indigo-700 dark:hover:text-indigo-300 font-bold ml-4"
          >
            Switch back to live database
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4 text-xs text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && source === "database" && !error && (
        <div className="flex items-center justify-center p-12">
          <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
        </div>
      )}

      {currentMetrics && (!loading || source === "upload") && (
        <div className="flex flex-col gap-6">
          {/* Row of 4 Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {canViewOmcRisk ? (
              /* Card 1: Total Leakage */
              <div className="bg-white dark:bg-zinc-900/35 border border-zinc-200 dark:border-zinc-900 rounded-lg p-4 flex flex-col justify-between min-h-[96px] shadow-sm transition-all">
                <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">
                  Total Leakage
                </span>
                <span className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white font-sans mt-1">
                  {formatKesCompact(totalLeakage)}
                </span>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold mt-1.5">
                  -14.8% vs last month
                </span>
              </div>
            ) : (
              /* Supervisor Card 1: Total Dispatched */
              <div className="bg-white dark:bg-zinc-900/35 border border-zinc-200 dark:border-zinc-900 rounded-lg p-4 flex flex-col justify-between min-h-[96px] shadow-sm transition-all">
                <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">
                  Total Dispatched
                </span>
                <span className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white font-sans mt-1">
                  {formatKesCompact(currentMetrics.total_dispatched_kes)}
                </span>
                <span className="text-[10px] text-zinc-450 dark:text-zinc-500 mt-1.5">
                  Across registered waybills
                </span>
              </div>
            )}

            {/* Card 2: Critical Anomalies */}
            <div className="bg-white dark:bg-zinc-900/35 border border-zinc-200 dark:border-zinc-900 rounded-lg p-4 flex flex-col justify-between min-h-[96px] shadow-sm transition-all">
              <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">
                Critical Anomalies
              </span>
              <span className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white font-sans mt-1">
                {criticalAnomaliesCount}
              </span>
              <span className="text-[10px] text-rose-600 dark:text-rose-500 font-bold mt-1.5">
                3 new today
              </span>
            </div>

            {/* Card 3: Synced Transactions */}
            <div className="bg-white dark:bg-zinc-900/35 border border-zinc-200/90 dark:border-zinc-900 rounded-lg p-4 flex flex-col justify-between min-h-[96px] shadow-sm transition-all">
              <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">
                Synced Transactions
              </span>
              <span className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white font-sans mt-1">
                {synchedTransactionsRate.toFixed(1)}%
              </span>
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold mt-1.5">
                98.1% target
              </span>
            </div>

            {canViewOmcRisk ? (
              /* Card 4: High Risk OMCs */
              <div className="bg-white dark:bg-zinc-900/35 border border-zinc-200 dark:border-zinc-900 rounded-lg p-4 flex flex-col justify-between min-h-[96px] shadow-sm transition-all">
                <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">
                  High Risk OMCs
                </span>
                <span className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white font-sans mt-1">
                  {highRiskOmcsCount}
                </span>
                <span className="text-[10px] text-amber-600 dark:text-amber-500 font-bold mt-1.5">
                  Under review
                </span>
              </div>
            ) : (
              /* Supervisor Card 4: Total Paid Remittance */
              <div className="bg-white dark:bg-zinc-900/35 border border-zinc-200 dark:border-zinc-900 rounded-lg p-4 flex flex-col justify-between min-h-[96px] shadow-sm transition-all">
                <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">
                  Total Paid Remitted
                </span>
                <span className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white font-sans mt-1">
                  {formatKesCompact(currentMetrics.total_paid_kes)}
                </span>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold mt-1.5">
                  Verified payments
                </span>
              </div>
            )}
          </div>

          {/* Core Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            {/* Left Column: Top Leaking OMCs or Live Feed (if no permission to view OMC risk profiles) */}
            <div className="lg:col-span-2">
              {canViewOmcRisk ? (
                <div className="bg-white dark:bg-zinc-900/35 border border-zinc-200 dark:border-zinc-900 rounded-xl p-5 flex flex-col gap-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-bold text-zinc-800 dark:text-white uppercase tracking-wider">
                        Top Leaking OMCs
                      </h2>
                      <span className="bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase border border-zinc-200/65 dark:border-zinc-700/40">
                        Materiality &gt; KES {materiality.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {sortedOmcs.length === 0 ? (
                    <p className="text-xs text-zinc-500 italic py-8 text-center">
                      No leakages match the current materiality criteria.
                    </p>
                  ) : (
                    <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-900/60">
                      {sortedOmcs.map((omc) => (
                        <div
                          key={omc.customer}
                          className="flex justify-between items-center py-3.5 first:pt-0 last:pb-0"
                        >
                          <div>
                            <h3 className="text-sm font-bold text-zinc-855 dark:text-white">
                              {omc.customer}
                            </h3>
                            <p className="text-[10px] text-zinc-500 mt-0.5">
                              {omc.anomaly_count} anomalies detected across
                              gantry logs
                            </p>
                          </div>
                          <span className="text-sm font-bold text-rose-600 dark:text-rose-500 font-mono">
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

            {/* Right Column: Recent Uploads / Instruction card */}
            <div className="bg-white dark:bg-zinc-900/35 border border-zinc-200 dark:border-zinc-900 rounded-xl p-5 flex flex-col gap-4 min-h-[220px] justify-between shadow-sm">
              <div>
                <h2 className="text-sm font-bold text-zinc-800 dark:text-white uppercase tracking-wider">
                  Recent Uploads
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2 leading-relaxed">
                  Upload CSV to preview reconciliation data
                </p>
              </div>

              <div className="border-t border-zinc-100 dark:border-zinc-900 pt-4 mt-auto">
                <span className="text-[10px] text-zinc-500 font-medium block">
                  Data automatically reflected across all modules
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CSV Upload Overlay Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl w-full max-w-lg p-6 shadow-2xl relative">
            <button
              onClick={() => setShowUploadModal(false)}
              className="absolute top-4 right-4 text-zinc-450 hover:text-zinc-800 dark:hover:text-white p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
            <div className="mb-4">
              <h3 className="text-base font-bold text-zinc-900 dark:text-white">
                Upload reconciliation datasets
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Drag or select a custom Gantry waybill CSV to run custom checks
              </p>
            </div>
            <CsvUploadPanel
              materiality={materiality}
              onUploaded={handleUploaded}
            />
          </div>
        </div>
      )}
    </div>
  );
}
