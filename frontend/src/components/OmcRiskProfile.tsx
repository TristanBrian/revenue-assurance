"use client";

import { useEffect, useState } from "react";
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
      return "bg-status-critical-bg text-status-critical";
    case "Medium":
      return "bg-status-medium-bg text-status-medium";
    default:
      return "bg-status-low-bg text-status-low";
  }
}

function timelineDotClass(status: Anomaly["status"]): string {
  switch (status) {
    case "Critical":
      return "bg-status-critical";
    case "Review Required":
      return "bg-status-medium";
    case "Resolved":
      return "bg-status-low";
    default:
      return "bg-muted-foreground";
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      try {
        const data = await getAnomalies(0, 1, 100);
        if (cancelled) return;
        setAnomalies(data.anomalies.filter((a) => a.customer === omc.customer));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load timeline data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [omc.customer]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between border-b border-border bg-muted/40 p-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">OMC Risk Profile</span>
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${riskBadgeClass(omc.risk_level)}`}>
                {omc.risk_level} Risk
              </span>
            </div>
            <h3 className="mt-1 text-xl font-bold text-foreground">{omc.customer}</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-center">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total Identified Leakage</p>
              <p className="mt-1 font-mono text-base font-bold text-status-critical">{formatKes(omc.leakage_kes)}</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-center">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Active Anomalies</p>
              <p className="mt-1 font-mono text-base font-bold text-foreground">{omc.anomaly_count}</p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Waybill Timeline</h4>

            {loading && (
              <div className="flex items-center justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-ring/30 border-t-ring"></div>
              </div>
            )}

            {error && <p className="text-xs text-status-critical">{error}</p>}

            {!loading && !error && anomalies.length === 0 && (
              <p className="py-4 text-xs italic text-muted-foreground">No active anomalies registered for this OMC.</p>
            )}

            {!loading && !error && anomalies.length > 0 && (
              <div className="relative flex flex-col gap-5 border-l border-border py-2 pl-4">
                {anomalies.map((a, i) => (
                  <div key={`${a.dispatch_id}-${i}`} className="relative flex flex-col gap-1">
                    <div className={`absolute -left-[21px] top-1.5 h-3 w-3 rounded-full border-2 border-card ${timelineDotClass(a.status)}`}></div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-foreground/90">
                        {a.break_type} ({a.product})
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">{a.age_days}d ago</span>
                    </div>

                    <div className="mt-1 flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 p-2.5">
                      <div className="flex flex-col">
                        <span className="text-[9px] font-bold uppercase text-muted-foreground">Waybill ID</span>
                        <span className="mt-0.5 font-mono text-xs text-foreground/80">{a.dispatch_id}</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-[9px] font-bold uppercase text-muted-foreground">Gap Leakage</span>
                        <span className="mt-0.5 font-mono text-xs font-bold text-status-critical">{formatKes(a.leakage_kes)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end border-t border-border bg-muted/40 p-4">
          <button
            onClick={onClose}
            className="rounded-md bg-muted px-4 py-2 text-xs font-semibold text-foreground/90 transition-colors hover:bg-accent"
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
      <div className="rounded-lg border border-border bg-muted/40 p-8 text-center">
        <p className="text-sm text-muted-foreground">No OMC risk data available.</p>
      </div>
    );
  }

  const sorted = [...profiles].sort((a, b) => b.leakage_kes - a.leakage_kes);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-bold text-foreground">OMC Customer Risk Matrix</h2>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3">
        {sorted.map((p) => (
          <div
            key={p.customer}
            onClick={() => setSelectedOmc(p)}
            className="group cursor-pointer rounded-xl border border-border bg-card p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-ring hover:shadow-md active:translate-y-0"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="flex-1 truncate text-sm font-bold text-foreground/90 group-hover:text-foreground">
                {p.customer}
              </h3>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${riskBadgeClass(p.risk_level)}`}>
                {p.risk_level}
              </span>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Identified Leakage</span>
                <span className="mt-0.5 font-mono text-sm font-extrabold text-foreground">
                  {formatKes(p.leakage_kes)}
                </span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Anomalies</span>
                <span className="mt-0.5 text-sm font-semibold text-muted-foreground">{p.anomaly_count} breaks</span>
              </div>
            </div>

            <div className="mt-3.5 flex items-center justify-end border-t border-border pt-2 text-[10px] font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100">
              <span>View Timeline →</span>
            </div>
          </div>
        ))}
      </div>

      {selectedOmc && <DrilldownModal omc={selectedOmc} onClose={() => setSelectedOmc(null)} />}
    </section>
  );
}
