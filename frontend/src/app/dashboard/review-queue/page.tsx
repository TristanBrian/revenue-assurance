"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, getAnomalies, getInukaCases } from "@/lib/api";
import type { Anomaly, InukaRiskCase } from "@/lib/types";
import InukaCaseModal from "@/components/InukaCaseModal";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(value);
}

export default function ReviewQueuePage() {
  const [oilCases, setOilCases] = useState<Anomaly[]>([]);
  const [inukaCases, setInukaCases] = useState<InukaRiskCase[]>([]);
  const [selectedInukaCase, setSelectedInukaCase] = useState<InukaRiskCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getAnomalies(100000, 1, 8, { status: "Critical" }, "inbound"),
      getInukaCases({ page: 1, pageSize: 8, status: "Critical" }),
    ])
      .then(([oilResult, inukaResult]) => {
        if (cancelled) return;
        setOilCases(oilResult.anomalies);
        setInukaCases(inukaResult.cases);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load the review queue.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-[1700px] flex-col gap-6">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Shared assurance workspace</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">My review queue</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">A triage view across Oil Revenue and Inuka Programs. Each case remains in its own domain for investigation and action.</p>
      </header>

      {error && <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg p-4 text-sm text-status-critical">{error}</div>}
      {loading ? (
        <div className="flex items-center justify-center rounded-xl border border-border bg-card p-12"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /></div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
              <div><p className="text-[10px] font-semibold uppercase tracking-wide text-status-info">Oil Revenue</p><h2 className="mt-1 text-lg font-bold text-foreground">Critical revenue controls</h2><p className="mt-1 text-xs text-muted-foreground">Dispatch, invoice, and settlement exceptions.</p></div>
              <Link href="/dashboard/anomalies" className="text-xs font-semibold text-primary hover:underline">Open oil queue</Link>
            </div>
            <div className="divide-y divide-border">
              {oilCases.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No critical oil cases.</p> : oilCases.map((item) => <Link key={item.dispatch_id} href="/dashboard/anomalies" className="flex items-center justify-between gap-3 py-3 hover:bg-muted/30"><div className="min-w-0"><p className="truncate text-sm font-semibold text-foreground">{item.break_type}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{item.customer} · {item.dispatch_id}</p></div><span className="shrink-0 font-mono text-sm font-semibold text-status-critical">{formatKes(item.leakage_kes)}</span></Link>)}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
              <div><p className="text-[10px] font-semibold uppercase tracking-wide text-primary">Inuka Programs</p><h2 className="mt-1 text-lg font-bold text-foreground">Critical program cases</h2><p className="mt-1 text-xs text-muted-foreground">Beneficiary, evidence, authorization, and payment exceptions.</p></div>
              <Link href="/dashboard/inuka/programs" className="text-xs font-semibold text-primary hover:underline">Open pillars</Link>
            </div>
            <div className="divide-y divide-border">
              {inukaCases.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No critical Inuka cases.</p> : inukaCases.map((item) => <button type="button" key={item.case_id} onClick={() => setSelectedInukaCase(item)} className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-muted/30"><div className="min-w-0"><p className="truncate text-sm font-semibold text-foreground">{item.title}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{item.pillar_id || "Unassigned pillar"} · {item.beneficiary_id || "Unknown beneficiary"}</p></div><span className="shrink-0 font-mono text-sm font-semibold text-status-critical">{formatKes(item.amount_at_risk)}</span></button>)}
            </div>
          </section>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">The queue prioritizes review; it does not merge Oil and Inuka data into a single risk model. Use the domain link to investigate and take the permitted action.</p>
      {selectedInukaCase && <InukaCaseModal item={selectedInukaCase} onClose={() => setSelectedInukaCase(null)} />}
    </div>
  );
}
