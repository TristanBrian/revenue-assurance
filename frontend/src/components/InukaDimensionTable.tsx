"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, getInukaOfficers, getInukaPillars } from "@/lib/api";
import type { InukaDimensionSummary } from "@/lib/types";

const formatKes = (value: number) => new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(value);
export default function InukaDimensionTable({ dimension }: { dimension: "pillars" | "officers" }) {
  const [items, setItems] = useState<InukaDimensionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("exposure");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    const request = dimension === "pillars" ? getInukaPillars() : getInukaOfficers();
    request.then((result) => { if (!cancelled) setItems(result); }).catch((err: unknown) => { if (!cancelled) { setItems([]); setError(err instanceof ApiError ? err.message : "Could not load assurance summaries."); } }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dimension, refresh]);
  const isPillar = dimension === "pillars";
  const rows = items.filter((item) => item.id.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === "critical" ? b.critical_count - a.critical_count : sort === "cases" ? b.case_count - a.case_count : b.amount_at_risk - a.amount_at_risk);
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
    <header><p className="text-xs font-semibold uppercase tracking-widest text-primary">Inuka program assurance</p><h1 className="mt-2 text-3xl font-bold tracking-tight">{isPillar ? "Programs & pillars" : "Field officers"}</h1><p className="mt-2 text-sm text-muted-foreground">{isPillar ? "Compare case concentration and financial exposure across Inuka pillars." : "Review case concentration and financial exposure by officer. Signals require human review."}</p></header>
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
      <label className="flex min-w-48 flex-1 flex-col gap-2 text-sm font-medium">{isPillar ? "Find a pillar" : "Find an officer"}<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={isPillar ? "Search pillar ID…" : "Search officer ID…"} className="rounded-lg border border-border bg-background px-3 py-2" /></label>
      <label className="flex flex-col gap-2 text-sm font-medium">Sort by<select value={sort} onChange={(event) => setSort(event.target.value)} className="rounded-lg border border-border bg-background px-3 py-2"><option value="exposure">Highest exposure</option><option value="critical">Critical cases</option><option value="cases">Total cases</option></select></label>
      <button disabled={loading} onClick={() => setRefresh((value) => value + 1)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">Refresh</button>
    </div>
    {error && <p role="alert" className="rounded-xl border border-status-critical/30 bg-status-critical-bg p-4 text-sm text-status-critical">{error}</p>}
    <section className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[540px] text-left text-sm"><caption className="p-4 text-left text-muted-foreground">{loading ? "Loading assurance summaries…" : `${rows.length} ${isPillar ? "pillars" : "officers"} · Select an ID to inspect its cases`}</caption><thead className="border-y border-border bg-muted/40 text-muted-foreground"><tr><th className="px-4">{isPillar ? "Pillar" : "Officer"}</th><th className="px-4 text-right">Cases</th><th className="px-4 text-right">Critical</th><th className="px-4 text-right">Amount at risk</th></tr></thead><tbody className="divide-y divide-border">{!loading && !error && rows.length === 0 ? <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">{query ? "No matching records. Try another ID." : "No assurance summaries available."}</td></tr> : rows.map((item) => <tr key={item.id}><td className="px-4"><Link className="font-semibold text-primary underline-offset-4 hover:underline" href={`/dashboard/outbound/anomalies/${encodeURIComponent(item.id)}?by=${isPillar ? "pillar" : "officer"}`}>{item.id} ↗</Link></td><td className="px-4 text-right tabular-nums">{item.case_count}</td><td className="px-4 text-right tabular-nums text-status-critical">{item.critical_count}</td><td className="px-4 text-right font-semibold tabular-nums">{formatKes(item.amount_at_risk)}</td></tr>)}</tbody></table>
    </section>
  </div>;
}
