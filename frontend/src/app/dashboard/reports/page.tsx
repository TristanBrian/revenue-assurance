"use client";

import { useState } from "react";
import { ApiError, downloadExport } from "@/lib/api";
import { useMateriality } from "@/context/MaterialityContext";
import RequirePermission from "@/components/RequirePermission";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

function ReportsContent() {
  const { materiality, setMateriality } = useMateriality();
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setDownloading(true);
    setError(null);
    try {
      await downloadExport(materiality);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not download the report.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white">Reports</h1>
        <p className="text-sm text-zinc-400">
          Export a multi-sheet reconciliation workbook (summary, anomalies, data quality, risk profile)
        </p>
      </header>

      <div className="flex items-center gap-2">
        <label htmlFor="materiality" className="text-sm text-zinc-400">
          Materiality threshold (KES)
        </label>
        <input
          id="materiality"
          type="number"
          min={0}
          step={25000}
          value={materiality}
          onChange={(e) => setMateriality(Number(e.target.value))}
          className="w-36 rounded border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-indigo-400 font-mono focus:outline-none focus:border-indigo-500 transition-all"
        />
      </div>

      <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-5 shadow-lg flex flex-col gap-4 max-w-md">
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-zinc-400">Active Settings Summary</p>
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-300">Materiality Target:</span>
            <span className="font-mono text-white font-bold">{formatKes(materiality)}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-850 py-2.5 text-xs font-semibold text-white shadow-lg shadow-indigo-600/20 active:scale-[0.98] transition-all disabled:opacity-40"
        >
          {downloading ? "Preparing Report..." : "Generate & Export Excel"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-xs text-red-350 max-w-md">
          {error}
        </div>
      )}
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
