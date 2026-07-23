import type { FailureRateMonitor } from "@/lib/types";

export default function EbillingMonitorBanner({
  monitor,
}: {
  monitor: FailureRateMonitor;
}) {
  if (!monitor.alert) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
        Failure rate {monitor.failure_rate}%
        {monitor.threshold !== undefined ? ` (threshold ${monitor.threshold}%)` : ""} — normal.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      <span className="font-medium">Alert:</span> failure rate {monitor.failure_rate}% exceeds
      threshold {monitor.threshold}%.
    </div>
  );
}
