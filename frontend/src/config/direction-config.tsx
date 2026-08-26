/**
 * Direction-keyed config objects — the "swap, don't branch" layer for the
 * shared components (StatCardGrid, AnomaliesTable, Heatmap, FraudGraph,
 * Reports). Each of these components reads column labels / break-type
 * vocabulary / axis labels / endpoint strings from here; none of them
 * branch on `direction` internally. See the workspace refactor spec's
 * "Page-by-page spec" for the reasoning behind each config shape.
 */
import type { Anomaly, BreakType, Metrics, OmcRiskProfile } from "@/lib/types";
import type { InukaCaseSummary } from "@/lib/types";
import type { PermissionToggleStatConfig } from "@/hooks/usePermissionToggleStat";
import type { WorkspaceDirection } from "@/lib/workspace";

// ---------------------------------------------------------------------------
// Overview — StatCardGrid
// ---------------------------------------------------------------------------

export interface OverviewStatData {
  metrics: Metrics | null;
  omcProfiles: OmcRiskProfile[];
  caseSummary: InukaCaseSummary | null;
}

function formatKesCompact(value: number): string {
  if (value >= 1e9) return `KES ${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `KES ${(value / 1e6).toFixed(2)}M`;
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(value);
}

/** 4 slots, in display order — every slot goes through
 * usePermissionToggleStat() uniformly (see that hook's own note on why),
 * even the two slots per direction that don't really toggle
 * (permission: null -> always whenTrue). */
export const overviewConfig: Record<WorkspaceDirection, PermissionToggleStatConfig[]> = {
  inbound: [
    {
      permission: "view_omc_risk_profile",
      whenTrue: {
        label: "Total Leakage",
        note: "Across all flagged OMCs",
        getValue: (d) => formatKesCompact(d.omcProfiles.reduce((acc, o) => acc + o.leakage_kes, 0)),
      },
      whenFalse: {
        label: "Total Dispatched",
        note: "Across registered waybills",
        getValue: (d) => formatKesCompact(d.metrics?.total_dispatched_kes ?? 0),
      },
    },
    {
      permission: null,
      whenTrue: {
        label: "Critical Anomalies",
        note: "Needs immediate review",
        notePill: true,
        href: "/dashboard/inbound/anomalies",
        tone: (d) => ((d.metrics?.critical_count ?? 0) > 0 ? "critical" : "low"),
        getValue: (d) => (d.metrics?.critical_count ?? 0).toLocaleString(),
      },
      whenFalse: {
        label: "Critical Anomalies",
        note: "Needs immediate review",
        notePill: true,
        tone: (d) => ((d.metrics?.critical_count ?? 0) > 0 ? "critical" : "low"),
        getValue: (d) => (d.metrics?.critical_count ?? 0).toLocaleString(),
      },
    },
    {
      permission: null,
      whenTrue: {
        label: "Reconciliation Rate",
        progress: (d) => d.metrics?.reconciliation_rate,
        tone: (d) => ((d.metrics?.reconciliation_rate ?? 0) >= 90 ? "low" : "medium"),
        getValue: (d) => `${(d.metrics?.reconciliation_rate ?? 0).toFixed(1)}%`,
      },
      whenFalse: {
        label: "Reconciliation Rate",
        progress: (d) => d.metrics?.reconciliation_rate,
        tone: (d) => ((d.metrics?.reconciliation_rate ?? 0) >= 90 ? "low" : "medium"),
        getValue: (d) => `${(d.metrics?.reconciliation_rate ?? 0).toFixed(1)}%`,
      },
    },
    {
      permission: "view_omc_risk_profile",
      whenTrue: {
        label: "High Risk OMCs",
        note: "Under active review",
        href: "/dashboard/inbound/leakage",
        tone: (d) => (d.omcProfiles.filter((o) => o.risk_level === "High").length > 0 ? "high" : "low"),
        getValue: (d) => d.omcProfiles.filter((o) => o.risk_level === "High").length.toString(),
      },
      whenFalse: {
        label: "Total Paid Remitted",
        note: "Verified payments",
        getValue: (d) => formatKesCompact(d.metrics?.total_paid_kes ?? 0),
      },
    },
  ],
  outbound: [
    {
      permission: null,
      whenTrue: {
        label: "Eligible program funds",
        note: "Attendance-linked amount",
        getValue: (d) => formatKesCompact(d.metrics?.total_dispatched_kes ?? 0),
      },
      whenFalse: {
        label: "Eligible program funds",
        note: "Attendance-linked amount",
        getValue: (d) => formatKesCompact(d.metrics?.total_dispatched_kes ?? 0),
      },
    },
    {
      permission: null,
      whenTrue: {
        label: "Open assurance cases",
        note: "Review by pillar",
        href: "/dashboard/outbound/anomalies",
        tone: (d) => ((d.caseSummary?.critical_count ?? d.metrics?.critical_count ?? 0) > 0 ? "critical" : "low"),
        getValue: (d) => (d.caseSummary?.case_count ?? d.metrics?.anomaly_count ?? 0).toLocaleString(),
      },
      whenFalse: {
        label: "Open assurance cases",
        note: "Review by pillar",
        href: "/dashboard/outbound/anomalies",
        tone: (d) => ((d.caseSummary?.critical_count ?? d.metrics?.critical_count ?? 0) > 0 ? "critical" : "low"),
        getValue: (d) => (d.caseSummary?.case_count ?? d.metrics?.anomaly_count ?? 0).toLocaleString(),
      },
    },
    {
      permission: null,
      whenTrue: {
        label: "Reconciliation Rate",
        progress: (d) => d.metrics?.reconciliation_rate,
        tone: (d) => ((d.metrics?.reconciliation_rate ?? 0) >= 90 ? "low" : "medium"),
        getValue: (d) => `${(d.metrics?.reconciliation_rate ?? 0).toFixed(1)}%`,
      },
      whenFalse: {
        label: "Reconciliation Rate",
        progress: (d) => d.metrics?.reconciliation_rate,
        tone: (d) => ((d.metrics?.reconciliation_rate ?? 0) >= 90 ? "low" : "medium"),
        getValue: (d) => `${(d.metrics?.reconciliation_rate ?? 0).toFixed(1)}%`,
      },
    },
    {
      permission: null,
      whenTrue: {
        label: "Funds flagged for review",
        note: "Deduplicated case exposure",
        href: "/dashboard/outbound/anomalies",
        tone: () => "info",
        getValue: (d) => formatKesCompact(d.caseSummary?.amount_at_risk ?? d.metrics?.total_leakage_kes ?? 0),
      },
      whenFalse: {
        label: "Funds flagged for review",
        note: "Deduplicated case exposure",
        href: "/dashboard/outbound/anomalies",
        tone: () => "info",
        getValue: (d) => formatKesCompact(d.caseSummary?.amount_at_risk ?? d.metrics?.total_leakage_kes ?? 0),
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Anomalies — AnomaliesTable
// ---------------------------------------------------------------------------

export interface AnomaliesConfig {
  columns: Partial<Record<keyof Anomaly, string>>;
  breakTypeOptions: { value: BreakType; label: string }[];
  idLabel: string; // "Dispatch ID" vs "Attendance / Disb. ID" — the natural-key column header
  entityLabel: string; // "OMC" vs "Beneficiary" — used in copy ("Customer OMC", modal subtitle, etc.)
  productLabel: string; // "Product" vs "Pillar"
  showEbilling: boolean; // outbound rows are always ebilling_status="N/A" — hide that whole section
  investigationTitle: string; // "Waybill" vs "Case" — the investigation modal's title prefix
  sourceRecordsLabel: string; // "Waybill Gantry Records" vs "Attendance Records"
  secondaryRecordLabel: string; // "Invoice" vs "Authorization"
  paymentRecordLabel: string; // "Payment" vs "Disbursement"
  endpointDirection: WorkspaceDirection;
}

export const anomaliesConfig: Record<WorkspaceDirection, AnomaliesConfig> = {
  inbound: {
    columns: {
      customer: "Customer OMC",
      product: "Product",
      dispatched_kes: "Dispatched",
      invoiced_kes: "Invoiced",
      paid_kes: "Paid",
    },
    breakTypeOptions: [
      { value: "Missing Invoice", label: "Missing Invoice" },
      { value: "Missing Payment", label: "Missing Payment" },
      { value: "Underpayment", label: "Underpayment" },
      { value: "Overpayment", label: "Overpayment" },
    ],
    idLabel: "Dispatch ID",
    entityLabel: "Customer OMC",
    productLabel: "Product Category",
    showEbilling: true,
    investigationTitle: "Waybill",
    sourceRecordsLabel: "Waybill Gantry Records",
    secondaryRecordLabel: "Invoice",
    paymentRecordLabel: "Payment",
    endpointDirection: "inbound",
  },
  outbound: {
    columns: {
      customer: "Beneficiary",
      product: "Pillar",
      dispatched_kes: "Eligible",
      invoiced_kes: "Authorized",
      paid_kes: "Disbursed",
    },
    breakTypeOptions: [
      { value: "Missing Authorization", label: "Missing Authorization" },
      { value: "Missing Disbursement", label: "Missing Disbursement" },
      { value: "Underpayment", label: "Underpayment" },
      { value: "Overpayment", label: "Overpayment" },
      { value: "Ghost Payment", label: "Ghost Payment" },
      { value: "Duplicate Disbursement", label: "Duplicate Disbursement" },
    ],
    idLabel: "Attendance / Disb. ID",
    entityLabel: "Beneficiary",
    productLabel: "Pillar",
    showEbilling: false,
    investigationTitle: "Case",
    sourceRecordsLabel: "Attendance Records",
    secondaryRecordLabel: "Authorization",
    paymentRecordLabel: "Disbursement",
    endpointDirection: "outbound",
  },
};

// ---------------------------------------------------------------------------
// Leakage Explorer — Heatmap
// ---------------------------------------------------------------------------

export interface HeatmapConfig {
  rowLabel: string; // "OMC Customer" vs "Beneficiary"
  columnLabel: string; // "Product Group" vs "Pillar"
  description: string;
  barDescription: string;
  /** The Map view is KPC's physical depot/pipeline geography — no
   * outbound equivalent exists (no beneficiary geography concept), so
   * that toggle is hidden rather than shown against data that doesn't
   * mean anything for this direction. */
  showMapView: boolean;
}

export const heatmapConfig: Record<WorkspaceDirection, HeatmapConfig> = {
  inbound: {
    rowLabel: "OMC Customer",
    columnLabel: "Product Group",
    description: "Every OMC × product leakage combination, sorted by value",
    barDescription: "Total leakage by Oil Marketing Company, ranked highest to lowest",
    showMapView: true,
  },
  outbound: {
    rowLabel: "Beneficiary",
    columnLabel: "Pillar",
    description: "Every beneficiary × pillar leakage combination, sorted by value",
    barDescription: "Total leakage by beneficiary, ranked highest to lowest",
    showMapView: false,
  },
};

// ---------------------------------------------------------------------------
// Risk Intelligence — FraudGraph
// ---------------------------------------------------------------------------

export interface RiskConfig {
  title: string;
  description: string;
}

export const riskConfig: Record<WorkspaceDirection, RiskConfig> = {
  inbound: {
    title: "OMC ↔ Depot Leakage Network",
    description: "Community-clustered leakage graph across OMCs and depots",
  },
  outbound: {
    title: "Officer ↔ Beneficiary Leakage Network",
    description: "Community-clustered leakage graph across field officers and beneficiaries",
  },
};

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface ReportsConfig {
  exportLabel: string;
  showEbillingLogs: boolean;
}

export const reportsConfig: Record<WorkspaceDirection, ReportsConfig> = {
  inbound: { exportLabel: "Export dispatch/invoice/payment workbook", showEbillingLogs: true },
  outbound: { exportLabel: "Export attendance/authorization/disbursement workbook", showEbillingLogs: false },
};
