"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ApiError, getInukaCases } from "@/lib/api";
import type { InukaRiskCase } from "@/lib/types";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(value);
}

/**
 * Outbound "extra" slot — the counterpart to inbound's EbillingPanel.
 * There is no backend beneficiary-LIST endpoint (only GET
 * /api/inuka/beneficiaries/{id}, a single lookup — see the workspace
 * refactor spec's flagged gap) — rather than adding a new backend
 * endpoint for a full, unscoped beneficiary roster this assurance
 * dashboard has no other use for, this derives the list from
 * /api/inuka/cases (already used elsewhere), de-duplicated by
 * beneficiary_id. That's a deliberate, narrower scope than "every
 * beneficiary in the system" — it shows beneficiaries who currently have
 * at least one open assurance case, which is what an assurance workspace
 * actually needs a beneficiary list FOR. Each entry links to the existing
 * single-beneficiary detail page.
 */
export default function BeneficiaryList() {
  const [cases, setCases] = useState<InukaRiskCase[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // page_size at its max (100) and only the fields this view needs —
    // good enough for a demo-scale case set; a real beneficiary roster
    // endpoint would paginate this properly (see docstring above).
    getInukaCases({ page: 1, pageSize: 100 })
      .then((result) => { if (!cancelled) setCases(result.cases); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load beneficiaries."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const beneficiaries = useMemo(() => {
    const byId = new Map<string, { id: string; caseCount: number; criticalCount: number; amountAtRisk: number }>();
    for (const item of cases) {
      if (!item.beneficiary_id) continue;
      const entry = byId.get(item.beneficiary_id) ?? { id: item.beneficiary_id, caseCount: 0, criticalCount: 0, amountAtRisk: 0 };
      entry.caseCount += 1;
      if (item.severity === "Critical") entry.criticalCount += 1;
      entry.amountAtRisk += item.amount_at_risk;
      byId.set(item.beneficiary_id, entry);
    }
    const list = Array.from(byId.values()).sort((a, b) => b.amountAtRisk - a.amountAtRisk);
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((b) => b.id.toLowerCase().includes(q));
  }, [cases, search]);

  return (
    <div className="flex flex-col gap-5 max-w-5xl mx-auto">
      <header>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Inuka Programs</p>
        <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">Beneficiaries</h1>
        <p className="text-sm text-muted-foreground mt-1">Beneficiaries with at least one open assurance case, ranked by amount at risk.</p>
      </header>

      <input
        type="text"
        placeholder="Search beneficiary ID..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
      />

      {error && <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg p-4 text-sm text-status-critical">{error}</div>}

      {loading && !error && (
        <div className="flex items-center justify-center p-12">
          <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {!loading && !error && (
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Beneficiary</th>
                <th className="px-4 py-3">Open cases</th>
                <th className="px-4 py-3">Critical</th>
                <th className="px-4 py-3">Amount at risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {beneficiaries.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">No beneficiaries match.</td></tr>
              ) : (
                beneficiaries.map((b) => (
                  <tr key={b.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/inuka/beneficiaries/${encodeURIComponent(b.id)}`} className="font-semibold text-primary hover:underline">{b.id}</Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{b.caseCount}</td>
                    <td className="px-4 py-3 text-status-critical">{b.criticalCount || "—"}</td>
                    <td className="px-4 py-3 font-mono font-semibold text-foreground">{formatKes(b.amountAtRisk)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
