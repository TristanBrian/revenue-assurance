"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { ApiError, getInukaCases, getReviewQueue } from "@/lib/api";
import type { Anomaly, InukaRiskCase } from "@/lib/types";
import type { WorkspaceDirection } from "@/lib/workspace";
import InukaCaseModal from "@/components/InukaCaseModal";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(value);
}

export default function DirectionReviewQueuePage() {
  const { direction } = useParams<{ direction: WorkspaceDirection }>();
  const isInbound = direction === "inbound";
  const { user } = useAuth();

  const [oilCases, setOilCases] = useState<Anomaly[]>([]);
  const [inukaCases, setInukaCases] = useState<InukaRiskCase[]>([]);
  const [selectedInukaCase, setSelectedInukaCase] = useState<InukaRiskCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState("Your operational review queue");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    if (isInbound) {
      getReviewQueue(1, 15)
        .then((res) => {
          if (!cancelled) {
            setOilCases(res.anomalies);
            setScope(res.scope || "Your operational review queue");
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load oil review queue.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      getInukaCases({ page: 1, pageSize: 15, status: "Critical" })
        .then((res) => {
          if (!cancelled) setInukaCases(res.cases);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load Inuka review queue.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    return () => { cancelled = true; };
  }, [isInbound, direction]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {isInbound ? "Oil Revenue Assurance" : "Inuka Programme Assurance"}
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-foreground font-['Outfit',sans-serif]">
            {isInbound ? "My Review Queue" : "Inuka Program Review Queue"}
          </h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            {isInbound
              ? `${scope}. Review high-priority oil revenue exceptions, waybill volume breaks, and depot gate clearance holds.`
              : "Triage view for high-priority stipend cases, beneficiary exceptions, and field officer alerts."}
          </p>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-status-critical/30 bg-status-critical-bg p-4 text-xs font-medium text-status-critical">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-border bg-card p-16">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        </div>
      ) : isInbound ? (
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-border pb-4 mb-4">
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-500 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/20">
                Oil Revenue Controls
              </span>
              <h2 className="mt-1.5 text-lg font-bold text-foreground">Critical Volumetric & Invoicing Exceptions</h2>
              <p className="text-xs text-muted-foreground">Waybill, gantry meter, and OMC invoice variance breaks needing immediate review.</p>
            </div>
            {user?.permissions.includes("view_anomaly_table") && (
              <Link
                href="/dashboard/inbound/anomalies"
                className="px-3 py-1.5 text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 rounded-xl transition-all"
              >
                Open Full Anomalies Queue →
              </Link>
            )}
          </div>

          <div className="divide-y divide-border">
            {oilCases.length === 0 ? (
              <p className="py-12 text-center text-xs text-muted-foreground italic">No critical oil revenue cases currently pending review.</p>
            ) : (
              oilCases.map((item) => (
                <Link
                  key={item.dispatch_id}
                  href={user?.permissions.includes("view_anomaly_table") ? `/dashboard/inbound/anomalies?search=${encodeURIComponent(item.dispatch_id)}` : "#"}
                  className="flex items-center justify-between gap-4 py-3.5 px-2 hover:bg-muted/40 rounded-xl transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-foreground">{item.break_type}</span>
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-rose-500/10 text-rose-500 border border-rose-500/20">
                        {item.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground truncate font-mono">
                      {item.customer} · Dispatch: <strong className="text-foreground">{item.dispatch_id}</strong> · Product: {item.product}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-sm font-black text-rose-600 dark:text-rose-400">{formatKes(item.leakage_kes)}</p>
                    <p className="text-[10px] text-muted-foreground font-semibold mt-0.5">Leakage Exposure</p>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-border pb-4 mb-4">
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-primary bg-primary/10 px-2.5 py-0.5 rounded-full border border-primary/20">
                Inuka Program Controls
              </span>
              <h2 className="mt-1.5 text-lg font-bold text-foreground">Critical Program Assurance Cases</h2>
              <p className="text-xs text-muted-foreground">Beneficiary, evidence, authorization, and stipend payment exceptions.</p>
            </div>
            <Link
              href="/dashboard/outbound/anomalies"
              className="px-3 py-1.5 text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 rounded-xl transition-all"
            >
              Open Outbound Queue →
            </Link>
          </div>

          <div className="divide-y divide-border">
            {inukaCases.length === 0 ? (
              <p className="py-12 text-center text-xs text-muted-foreground italic">No critical Inuka cases currently pending review.</p>
            ) : (
              inukaCases.map((item) => (
                <button
                  type="button"
                  key={item.case_id}
                  onClick={() => setSelectedInukaCase(item)}
                  className="flex w-full items-center justify-between gap-4 py-3.5 px-2 text-left hover:bg-muted/40 rounded-xl transition-colors cursor-pointer"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">{item.title}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground font-mono">
                      {item.pillar_id || "Unassigned pillar"} · Beneficiary: {item.beneficiary_id || "Unknown"}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-mono text-sm font-black text-rose-600 dark:text-rose-400">{formatKes(item.amount_at_risk)}</span>
                    <p className="text-[10px] text-muted-foreground font-semibold mt-0.5">Amount at Risk</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>
      )}

      {selectedInukaCase && <InukaCaseModal item={selectedInukaCase} onClose={() => setSelectedInukaCase(null)} />}
    </div>
  );
}
