"use client";

import { useEffect, useState } from "react";
import { ApiError, getAnomalies } from "@/lib/api";
import type { Anomaly } from "@/lib/types";
import { useMateriality } from "@/context/MaterialityContext";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(value);
}

export default function InukaAnomaliesPage() {
  const { materiality } = useMateriality();
  const [items, setItems] = useState<Anomaly[]>([]);
  const [status, setStatus] = useState("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => setLoading(true));
    getAnomalies(materiality, 1, 100, { status: status === "All" ? undefined : status }, "outbound")
      .then((result) => { if (!cancelled) setItems(result.anomalies); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load payout anomalies."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [materiality, status]);

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto">
      <header><h1 className="text-2xl font-bold tracking-tight text-foreground">Payout anomalies</h1><p className="text-sm text-muted-foreground mt-1">Attendance, authorization, beneficiary, officer, and disbursement controls.</p></header>
      <div className="flex justify-end"><select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"><option>All</option><option>Critical</option><option>Pending</option><option>Review Required</option><option>Resolved</option></select></div>
      {error && <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg p-4 text-sm text-status-critical">{error}</div>}
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Beneficiary</th><th className="px-4 py-3">Officer</th><th className="px-4 py-3">Control failure</th><th className="px-4 py-3">Amount exposed</th><th className="px-4 py-3">Status</th></tr></thead><tbody className="divide-y divide-border">{loading ? <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">Loading payout anomalies…</td></tr> : items.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No payout anomalies match the selected filter.</td></tr> : items.map((item) => <tr key={`${item.dispatch_id}-${item.break_type}`}><td className="px-4 py-3 font-medium text-foreground">{item.beneficiary_id || "Unknown"}<div className="text-[10px] font-normal text-muted-foreground">{item.dispatch_id}</div></td><td className="px-4 py-3 text-muted-foreground">{item.officer_id || "Unassigned"}</td><td className="px-4 py-3 text-foreground">{item.break_type}</td><td className="px-4 py-3 font-mono font-semibold text-status-critical">{formatKes(item.leakage_kes)}</td><td className="px-4 py-3 text-muted-foreground">{item.status}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}
