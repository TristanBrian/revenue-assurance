import type { EbillingIntegrationStatus } from "@/lib/types";

interface CardProps {
  label: string;
  value: string;
  tone?: "default" | "danger" | "warning" | "success";
}

function Card({ label, value, tone = "default" }: CardProps) {
  const toneClass =
    tone === "danger"
      ? "text-red-600 dark:text-red-400"
      : tone === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "success"
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-zinc-900 dark:text-zinc-50";

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

export default function EbillingStatusCards({
  status,
}: {
  status: EbillingIntegrationStatus;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      <Card
        label="Connection"
        value={status.connected ? "Connected" : "Disconnected"}
        tone={status.connected ? "success" : "danger"}
      />
      <Card label="Total Invoices" value={String(status.total_invoices)} />
      <Card label="Synced" value={String(status.synced_count)} tone="success" />
      <Card
        label="Failed"
        value={String(status.failed_count)}
        tone={status.failed_count > 0 ? "danger" : "default"}
      />
      <Card label="Not Attempted" value={String(status.not_attempted)} />
    </div>
  );
}
