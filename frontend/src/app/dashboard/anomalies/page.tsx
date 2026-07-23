"use client";

import { useEffect, useState } from "react";
import { ApiError, reconcile, updateAnomalyStatus } from "@/lib/api";
import type { Anomaly } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import AnomalyTable from "@/components/AnomalyTable";
import RequirePermission from "@/components/RequirePermission";

const DEFAULT_MATERIALITY = 100000;

function AnomaliesContent() {
  const { user } = useAuth();
  const [materialityInput, setMaterialityInput] = useState(String(DEFAULT_MATERIALITY));
  const [materiality, setMateriality] = useState(DEFAULT_MATERIALITY);
  const [reloadToken, setReloadToken] = useState(0);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    reconcile(materiality)
      .then((data) => {
        if (!cancelled) setAnomalies(data.anomalies);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Could not reach the reconciliation API. Is the backend running?",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [materiality, reloadToken]);

  function handleMaterialityChange(value: string) {
    setMaterialityInput(value);
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      setLoading(true);
      setError(null);
      setMateriality(parsed);
    }
  }

  async function handleResolve(dispatchId: string) {
    setResolvingId(dispatchId);
    try {
      await updateAnomalyStatus(dispatchId, "Resolved");
      setReloadToken((t) => t + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not resolve the anomaly.");
    } finally {
      setResolvingId(null);
    }
  }

  const canResolve = user?.permissions.includes("resolve_anomaly");

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Anomalies</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Line-item reconciliation breaks
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
          value={materialityInput}
          onChange={(e) => handleMaterialityChange(e.target.value)}
          className="w-32 rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && !error && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading anomalies…</p>
      )}

      {!loading && !error && (
        <AnomalyTable
          anomalies={anomalies}
          onResolve={canResolve ? handleResolve : undefined}
          resolvingId={resolvingId}
        />
      )}
    </div>
  );
}

export default function AnomaliesPage() {
  return (
    <RequirePermission code="view_anomalies">
      <AnomaliesContent />
    </RequirePermission>
  );
}
