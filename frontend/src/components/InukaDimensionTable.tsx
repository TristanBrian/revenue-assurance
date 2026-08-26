"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, getInukaCases, getInukaOfficers, getInukaPillars } from "@/lib/api";
import type { InukaDimensionSummary, InukaRiskCase } from "@/lib/types";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(value);
}

export default function InukaDimensionTable({ dimension }: { dimension: "pillars" | "officers" }) {
  const router = useRouter();
  const [items, setItems] = useState<InukaDimensionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedOfficer, setSelectedOfficer] = useState<string | null>(null);
  const [officerCases, setOfficerCases] = useState<InukaRiskCase[]>([]);
  useEffect(() => {
    let cancelled = false;
    const request = dimension === "pillars" ? getInukaPillars() : getInukaOfficers();
    request.then((result) => { if (!cancelled) setItems(result); }).catch((err: unknown) => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load assurance summaries."); });
    return () => { cancelled = true; };
  }, [dimension]);
  useEffect(() => {
    if (!selectedOfficer || dimension !== "officers") return;
    getInukaCases({ officerId: selectedOfficer, page: 1, pageSize: 10 }).then((result) => setOfficerCases(result.cases)).catch(() => setOfficerCases([]));
  }, [dimension, selectedOfficer]);
  const label = dimension === "pillars" ? "Inuka pillar risk" : "Officer assurance";
  const description = dimension === "pillars" ? "Compare exposure and case concentration across the four official Inuka pillars." : "Review approval concentration and exception exposure by officer.";
  return <div className="flex flex-col gap-5 w-full max-w-[1700px] mx-auto"><header><p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Inuka assurance</p><h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">{label}</h1><p className="text-sm text-muted-foreground mt-1">{description}</p></header>{error && <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg p-4 text-sm text-status-critical">{error}</div>}<section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"><table className="w-full text-left text-sm"><thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">{dimension === "pillars" ? "Inuka pillar" : "Officer"}</th><th className="px-4 py-3">Cases</th><th className="px-4 py-3">Critical</th><th className="px-4 py-3">Amount at risk</th></tr></thead><tbody className="divide-y divide-border">{items.length === 0 ? <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">No assurance cases found.</td></tr> : items.map((item) => <tr key={item.id} onClick={() => dimension === "pillars" ? router.push(`/dashboard/inuka/anomalies?pillar=${encodeURIComponent(item.id)}`) : setSelectedOfficer(item.id)} className="cursor-pointer hover:bg-muted/30"><td className="px-4 py-3 font-semibold text-foreground">{item.id}</td><td className="px-4 py-3 text-muted-foreground">{item.case_count}</td><td className="px-4 py-3 text-status-critical">{item.critical_count}</td><td className="px-4 py-3 font-mono font-semibold text-foreground">{formatKes(item.amount_at_risk)}</td></tr>)}</tbody></table></section><p className="text-[11px] text-muted-foreground">{dimension === "pillars" ? "Select a pillar to open its scoped investigation queue." : "Select an officer to inspect the cases contributing to their assurance profile."}</p>{selectedOfficer && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" onClick={() => setSelectedOfficer(null)}><div className="w-full max-w-2xl rounded-xl border border-border bg-card p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between"><div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Officer assurance profile</p><h2 className="mt-1 text-xl font-bold text-foreground">{selectedOfficer}</h2></div><button onClick={() => setSelectedOfficer(null)} className="text-xl text-muted-foreground">×</button></div><p className="mt-4 text-sm text-muted-foreground">Cases currently attributed to this officer. These signals require human review and do not by themselves establish misconduct.</p><div className="mt-4 max-h-80 overflow-y-auto divide-y divide-border">{officerCases.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No cases found.</p> : officerCases.map((item) => <div key={item.case_id} className="py-3"><div className="flex justify-between gap-3"><span className="font-semibold text-foreground">{item.title}</span><span className="font-mono text-status-critical">{formatKes(item.amount_at_risk)}</span></div><p className="mt-1 text-xs text-muted-foreground">{item.reason}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{item.case_id}</p></div>)}</div><div className="mt-5 flex justify-end"><button onClick={() => setSelectedOfficer(null)} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Close officer details</button></div></div></div>}</div>;
}
