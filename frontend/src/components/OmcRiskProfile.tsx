"use client";

import { useState } from "react";
import { ApiError, getAnomalies } from "@/lib/api";
import type { Anomaly, OmcRiskProfile as OmcRiskProfileEntry } from "@/lib/types";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

function riskBadgeClass(risk: OmcRiskProfileEntry["risk_level"]): string {
  switch (risk) {
    case "High":
      return "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 shadow-[0_0_15px_rgba(244,63,94,0.08)]";
    case "Medium":
      return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20";
    default:
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20";
  }
}

interface DrilldownModalProps {
  omc: OmcRiskProfileEntry;
  onClose: () => void;
}

function DrilldownModal({ omc, onClose }: DrilldownModalProps) {
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch anomalies for this OMC on mount to construct the waybill timeline
  useState(() => {
    getAnomalies(0, 1, 100)
      .then((data) => {
        // Filter anomalies belonging to this customer
        const filtered = data.anomalies.filter((a) => a.customer === omc.customer);
        setAnomalies(filtered);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Could not load timeline data.");
      })
      .finally(() => {
        setLoading(false);
      });
  });

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto animate-fade-in">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh] transition-all">
        {/* Modal Header */}
        <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-start bg-zinc-50 dark:bg-zinc-950/40">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">OMC Profile Gantry Analysis</span>
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${riskBadgeClass(omc.risk_level)}`}>
                {omc.risk_level} Risk
              </span>
            </div>
            <h3 className="text-xl font-bold text-zinc-900 dark:text-white mt-1">{omc.customer}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-850 dark:text-zinc-400 dark:hover:text-white p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6">
          {/* Quick Metrics Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-zinc-50 dark:bg-zinc-950/40 border border-zinc-200 dark:border-zinc-800/60 rounded-lg p-3 text-center shadow-sm">
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Total Identified Leakage</p>
              <p className="text-base font-bold text-rose-600 dark:text-rose-400 font-mono mt-1">{formatKes(omc.leakage_kes)}</p>
            </div>
            <div className="bg-zinc-50 dark:bg-zinc-950/40 border border-zinc-200 dark:border-zinc-800/60 rounded-lg p-3 text-center shadow-sm">
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Active Anomalies</p>
              <p className="text-base font-bold text-zinc-900 dark:text-white font-mono mt-1">{omc.anomaly_count}</p>
            </div>
          </div>

          {/* Timeline Section */}
          <div className="flex flex-col gap-3">
            <h4 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Waybill Gantry Timeline</h4>
            
            {loading && (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
              </div>
            )}

            {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}

            {!loading && !error && anomalies.length === 0 && (
              <p className="text-xs text-zinc-500 italic py-4">No active anomalies registered for this OMC.</p>
            )}

            {!loading && !error && anomalies.length > 0 && (
              <div className="relative border-l border-zinc-200 dark:border-zinc-800 pl-4 py-2 flex flex-col gap-5">
                {anomalies.map((a, i) => (
                  <div key={`${a.dispatch_id}-${i}`} className="relative flex flex-col gap-1">
                    {/* Timeline Node Dot */}
                    <div className={`absolute -left-[21px] top-1.5 w-3 h-3 rounded-full border-2 border-white dark:border-zinc-900 ${
                      a.status === "Critical" ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]" :
                      a.status === "Review Required" ? "bg-amber-500" :
                      a.status === "Resolved" ? "bg-emerald-500" :
                      "bg-zinc-500"
                    }`}></div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                        {a.break_type} ({a.product})
                      </span>
                      <span className="text-zinc-500 font-mono text-[10px]">
                        {a.age_days}d ago
                      </span>
                    </div>

                    <div className="bg-zinc-50 dark:bg-zinc-950/20 border border-zinc-200 dark:border-zinc-800/80 rounded-lg p-2.5 flex items-center justify-between gap-4 mt-1">
                      <div className="flex flex-col">
                        <span className="text-[9px] text-zinc-500 font-bold uppercase">Waybill ID</span>
                        <span className="text-xs text-zinc-600 dark:text-zinc-300 font-mono mt-0.5">{a.dispatch_id}</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-[9px] text-zinc-500 font-bold uppercase">Gap Leakage</span>
                        <span className="text-xs text-rose-600 dark:text-rose-400 font-bold font-mono mt-0.5">{formatKes(a.leakage_kes)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/30 flex justify-end">
          <button
            onClick={onClose}
            className="rounded bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            Close Details
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OmcRiskProfile({ profiles }: { profiles: OmcRiskProfileEntry[] }) {
  const [selectedOmc, setSelectedOmc] = useState<OmcRiskProfileEntry | null>(null);

  if (profiles.length === 0) {
    return (
      <div className="bg-zinc-50 dark:bg-zinc-900/30 border border-zinc-200 dark:border-zinc-800 rounded-lg p-8 text-center shadow-sm">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No OMC risk data available.</p>
      </div>
    );
  }

  const sorted = [...profiles].sort((a, b) => b.leakage_kes - a.leakage_kes);

  return (
    <section className="flex flex-col gap-4 text-zinc-800 dark:text-zinc-100">
      <h2 className="text-lg font-bold text-zinc-900 dark:text-white">OMC Customer Risk Matrix</h2>
      
      {/* Clickable Cards Grid Layout */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
        {sorted.map((p) => (
          <div
            key={p.customer}
            onClick={() => setSelectedOmc(p)}
            className="group cursor-pointer rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/30 hover:bg-zinc-50 dark:hover:bg-zinc-900/60 p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 border-l-4 border-l-indigo-500 hover:border-l-indigo-400"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-200 group-hover:text-zinc-900 group-hover:dark:text-white truncate flex-1">
                {p.customer}
              </h3>
              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold shrink-0 ${riskBadgeClass(p.risk_level)}`}>
                {p.risk_level}
              </span>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">Identified Leakage</span>
                <span className="text-sm font-extrabold text-zinc-900 dark:text-white font-mono mt-0.5">
                  {formatKes(p.leakage_kes)}
                </span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">Anomalies</span>
                <span className="text-sm font-semibold text-zinc-500 dark:text-zinc-300 mt-0.5">
                  {p.anomaly_count} breaks
                </span>
              </div>
            </div>
            
            <div className="mt-3.5 border-t border-zinc-200 dark:border-zinc-800/80 pt-2 flex items-center justify-end text-[10px] text-indigo-650 dark:text-indigo-400 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
              <span>View Timeline →</span>
            </div>
          </div>
        ))}
      </div>

      {/* Drill-down Timeline Modal */}
      {selectedOmc && (
        <DrilldownModal
          omc={selectedOmc}
          onClose={() => setSelectedOmc(null)}
        />
      )}
    </section>
  );
}
