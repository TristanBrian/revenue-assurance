import type { FailureRateMonitor } from "@/lib/types";

export default function EbillingMonitorBanner({
  monitor,
}: {
  monitor: FailureRateMonitor;
}) {
  if (!monitor.alert) {
    return (
      <div className="rounded-lg border border-status-low/30 bg-status-low-bg px-4 py-2 text-sm text-status-low">
        Failure rate {monitor.failure_rate}%
        {monitor.threshold !== undefined ? ` (threshold ${monitor.threshold}%)` : ""} — normal.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg px-4 py-2 text-sm text-status-critical">
      <span className="font-medium">Alert:</span> failure rate {monitor.failure_rate}% exceeds
      threshold {monitor.threshold}%.
    </div>
  );
}
