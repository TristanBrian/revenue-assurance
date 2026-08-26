"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, getInukaOfficers, getInukaPillars } from "@/lib/api";
import type { InukaDimensionSummary } from "@/lib/types";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(value);
}

type Grouping = "pillar" | "officer";

/**
 * Outbound anomalies entry screen (/dashboard/outbound/anomalies) — no
 * inbound equivalent (there's no raw anomaly table on this side at all;
 * see the workspace refactor spec). Groups outbound cases by pillar or
 * officer, each card showing case count / critical count / amount at
 * risk sourced from /api/inuka/pillars /officers. Clicking a card
 * navigates to /dashboard/outbound/anomalies/[groupId], which renders
 * the shared AnomaliesTable scoped to that group via pillar_id/
 * officer_id.
 */
export default function DimensionGroupGrid() {
  const router = useRouter();
  const [grouping, setGrouping] = useState<Grouping>("pillar");
  const [items, setItems] = useState<InukaDimensionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const request = grouping === "pillar" ? getInukaPillars() : getInukaOfficers();
    request
      .then((result) => { if (!cancelled) setItems(result); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load assurance groupings."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [grouping]);

  function openGroup(id: string) {
    router.push(`/dashboard/outbound/anomalies/${encodeURIComponent(id)}?by=${grouping}`);
  }

  return (
    <div className="flex flex-col gap-5 max-w-6xl mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Investigation queue</p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">Inuka assurance cases</h1>
          <p className="text-sm text-muted-foreground mt-1">Select a {grouping} to open its scoped case queue.</p>
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/50 p-1">
          {(["pillar", "officer"] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGrouping(g)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                grouping === g ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {g === "pillar" ? "By pillar" : "By officer"}
            </button>
          ))}
        </div>
      </header>

      {error && <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg p-4 text-sm text-status-critical">{error}</div>}

      {loading && !error && (
        <div className="flex items-center justify-center p-12">
          <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {!loading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.length === 0 ? (
            <p className="col-span-full py-10 text-center text-sm text-muted-foreground">No assurance cases found.</p>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openGroup(item.id)}
                className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 text-left shadow-sm transition hover:border-primary/40 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-foreground">{item.id}</span>
                  {item.critical_count > 0 && (
                    <span className="shrink-0 rounded-full bg-status-critical-bg px-2 py-0.5 text-[10px] font-bold text-status-critical">
                      {item.critical_count} critical
                    </span>
                  )}
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Cases</p>
                    <p className="text-lg font-bold text-foreground">{item.case_count}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Amount at risk</p>
                    <p className="font-mono font-semibold text-status-critical">{formatKes(item.amount_at_risk)}</p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
