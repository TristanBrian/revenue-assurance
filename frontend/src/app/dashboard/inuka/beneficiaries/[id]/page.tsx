"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ApiError, getInukaBeneficiary } from "@/lib/api";
import type { InukaBeneficiaryDetail } from "@/lib/types";

export default function InukaBeneficiaryPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<InukaBeneficiaryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getInukaBeneficiary(params.id)
      .then((value) => {
        if (!cancelled) setDetail(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load beneficiary history.");
        }
      });
    return () => { cancelled = true; };
  }, [params.id]);

  if (error) {
    return (
      <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg p-4 text-sm text-status-critical">
        {error}
      </div>
    );
  }

  if (!detail) {
    return <div className="p-12 text-center text-muted-foreground">Loading beneficiary history…</div>;
  }

  const sections = ["attendance", "stipend_authorizations", "disbursements", "cases"];

  return (
    <div className="flex flex-col gap-5 max-w-6xl mx-auto">
      <header>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Beneficiary 360
        </p>
        {/* ✅ Always show beneficiary ID, never the name */}
        <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">
          {detail.beneficiary_id}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {detail.beneficiary_id} · identity, participation, authorization, payment, and assurance history
        </p>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {["beneficiary_id", "pillar_id", "enrollment_date", "is_active"].map((key) => (
          <div key={key} className="rounded-xl border border-border bg-card p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {key.replaceAll("_", " ")}
            </p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {String(detail[key as keyof InukaBeneficiaryDetail] ?? "—")}
            </p>
          </div>
        ))}
      </section>

      {sections.map((section) => {
        const rows = Array.isArray(detail[section as keyof InukaBeneficiaryDetail])
          ? (detail[section as keyof InukaBeneficiaryDetail] as Record<string, unknown>[])
          : [];
        return (
          <section key={section} className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-bold capitalize text-foreground">
                {section.replaceAll("_", " ")}
              </h2>
            </div>
            {rows.length === 0 ? (
              <p className="px-4 py-8 text-sm text-muted-foreground">No records found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <tbody className="divide-y divide-border">
                    {rows.slice(0, 25).map((row, index) => (
                      <tr key={index}>
                        {Object.entries(row)
                          .slice(0, 6)
                          .map(([key, value]) => (
                            <td key={key} className="px-4 py-3">
                              <p className="text-[10px] uppercase text-muted-foreground">
                                {key.replaceAll("_", " ")}
                              </p>
                              <p className="mt-1 text-foreground">{String(value ?? "—")}</p>
                            </td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}