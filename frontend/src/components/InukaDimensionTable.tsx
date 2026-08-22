"use client";

import { useEffect, useState } from "react";
import { ApiError, getInukaOfficers, getInukaPillars } from "@/lib/api";
import type { InukaDimensionSummary } from "@/lib/types";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(value);
}

export default function InukaDimensionTable({ dimension }: { dimension: "pillars" | "officers" }) {
  const [items, setItems] = useState<InukaDimensionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const request = dimension === "pillars" ? getInukaPillars() : getInukaOfficers();
    request.then((result) => { if (!cancelled) setItems(result); }).catch((err: unknown) => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load assurance summaries."); });
    return () => { cancelled = true; };
  }, [dimension]);
  const label = dimension === "pillars" ? "Inuka pillar risk" : "Officer assurance";
  const description = dimension === "pillars" ? "Compare exposure and case concentration across the four official Inuka pillars." : "Review approval concentration and exception exposure by officer.";
  return <div className="flex flex-col gap-5 max-w-6xl mx-auto"><header><p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Inuka assurance</p><h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">{label}</h1><p className="text-sm text-muted-foreground mt-1">{description}</p></header>{error && <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg p-4 text-sm text-status-critical">{error}</div>}<section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"><table className="w-full text-left text-sm"><thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">{dimension === "pillars" ? "Inuka pillar" : "Officer"}</th><th className="px-4 py-3">Cases</th><th className="px-4 py-3">Critical</th><th className="px-4 py-3">Amount at risk</th></tr></thead><tbody className="divide-y divide-border">{items.length === 0 ? <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">No assurance cases found.</td></tr> : items.map((item) => <tr key={item.id}><td className="px-4 py-3 font-semibold text-foreground">{item.id}</td><td className="px-4 py-3 text-muted-foreground">{item.case_count}</td><td className="px-4 py-3 text-status-critical">{item.critical_count}</td><td className="px-4 py-3 font-mono font-semibold text-foreground">{formatKes(item.amount_at_risk)}</td></tr>)}</tbody></table></section></div>;
}
