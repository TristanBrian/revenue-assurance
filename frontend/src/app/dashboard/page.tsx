"use client";

import { useEffect, useState } from "react";
import { ApiError, reconcile } from "@/lib/api";
import type { Metrics } from "@/lib/types";
import MetricCards from "@/components/MetricCards";
import LiveFeed from "@/components/LiveFeed";

const DEFAULT_MATERIALITY = 100000;

export default function DashboardOverviewPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    reconcile(DEFAULT_MATERIALITY)
      .then((data) => {
        if (!cancelled) setMetrics(data.metrics);
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
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Overview</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Order-to-Cash reconciliation dashboard
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && !error && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading metrics…</p>
      )}

      {metrics && !loading && <MetricCards metrics={metrics} />}

      <LiveFeed />
    </div>
  );
}
