"use client";

import { useEffect, useState } from "react";
import { ApiError, getBeneficiaryConsents, getInukaStreamStatus } from "@/lib/api";
import type { BeneficiaryConsent, InukaStreamStatus } from "@/lib/types";

const statusClass: Record<string, string> = {
  Active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Pending: "bg-amber-50 text-amber-700 border-amber-200",
  Withdrawn: "bg-rose-50 text-rose-700 border-rose-200",
  Expired: "bg-zinc-100 text-zinc-600 border-zinc-200",
};

export default function ConsentPrivacyPage() {
  const [items, setItems] = useState<BeneficiaryConsent[]>([]);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<InukaStreamStatus | null>(null);

  useEffect(() => {
    getInukaStreamStatus().then(setStream).catch(() => undefined);
    let cancelled = false;
    setLoading(true);
    getBeneficiaryConsents({ page: 1, pageSize: 100, status: status || undefined, search: search || undefined })
      .then((result) => { if (!cancelled) setItems(result.items); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load consent records."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [status, search]);

  return <div className="mx-auto flex max-w-6xl flex-col gap-6">
    <header><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Inuka programme assurance</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Beneficiary consent & privacy</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">Verify whether participation evidence may be used for programme operations, donor reporting, SMS, or photography. Names are intentionally absent from this operational register.</p></header>
    {stream && <section className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-wide text-blue-700">Live data fabric</p><p className="mt-1 text-sm font-semibold text-foreground">{stream.mode.replaceAll("_", " ")}</p><p className="mt-1 text-xs text-muted-foreground">{stream.events_received} events received across {stream.pillars.join(", ")} · contract: {stream.source_contract}</p></div><span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">Connected</span></div></section>}
    <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-border bg-card p-4 shadow-sm"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Records shown</p><p className="mt-1 text-2xl font-bold text-foreground">{items.length}</p></div><div className="rounded-xl border border-border bg-card p-4 shadow-sm"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Export allowed</p><p className="mt-1 text-2xl font-bold text-emerald-600">{items.filter((item) => item.anonymised_export_allowed).length}</p></div><div className="rounded-xl border border-border bg-card p-4 shadow-sm"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Needs attention</p><p className="mt-1 text-2xl font-bold text-amber-600">{items.filter((item) => item.status !== "Active").length}</p></div></div>
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap gap-3 border-b border-border p-4"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search beneficiary ID or consent ID" className="min-w-64 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" /><select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm"><option value="">All statuses</option><option>Active</option><option>Pending</option><option>Withdrawn</option><option>Expired</option></select></div>
      {error && <p className="p-5 text-sm text-status-critical">{error}</p>}
      {loading ? <div className="p-12 text-center text-sm text-muted-foreground">Loading consent register…</div> : items.length === 0 ? <div className="p-12 text-center text-sm text-muted-foreground">No consent records match this filter.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Beneficiary ID</th><th className="px-4 py-3">Consent type</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Captured date</th><th className="px-4 py-3">Withdraw / renew</th><th className="px-4 py-3">Anonymised export</th></tr></thead><tbody className="divide-y divide-border">{items.map((item) => <tr key={item.consent_id ?? `${item.beneficiary_id}-${item.consent_type}`}><td className="px-4 py-3 font-mono font-semibold">{item.beneficiary_id ?? "—"}</td><td className="px-4 py-3">{item.consent_type ?? "—"}</td><td className="px-4 py-3"><span className={`rounded-full border px-2 py-1 text-xs font-semibold ${statusClass[item.status] ?? statusClass.Expired}`}>{item.status}</span></td><td className="px-4 py-3 text-muted-foreground">{item.captured_at ?? "—"}</td><td className="px-4 py-3 text-xs">{item.can_withdraw ? "Withdraw available" : item.can_renew ? "Renew available" : "No action"}</td><td className="px-4 py-3 font-semibold">{item.anonymised_export_allowed ? <span className="text-emerald-600">Allowed (anonymised)</span> : <span className="text-amber-600">Blocked</span>}</td></tr>)}</tbody></table></div>}
    </section>
    <p className="text-xs text-muted-foreground">Demo data source: synthetic consent records. Production records would come from the beneficiary registry and consent service.</p>
  </div>;
}
