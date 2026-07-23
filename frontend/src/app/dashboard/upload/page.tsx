"use client";

import { useState } from "react";
import type { ReconcileResult } from "@/lib/types";
import CsvUploadPanel from "@/components/CsvUploadPanel";
import MetricCards from "@/components/MetricCards";
import RequirePermission from "@/components/RequirePermission";

const DEFAULT_MATERIALITY = 100000;

function UploadContent() {
  const [result, setResult] = useState<ReconcileResult | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Upload CSVs</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Reconcile your own Dispatches/Invoices/Payments CSVs without touching the database
        </p>
      </header>

      <CsvUploadPanel materiality={DEFAULT_MATERIALITY} onUploaded={setResult} />

      {result && (
        <>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Results from your upload:</p>
          <MetricCards metrics={result.metrics} />
        </>
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
