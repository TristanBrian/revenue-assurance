import type { Metrics } from "@/lib/types";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

interface CardProps {
  label: string;
  value: string;
  tone?: "default" | "danger" | "warning";
}

function Card({ label, value, tone = "default" }: CardProps) {
  const toneClass =
    tone === "danger"
      ? "text-red-600 dark:text-red-400"
      : tone === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : "text-zinc-900 dark:text-zinc-50";

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

export default function MetricCards({ metrics }: { metrics: Metrics }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      <Card label="Total Dispatched" value={formatKes(metrics.total_dispatched_kes)} />
      <Card
        label="Total Leakage"
        value={formatKes(metrics.total_leakage_kes)}
        tone="danger"
      />
      <Card
        label="Reconciliation Rate"
        value={`${metrics.reconciliation_rate.toFixed(2)}%`}
      />
      <Card label="Anomalies" value={String(metrics.anomaly_count)} />
      <Card
        label="Critical"
        value={String(metrics.critical_count)}
        tone={metrics.critical_count > 0 ? "warning" : "default"}
      />
    </div>
  );
}
