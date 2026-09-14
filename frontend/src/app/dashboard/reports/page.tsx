"use client";

import { useEffect, useState, useMemo } from "react";
import { ApiError, downloadExportWithFields, getAnomalies, getMetrics, getEbillingLogs } from "@/lib/api";
import { useMateriality } from "@/context/MaterialityContext";
import { useDirection } from "@/context/DirectionContext";
import RequirePermission from "@/components/RequirePermission";
import ConsentModal from "@/components/ConsentModal";
import FieldSelectorModal from "@/components/FieldSelectorModal";
import ReportVerifierModal from "@/components/ReportVerifierModal";
import RecordHistoryDrawer from "@/components/RecordHistoryDrawer";
import type { Metrics, Anomaly, EbillingLogEntry } from "@/lib/types";

type Domain = "oil" | "inuka";
type OilReportType = "operational" | "financial" | "icms";
type InukaReportType = "inuka_stipend" | "inuka_officer";
type ReportType = OilReportType | InukaReportType;
type DateWindow = "all" | "30" | "90";

const REPORT_META: Record<ReportType, { title: string; subtitle: string; question: string }> = {
  operational: {
    title: "Operational Audit",
    subtitle: "Dispatch-to-invoice control",
    question: "Which dispatched loads were not invoiced correctly?",
  },
  financial: {
    title: "Financial Settlement",
    subtitle: "Invoice-to-payment control",
    question: "Which invoices remain unpaid or incorrectly settled?",
  },
  icms: {
    title: "iCMS Tax Declarations",
    subtitle: "KRA e-billing transmission control",
    question: "Which declarations failed, are pending, or require retry?",
  },
  inuka_stipend: {
    title: "Stipend Governance",
    subtitle: "Authorization-to-disbursement control",
    question: "Which beneficiary payments break authorization and payment controls?",
  },
  inuka_officer: {
    title: "Officer Assurance",
    subtitle: "Officer-attributed control profile",
    question: "Where are cases and exposure concentrated by responsible officer?",
  },
};

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatKesCompact(value: number): string {
  if (value >= 1e9) return `KES ${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `KES ${(value / 1e6).toFixed(2)}M`;
  return formatKes(value);
}

function maskIdentity(value: string): string {
  if (!value || value === "N/A") return "Protected beneficiary";
  if (value.length <= 4) return `${value.slice(0, 1)}***`;
  return `${value.slice(0, 2)}${"•".repeat(Math.min(6, value.length - 3))}${value.slice(-1)}`;
}

function InsightBar({
  label,
  value,
  total,
  active,
  onClick,
}: {
  label: string;
  value: number;
  total: number;
  active: boolean;
  onClick: () => void;
}) {
  const width = total > 0 ? Math.max(4, (value / total) * 100) : 0;
  return (
    <button type="button" onClick={onClick} className="group w-full text-left" aria-pressed={active}>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
        <span className={`font-semibold ${active ? "text-[#b3312c] dark:text-[#ec835a]" : "text-[#514b47] dark:text-[#d1ccca]"}`}>{label}</span>
        <span className="font-mono font-bold text-[#26221f] dark:text-[#f5f2ef]">{value}</span>
      </div>
      <div className={`h-2.5 overflow-hidden rounded-full ${active ? "bg-[#b3312c]/20" : "bg-[#e8e3de] dark:bg-[#33302c]"}`}>
        <div className={`h-full rounded-full transition-all duration-500 ${active ? "bg-[#b3312c]" : "bg-[#cc6b45] group-hover:bg-[#b3312c]"}`} style={{ width: `${width}%` }} />
      </div>
    </button>
  );
}

function ReportsContent() {
  const { materiality } = useMateriality();
  const { direction, setDirection } = useDirection();
  
  // Current active domain: "oil" or "inuka"
  const [activeDomain, setActiveDomain] = useState<Domain>(() =>
    direction === "outbound" ? "inuka" : "oil"
  );

  // Current active report focus
  const [reportType, setReportType] = useState<ReportType>(() =>
    direction === "outbound" ? "inuka_stipend" : "operational"
  );

  // Data states
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [icmsLogs, setIcmsLogs] = useState<EbillingLogEntry[]>([]);

  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modals state
  const [isFieldSelectorOpen, setIsFieldSelectorOpen] = useState(false);
  const [isVerifierOpen, setIsVerifierOpen] = useState(false);
  // Deliberately starts open on every Reports page mount. Acceptance is not
  // reused to silently bypass the notice when a user re-enters this module.
  const [isConsentOpen, setIsConsentOpen] = useState(true);
  const [historyTarget, setHistoryTarget] = useState<{ type: string; id: string } | null>(null);

  // Search & Pagination
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [dateWindow, setDateWindow] = useState<DateWindow>("all");
  const [dateCutoff, setDateCutoff] = useState<number | null>(null);
  const [activeBreakType, setActiveBreakType] = useState<string | null>(null);
  const itemsPerPage = 8;

  // Switch domain between Oil and Inuka
  const handleDomainChange = (domain: Domain) => {
    setActiveDomain(domain);
    setCurrentPage(1);
    setSearchQuery("");
    setDateWindow("all");
    setDateCutoff(null);
    setActiveBreakType(null);
    if (domain === "oil") {
      setDirection("inbound");
      setReportType("operational");
    } else {
      setDirection("outbound");
      setReportType("inuka_stipend");
    }
  };

  const handleReportTypeChange = (type: ReportType) => {
    setReportType(type);
    setCurrentPage(1);
    setActiveBreakType(null);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  };

  function handleDateWindowChange(value: DateWindow) {
    setDateWindow(value);
    setDateCutoff(value === "all" ? null : Date.now() - Number(value) * 24 * 60 * 60 * 1000);
    setCurrentPage(1);
  }

  // Load metrics & data
  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const scopedDirection = activeDomain === "oil" ? "inbound" : "outbound";
        const [metricsRes, anomalyRes] = await Promise.all([
          getMetrics(materiality, scopedDirection),
          getAnomalies(materiality, 1, 100, {}, scopedDirection),
        ]);
        if (cancelled) return;
        setMetrics(metricsRes.metrics);
        setAnomalies(anomalyRes.anomalies || []);

        if (reportType === "icms") {
          const logsRes = await getEbillingLogs(100);
          if (cancelled) return;
          setIcmsLogs(logsRes);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Failed to load report data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadData();
    return () => {
      cancelled = true;
    };
  }, [materiality, activeDomain, reportType]);

  // Filter preview data
  const filteredPreviewData = useMemo(() => {
    const query = searchQuery.toLowerCase();
    if (reportType === "icms") {
      return icmsLogs.filter(
        (log) =>
          log.invoice_id.toLowerCase().includes(query) ||
          (log.customer_name && log.customer_name.toLowerCase().includes(query)) ||
          (log.error_message && log.error_message.toLowerCase().includes(query))
      );
    }

    return anomalies.filter((a) => {
      if (activeBreakType && a.break_type !== activeBreakType) return false;
      if (dateCutoff !== null && a.created_at) {
        const created = new Date(a.created_at).getTime();
        if (!Number.isNaN(created) && created < dateCutoff) return false;
      }
      const matchesSearch =
        a.dispatch_id.toLowerCase().includes(query) ||
        a.customer.toLowerCase().includes(query) ||
        a.product.toLowerCase().includes(query) ||
        (a.invoice_id && a.invoice_id.toLowerCase().includes(query)) ||
        a.break_type.toLowerCase().includes(query);

      if (!matchesSearch) return false;

      if (reportType === "operational") {
        return a.break_type === "Missing Invoice" || a.break_type === "Underpayment";
      } else if (reportType === "financial") {
        return a.break_type === "Missing Payment" || a.break_type === "Underpayment" || a.break_type === "Overpayment";
      } else if (reportType === "inuka_stipend" || reportType === "inuka_officer") {
        return (
          a.flow_direction === "outbound" ||
          a.break_type === "Ghost Payment" ||
          a.break_type === "Duplicate Disbursement" ||
          a.break_type === "Overpayment" ||
          a.break_type === "Underpayment"
        );
      }
      return true;
    });
  }, [anomalies, icmsLogs, reportType, searchQuery, activeBreakType, dateCutoff]);

  const scopedAnomalies = useMemo(() => {
    if (reportType === "operational") return anomalies.filter((a) => a.break_type === "Missing Invoice" || a.break_type === "Underpayment");
    if (reportType === "financial") return anomalies.filter((a) => ["Missing Payment", "Underpayment", "Overpayment"].includes(a.break_type));
    return anomalies.filter((a) => a.flow_direction === "outbound");
  }, [anomalies, reportType]);

  const breakDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    scopedAnomalies.forEach((a) => counts.set(a.break_type, (counts.get(a.break_type) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [scopedAnomalies]);

  const statusDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    scopedAnomalies.forEach((a) => counts.set(a.status, (counts.get(a.status) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [scopedAnomalies]);

  const totalScopedExposure = scopedAnomalies.reduce((sum, a) => sum + a.leakage_kes, 0);
  const criticalScoped = scopedAnomalies.filter((a) => a.status === "Critical").length;
  const resolvedScoped = scopedAnomalies.filter((a) => a.status === "Resolved").length;
  const topConcentration = useMemo(() => {
    const totals = new Map<string, number>();
    scopedAnomalies.forEach((a) => {
      const key = reportType === "inuka_officer" ? (a.officer_id || "Unassigned") : (a.depot || a.customer || "Unknown");
      totals.set(key, (totals.get(key) || 0) + a.leakage_kes);
    });
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [scopedAnomalies, reportType]);

  // Pagination math
  const totalItems = filteredPreviewData.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredPreviewData.slice(start, start + itemsPerPage);
  }, [filteredPreviewData, currentPage]);

  // Export handlers
  function handleExportExcel() {
    setIsFieldSelectorOpen(true);
  }

  async function handleConfirmFilteredExport(fields: string[], maskSensitive = true) {
    setExporting(true);
    setError(null);
    try {
      const blob = await downloadExportWithFields(materiality, fields, activeDomain === "oil" ? "inbound" : "outbound", maskSensitive);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kpc_${activeDomain}_${reportType}_report_m${materiality}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setIsFieldSelectorOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not download the Excel report.");
    } finally {
      setExporting(false);
    }
  }

  function handleExportCsv() {
    if (filteredPreviewData.length === 0) {
      alert("No data available to export in the active report filter.");
      return;
    }

    let csvHeaders: string[] = [];
    let csvRows: string[][] = [];
    const filename = `kpc_${activeDomain}_${reportType}_report.csv`;

    if (reportType === "icms") {
      csvHeaders = ["Invoice ID", "Customer Name", "Invoiced Value (KES)", "Sync Status", "Retries", "Sync Date", "Error Details"];
      csvRows = (filteredPreviewData as EbillingLogEntry[]).map((log) => [
        log.invoice_id,
        log.customer_name ?? "N/A",
        String(log.value_kes ?? 0),
        log.status,
        String(log.retry_count),
        log.sync_date || log.last_attempt || "N/A",
        log.error_message || "None",
      ]);
    } else {
      csvHeaders = ["Record ID", "Invoice ID", "OMC / Beneficiary", "Product / Category", "Dispatched / Baseline (KES)", "Invoiced / Paid (KES)", "Leakage Gap (KES)", "Status"];
      csvRows = (filteredPreviewData as Anomaly[]).map((a) => [
        a.dispatch_id,
        a.invoice_id ?? "N/A",
        activeDomain === "inuka" ? maskIdentity(a.customer) : a.customer,
        a.product,
        String(a.dispatched_kes),
        String(a.invoiced_kes),
        String(a.leakage_kes),
        a.status,
      ]);
    }

    const csvContent = "data:text/csv;charset=utf-8," + [csvHeaders.join(","), ...csvRows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function handlePrintPdf() {
    window.print();
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1700px] mx-auto px-2 sm:px-4 text-[#26221f] dark:text-[#f5f2ef]">
      
      {/* Page Header */}
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-2 border-b border-[#e8e3de] dark:border-[#33302c]">
        <div>
          <span className="text-xs font-extrabold text-[#b3312c] dark:text-[#ec835a] uppercase tracking-wider">
            Reconova Revenue Assurance & Governance Center
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#26221f] dark:text-[#f5f2ef] mt-1">
            Reports & Audit Center
          </h1>
          <p className="text-xs sm:text-sm text-[#736c67] dark:text-[#b2aeac] mt-1">
            Inspect, filter, export, and verify authentic reports across Oil Revenue Assurance and Inuka Stipend Governance.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsConsentOpen(true)}
          className="px-3.5 py-2 text-xs font-bold bg-[#f1ede9] dark:bg-[#2a2725] hover:bg-[#e8e3de] dark:hover:bg-[#33302c] text-[#26221f] dark:text-[#f5f2ef] border border-[#e8e3de] dark:border-[#33302c] rounded-xl transition flex items-center space-x-1.5 cursor-pointer shrink-0"
        >
          <svg className="w-4 h-4 text-[#b3312c]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span>Data Privacy Notice</span>
        </button>
      </header>

      {error && (
        <div className="rounded-xl border border-[#d03b3b]/30 bg-[#fdecec] dark:bg-[#d03b3b]/20 p-4 text-xs text-[#d03b3b] dark:text-[#f87171]">
          {error}
        </div>
      )}

      {/* 1. TOP SECTION: REPORT FOCUS WITH DOMAIN DISTINCTION */}
      <section className="bg-[#ffffff] dark:bg-[#221d1a] border border-[#e8e3de] dark:border-[#33302c] rounded-2xl p-6 shadow-sm flex flex-col gap-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#e8e3de] dark:border-[#33302c] pb-4">
          <div>
            <h2 className="text-lg font-extrabold text-[#26221f] dark:text-[#f5f2ef] uppercase tracking-wide">
              Report Focus
            </h2>
            <p className="text-xs sm:text-sm font-medium text-[#736c67] dark:text-[#b2aeac] mt-1">
              Select the operational or governance view to inspect and export
            </p>
          </div>

          {/* Domain Switcher Pills */}
          <div className="flex items-center space-x-2 bg-[#f1ede9] dark:bg-[#2a2725] p-1.5 rounded-xl border border-[#e8e3de] dark:border-[#33302c]">
            <button
              type="button"
              onClick={() => handleDomainChange("oil")}
              className={`px-4 py-2 text-xs sm:text-sm font-extrabold rounded-lg transition-colors flex items-center space-x-2 ${
                activeDomain === "oil"
                  ? "bg-[#b3312c] text-white shadow-sm"
                  : "text-[#736c67] dark:text-[#b2aeac] hover:text-[#26221f] dark:hover:text-[#f5f2ef]"
              }`}
            >
              <span>🛢️ Oil Revenue Side</span>
            </button>
            <button
              type="button"
              onClick={() => handleDomainChange("inuka")}
              className={`px-4 py-2 text-xs sm:text-sm font-extrabold rounded-lg transition-colors flex items-center space-x-2 ${
                activeDomain === "inuka"
                  ? "bg-[#b3312c] text-white shadow-sm"
                  : "text-[#736c67] dark:text-[#b2aeac] hover:text-[#26221f] dark:hover:text-[#f5f2ef]"
              }`}
            >
              <span>🎓 Inuka Side</span>
            </button>
          </div>
        </div>

        {/* DOMAIN SPECIFIC REPORT FOCUS CARDS */}
        {activeDomain === "oil" ? (
          /* OIL REVENUE SIDE REPORT FOCUS CARDS */
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Operational Audit */}
            <div
              onClick={() => handleReportTypeChange("operational")}
              className={`p-5 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between space-y-3 ${
                reportType === "operational"
                  ? "bg-[#b3312c]/10 dark:bg-[#b3312c]/20 border-[#b3312c] text-[#b3312c] dark:text-[#ec835a] shadow-md ring-2 ring-[#b3312c]/30"
                  : "bg-[#f1ede9]/50 dark:bg-[#2a2725]/50 border-[#e8e3de] dark:border-[#33302c] hover:border-[#b3312c]/40 text-[#26221f] dark:text-[#f5f2ef]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider">Operational Audit</span>
                {reportType === "operational" && <span className="w-2.5 h-2.5 rounded-full bg-[#b3312c]" />}
              </div>
              <p className="text-xs text-[#736c67] dark:text-[#b2aeac] leading-relaxed">
                Audits fuel dispatch volume matching & ghost loads (KPC inbound).
              </p>
            </div>

            {/* Financial Settlement */}
            <div
              onClick={() => handleReportTypeChange("financial")}
              className={`p-5 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between space-y-3 ${
                reportType === "financial"
                  ? "bg-[#b3312c]/10 dark:bg-[#b3312c]/20 border-[#b3312c] text-[#b3312c] dark:text-[#ec835a] shadow-md ring-2 ring-[#b3312c]/30"
                  : "bg-[#f1ede9]/50 dark:bg-[#2a2725]/50 border-[#e8e3de] dark:border-[#33302c] hover:border-[#b3312c]/40 text-[#26221f] dark:text-[#f5f2ef]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider">Financial Settlement</span>
                {reportType === "financial" && <span className="w-2.5 h-2.5 rounded-full bg-[#b3312c]" />}
              </div>
              <p className="text-xs text-[#736c67] dark:text-[#b2aeac] leading-relaxed">
                Audits commercial invoiced values against bank cash deposits.
              </p>
            </div>

            {/* iCMS Tax Sync */}
            <div
              onClick={() => handleReportTypeChange("icms")}
              className={`p-5 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between space-y-3 ${
                reportType === "icms"
                  ? "bg-[#b3312c]/10 dark:bg-[#b3312c]/20 border-[#b3312c] text-[#b3312c] dark:text-[#ec835a] shadow-md ring-2 ring-[#b3312c]/30"
                  : "bg-[#f1ede9]/50 dark:bg-[#2a2725]/50 border-[#e8e3de] dark:border-[#33302c] hover:border-[#b3312c]/40 text-[#26221f] dark:text-[#f5f2ef]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider">iCMS Tax Declarations</span>
                {reportType === "icms" && <span className="w-2.5 h-2.5 rounded-full bg-[#b3312c]" />}
              </div>
              <p className="text-xs text-[#736c67] dark:text-[#b2aeac] leading-relaxed">
                Audits KRA electronic billing status, PIN validations & retry logs.
              </p>
            </div>
          </div>
        ) : (
          /* INUKA SIDE REPORT FOCUS CARDS */
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Inuka Stipend Governance */}
            <div
              onClick={() => handleReportTypeChange("inuka_stipend")}
              className={`p-5 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between space-y-3 ${
                reportType === "inuka_stipend"
                  ? "bg-[#b3312c]/10 dark:bg-[#b3312c]/20 border-[#b3312c] text-[#b3312c] dark:text-[#ec835a] shadow-md ring-2 ring-[#b3312c]/30"
                  : "bg-[#f1ede9]/50 dark:bg-[#2a2725]/50 border-[#e8e3de] dark:border-[#33302c] hover:border-[#b3312c]/40 text-[#26221f] dark:text-[#f5f2ef]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider">Inuka Stipend Governance</span>
                {reportType === "inuka_stipend" && <span className="w-2.5 h-2.5 rounded-full bg-[#b3312c]" />}
              </div>
              <p className="text-xs text-[#736c67] dark:text-[#b2aeac] leading-relaxed">
                Audits beneficiary attendance, stipend authorizations & MPESA payments (Outbound).
              </p>
            </div>

            {/* Officer Assurance */}
            <div
              onClick={() => handleReportTypeChange("inuka_officer")}
              className={`p-5 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between space-y-3 ${
                reportType === "inuka_officer"
                  ? "bg-[#b3312c]/10 dark:bg-[#b3312c]/20 border-[#b3312c] text-[#b3312c] dark:text-[#ec835a] shadow-md ring-2 ring-[#b3312c]/30"
                  : "bg-[#f1ede9]/50 dark:bg-[#2a2725]/50 border-[#e8e3de] dark:border-[#33302c] hover:border-[#b3312c]/40 text-[#26221f] dark:text-[#f5f2ef]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider">Officer Assurance Profile</span>
                {reportType === "inuka_officer" && <span className="w-2.5 h-2.5 rounded-full bg-[#b3312c]" />}
              </div>
              <p className="text-xs text-[#736c67] dark:text-[#b2aeac] leading-relaxed">
                Audits officer-attributed risk cases, review notes, and assurance escalations.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* DOMAIN-SCOPED ANALYTICS WORKSPACE */}
      <section className="space-y-5" aria-label={`${activeDomain} report analytics`}>
        <div className={`rounded-2xl border p-5 sm:p-6 ${activeDomain === "oil" ? "border-[#b3312c]/25 bg-[#fff8f5] dark:bg-[#281d19]" : "border-[#2a78d6]/25 bg-[#f5f9ff] dark:bg-[#19222d]"}`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${activeDomain === "oil" ? "bg-[#b3312c] text-white" : "bg-[#2a78d6] text-white"}`}>
                  {activeDomain === "oil" ? "Oil revenue domain" : "Inuka programme domain"}
                </span>
                <span className="rounded-full border border-[#e8e3de] bg-white/80 px-2.5 py-1 text-[10px] font-bold text-[#736c67] dark:border-[#3c3936] dark:bg-black/20 dark:text-[#b2aeac]">
                  Live assurance view
                </span>
                <span className="rounded-full border border-[#0ca30c]/25 bg-[#0ca30c]/10 px-2.5 py-1 text-[10px] font-bold text-[#087d08] dark:text-[#4ade80]">
                  PII masked by default
                </span>
              </div>
              <h2 className="text-xl font-black text-[#26221f] dark:text-[#f5f2ef]">{REPORT_META[reportType].title}</h2>
              <p className="mt-1 text-sm font-medium text-[#736c67] dark:text-[#b2aeac]">{REPORT_META[reportType].question}</p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1 text-[10px] font-extrabold uppercase tracking-wider text-[#736c67] dark:text-[#b2aeac]">
                Reporting window
                <select value={dateWindow} onChange={(e) => handleDateWindowChange(e.target.value as DateWindow)} className="block min-w-40 rounded-xl border border-[#e8e3de] bg-white px-3 py-2 text-xs font-bold normal-case text-[#26221f] dark:border-[#33302c] dark:bg-[#171310] dark:text-[#f5f2ef]">
                  <option value="all">All available data</option>
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                </select>
              </label>
              {(activeBreakType || dateWindow !== "all") && (
                <button type="button" onClick={() => { setActiveBreakType(null); setDateWindow("all"); setDateCutoff(null); setCurrentPage(1); }} className="rounded-xl border border-[#e8e3de] bg-white px-3 py-2 text-xs font-bold text-[#b3312c] dark:border-[#33302c] dark:bg-[#171310] dark:text-[#ec835a]">
                  Clear filters
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: activeDomain === "oil" ? "Exposure identified" : "Funds at risk", value: formatKesCompact(totalScopedExposure), note: `${scopedAnomalies.length} control exceptions` },
            { label: "Critical cases", value: criticalScoped.toLocaleString(), note: "Requires priority review" },
            { label: "Reconciliation rate", value: `${(metrics?.reconciliation_rate || 0).toFixed(1)}%`, note: activeDomain === "oil" ? "Dispatch → invoice → payment" : "Participation → authorization → payment" },
            { label: "Resolved records", value: resolvedScoped.toLocaleString(), note: scopedAnomalies.length ? `${((resolvedScoped / scopedAnomalies.length) * 100).toFixed(1)}% of report population` : "No report population" },
          ].map((card) => (
            <article key={card.label} className="rounded-2xl border border-[#e8e3de] bg-white p-4 shadow-sm dark:border-[#33302c] dark:bg-[#221d1a]">
              <p className="text-[10px] font-black uppercase tracking-wider text-[#736c67] dark:text-[#b2aeac]">{card.label}</p>
              <p className="mt-2 text-xl font-black text-[#26221f] dark:text-[#f5f2ef] sm:text-2xl">{card.value}</p>
              <p className="mt-1 text-[11px] text-[#8a817c] dark:text-[#9f9995]">{card.note}</p>
            </article>
          ))}
        </div>

        {reportType === "icms" ? (
          <div className="grid gap-4 lg:grid-cols-3">
            {(["synced", "failed", "pending"] as const).map((status) => {
              const count = icmsLogs.filter((log) => log.status === status).length;
              return <article key={status} className="rounded-2xl border border-[#e8e3de] bg-white p-5 dark:border-[#33302c] dark:bg-[#221d1a]"><p className="text-xs font-black uppercase text-[#736c67] dark:text-[#b2aeac]">{status}</p><p className="mt-2 text-3xl font-black text-[#26221f] dark:text-[#f5f2ef]">{count}</p><div className="mt-4 h-2 rounded-full bg-[#e8e3de] dark:bg-[#33302c]"><div className={`h-2 rounded-full ${status === "synced" ? "bg-[#0ca30c]" : status === "failed" ? "bg-[#d03b3b]" : "bg-[#b6790a]"}`} style={{ width: `${icmsLogs.length ? (count / icmsLogs.length) * 100 : 0}%` }} /></div></article>;
            })}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-5">
            <article className="rounded-2xl border border-[#e8e3de] bg-white p-5 dark:border-[#33302c] dark:bg-[#221d1a] lg:col-span-2">
              <div className="mb-5 flex items-start justify-between gap-3"><div><h3 className="text-sm font-black text-[#26221f] dark:text-[#f5f2ef]">Exceptions by control break</h3><p className="mt-1 text-xs text-[#736c67] dark:text-[#b2aeac]">Select a bar to filter the evidence table.</p></div>{activeBreakType && <button type="button" onClick={() => setActiveBreakType(null)} className="text-[10px] font-black uppercase text-[#b3312c] dark:text-[#ec835a]">Reset</button>}</div>
              <div className="space-y-4">
                {breakDistribution.length ? breakDistribution.map(([label, value]) => <InsightBar key={label} label={label} value={value} total={scopedAnomalies.length} active={activeBreakType === label} onClick={() => { setActiveBreakType(activeBreakType === label ? null : label); setCurrentPage(1); }} />) : <p className="py-10 text-center text-xs text-[#736c67]">No exception distribution available.</p>}
              </div>
            </article>
            <article className="rounded-2xl border border-[#e8e3de] bg-white p-5 dark:border-[#33302c] dark:bg-[#221d1a] lg:col-span-3">
              <div className="mb-5"><h3 className="text-sm font-black text-[#26221f] dark:text-[#f5f2ef]">{reportType === "inuka_officer" ? "Exposure by officer" : activeDomain === "oil" ? "Exposure concentration" : "Exposure by pillar / beneficiary group"}</h3><p className="mt-1 text-xs text-[#736c67] dark:text-[#b2aeac]">Top five concentrations in this report population.</p></div>
              <div className="flex h-56 items-end gap-3 border-b border-[#e8e3de] px-1 pt-5 dark:border-[#33302c]">
                {topConcentration.map(([label, amount]) => {
                  const max = topConcentration[0]?.[1] || 1;
                  return <div key={label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2" title={`${label}: ${formatKes(amount)}`}><span className="text-[10px] font-bold text-[#736c67] dark:text-[#b2aeac]">{formatKesCompact(amount)}</span><div className={`w-full max-w-20 rounded-t-lg transition-all hover:opacity-80 ${activeDomain === "oil" ? "bg-gradient-to-t from-[#b3312c] to-[#ec835a]" : "bg-gradient-to-t from-[#2a78d6] to-[#68a6ed]"}`} style={{ height: `${Math.max(10, (amount / max) * 150)}px` }} /><span className="w-full truncate text-center text-[10px] font-semibold text-[#514b47] dark:text-[#d1ccca]">{activeDomain === "inuka" ? maskIdentity(label) : label}</span></div>;
                })}
              </div>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-[#736c67] dark:text-[#b2aeac]">{statusDistribution.map(([status, count]) => <span key={status}><strong className="text-[#26221f] dark:text-[#f5f2ef]">{count}</strong> {status}</span>)}</div>
            </article>
          </div>
        )}
      </section>

      {/* 2. SECOND SECTION: PREVIEW OF THE REPORT SELECTED */}
      <section className="bg-[#ffffff] dark:bg-[#221d1a] border border-[#e8e3de] dark:border-[#33302c] rounded-2xl p-6 shadow-sm flex flex-col gap-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-[#e8e3de] dark:border-[#33302c] pb-4">
          <div>
            <h2 className="text-lg font-extrabold text-[#26221f] dark:text-[#f5f2ef] uppercase tracking-wide">
              Evidence Records · {REPORT_META[reportType].title}
            </h2>
            <p className="text-xs sm:text-sm font-medium text-[#736c67] dark:text-[#b2aeac] mt-1">
              {activeDomain === "oil" ? `Showing records above the KES ${materiality.toLocaleString()} materiality threshold.` : "Showing the full outbound control population. Beneficiary identifiers are masked in this view."}
            </p>
          </div>

          <div className="relative w-full sm:w-72">
            <input
              type="text"
              placeholder={activeDomain === "oil" ? "Search waybills, OMCs, products..." : "Search cases, beneficiaries, pillars..."}
              value={searchQuery}
              onChange={handleSearchChange}
              className="w-full px-4 py-2 text-xs bg-[#f7f6f4] dark:bg-[#171310] border border-[#e8e3de] dark:border-[#33302c] rounded-xl text-[#26221f] dark:text-[#f5f2ef] focus:outline-none focus:border-[#b3312c]"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-[#b3312c]/30 border-t-[#b3312c] animate-spin" />
            <span className="text-xs text-[#736c67] dark:text-[#b2aeac]">Loading report records...</span>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-[#e8e3de] dark:border-[#33302c]">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-[#f1ede9] dark:bg-[#2a2725] text-[#26221f] dark:text-[#f5f2ef] font-bold uppercase text-[11px] tracking-wider border-b border-[#e8e3de] dark:border-[#33302c]">
                  <tr>
                    {reportType === "icms" ? (
                      <>
                        <th className="px-4 py-3">Invoice ID</th>
                        <th className="px-4 py-3">Customer OMC</th>
                        <th className="px-4 py-3">Value (KES)</th>
                        <th className="px-4 py-3">KRA iCMS Status</th>
                        <th className="px-4 py-3">Sync Date</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </>
                    ) : (
                      <>
                        <th className="px-4 py-3">{activeDomain === "oil" ? "Dispatch / Waybill" : "Assurance Case"}</th>
                        <th className="px-4 py-3">{activeDomain === "oil" ? "Oil Marketing Company" : "Beneficiary (masked)"}</th>
                        <th className="px-4 py-3">{activeDomain === "oil" ? "Product" : "Pillar / Category"}</th>
                        <th className="px-4 py-3">{activeDomain === "oil" ? "Expected revenue" : "Authorized amount"}</th>
                        <th className="px-4 py-3">{activeDomain === "oil" ? "Revenue gap" : "Funds at risk"}</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Provenance</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e8e3de] dark:divide-[#33302c]">
                  {paginatedData.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-[#736c67] dark:text-[#b2aeac] italic">
                        No records match the active search and materiality criteria.
                      </td>
                    </tr>
                  ) : reportType === "icms" ? (
                    (paginatedData as EbillingLogEntry[]).map((log) => (
                      <tr key={`${log.invoice_id}-${log.last_attempt}`} className="hover:bg-[#f1ede9]/50 dark:hover:bg-[#2a2725]/50 transition-colors">
                        <td className="px-4 py-3 font-mono font-bold">{log.invoice_id}</td>
                        <td className="px-4 py-3 font-semibold">{log.customer_name ?? "N/A"}</td>
                        <td className="px-4 py-3 font-mono">{formatKes(log.value_kes ?? 0)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                            log.status === "synced"
                              ? "bg-[#0ca30c]/10 text-[#0ca30c] dark:text-[#4ade80] border border-[#0ca30c]/20"
                              : "bg-[#d03b3b]/10 text-[#d03b3b] dark:text-[#f87171] border border-[#d03b3b]/20"
                          }`}>
                            {log.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-[#736c67] dark:text-[#b2aeac]">{log.sync_date || log.last_attempt || "N/A"}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => setHistoryTarget({ type: "Invoice", id: log.invoice_id })}
                            className="px-2.5 py-1 bg-[#b3312c]/10 text-[#b3312c] dark:text-[#ec835a] rounded-lg text-xs font-bold border border-[#b3312c]/20"
                          >
                            History
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    (paginatedData as Anomaly[]).map((a) => (
                      <tr key={a.dispatch_id} className="hover:bg-[#f1ede9]/50 dark:hover:bg-[#2a2725]/50 transition-colors">
                        <td className="px-4 py-3 font-mono font-bold">{a.dispatch_id}</td>
                        <td className="px-4 py-3 font-semibold">{activeDomain === "inuka" ? maskIdentity(a.customer) : a.customer}</td>
                        <td className="px-4 py-3 text-xs text-[#736c67] dark:text-[#b2aeac]">{a.product}</td>
                        <td className="px-4 py-3 font-mono">{formatKes(a.dispatched_kes)}</td>
                        <td className="px-4 py-3 font-mono font-bold text-[#d03b3b] dark:text-[#f87171]">
                          {formatKes(a.leakage_kes)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                            a.status === "Critical"
                              ? "bg-[#d03b3b]/10 text-[#d03b3b] dark:text-[#f87171] border border-[#d03b3b]/20"
                              : a.status === "Resolved"
                              ? "bg-[#0ca30c]/10 text-[#0ca30c] dark:text-[#4ade80] border border-[#0ca30c]/20"
                              : "bg-[#b6790a]/10 text-[#b6790a] dark:text-[#fbbf24] border border-[#b6790a]/20"
                          }`}>
                            {a.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => setHistoryTarget({ type: activeDomain === "oil" ? "Dispatch" : "Inuka Case", id: a.dispatch_id })}
                            className="px-2.5 py-1 bg-[#b3312c]/10 text-[#b3312c] dark:text-[#ec835a] rounded-lg text-xs font-bold border border-[#b3312c]/20"
                          >
                            SHA-256 Audit
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between text-xs text-[#736c67] dark:text-[#b2aeac] pt-2">
              <span>Showing {paginatedData.length ? (currentPage - 1) * itemsPerPage + 1 : 0}–{Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems} rows</span>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 bg-[#f1ede9] dark:bg-[#2a2725] text-[#26221f] dark:text-[#f5f2ef] rounded-lg disabled:opacity-40 font-bold border border-[#e8e3de] dark:border-[#33302c]"
                >
                  Previous
                </button>
                <span className="font-mono font-bold text-[#26221f] dark:text-[#f5f2ef]">Page {currentPage} of {totalPages}</span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="px-3 py-1.5 bg-[#f1ede9] dark:bg-[#2a2725] text-[#26221f] dark:text-[#f5f2ef] rounded-lg disabled:opacity-40 font-bold border border-[#e8e3de] dark:border-[#33302c]"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* 3. THIRD SECTION: EXPORT SECTION WITH MULTI-FORMAT PROVISION */}
      <section className="bg-[#ffffff] dark:bg-[#221d1a] border border-[#e8e3de] dark:border-[#33302c] rounded-2xl p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <h2 className="text-lg font-extrabold text-[#26221f] dark:text-[#f5f2ef] uppercase tracking-wide">
            Export Report Data
          </h2>
          <p className="text-xs sm:text-sm font-medium text-[#736c67] dark:text-[#b2aeac] mt-1">
            Download formatted audit files with KDPA data minimization and PII field selection.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {/* Excel Format */}
          <button
            type="button"
            onClick={handleExportExcel}
            className="px-5 py-3 bg-[#b3312c] hover:bg-[#962723] text-white font-bold text-sm rounded-xl transition shadow-md flex items-center space-x-2 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>Download Excel (.xlsx)</span>
          </button>

          {/* CSV Format */}
          <button
            type="button"
            onClick={handleExportCsv}
            className="px-5 py-3 bg-[#f1ede9] dark:bg-[#2a2725] hover:bg-[#e8e3de] dark:hover:bg-[#33302c] text-[#26221f] dark:text-[#f5f2ef] border border-[#e8e3de] dark:border-[#33302c] font-bold text-sm rounded-xl transition flex items-center space-x-2 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span>Download Masked CSV (.csv)</span>
          </button>

          {/* PDF Format */}
          <button
            type="button"
            onClick={handlePrintPdf}
            className="px-5 py-3 bg-[#2a78d6]/10 hover:bg-[#2a78d6]/20 text-[#2a78d6] dark:text-[#60a5fa] border border-[#2a78d6]/30 font-bold text-sm rounded-xl transition flex items-center space-x-2 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            <span>Print PDF Summary (.pdf)</span>
          </button>
        </div>
      </section>

      {/* 4. FOURTH SECTION: GOVERNANCE HEALTH METRIC & CRYPTOGRAPHIC VERIFIER */}
      <section className="bg-[#f1ede9]/90 dark:bg-[#2a2725]/90 border border-[#e8e3de] dark:border-[#33302c] rounded-2xl p-6 sm:p-7 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 shadow-sm">
        <div className="flex items-center space-x-4">
          <div className="p-3.5 bg-[#b3312c]/10 dark:bg-[#b3312c]/20 rounded-xl text-[#b3312c] dark:text-[#ec835a] border border-[#b3312c]/20 shrink-0">
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm sm:text-base font-black text-[#26221f] dark:text-[#f5f2ef] uppercase tracking-wide">Governance Health Metric:</span>
              <span className="text-sm sm:text-base font-extrabold text-[#b3312c] dark:text-[#ec835a]">98.4% Verified Active Consent & KRA PIN Coverage</span>
            </div>
            <p className="text-xs sm:text-sm font-medium text-[#736c67] dark:text-[#b2aeac] mt-1.5 leading-relaxed">
              Order-to-Cash and Beneficiary Stipend exports are cryptographically signed with SHA-256 digests and audited under KDPA standards, for verifying authenticity of reports gotten from other people.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsVerifierOpen(true)}
          className="px-5 py-3 bg-[#2a78d6]/10 hover:bg-[#2a78d6]/20 text-[#2a78d6] dark:text-[#60a5fa] border border-[#2a78d6]/30 rounded-xl text-sm font-bold transition flex items-center space-x-2 shrink-0 shadow-sm cursor-pointer"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <span>Verify Report File Signature (SHA-256 Check)</span>
        </button>
      </section>

      {/* Governance Modals */}
      <FieldSelectorModal
        isOpen={isFieldSelectorOpen}
        onClose={() => setIsFieldSelectorOpen(false)}
        onConfirmExport={handleConfirmFilteredExport}
        exporting={exporting}
        domain={activeDomain === "oil" ? "kpc" : "inuka"}
      />

      <ReportVerifierModal
        isOpen={isVerifierOpen}
        onClose={() => setIsVerifierOpen(false)}
      />

      <ConsentModal
        forceShow={isConsentOpen}
        onAccept={() => setIsConsentOpen(false)}
      />

      {historyTarget && (
        <RecordHistoryDrawer
          isOpen
          targetType={historyTarget.type}
          targetId={historyTarget.id}
          onClose={() => setHistoryTarget(null)}
        />
      )}
    </div>
  );
}

export default function ReportsPage() {
  return (
    <RequirePermission code="export_reports">
      <ReportsContent />
    </RequirePermission>
  );
}
