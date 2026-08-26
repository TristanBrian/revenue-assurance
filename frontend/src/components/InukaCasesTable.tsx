"use client";

import { useEffect, useState } from "react";
import { ApiError, getInukaCases } from "@/lib/api";
import type { InukaRiskCase } from "@/lib/types";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(value);
}

function badgeClass(value: string): string {
  if (value === "Critical" || value === "Likely Fraud") return "border-rose-200 bg-rose-50 text-rose-700";
  if (value === "Suspicious" || value === "Review Required") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

export default function InukaCasesTable({
  scopeParams,
  title = "Payment assurance cases",
  subtitle = "Grouped control signals requiring beneficiary and disbursement review.",
  onSelect,
}: {
  scopeParams?: { pillarId?: string; officerId?: string };
  title?: string;
  subtitle?: string;
  onSelect: (item: InukaRiskCase) => void;
}) {
  const [items, setItems] = useState<InukaRiskCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [signal, setSignal] = useState("All");
  const [status, setStatus] = useState("All");
  const [tier, setTier] = useState("All");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, total_pages: 1 });
  const [summary, setSummary] = useState({ case_count: 0, critical_count: 0, review_count: 0, amount_at_risk: 0 });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await getInukaCases({
        page,
        pageSize: 25,
        search: search || undefined,
        status: status === "All" ? undefined : status,
        riskType: signal === "All" ? undefined : signal,
        pillarId: scopeParams?.pillarId,
        officerId: scopeParams?.officerId,
      });
      const filtered = tier === "All" ? result.cases : result.cases.filter((item) => item.fraud_tier === tier);
      setItems(filtered);
      setPagination({ total: result.pagination.total, total_pages: Math.max(1, result.pagination.total_pages) });
      setSummary(result.summary);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not retrieve Inuka assurance cases.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // load is intentionally recreated with the active query state below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, signal, status, tier, scopeParams?.pillarId, scopeParams?.officerId]);

  const signalOptions = [{ value: "ghost_payment", label: "Ghost payment" }, { value: "duplicate_payment", label: "Duplicate payment" }, { value: "missing_authorization", label: "Missing authorization" }, { value: "missing_disbursement", label: "Missing disbursement" }, { value: "overpayment", label: "Overpayment" }, { value: "underpayment", label: "Underpayment" }, { value: "ghost_beneficiary", label: "Ghost beneficiary" }, { value: "inactive_beneficiary", label: "Inactive beneficiary" }, { value: "shared_payment_account", label: "Shared payment account" }, { value: "weak_participation_evidence", label: "Participation evidence not verified" }];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 text-zinc-800 dark:text-zinc-100">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">Inuka programme assurance</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{title}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40"><p className="text-[10px] font-semibold uppercase text-zinc-500">Open cases</p><p className="mt-1 text-2xl font-bold">{summary.case_count.toLocaleString()}</p></div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40"><p className="text-[10px] font-semibold uppercase text-zinc-500">Critical cases</p><p className="mt-1 text-2xl font-bold text-rose-600">{summary.critical_count.toLocaleString()}</p></div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40"><p className="text-[10px] font-semibold uppercase text-zinc-500">Amount at risk</p><p className="mt-1 font-mono text-2xl font-bold">{formatKes(summary.amount_at_risk)}</p></div>
      </div>

      <div className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40 md:grid-cols-[1fr_190px_150px_170px]">
        <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search case, beneficiary ID, disbursement ID..." className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-800 dark:bg-zinc-950" />
        <select value={signal} onChange={(event) => { setSignal(event.target.value); setPage(1); }} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"><option value="All">All signals</option>{signalOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"><option value="All">All statuses</option><option>Critical</option><option>Review Required</option><option>Open</option></select>
        <select value={tier} onChange={(event) => { setTier(event.target.value); setPage(1); }} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"><option value="All">All fraud tiers</option><option>Likely Fraud</option><option>Suspicious</option><option>Likely Benign</option></select>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}
      {loading ? <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40">Loading assurance cases…</div> : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/40"><tr><th className="px-4 py-3">Case</th><th className="px-4 py-3">Beneficiary ID</th><th className="px-4 py-3">Signals</th><th className="px-4 py-3">Amount at risk</th><th className="px-4 py-3">Fraud score</th><th className="px-4 py-3">Status</th></tr></thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {items.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-zinc-500">No cases match the selected filters.</td></tr> : items.map((item) => (
                  <tr key={item.case_id} onClick={() => onSelect(item)} className="cursor-pointer hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20">
                    <td className="px-4 py-4"><p className="font-mono font-semibold text-zinc-900 dark:text-white">{item.primary_record_id || item.case_id}</p><p className="mt-1 text-xs text-zinc-500">{item.pillar_id || "Unassigned pillar"}</p></td>
                    <td className="px-4 py-4 font-mono font-semibold">{item.beneficiary_id || "Unavailable"}</td>
                    <td className="max-w-[320px] px-4 py-4"><div className="flex flex-wrap gap-1.5">{item.signal_types.map((label) => <span key={label} className="rounded-full border border-zinc-200 px-2 py-1 text-[11px] dark:border-zinc-700">{label}</span>)}</div></td>
                    <td className="px-4 py-4 font-mono font-semibold">{formatKes(item.amount_at_risk)}</td>
                    <td className="px-4 py-4"><span className={"rounded-full border px-2 py-1 text-xs font-semibold " + badgeClass(item.fraud_tier)}>{item.fraud_score}</span><p className="mt-1 text-[11px] text-zinc-500">{item.confidence} confidence</p></td>
                    <td className="px-4 py-4"><span className={"rounded-full border px-2 py-1 text-xs font-semibold " + badgeClass(item.severity)}>{item.review_status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-zinc-200 px-4 py-3 text-xs dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between"><span className="text-zinc-500">Showing {items.length ? (page - 1) * 25 + 1 : 0}–{Math.min(page * 25, pagination.total)} of {pagination.total.toLocaleString()} cases</span><div className="flex items-center gap-2"><button disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-md border border-zinc-200 px-3 py-1.5 font-semibold disabled:opacity-40 dark:border-zinc-700">Previous</button><span className="min-w-20 text-center font-mono">Page {page} / {pagination.total_pages}</span><button disabled={page >= pagination.total_pages || loading} onClick={() => setPage((value) => Math.min(pagination.total_pages, value + 1))} className="rounded-md border border-zinc-200 px-3 py-1.5 font-semibold disabled:opacity-40 dark:border-zinc-700">Next</button></div></div>
        </div>
      )}
    </div>
  );
}

