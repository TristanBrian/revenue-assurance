"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiError, getFraudGraph } from "@/lib/api";
import type { FraudGraphData, GraphEdge, GraphNode, RiskLevel } from "@/lib/types";

type ViewMode = "pathways" | "matrix" | "focus";
type Pathway = { id: string; officer: GraphNode; beneficiary: GraphNode; edge: GraphEdge; risk: RiskLevel; community: number };
const rank: Record<RiskLevel, number> = { Low: 0, Medium: 1, High: 2 };

function formatKes(value: number) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(value);
}
function tone(risk: RiskLevel) {
  return risk === "High" ? "border-rose-200 bg-rose-50 text-rose-700" : risk === "Medium" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700";
}

export default function InukaRiskIntelligence() {
  const [graph, setGraph] = useState<FraudGraphData | null>(null);
  const [view, setView] = useState<ViewMode>("pathways");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getFraudGraph(0, "outbound").then((data) => { if (!cancelled) setGraph(data); }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load Inuka risk relationships.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const pathways = useMemo<Pathway[]>(() => {
    if (!graph) return [];
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    return graph.edges.flatMap((edge) => {
      const source = nodes.get(edge.source); const target = nodes.get(edge.target);
      if (!source || !target || source.type === target.type) return [];
      const officer = source.type === "officer" ? source : target.type === "officer" ? target : null;
      const beneficiary = source.type === "beneficiary" ? source : target.type === "beneficiary" ? target : null;
      if (!officer || !beneficiary) return [];
      const risk = rank[officer.risk_level] >= rank[beneficiary.risk_level] ? officer.risk_level : beneficiary.risk_level;
      return [{ id: `${officer.id}:${beneficiary.id}`, officer, beneficiary, edge, risk, community: beneficiary.community }];
    }).sort((a, b) => b.edge.weight - a.edge.weight || b.edge.anomaly_count - a.edge.anomaly_count);
  }, [graph]);

  const selected = pathways.find((item) => item.id === selectedId) ?? pathways[0] ?? null;
  const officers = useMemo(() => [...new Map(pathways.map((item) => [item.officer.id, item.officer])).values()].sort((a, b) => b.leakage_kes - a.leakage_kes).slice(0, 10), [pathways]);
  const beneficiaries = useMemo(() => [...new Map(pathways.map((item) => [item.beneficiary.id, item.beneficiary])).values()].sort((a, b) => b.leakage_kes - a.leakage_kes).slice(0, 12), [pathways]);
  const matrix = useMemo(() => new Map(pathways.map((item) => [`${item.officer.id}:${item.beneficiary.id}`, item])), [pathways]);
  const maxWeight = Math.max(1, ...pathways.map((item) => item.edge.weight));
  const connected = selected ? pathways.filter((item) => item.officer.id === selected.officer.id || item.beneficiary.id === selected.beneficiary.id).slice(0, 12) : [];

  function choose(item: Pathway, nextView: ViewMode = "focus") { setSelectedId(item.id); setView(nextView); }

  return <section className="flex flex-col gap-5">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Inuka programme assurance</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Risk pathways</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Prioritise officer-to-beneficiary relationships by amount at risk and anomaly concentration. Beneficiary names remain hidden until a case is opened.</p></div>
      <div className="flex rounded-lg border border-border bg-card p-1">{(["pathways", "matrix", "focus"] as ViewMode[]).map((item) => <button key={item} type="button" onClick={() => setView(item)} className={`rounded-md px-3 py-2 text-xs font-semibold capitalize ${view === item ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{item === "focus" ? "Focused relationship" : item}</button>)}</div>
    </header>

    {error && <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg p-4 text-sm text-status-critical">{error}</div>}
    {loading && <div className="flex justify-center p-16"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /></div>}
    {graph && !loading && <>
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Risk pathways" value={String(pathways.length)} />
        <Metric label="Officers linked" value={String(new Set(pathways.map((item) => item.officer.id)).size)} />
        <Metric label="Beneficiaries linked" value={String(new Set(pathways.map((item) => item.beneficiary.id)).size)} />
        <Metric label="Relationship exposure" value={formatKes(pathways.reduce((sum, item) => sum + item.edge.weight, 0))} />
      </div>

      {view === "pathways" && <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border p-4"><h2 className="text-sm font-bold text-foreground">Ranked officer–beneficiary pathways</h2><p className="mt-1 text-xs text-muted-foreground">A relationship is listed once even when several anomaly signals contribute to it.</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Officer</th><th className="px-4 py-3">Beneficiary ID</th><th className="px-4 py-3">Signals</th><th className="px-4 py-3">Amount at risk</th><th className="px-4 py-3">Risk</th><th className="px-4 py-3" /></tr></thead><tbody className="divide-y divide-border">{pathways.slice(0, 40).map((item) => <tr key={item.id} className="hover:bg-muted/20"><td className="px-4 py-3 font-mono font-semibold">{item.officer.id}</td><td className="px-4 py-3 font-mono font-semibold">{item.beneficiary.id}</td><td className="px-4 py-3">{item.edge.anomaly_count} control breaks</td><td className="px-4 py-3 font-mono font-bold text-status-critical">{formatKes(item.edge.weight)}</td><td className="px-4 py-3"><span className={`rounded-full border px-2 py-1 text-xs font-semibold ${tone(item.risk)}`}>{item.risk}</span></td><td className="px-4 py-3 text-right"><button type="button" onClick={() => choose(item)} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted">Inspect</button></td></tr>)}</tbody></table></div>
      </section>}

      {view === "matrix" && <section className="overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm"><h2 className="text-sm font-bold text-foreground">Officer × beneficiary risk matrix</h2><p className="mt-1 text-xs text-muted-foreground">Darker cells indicate greater amount at risk. Select a cell to inspect that relationship.</p><div className="mt-5 overflow-auto"><div className="grid min-w-[820px] gap-1" style={{ gridTemplateColumns: `110px repeat(${beneficiaries.length}, minmax(48px, 1fr))` }}><div />{beneficiaries.map((beneficiary) => <div key={beneficiary.id} className="-rotate-45 pb-4 text-[9px] font-mono text-muted-foreground">{beneficiary.id}</div>)}{officers.flatMap((officer) => [<div key={`${officer.id}-label`} className="flex items-center font-mono text-[11px] font-semibold">{officer.id}</div>, ...beneficiaries.map((beneficiary) => { const item = matrix.get(`${officer.id}:${beneficiary.id}`); const strength = item ? Math.max(.16, item.edge.weight / maxWeight) : 0; return <button key={`${officer.id}:${beneficiary.id}`} type="button" disabled={!item} title={item ? `${officer.id} → ${beneficiary.id}: ${formatKes(item.edge.weight)}` : "No observed risk pathway"} onClick={() => item && choose(item)} className="h-10 rounded border border-border disabled:bg-muted/30" style={item ? { backgroundColor: `color-mix(in srgb, var(--primary) ${Math.round(strength * 85)}%, white)` } : undefined}><span className="sr-only">{item ? formatKes(item.edge.weight) : "No relationship"}</span></button>; })])}</div></div></section>}

      {view === "focus" && <section className="grid gap-5 lg:grid-cols-3"><div className="rounded-xl border border-border bg-card p-5 shadow-sm lg:col-span-2"><h2 className="text-sm font-bold text-foreground">Focused relationship</h2>{selected ? <div className="mt-8 flex flex-col items-center"><div className="flex w-full max-w-xl items-center justify-between gap-4"><Entity type="Control actor" id={selected.officer.id} risk={selected.officer.risk_level} /><div className="flex flex-1 flex-col items-center"><span className="text-xs font-semibold text-status-critical">{formatKes(selected.edge.weight)}</span><div className="my-2 h-1 w-full rounded bg-primary"/><span className="text-[10px] text-muted-foreground">{selected.edge.anomaly_count} signals</span></div><Entity type="Beneficiary" id={selected.beneficiary.id} risk={selected.beneficiary.risk_level} /></div><div className="mt-8 w-full max-w-xl"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Related pathways</p><div className="mt-2 flex flex-wrap gap-2">{connected.map((item) => <button type="button" key={item.id} onClick={() => setSelectedId(item.id)} className={`rounded-lg border px-3 py-2 text-xs font-mono ${item.id === selected.id ? "border-primary bg-primary/5 text-primary" : "border-border hover:bg-muted"}`}>{item.officer.id} → {item.beneficiary.id}</button>)}</div></div></div> : <p className="py-16 text-center text-sm text-muted-foreground">Select a pathway from the ranked list or matrix.</p>}</div><aside className="rounded-xl border border-border bg-card p-5 shadow-sm"><h2 className="text-sm font-bold text-foreground">Investigation summary</h2>{selected && <div className="mt-4 space-y-4 text-sm"><Detail label="Officer" value={selected.officer.id}/><Detail label="Beneficiary ID" value={selected.beneficiary.id}/><Detail label="Community" value={`#${selected.community}`}/><Detail label="Amount at risk" value={formatKes(selected.edge.weight)}/><Detail label="Control signals" value={String(selected.edge.anomaly_count)}/><Link href="/dashboard/outbound/anomalies" className="block rounded-lg bg-primary px-4 py-3 text-center text-xs font-bold text-primary-foreground">Open assurance cases</Link></div>}</aside></section>}
    </>}
  </section>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-border bg-card p-4 shadow-sm"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-xl font-bold text-foreground">{value}</p></div>; }
function Detail({ label, value }: { label: string; value: string }) { return <div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 font-mono font-semibold text-foreground">{value}</p></div>; }
function Entity({ type, id, risk }: { type: string; id: string; risk: RiskLevel }) { return <div className="min-w-36 rounded-xl border border-border bg-muted/30 p-4 text-center"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{type}</p><p className="mt-2 font-mono text-sm font-bold text-foreground">{id}</p><span className={`mt-3 inline-block rounded-full border px-2 py-1 text-[10px] font-semibold ${tone(risk)}`}>{risk} risk</span></div>; }
