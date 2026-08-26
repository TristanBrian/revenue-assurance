"use client";

import { useEffect, useMemo, useState } from "react";
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    getInukaStreamStatus().then(setStream).catch(() => undefined);
    let cancelled = false;
    setLoading(true);
    setError(null);
    getBeneficiaryConsents({ page: 1, pageSize: 100, status: status || undefined, search: search || undefined })
      .then(async (first) => {
        const rest = await Promise.all(Array.from(
          { length: Math.max(0, Math.ceil(first.total / 100) - 1) },
          (_, index) => getBeneficiaryConsents({ page: index + 2, pageSize: 100, status: status || undefined, search: search || undefined }),
        ));
        if (!cancelled) setItems([first, ...rest].flatMap((result) => result.items));
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load consent records."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [status, search]);

  const profiles = useMemo(() => {
    const grouped = new Map<string, BeneficiaryConsent[]>();
    items.forEach((record) => {
      const id = record.beneficiary_id || "ID unavailable";
      grouped.set(id, [...(grouped.get(id) ?? []), record]);
    });
    return [...grouped.entries()].map(([id, records]) => ({
      id,
      records,
      active: records.filter((record) => record.status === "Active").length,
      attention: records.filter((record) => record.status !== "Active").length,
      exportAllowed: records.length > 0 && records.every((record) => record.anonymised_export_allowed),
      latest: records.map((record) => record.captured_at).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
    })).sort((a, b) => b.attention - a.attention || a.id.localeCompare(b.id));
  }, [items]);
  const totalPages = Math.max(1, Math.ceil(profiles.length / 12));
  const visibleProfiles = profiles.slice((page - 1) * 12, page * 12);
  const selected = profiles.find((profile) => profile.id === selectedId) ?? null;

  useEffect(() => { setPage(1); setSelectedId(null); }, [status, search]);

  return <div className="mx-auto flex max-w-6xl flex-col gap-6">
    <header><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Inuka programme assurance</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Consent & privacy registry</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">Review consent coverage by beneficiary. Select an ID to inspect every permitted use and its consent history; identity details remain protected.</p></header>
    {stream && <section className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-wide text-blue-700">Live data fabric</p><p className="mt-1 text-sm font-semibold text-foreground">{stream.mode.replaceAll("_", " ")}</p><p className="mt-1 text-xs text-muted-foreground">{stream.events_received} events received across {stream.pillars.join(", ")} · contract: {stream.source_contract}</p></div><span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">Connected</span></div></section>}
    <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-border bg-card p-4 shadow-sm"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Beneficiaries</p><p className="mt-1 text-2xl font-bold text-foreground">{profiles.length}</p></div><div className="rounded-xl border border-border bg-card p-4 shadow-sm"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Complete coverage</p><p className="mt-1 text-2xl font-bold text-emerald-600">{profiles.filter((profile) => profile.attention === 0).length}</p></div><div className="rounded-xl border border-border bg-card p-4 shadow-sm"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Needs attention</p><p className="mt-1 text-2xl font-bold text-amber-600">{profiles.filter((profile) => profile.attention > 0).length}</p></div></div>
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap gap-3 border-b border-border p-4"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search beneficiary ID" className="min-w-64 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" /><select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm"><option value="">All statuses</option><option>Active</option><option>Pending</option><option>Withdrawn</option><option>Expired</option></select></div>
      {error && <p className="p-5 text-sm text-status-critical">{error}</p>}
      {loading ? <div className="p-12 text-center text-sm text-muted-foreground">Loading beneficiary profiles…</div> : visibleProfiles.length === 0 ? <div className="p-12 text-center text-sm text-muted-foreground">No beneficiary profiles match this filter.</div> : <div className="divide-y divide-border">{visibleProfiles.map((profile) => <button key={profile.id} type="button" onClick={() => setSelectedId(profile.id)} className="grid w-full gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/30 sm:grid-cols-[1.3fr_1fr_1fr_auto] sm:items-center"><div><p className="font-mono text-sm font-bold">{profile.id}</p><p className="mt-1 text-xs text-muted-foreground">{profile.records.length} consent {profile.records.length === 1 ? "type" : "types"} recorded</p></div><div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Coverage</p><div className="mt-1 flex gap-2 text-xs"><span className="font-semibold text-emerald-600">{profile.active} active</span>{profile.attention > 0 && <span className="font-semibold text-amber-600">{profile.attention} attention</span>}</div></div><div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Latest capture</p><p className="mt-1 text-xs font-medium">{profile.latest ?? "Not captured"}</p></div><div className="flex items-center gap-3"><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${profile.exportAllowed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{profile.exportAllowed ? "Export eligible" : "Export restricted"}</span><span className="text-lg text-muted-foreground">›</span></div></button>)}</div>}
      {!loading && profiles.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted-foreground"><span>Showing {(page - 1) * 12 + 1}–{Math.min(page * 12, profiles.length)} of {profiles.length} beneficiaries</span><div className="flex items-center gap-2"><button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="rounded-md border border-border px-3 py-2 font-semibold disabled:opacity-40">Previous</button><span>Page {page} of {totalPages}</span><button type="button" disabled={page === totalPages} onClick={() => setPage((value) => value + 1)} className="rounded-md border border-border px-3 py-2 font-semibold disabled:opacity-40">Next</button></div></div>}
    </section>
    {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="consent-profile-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null); }}><section className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"><header className="flex items-start justify-between gap-4 border-b border-border px-6 py-5"><div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Beneficiary consent profile</p><h2 id="consent-profile-title" className="mt-1 font-mono text-xl font-bold">{selected.id}</h2><p className="mt-1 text-sm text-muted-foreground">{selected.records.length} recorded consent types · identity details intentionally hidden</p></div><button type="button" onClick={() => setSelectedId(null)} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted">Close</button></header><div className="overflow-y-auto p-6"><div className="mb-5 grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-muted/40 p-3"><p className="text-[10px] uppercase text-muted-foreground">Active</p><p className="mt-1 font-bold">{selected.active}</p></div><div className="rounded-lg bg-muted/40 p-3"><p className="text-[10px] uppercase text-muted-foreground">Needs attention</p><p className="mt-1 font-bold">{selected.attention}</p></div><div className="rounded-lg bg-muted/40 p-3"><p className="text-[10px] uppercase text-muted-foreground">Anonymised export</p><p className="mt-1 font-bold">{selected.exportAllowed ? "Permitted" : "Restricted"}</p></div></div><div className="space-y-3">{selected.records.map((record) => <article key={record.consent_id ?? `${selected.id}-${record.consent_type}`} className="rounded-xl border border-border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{record.consent_type ?? "Unspecified consent"}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">{record.consent_id ?? "Consent ID unavailable"}</p></div><span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${statusClass[record.status] ?? statusClass.Expired}`}>{record.status}</span></div><dl className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-[10px] uppercase text-muted-foreground">Captured date</dt><dd className="mt-1 text-sm font-medium">{record.captured_at ?? "Not captured"}</dd></div><div><dt className="text-[10px] uppercase text-muted-foreground">Captured by</dt><dd className="mt-1 text-sm font-medium">{record.captured_by ?? "Not recorded"}</dd></div><div><dt className="text-[10px] uppercase text-muted-foreground">Lifecycle action</dt><dd className="mt-1 text-sm font-medium">{record.can_withdraw ? "May withdraw" : record.can_renew ? "Renewal available" : "No action required"}</dd></div><div><dt className="text-[10px] uppercase text-muted-foreground">Anonymised export</dt><dd className="mt-1 text-sm font-medium">{record.anonymised_export_allowed ? "Allowed" : "Blocked"}</dd></div></dl></article>)}</div></div></section></div>}
    <p className="text-xs text-muted-foreground">Demo data source: synthetic consent records. Production records would come from the beneficiary registry and consent service.</p>
  </div>;
}
