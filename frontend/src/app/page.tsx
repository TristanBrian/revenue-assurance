"use client";

import { useEffect, useState } from "react";
import { ApiError, reconcile } from "@/lib/api";
import type { ReconcileResult } from "@/lib/types";
import MetricCards from "@/components/MetricCards";
import AnomalyTable from "@/components/AnomalyTable";
import CsvUploadPanel from "@/components/CsvUploadPanel";

const DEFAULT_MATERIALITY = 100000;

type DataSource = "database" | "upload";

export default function Home() {
  const [materialityInput, setMaterialityInput] = useState(String(DEFAULT_MATERIALITY));
  const [materiality, setMateriality] = useState(DEFAULT_MATERIALITY);
  const [reloadToken, setReloadToken] = useState(0);
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [source, setSource] = useState<DataSource>("database");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function handleMaterialityChange(value: string) {
    setMaterialityInput(value);
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      setLoading(true);
      setError(null);
      setMateriality(parsed);
    }
  }

  function handleReloadFromDatabase() {
    setLoading(true);
    setError(null);
    setReloadToken((t) => t + 1);
  }

  function handleUploaded(data: ReconcileResult) {
    setResult(data);
    setError(null);
    setSource("upload");
  }

  useEffect(() => {
    let cancelled = false;

    reconcile(materiality)
      .then((data) => {
        if (!cancelled) {
          setResult(data);
          setSource("database");
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("Could not reach the reconciliation API. Is the backend running?");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [materiality, reloadToken]);

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-black">
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            KPC Revenue Assurance
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Order-to-Cash reconciliation dashboard
          </p>
        </header>

        <div className="flex items-center gap-2">
          <label
            htmlFor="materiality"
            className="text-sm text-zinc-600 dark:text-zinc-400"
          >
            Materiality threshold (KES)
          </label>
          <input
            id="materiality"
            type="number"
            min={0}
            step={10000}
            value={materialityInput}
            onChange={(e) => handleMaterialityChange(e.target.value)}
            className="w-32 rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            <p className="font-medium">Failed to load reconciliation data</p>
            <p className="mt-1">{error}</p>
            <p className="mt-2 text-red-700/80 dark:text-red-400/80">
              If this is the first run, make sure the backend database exists: from{" "}
              <code>backend/</code>, run{" "}
              <code>python scripts/generate_kpc_data.py</code> then{" "}
              <code>python scripts/etl_pipeline.py</code>, and confirm the API is
              running on <code>NEXT_PUBLIC_API_URL</code>.
            </p>
          </div>
        )}

        {loading && !error && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Loading reconciliation data…
          </p>
        )}

        {result && !loading && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Showing:{" "}
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {source === "database" ? "live database" : "uploaded CSVs"}
                </span>
              </p>
              {source === "upload" && (
                <button
                  type="button"
                  onClick={handleReloadFromDatabase}
                  className="text-xs text-zinc-500 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  Switch back to live database
                </button>
              )}
            </div>
            <MetricCards metrics={result.metrics} />
            <AnomalyTable anomalies={result.anomalies} />
          </>
        )}

        <CsvUploadPanel materiality={materiality} onUploaded={handleUploaded} />
      </main>
    </div>
  );
}
