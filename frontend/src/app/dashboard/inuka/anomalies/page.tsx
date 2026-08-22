"use client";

import { useEffect, useState } from "react";
import { ApiError, getInukaCases } from "@/lib/api";
import Link from "next/link";
import type { InukaRiskCase } from "@/lib/types";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(value);
}

export default function InukaAnomaliesPage() {
  const [items, setItems] = useState<InukaRiskCase[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [status, setStatus] = useState("");
  const [riskType, setRiskType] = useState("");
  const [search, setSearch] = useState("");
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getInukaCases({ page, pageSize, status: status || undefined, riskType: riskType || undefined, search: search || undefined })
      .then((result) => {
        if (cancelled) return;
        setItems(result.cases);
        setTotal(result.pagination.total);
        setTotalPages(result.pagination.total_pages);
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load assurance cases."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, pageSize, status, riskType, search]);

  return (
    <div className="flex flex-col gap-5 max-w-6xl mx-auto">
      <header><p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Investigation queue</p><h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">Inuka assurance cases</h1><p className="text-sm text-muted-foreground mt-1">Every case includes the control failure, evidence confidence, source records, and amount at risk.</p></header>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_180px_210px_110px] gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        <input value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder="Search beneficiary, officer, case, program…" className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
        <select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"><option value="">All severity</option><option value="Critical">Critical</option><option value="Review Required">Review Required</option></select>
        <select value={riskType} onChange={(event) => { setPage(1); setRiskType(event.target.value); }} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"><option value="">All control types</option><option value="ghost_beneficiary">Ghost beneficiary</option><option value="shared_payment_account">Shared payment account</option><option value="weak_participation_evidence">Weak participation evidence</option><option value="duplicate_payment">Duplicate payment</option><option value="overpayment">Overpayment</option><option value="underpayment">Underpayment</option></select>
        <select value={pageSize} onChange={(event) => { setPage(1); setPageSize(Number(event.target.value)); }} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"><option value={25}>25 / page</option><option value={50}>50 / page</option><option value={100}>100 / page</option></select>
      </div>
      {error && <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg p-4 text-sm text-status-critical">{error}</div>}
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Case</th><th className="px-4 py-3">Beneficiary / officer</th><th className="px-4 py-3">Evidence</th><th className="px-4 py-3">Amount at risk</th><th className="px-4 py-3">Score</th><th className="px-4 py-3">Severity</th></tr></thead><tbody className="divide-y divide-border">{loading ? <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">Loading assurance cases…</td></tr> : items.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No cases match the selected filters.</td></tr> : items.map((item) => <tr key={item.case_id} className="hover:bg-muted/20"><td className="px-4 py-3"><p className="font-semibold text-foreground">{item.title}</p><p className="mt-1 max-w-[260px] text-[11px] text-muted-foreground">{item.reason}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{item.case_id}</p></td><td className="px-4 py-3">{item.beneficiary_id ? <Link href={`/dashboard/inuka/beneficiaries/${encodeURIComponent(item.beneficiary_id)}`} className="font-medium text-primary hover:underline">{item.beneficiary_id}</Link> : <p className="text-foreground">—</p>}<p className="mt-1 text-[11px] text-muted-foreground">Officer {item.officer_id || "unassigned"}</p><p className="text-[11px] text-muted-foreground">{item.program_id || "Program unassigned"}</p></td><td className="px-4 py-3"><span className="rounded-full bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground">{item.confidence} confidence</span><p className="mt-2 text-[11px] text-muted-foreground">{item.source_records.length} source record{item.source_records.length === 1 ? "" : "s"}</p></td><td className="px-4 py-3 font-mono font-semibold text-status-critical">{formatKes(item.amount_at_risk)}</td><td className="px-4 py-3 font-mono font-semibold text-foreground">{item.risk_score}/100</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${item.severity === "Critical" ? "bg-status-critical-bg text-status-critical" : "bg-status-medium-bg text-status-medium"}`}>{item.severity}</span></td></tr>)}</tbody></table></div>
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground"><span>{total.toLocaleString()} cases · page {totalPages ? page : 0} of {totalPages}</span><div className="flex gap-2"><button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)} className="rounded-md border border-border px-3 py-1.5 disabled:opacity-40">Previous</button><button disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)} className="rounded-md border border-border px-3 py-1.5 disabled:opacity-40">Next</button></div></div>
      </section>
      <p className="text-[11px] text-muted-foreground">A case is a review signal, not a final fraud determination. Confirm the underlying records before taking beneficiary action.</p>
    </div>
  );
}
