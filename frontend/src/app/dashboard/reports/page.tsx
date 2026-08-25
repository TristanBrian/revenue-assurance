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

type Domain = "oil" | "inuka";
type OilReportType = "operational" | "financial" | "icms";
type InukaReportType = "inuka_stipend" | "inuka_officer";
type ReportType = OilReportType | InukaReportType;

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
  const [isConsentOpen, setIsConsentOpen] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<{ type: string; id: string } | null>(null);

  // Search & Pagination
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  // Switch domain between Oil and Inuka
  const handleDomainChange = (domain: Domain) => {
    setActiveDomain(domain);
    setCurrentPage(1);
    setSearchQuery("");
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
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  };

  // Load metrics & data
  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const metricsRes = await getMetrics(materiality, activeDomain === "oil" ? "inbound" : "outbound");
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
  }, [anomalies, icmsLogs, reportType, searchQuery]);

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
      const blob = await downloadExportWithFields(materiality, fields, activeDomain === "oil" ? "inbound" : "outbound");
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
    let filename = `kpc_${activeDomain}_${reportType}_report.csv`;

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
        a.customer,
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
            FlowGuard Revenue Assurance & Governance Center
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

      {/* 2. SECOND SECTION: PREVIEW OF THE REPORT SELECTED */}
      <section className="bg-[#ffffff] dark:bg-[#221d1a] border border-[#e8e3de] dark:border-[#33302c] rounded-2xl p-6 shadow-sm flex flex-col gap-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-[#e8e3de] dark:border-[#33302c] pb-4">
          <div>
            <h2 className="text-lg font-extrabold text-[#26221f] dark:text-[#f5f2ef] uppercase tracking-wide">
              Report Preview ({reportType.toUpperCase()})
            </h2>
            <p className="text-xs sm:text-sm font-medium text-[#736c67] dark:text-[#b2aeac] mt-1">
              Showing real-time records matching active filter options exceeding KES {materiality.toLocaleString()}
            </p>
          </div>

          <div className="relative w-full sm:w-72">
            <input
              type="text"
              placeholder="Search records, waybills, OMCs..."
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
                        <th className="px-4 py-3">Record / Waybill</th>
                        <th className="px-4 py-3">OMC / Beneficiary</th>
                        <th className="px-4 py-3">Category / Product</th>
                        <th className="px-4 py-3">Dispatched / Baseline</th>
                        <th className="px-4 py-3">Leakage / Gap</th>
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
                      <tr key={log.id} className="hover:bg-[#f1ede9]/50 dark:hover:bg-[#2a2725]/50 transition-colors">
                        <td className="px-4 py-3 font-mono font-bold">{log.invoice_id}</td>
                        <td className="px-4 py-3 font-semibold">{log.customer_name ?? "N/A"}</td>
                        <td className="px-4 py-3 font-mono">{formatKes(log.value_kes ?? 0)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                            log.status === "SUCCESS"
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
                        <td className="px-4 py-3 font-semibold">{a.customer}</td>
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
                            onClick={() => setHistoryTarget({ type: "Dispatch", id: a.dispatch_id })}
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
            <span>Download CSV (.csv)</span>
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
        domain={activeDomain}
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
          target={historyTarget}
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
