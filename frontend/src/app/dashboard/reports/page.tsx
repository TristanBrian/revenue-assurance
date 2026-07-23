"use client";

import { useState } from "react";
import { ApiError, downloadExport } from "@/lib/api";
import RequirePermission from "@/components/RequirePermission";

const DEFAULT_MATERIALITY = 100000;

function ReportsContent() {
  const [materiality, setMateriality] = useState(String(DEFAULT_MATERIALITY));
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setDownloading(true);
    setError(null);
    try {
      await downloadExport(Number(materiality) || 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not download the report.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Reports</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Export a multi-sheet reconciliation workbook (summary, anomalies, data quality, risk profile)
        </p>
      </header>

      <div className="flex items-center gap-2">
        <label htmlFor="materiality" className="text-sm text-zinc-600 dark:text-zinc-400">
          Materiality threshold (KES)
        </label>
        <input
          id="materiality"
          type="number"
          min={0}
          step={10000}
          value={materiality}
          onChange={(e) => setMateriality(e.target.value)}
          className="w-32 rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        className="self-start rounded bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {downloading ? "Preparing…" : "Export Excel report"}
      </button>

      {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}

export default function ReportsPage() {
  return (
    <RequirePermission code="export_reports">
      <ReportsContent />
    </RequirePermission>
  );
}
