"use client";

import { useState } from "react";
import Link from "next/link";
import type { ReconcileResult } from "@/lib/types";
import { useMateriality } from "@/context/MaterialityContext";
import CsvUploadPanel from "@/components/CsvUploadPanel";
import StatCard from "@/components/StatCard";
import RequirePermission from "@/components/RequirePermission";

function formatKesCompact(value: number): string {
  if (value >= 1e6) return `KES ${(value / 1e6).toFixed(2)}M`;
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(
    value,
  );
}

function UploadContent() {
  const { materiality } = useMateriality();
  const [result, setResult] = useState<ReconcileResult | null>(null);

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
      <header>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ad-hoc Reconciliation</p>
        <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">Upload CSVs</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Reconcile your own Dispatches, Invoices, and Payments CSVs instantly — nothing is written to the database.
        </p>
      </header>

      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <CsvUploadPanel materiality={materiality} onUploaded={setResult} />
      </div>

      {result && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-foreground">Results from your upload</h2>
            <Link href="/dashboard" className="text-xs font-medium text-muted-foreground hover:text-foreground">
              Back to live dashboard →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total Dispatched" value={formatKesCompact(result.metrics.total_dispatched_kes)} />
            <StatCard
              label="Total Leakage"
              value={formatKesCompact(result.metrics.total_leakage_kes)}
              tone={result.metrics.total_leakage_kes > 0 ? "critical" : "low"}
            />
            <StatCard label="Anomalies" value={result.metrics.anomaly_count.toString()} tone="medium" />
            <StatCard
              label="Reconciliation Rate"
              value={`${result.metrics.reconciliation_rate.toFixed(1)}%`}
              tone={result.metrics.reconciliation_rate >= 90 ? "low" : "medium"}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function UploadPage() {
  return (
    <RequirePermission code="upload_csv">
      <UploadContent />
    </RequirePermission>
  );
}
