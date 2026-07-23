"use client";

import { useEffect, useState } from "react";
import { ApiError, getFeed } from "@/lib/api";
import type { Anomaly, FeedData } from "@/lib/types";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

function statusClass(status: Anomaly["status"]): string {
  switch (status) {
    case "Critical":
      return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
    case "Review Required":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
    default:
      return "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300";
  }
}

export default function LiveFeed() {
  const [feed, setFeed] = useState<FeedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getFeed(10)
      .then((data) => {
        if (!cancelled) setFeed(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load the live feed.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Live Feed</h2>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && !error && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      )}

      {feed && !loading && feed.anomalies.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No recent anomalies.</p>
      )}

      {feed && feed.anomalies.length > 0 && (
        <ul className="flex flex-col divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
          {feed.anomalies.map((a, i) => (
            <li key={`${a.dispatch_id}-${i}`} className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate text-zinc-900 dark:text-zinc-50">
                  {a.customer} — {a.break_type}
                </p>
                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{a.dispatch_id}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="font-medium text-zinc-900 dark:text-zinc-50">
                  {formatKes(a.leakage_kes)}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(a.status)}`}>
                  {a.status}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
