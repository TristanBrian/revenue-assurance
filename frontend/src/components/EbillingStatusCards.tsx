import type { EbillingIntegrationStatus } from "@/lib/types";

interface Segment {
  label: string;
  value: number;
  barClass: string;
  dotClass: string;
  textClass: string;
}

// A single-row stacked bar (dataviz mark spec: 2px surface gap between
// segments, rounded ends) reading left-to-right as the invoice's journey —
// synced, still pending, failed, or never attempted — instead of five
// disconnected numbers with no sense of the whole pipeline.
export default function EbillingStatusCards({
  status,
}: {
  status: EbillingIntegrationStatus;
}) {
  const total = status.total_invoices || 1;
  const segments: Segment[] = [
    { label: "Synced", value: status.synced_count, barClass: "bg-status-low", dotClass: "bg-status-low", textClass: "text-status-low" },
    { label: "Pending", value: status.pending_count, barClass: "bg-status-medium", dotClass: "bg-status-medium", textClass: "text-status-medium" },
    { label: "Failed", value: status.failed_count, barClass: "bg-status-critical", dotClass: "bg-status-critical", textClass: "text-status-critical" },
    { label: "Not Attempted", value: status.not_attempted, barClass: "bg-muted-foreground/40", dotClass: "bg-muted-foreground/60", textClass: "text-muted-foreground" },
  ];

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={`h-2 w-2 rounded-full ${status.connected ? "bg-status-low" : "bg-status-critical"}`} />
          <span className="text-sm font-semibold text-foreground">
            {status.connected ? "Connected" : "Disconnected"}
          </span>
          <span className="text-xs text-muted-foreground">— {status.system}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            {status.api_endpoint}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>Response time <span className="font-mono font-semibold text-foreground/80">{status.response_time_ms}ms</span></span>
          <span>Last sync <span className="font-medium text-foreground/80">{status.last_sync ?? "never"}</span></span>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-foreground">{status.total_invoices} total invoices</span>
        </div>
        <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
          {segments.map((s) => (
            <div
              key={s.label}
              className={`h-full rounded-full transition-all ${s.barClass}`}
              style={{ width: `${(s.value / total) * 100}%` }}
              title={`${s.label}: ${s.value}`}
            />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          {segments.map((s) => (
            <div key={s.label} className="flex items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${s.dotClass}`} />
              <span className="text-xs text-muted-foreground">{s.label}</span>
              <span className={`ml-auto font-mono text-sm font-bold ${s.textClass}`}>{s.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
