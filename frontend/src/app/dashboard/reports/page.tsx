"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { ApiError, downloadExportWithFields, getMetrics, getEbillingLogs } from "@/lib/api";
import { useMateriality } from "@/context/MaterialityContext";
import { useDirection } from "@/context/DirectionContext";
import RequirePermission from "@/components/RequirePermission";
import ConsentModal from "@/components/ConsentModal";
import FieldSelectorModal from "@/components/FieldSelectorModal";
import ReportVerifierModal from "@/components/ReportVerifierModal";
import RecordHistoryDrawer from "@/components/RecordHistoryDrawer";
import type { Metrics, Anomaly, EbillingLogEntry } from "@/lib/types";

type ReportType = "operational" | "financial" | "icms" | "inuka";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatKesCompact(value: number): string {
  if (value >= 1e9) {
    return `KES ${(value / 1e9).toFixed(2)}B`;
  }
  if (value >= 1e6) {
    return `KES ${(value / 1e6).toFixed(2)}M`;
  }
  return formatKes(value);
}

function ReportsContent() {
  const { materiality } = useMateriality();
  const { direction } = useDirection();
  const [reportType, setReportType] = useState<ReportType>("operational");

  // Data states
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [icmsLogs, setIcmsLogs] = useState<EbillingLogEntry[]>([]);

  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Governance Modals State
  const [isFieldSelectorOpen, setIsFieldSelectorOpen] = useState(false);
  const [isVerifierOpen, setIsVerifierOpen] = useState(false);
  const [isConsentOpen, setIsConsentOpen] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<{ type: string; id: string } | null>(null);

  // Interactive Funnel State
  const [activeFunnelFilter, setActiveFunnelFilter] = useState<"all" | "dispatched" | "ghost" | "invoiced" | "unpaid" | "settled">("all");

  // Pagination / Search for the preview table
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  const handleFunnelStageClick = useCallback((stage: "all" | "dispatched" | "ghost" | "invoiced" | "unpaid" | "settled") => {
    setActiveFunnelFilter(stage);
    setCurrentPage(1);
    if (stage === "ghost") {
      setReportType("operational");
      setSearchQuery("Missing Invoice");
    } else if (stage === "unpaid") {
      setReportType("financial");
      setSearchQuery("Missing Payment");
    } else if (stage === "dispatched") {
      setReportType("operational");
      setSearchQuery("");
    } else if (stage === "invoiced") {
      setReportType("financial");
      setSearchQuery("");
    } else {
      setSearchQuery("");
    }
  }, []);

  // Reset page when search or report type changes
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  }, []);

  const handleReportTypeChange = useCallback((type: ReportType) => {
    setReportType(type);
    setCurrentPage(1);
  }, []);

  // Load metrics & anomalies
  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const metricsRes = await getMetrics(materiality, direction);
        if (cancelled) return;
        setMetrics(metricsRes.metrics);
        const anomaliesData = (metricsRes as { anomalies?: Anomaly[] }).anomalies || [];
        setAnomalies(anomaliesData);

        if (reportType === "icms") {
          const logsRes = await getEbillingLogs(100);
          if (cancelled) return;
          setIcmsLogs(logsRes);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Failed to load operational & governance data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadData();
    return () => {
      cancelled = true;
    };
  }, [materiality, direction, reportType]);

  // Funnel calculations
  const funnelData = useMemo(() => {
    const disp = metrics?.total_dispatched_kes ?? 0;
    const inv = metrics?.total_invoiced_kes ?? 0;
    const pay = metrics?.total_paid_kes ?? 0;

    const ghostLeak = metrics?.missing_invoice_leak ?? 0;
    const unpaidLeak = metrics?.missing_payment_leak ?? 0;

    return {
      disp,
      inv,
      pay,
      ghostLeak,
      unpaidLeak,
      invPercent: disp > 0 ? (inv / disp) * 100 : 0,
      payPercent: disp > 0 ? (pay / disp) * 100 : 0,
      ghostPercent: disp > 0 ? (ghostLeak / disp) * 100 : 0,
      unpaidPercent: disp > 0 ? (unpaidLeak / disp) * 100 : 0,
    };
  }, [metrics]);

  // Filtering table preview data
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
      } else if (reportType === "inuka") {
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
  }, [anomalies, icmsLogs, reportType, searchQuery]);

  // Pagination math
  const totalItems = filteredPreviewData.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredPreviewData.slice(start, start + itemsPerPage);
  }, [filteredPreviewData, currentPage]);

  // Trigger Data Minimization Modal before Excel Export
  function handleExportExcel() {
    setIsFieldSelectorOpen(true);
  }

  // Executed after user selects minimized fields
  async function handleConfirmFilteredExport(fields: string[]) {
    setExporting(true);
    setError(null);
    try {
      const blob = await downloadExportWithFields(materiality, fields, direction);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `flowguard_revenue_governance_m${materiality}_${direction}.xlsx`;
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

  // Trigger Client-side CSV download
  function handleExportCsv() {
    if (filteredPreviewData.length === 0) {
      alert("No data available to export in the active report filter.");
      return;
    }

    let csvHeaders: string[] = [];
    let csvRows: string[][] = [];
    let filename = "";

    if (reportType === "icms") {
      filename = `kpc_icms_sync_report_m${materiality}.csv`;
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
    } else if (reportType === "operational") {
      filename = `kpc_operational_audit_m${materiality}_${direction}.csv`;
      csvHeaders = ["Dispatch ID", "Invoice ID", "OMC / Beneficiary", "Product / Officer", "Dispatched / Authorized (KES)", "Invoiced / Paid (KES)", "Leakage Gap (KES)", "Category", "Status"];
      csvRows = (filteredPreviewData as Anomaly[]).map((a) => [
        a.dispatch_id,
        a.invoice_id ?? "N/A",
        a.customer,
        a.product,
        String(a.dispatched_kes),
        String(a.invoiced_kes),
        String(a.leakage_kes),
        a.break_type,
        a.status,
      ]);
    } else if (reportType === "inuka") {
      filename = `inuka_stipend_governance_report_m${materiality}.csv`;
      csvHeaders = ["Stipend / Dispatch ID", "Disbursement / Invoice ID", "Beneficiary Name", "Officer / Station", "Authorized Amount (KES)", "Disbursed Amount (KES)", "Stipend Exposure (KES)", "Anomaly Type", "Status"];
      csvRows = (filteredPreviewData as Anomaly[]).map((a) => [
        a.dispatch_id,
        a.invoice_id ?? "N/A",
        a.customer,
        a.product,
        String(a.dispatched_kes),
        String(a.invoiced_kes),
        String(a.leakage_kes),
        a.break_type,
        a.status,
      ]);
    } else {
      filename = `kpc_financial_settlement_m${materiality}_${direction}.csv`;
      csvHeaders = ["Invoice ID", "Dispatch ID", "Customer OMC", "Invoiced Value (KES)", "Paid Amount (KES)", "Outstanding Gap (KES)", "Category", "Reconciliation Status"];
      csvRows = (filteredPreviewData as Anomaly[]).map((a) => [
        a.invoice_id ?? "N/A",
        a.dispatch_id,
        a.customer,
        String(a.invoiced_kes),
        String(a.paid_kes),
        String(a.leakage_kes),
        a.break_type,
        a.status,
      ]);
    }

    const csvContent =
      "data:text/csv;charset=utf-8,\uFEFF" +
      [csvHeaders.join(",")].concat(csvRows.map((row) => row.map((val) => `"${val.replace(/"/g, '""')}"`).join(","))).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1700px] mx-auto px-2 sm:px-4 text-zinc-800 dark:text-zinc-100">
      
      {/* Page Header */}
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <span className="text-[10px] font-bold text-[#b3312c] dark:text-[#ec835a] uppercase tracking-widest leading-none">
            FlowGuard Audit & Governance Reporting Center
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white mt-1">
            Revenue Assurance & Stipend Governance Reports
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Audit operational drops, financial settlements, KRA iCMS tax syncs, and Inuka beneficiary stipends.
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

      {/* Compliance & Governance Banner */}
      <div className="bg-[#f1ede9]/90 dark:bg-[#2a2725]/90 border border-[#e8e3de] dark:border-[#33302c] rounded-2xl p-6 sm:p-7 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 shadow-sm my-2">
        <div className="flex items-center space-x-4">
          <div className="p-3.5 bg-[#b3312c]/10 dark:bg-[#b3312c]/20 rounded-xl text-[#b3312c] dark:text-[#ec835a] border border-[#b3312c]/20 shrink-0">
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm sm:text-base font-black text-emerald-950 dark:text-[#ec835a] uppercase tracking-wide">Governance Health Metric:</span>
              <span className="text-sm sm:text-base font-extrabold text-[#b3312c] dark:text-[#ec835a]">98.4% Verified Active Consent & KRA PIN Coverage</span>
            </div>
            <p className="text-xs sm:text-sm font-medium text-[#736c67] dark:text-[#b2aeac] mt-1.5 leading-relaxed">
              Order-to-Cash and Beneficiary Stipend exports are cryptographically signed with SHA-256 digests and audited under KDPA standards.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsVerifierOpen(true)}
          className="px-5 py-3 bg-cyan-100 hover:bg-cyan-200 text-cyan-950 border border-cyan-300 dark:bg-cyan-600/20 dark:hover:bg-cyan-600/30 dark:text-cyan-300 dark:border-cyan-500/30 rounded-xl text-sm font-bold transition flex items-center space-x-2 shrink-0 shadow-sm cursor-pointer"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <span>Verify Report File Signature</span>
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4 text-xs text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Main Dual-Domain Reporting Workspace */}
      <div className="flex flex-col gap-6">
        {/* Domain & Report Focus Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* KPC Operational Audit */}
          <div
            onClick={() => handleReportTypeChange("operational")}
            className={`p-6 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between space-y-4 shadow-sm ${
              reportType === "operational"
                ? "bg-[#ffffff] dark:bg-[#221d1a] border-[#b3312c] text-[#b3312c] dark:text-[#ec835a] ring-2 ring-[#b3312c]/30 shadow-md"
                : "bg-[#ffffff] dark:bg-[#221d1a] border-[#e8e3de] dark:border-[#33302c] hover:border-[#b3312c]/40 text-[#26221f] dark:text-[#f5f2ef]"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="p-2.5 bg-[#b3312c]/10 text-[#b3312c] dark:text-[#ec835a] rounded-xl font-bold text-xs uppercase tracking-wider">
                🛢️ KPC Oil Side
              </span>
              {reportType === "operational" && (
                <span className="w-3 h-3 rounded-full bg-[#b3312c] animate-pulse" />
              )}
            </div>
            <div>
              <h3 className="text-base font-extrabold tracking-tight">Operational Dispatch Audit</h3>
              <p className="text-xs text-[#736c67] dark:text-[#b2aeac] mt-1">
                Gantry dispatches, physical volume metered, and SAP invoice match logs.
              </p>
            </div>
            <div className="pt-3 border-t border-[#e8e3de] dark:border-[#33302c] flex items-center justify-between text-xs font-bold text-[#b3312c] dark:text-[#ec835a]">
              <span>Dispatches & Invoices</span>
              <span>Select Focus &rarr;</span>
            </div>
          </div>

          {/* KPC Financial Settlement */}
          <div
            onClick={() => handleReportTypeChange("financial")}
            className={`p-6 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between space-y-4 shadow-sm ${
              reportType === "financial"
                ? "bg-[#ffffff] dark:bg-[#221d1a] border-[#b3312c] text-[#b3312c] dark:text-[#ec835a] ring-2 ring-[#b3312c]/30 shadow-md"
                : "bg-[#ffffff] dark:bg-[#221d1a] border-[#e8e3de] dark:border-[#33302c] hover:border-[#b3312c]/40 text-[#26221f] dark:text-[#f5f2ef]"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="p-2.5 bg-[#0ca30c]/10 text-[#0ca30c] dark:text-[#4ade80] rounded-xl font-bold text-xs uppercase tracking-wider">
                💳 Cash Settlement
              </span>
              {reportType === "financial" && (
                <span className="w-3 h-3 rounded-full bg-[#0ca30c] animate-pulse" />
              )}
            </div>
            <div>
              <h3 className="text-base font-extrabold tracking-tight">Financial Settlement Audit</h3>
              <p className="text-xs text-[#736c67] dark:text-[#b2aeac] mt-1">
                Bank payment remittances, OMC credit limits, overpayments, and balances.
              </p>
            </div>
            <div className="pt-3 border-t border-[#e8e3de] dark:border-[#33302c] flex items-center justify-between text-xs font-bold text-[#0ca30c] dark:text-[#4ade80]">
              <span>Payments & Remittances</span>
              <span>Select Focus &rarr;</span>
            </div>
          </div>

          {/* KPC iCMS Tax Sync */}
          <div
            onClick={() => handleReportTypeChange("icms")}
            className={`p-6 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between space-y-4 shadow-sm ${
              reportType === "icms"
                ? "bg-[#ffffff] dark:bg-[#221d1a] border-[#2a78d6] text-[#2a78d6] dark:text-[#60a5fa] ring-2 ring-[#2a78d6]/30 shadow-md"
                : "bg-[#ffffff] dark:bg-[#221d1a] border-[#e8e3de] dark:border-[#33302c] hover:border-[#2a78d6]/40 text-[#26221f] dark:text-[#f5f2ef]"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="p-2.5 bg-[#2a78d6]/10 text-[#2a78d6] dark:text-[#60a5fa] rounded-xl font-bold text-xs uppercase tracking-wider">
                📑 KRA iCMS Tax
              </span>
              {reportType === "icms" && (
                <span className="w-3 h-3 rounded-full bg-[#2a78d6] animate-pulse" />
              )}
            </div>
            <div>
              <h3 className="text-base font-extrabold tracking-tight">iCMS Tax Declaration Sync</h3>
              <p className="text-xs text-[#736c67] dark:text-[#b2aeac] mt-1">
                KRA electronic billing declarations, PIN validations, and payload logs.
              </p>
            </div>
            <div className="pt-3 border-t border-[#e8e3de] dark:border-[#33302c] flex items-center justify-between text-xs font-bold text-[#2a78d6] dark:text-[#60a5fa]">
              <span>Tax Declarations</span>
              <span>Select Focus &rarr;</span>
            </div>
          </div>

          {/* Inuka Fellowship Governance */}
          <div
            onClick={() => handleReportTypeChange("inuka")}
            className={`p-6 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between space-y-4 shadow-sm ${
              reportType === "inuka"
                ? "bg-[#ffffff] dark:bg-[#221d1a] border-[#b6790a] text-[#b6790a] dark:text-[#fbbf24] ring-2 ring-[#b6790a]/30 shadow-md"
                : "bg-[#ffffff] dark:bg-[#221d1a] border-[#e8e3de] dark:border-[#33302c] hover:border-[#b6790a]/40 text-[#26221f] dark:text-[#f5f2ef]"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="p-2.5 bg-[#b6790a]/10 text-[#b6790a] dark:text-[#fbbf24] rounded-xl font-bold text-xs uppercase tracking-wider">
                🎓 Inuka Side
              </span>
              {reportType === "inuka" && (
                <span className="w-3 h-3 rounded-full bg-[#b6790a] animate-pulse" />
              )}
            </div>
            <div>
              <h3 className="text-base font-extrabold tracking-tight">Inuka Stipend Governance</h3>
              <p className="text-xs text-[#736c67] dark:text-[#b2aeac] mt-1">
                Fellowship attendance, calculated stipends, and MPESA/Bank disbursements.
              </p>
            </div>
            <div className="pt-3 border-t border-[#e8e3de] dark:border-[#33302c] flex items-center justify-between text-xs font-bold text-[#b6790a] dark:text-[#fbbf24]">
              <span>Stipends & Officers</span>
              <span>Select Focus &rarr;</span>
            </div>
          </div>

        </div>

        {/* Action Controls & Export Bar */}
        <div className="p-6 rounded-2xl bg-[#ffffff] dark:bg-[#221d1a] border border-[#e8e3de] dark:border-[#33302c] shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <span className="text-sm font-bold uppercase tracking-wider text-[#b3312c] dark:text-[#ec835a]">
              Report Export Actions:
            </span>
            <span className="text-xs font-medium text-[#736c67] dark:text-[#b2aeac]">
              Active Focus: <strong className="text-[#26221f] dark:text-[#f5f2ef] capitalize">{reportType} Report</strong>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleExportExcel}
              className="px-5 py-3 bg-[#b3312c] hover:bg-[#962723] text-white font-bold text-sm rounded-xl transition shadow-md flex items-center space-x-2 cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>Download Filtered Excel (.xlsx)</span>
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              className="px-5 py-3 bg-[#f1ede9] dark:bg-[#2a2725] hover:bg-[#e8e3de] dark:hover:bg-[#33302c] text-[#26221f] dark:text-[#f5f2ef] border border-[#e8e3de] dark:border-[#33302c] font-bold text-sm rounded-xl transition flex items-center space-x-2 cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span>Download Active CSV (.csv)</span>
            </button>
          </div>
        </div>
      </div>

      {/* BOTTOM WORKSPACE SECTION: Report Data Preview Table Grid */}
      <div className="bg-[#ffffff] dark:bg-[#221d1a] border border-[#e8e3de] dark:border-[#33302c] rounded-2xl p-6 shadow-md flex flex-col gap-5">
        
        {/* Toolbar Header for Table Preview */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-[#e8e3de] dark:border-[#33302c] pb-4">
          <div>
            <h3 className="text-sm font-bold text-zinc-900 dark:text-slate-100 uppercase tracking-wider">
              {reportType === "operational" ? "Operational Audit Log Preview" : 
               reportType === "financial" ? "Financial Settlement Match Preview" : 
               reportType === "inuka" ? "Inuka Stipend Governance Log Preview" :
               "iCMS Tax Declaration logs"}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-slate-400 mt-0.5">
              Showing active rows exceeding KES {materiality.toLocaleString()} materiality ({direction.toUpperCase()} direction).
            </p>
          </div>

          {/* Search bar inside preview header */}
          <div className="w-full md:w-64 relative">
            <input
              type="text"
              placeholder="Search active table..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="w-full bg-zinc-50 dark:bg-slate-955/80 border border-[#e8e3de] dark:border-[#33302c] hover:border-zinc-300 dark:hover:border-slate-700 focus:border-indigo-500 focus:bg-white rounded-xl px-3.5 py-2 text-xs text-zinc-800 dark:text-slate-200 placeholder-zinc-400 focus:outline-none transition-all shadow-inner font-medium"
            />
          </div>
        </div>

        {/* Loading Preview */}
        {loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            
            {/* Table wrapper */}
            <div className="overflow-x-auto rounded-xl border border-[#e8e3de] dark:border-[#33302c] bg-[#ffffff] dark:bg-[#221d1a]">

              {totalItems === 0 ? (
                <div className="py-12 text-center text-xs text-zinc-500 italic">
                  No active logs match the search query or selected materiality.
                </div>
              ) : (
                <table className="w-full min-w-[700px] text-left text-xs">
                  
                  {/* Table Headers */}
                  <thead className="border-b border-[#e8e3de] dark:border-[#33302c] bg-[#f1ede9] dark:bg-[#2a2725] text-[#26221f] dark:text-[#f5f2ef] font-bold uppercase tracking-wider text-[11px]">
                    {reportType === "operational" ? (
                      <tr>
                        <th className="px-4 py-3">Dispatch ID</th>
                        <th className="px-4 py-3">Customer OMC</th>
                        <th className="px-4 py-3">Product</th>
                        <th className="px-4 py-3">Dispatched Value</th>
                        <th className="px-4 py-3">Invoiced Value</th>
                        <th className="px-4 py-3">Gap Leakage</th>
                        <th className="px-4 py-3">Error Category</th>
                        <th className="px-4 py-3">Audit Log</th>
                      </tr>
                    ) : reportType === "financial" ? (
                      <tr>
                        <th className="px-4 py-3">Invoice ID</th>
                        <th className="px-4 py-3">Dispatch ID</th>
                        <th className="px-4 py-3">Customer OMC</th>
                        <th className="px-4 py-3">Invoiced Value</th>
                        <th className="px-4 py-3">Paid Amount</th>
                        <th className="px-4 py-3">Outstanding Gap</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Audit Log</th>
                      </tr>
                    ) : reportType === "inuka" ? (
                      <tr>
                        <th className="px-4 py-3">Stipend / Dispatch ID</th>
                        <th className="px-4 py-3">Disbursement ID</th>
                        <th className="px-4 py-3">Beneficiary / Customer</th>
                        <th className="px-4 py-3">Authorized Amount</th>
                        <th className="px-4 py-3">Disbursed Amount</th>
                        <th className="px-4 py-3">Stipend Exposure</th>
                        <th className="px-4 py-3">Governance Alert</th>
                        <th className="px-4 py-3">Audit Log</th>
                      </tr>
                    ) : (
                      <tr>
                        <th className="px-4 py-3">Invoice ID</th>
                        <th className="px-4 py-3">Customer OMC</th>
                        <th className="px-4 py-3">Invoiced Value</th>
                        <th className="px-4 py-3">Sync Status</th>
                        <th className="px-4 py-3">Retries</th>
                        <th className="px-4 py-3">Last Sync Date</th>
                        <th className="px-4 py-3">iCMS Error Log</th>
                        <th className="px-4 py-3">Audit Log</th>
                      </tr>
                    )}
                  </thead>

                  {/* Table Body Content */}
                  <tbody className="divide-y divide-[#e8e3de] dark:divide-[#33302c] text-zinc-700 dark:text-zinc-355">
                    
                    {reportType === "operational" &&
                      (paginatedData as Anomaly[]).map((a, i) => (
                        <tr key={i} className="hover:bg-[#f1ede9]/50 dark:hover:bg-[#2a2725]/50 transition-colors">
                          <td className="px-4 py-3 font-mono font-semibold">{a.dispatch_id}</td>
                          <td className="px-4 py-3 font-medium">{a.customer}</td>
                          <td className="px-4 py-3 font-mono">{a.product}</td>
                          <td className="px-4 py-3 font-mono">{formatKes(a.dispatched_kes)}</td>
                          <td className="px-4 py-3 font-mono">{a.invoice_id ? formatKes(a.invoiced_kes) : "—"}</td>
                          <td className="px-4 py-3 font-mono font-bold text-rose-600 dark:text-[#d03b3b]">{formatKes(a.leakage_kes)}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              a.break_type === "Missing Invoice" ? "bg-[#d03b3b]/10 text-rose-500" : "bg-[#b6790a]/10 text-amber-500"
                            }`}>
                              {a.break_type}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => setHistoryTarget({ type: "dispatch", id: a.dispatch_id })}
                              className="px-2 py-1 bg-[#b3312c]/10 hover:bg-[#b3312c]/20 text-indigo-400 border border-indigo-500/20 rounded text-[10px] font-mono transition cursor-pointer"
                            >
                              History
                            </button>
                          </td>
                        </tr>
                      ))}

                    {reportType === "financial" &&
                      (paginatedData as Anomaly[]).map((a, i) => (
                        <tr key={i} className="hover:bg-[#f1ede9]/50 dark:hover:bg-[#2a2725]/50 transition-colors">
                          <td className="px-4 py-3 font-mono font-semibold">{a.invoice_id ?? "—"}</td>
                          <td className="px-4 py-3 font-mono text-zinc-500">{a.dispatch_id}</td>
                          <td className="px-4 py-3 font-medium">{a.customer}</td>
                          <td className="px-4 py-3 font-mono">{formatKes(a.invoiced_kes)}</td>
                          <td className="px-4 py-3 font-mono">{formatKes(a.paid_kes)}</td>
                          <td className="px-4 py-3 font-mono font-bold text-rose-600 dark:text-[#d03b3b]">{formatKes(a.leakage_kes)}</td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#b6790a]/10 text-amber-500">
                              {a.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => setHistoryTarget({ type: "invoice", id: a.invoice_id || a.dispatch_id })}
                              className="px-2 py-1 bg-[#b3312c]/10 hover:bg-[#b3312c]/20 text-indigo-400 border border-indigo-500/20 rounded text-[10px] font-mono transition cursor-pointer"
                            >
                              History
                            </button>
                          </td>
                        </tr>
                      ))}

                    {reportType === "inuka" &&
                      (paginatedData as Anomaly[]).map((a, i) => (
                        <tr key={i} className="hover:bg-[#f1ede9]/50 dark:hover:bg-[#2a2725]/50 transition-colors">
                          <td className="px-4 py-3 font-mono font-semibold">{a.dispatch_id}</td>
                          <td className="px-4 py-3 font-mono text-zinc-500">{a.invoice_id ?? "—"}</td>
                          <td className="px-4 py-3 font-medium">{a.customer}</td>
                          <td className="px-4 py-3 font-mono">{formatKes(a.dispatched_kes)}</td>
                          <td className="px-4 py-3 font-mono">{formatKes(a.invoiced_kes || a.paid_kes)}</td>
                          <td className="px-4 py-3 font-mono font-bold text-rose-600 dark:text-[#d03b3b]">{formatKes(a.leakage_kes)}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              a.break_type === "Ghost Payment" || a.break_type === "Duplicate Disbursement" ? "bg-[#d03b3b]/20 text-[#d03b3b] border border-rose-500/30" : "bg-[#0ca30c]/10 text-[#ec835a]"
                            }`}>
                              {a.break_type}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => setHistoryTarget({ type: "dispatch", id: a.dispatch_id })}
                              className="px-2 py-1 bg-[#0ca30c]/10 hover:bg-[#0ca30c]/20 text-[#ec835a] border border-emerald-500/20 rounded text-[10px] font-mono transition cursor-pointer"
                            >
                              History
                            </button>
                          </td>
                        </tr>
                      ))}

                    {reportType === "icms" &&
                      (paginatedData as EbillingLogEntry[]).map((log, i) => (
                        <tr key={i} className="hover:bg-[#f1ede9]/50 dark:hover:bg-[#2a2725]/50 transition-colors">
                          <td className="px-4 py-3 font-mono font-semibold">{log.invoice_id}</td>
                          <td className="px-4 py-3 font-medium">{log.customer_name ?? "—"}</td>
                          <td className="px-4 py-3 font-mono">{formatKes(log.value_kes ?? 0)}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              log.status === "synced" ? "bg-[#0ca30c]/10 text-emerald-500" : "bg-[#d03b3b]/10 text-rose-500"
                            }`}>
                              {log.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono">{log.retry_count}</td>
                          <td className="px-4 py-3 font-mono text-zinc-500">{log.last_attempt || "—"}</td>
                          <td className="px-4 py-3 max-w-[200px] truncate text-zinc-500" title={log.error_message ?? ""}>
                            {log.error_message || "—"}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => setHistoryTarget({ type: "invoice", id: log.invoice_id })}
                              className="px-2 py-1 bg-[#b3312c]/10 hover:bg-[#b3312c]/20 text-indigo-400 border border-indigo-500/20 rounded text-[10px] font-mono transition cursor-pointer"
                            >
                              History
                            </button>
                          </td>
                        </tr>
                      ))}

                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination Controls */}
            {totalItems > itemsPerPage && (
              <div className="flex items-center justify-between border-t border-zinc-150 dark:border-zinc-800/80 pt-4">
                <span className="text-[10px] text-zinc-500">
                  Showing {Math.min(totalItems, (currentPage - 1) * itemsPerPage + 1)} to{" "}
                  {Math.min(totalItems, currentPage * itemsPerPage)} of {totalItems} items
                </span>

                <div className="flex gap-2">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 text-xs font-semibold rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-40 transition-all cursor-pointer bg-white dark:bg-zinc-950"
                  >
                    Previous
                  </button>
                  <span className="px-3 py-1 text-xs font-bold font-mono border border-[#b3312c]/30 bg-[#b3312c]/10 text-[#b3312c] dark:text-[#ec835a] rounded">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 text-xs font-semibold rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-40 transition-all cursor-pointer bg-white dark:bg-zinc-950"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}

          </div>
        )}

      </div>

      {/* Compliance & Governance Modals */}
      <ConsentModal forceShow={isConsentOpen} onAccept={() => setIsConsentOpen(false)} />
      <FieldSelectorModal
        isOpen={isFieldSelectorOpen}
        onClose={() => setIsFieldSelectorOpen(false)}
        onConfirmExport={handleConfirmFilteredExport}
        exporting={exporting}
      />
      <ReportVerifierModal
        isOpen={isVerifierOpen}
        onClose={() => setIsVerifierOpen(false)}
      />
      <RecordHistoryDrawer
        isOpen={!!historyTarget}
        onClose={() => setHistoryTarget(null)}
        targetType={historyTarget?.type || ""}
        targetId={historyTarget?.id || ""}
      />

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
