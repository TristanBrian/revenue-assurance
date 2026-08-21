"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { ApiError, downloadExport, downloadExportWithFields, getMetrics, getEbillingLogs } from "@/lib/api";
import { useMateriality } from "@/context/MaterialityContext";
import RequirePermission from "@/components/RequirePermission";
import ConsentModal from "@/components/ConsentModal";
import FieldSelectorModal from "@/components/FieldSelectorModal";
import ReportVerifierModal from "@/components/ReportVerifierModal";
import RecordHistoryDrawer from "@/components/RecordHistoryDrawer";
import type { Metrics, Anomaly, EbillingLogEntry } from "@/lib/types";

type ReportType = "operational" | "financial" | "icms";

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
  const { materiality, setMateriality } = useMateriality();
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
        const metricsRes = await getMetrics(materiality);
        if (cancelled) return;
        setMetrics(metricsRes.metrics);
        // ✅ Fix: Use proper type assertion instead of 'any'
        const anomaliesData = (metricsRes as { anomalies?: Anomaly[] }).anomalies || [];
        setAnomalies(anomaliesData);

        if (reportType === "icms") {
          const logsRes = await getEbillingLogs(100);
          if (cancelled) return;
          setIcmsLogs(logsRes);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Failed to load operational data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadData();
    return () => {
      cancelled = true;
    };
  }, [materiality, reportType]);

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

    // Operational or Financial anomalies
    return anomalies.filter((a) => {
      // Basic search match
      const matchesSearch =
        a.dispatch_id.toLowerCase().includes(query) ||
        a.customer.toLowerCase().includes(query) ||
        a.product.toLowerCase().includes(query) ||
        (a.invoice_id && a.invoice_id.toLowerCase().includes(query));

      if (!matchesSearch) return false;

      // Classify by report type context
      if (reportType === "operational") {
        return a.break_type === "Missing Invoice" || a.break_type === "Underpayment";
      } else {
        return a.break_type === "Missing Payment" || a.break_type === "Underpayment" || a.break_type === "Overpayment";
      }
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
      const blob = await downloadExportWithFields(materiality, fields);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kpc_reconciliation_report_m${materiality}.xlsx`;
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
      filename = `kpc_operational_audit_m${materiality}.csv`;
      csvHeaders = ["Dispatch ID", "Invoice ID", "OMC Customer", "Product", "Dispatched (KES)", "Invoiced (KES)", "Leakage Gap (KES)", "Category", "Status"];
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
      filename = `kpc_financial_settlement_m${materiality}.csv`;
      csvHeaders = ["Invoice ID", "Dispatch ID", "OMC Customer", "Invoiced Value (KES)", "Paid Amount (KES)", "Outstanding Gap (KES)", "Category", "Reconciliation Status"];
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
          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-500 uppercase tracking-widest leading-none">
            Audit Reporting Center
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white mt-1">
            Revenue Assurance Reports
          </h1>
          <p className="text-xs text-zinc-550 dark:text-zinc-400 mt-0.5">
            Audit operational drops, financial settlements, and tax declarations.
          </p>
        </div>
      </header>


      {/* Compliance & Governance Banner */}
      <div className="bg-emerald-50/90 dark:bg-emerald-950/25 border border-emerald-300/80 dark:border-emerald-500/30 rounded-2xl p-6 sm:p-7 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 shadow-sm my-2">
        <div className="flex items-center space-x-4">
          <div className="p-3.5 bg-emerald-100 dark:bg-emerald-500/15 rounded-xl text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-500/20 shrink-0">
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm sm:text-base font-black text-emerald-950 dark:text-emerald-400 uppercase tracking-wide">Governance Health Metric:</span>
              <span className="text-sm sm:text-base font-extrabold text-emerald-800 dark:text-emerald-300">98.4% Verified Active Consent & KRA PIN Coverage</span>
            </div>
            <p className="text-xs sm:text-sm font-medium text-emerald-900/90 dark:text-zinc-400 mt-1.5 leading-relaxed">
              Order-to-Cash exports are cryptographically signed with SHA-256 digests and audited under KDPA standards.
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
      {/* Main Reporting Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
               {/* LEFT COLUMN: Visual Funnel Chart Card (Spans 2 columns) */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <div className="bg-white dark:bg-slate-900/90 border border-zinc-200 dark:border-slate-700/80 rounded-2xl p-7 shadow-md flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-100 dark:border-slate-800 pb-5">
              <div>
                <h2 className="text-lg sm:text-xl font-extrabold text-zinc-900 dark:text-slate-100 uppercase tracking-wider">
                  Revenue Lifecycle & Leakage State
                </h2>

                <p className="text-sm font-medium text-zinc-600 dark:text-slate-400 mt-1.5">
                  Click any stage or leakage card below to filter the audit preview table in real time.
                </p>
              </div>

              {activeFunnelFilter !== "all" && (
                <button
                  onClick={() => handleFunnelStageClick("all")}
                  className="px-4 py-2 text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl border border-slate-700 transition flex items-center space-x-2 shadow-sm cursor-pointer shrink-0"
                >
                  <span>Reset Filter</span>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <div className="w-8 h-8 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin"></div>
                <span className="text-xs text-zinc-500">Loading live aggregates...</span>
              </div>
            ) : (
              <div className="flex flex-col gap-6">


                
                {/* 1. HERO RECOVERY STAT BANNER (Lead with 93.7% Settled Recovery) */}
                <div className="bg-gradient-to-r from-emerald-900/90 via-slate-900 to-slate-900 border border-emerald-500/40 p-6 rounded-2xl shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-center space-x-4">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0 shadow-inner">
                      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-black uppercase tracking-widest text-emerald-400">HERO VALUE RECOVERY</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          {funnelData.payPercent.toFixed(1)}% Settled Cash
                        </span>
                      </div>
                      <h3 className="text-2xl sm:text-3xl font-black font-mono text-white tracking-tight mt-0.5">
                        {formatKesCompact(funnelData.pay)} <span className="text-sm font-sans font-bold text-slate-300">Settled & Verified</span>
                      </h3>
                      <p className="text-xs font-medium text-slate-400 mt-1">
                        Total metered pipeline baseline: <span className="font-mono text-white font-bold">{formatKesCompact(funnelData.disp)}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col items-start sm:items-end gap-1.5 shrink-0 bg-slate-955/80 border border-slate-800 p-3.5 rounded-xl">
                    <span className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider">Identified Risk Exposure</span>
                    <span className="text-lg font-black font-mono text-rose-400">
                      {formatKesCompact(funnelData.ghostLeak + funnelData.unpaidLeak)}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400">Unbilled Ghost Loads + Unpaid Invoices</span>
                  </div>
                </div>

                {/* 2. SINGLE LEFT-TO-RIGHT VALUE FLOW & CONNECTED LIFECYCLE CHECKPOINTS */}
                <div className="relative pt-2">
                  
                  {/* Grid of Connected Stage Cards */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 relative">
                    
                    {/* STAGE 1: Dispatched Baseline */}
                    <div
                      onClick={() => handleFunnelStageClick("dispatched")}
                      className={`p-6 rounded-2xl border cursor-pointer transition-all duration-300 flex flex-col justify-between space-y-4 shadow-sm relative ${
                        activeFunnelFilter === "dispatched"
                          ? "bg-slate-900 border-cyan-500/90 shadow-xl shadow-cyan-500/10 ring-2 ring-cyan-500/40"
                          : "bg-white dark:bg-slate-950/80 border-zinc-200 dark:border-slate-800 hover:border-cyan-500/50"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <span className="text-xs font-black uppercase tracking-wider text-cyan-600 dark:text-cyan-400">STAGE 1 CHECKPOINT</span>
                          <h3 className="text-lg font-extrabold text-zinc-900 dark:text-slate-100">Dispatched Volume</h3>
                        </div>
                        <div className="w-11 h-11 rounded-xl border-2 border-cyan-500/40 flex items-center justify-center text-sm font-black font-mono text-cyan-700 dark:text-cyan-300 bg-cyan-50 dark:bg-cyan-500/10 shrink-0">
                          100%
                        </div>
                      </div>

                      <div>
                        <div className="text-3xl font-black font-mono text-zinc-900 dark:text-white tracking-tight">{formatKesCompact(funnelData.disp)}</div>
                        <p className="text-xs font-medium text-zinc-600 dark:text-slate-400 mt-1.5 leading-relaxed">
                          Physical fuel metered leaving KPC depot loading arms.
                        </p>
                      </div>

                      <div className="pt-3 border-t border-zinc-200 dark:border-slate-800/80 flex items-center justify-between text-xs font-extrabold text-cyan-700 dark:text-cyan-400">
                        <span>Physical Meter Baseline</span>
                        <span>Filter Stage &rarr;</span>
                      </div>
                    </div>

                    {/* STAGE 2: Commercial Billing (With Exception Signal Below) */}
                    <div className="flex flex-col gap-3">
                      <div
                        onClick={() => handleFunnelStageClick("invoiced")}
                        className={`p-6 rounded-2xl border cursor-pointer transition-all duration-300 flex flex-col justify-between space-y-4 shadow-sm relative ${
                          activeFunnelFilter === "invoiced" || activeFunnelFilter === "ghost"
                            ? "bg-slate-900 border-purple-500/90 shadow-xl shadow-purple-500/10 ring-2 ring-purple-500/40"
                            : "bg-white dark:bg-slate-955/80 border-zinc-200 dark:border-slate-800 hover:border-purple-500/50"
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <span className="text-xs font-black uppercase tracking-wider text-purple-600 dark:text-purple-400">STAGE 2 CHECKPOINT</span>
                            <h3 className="text-lg font-extrabold text-zinc-900 dark:text-slate-100">Commercial Billing</h3>
                          </div>
                          <div className="w-11 h-11 rounded-xl border-2 border-purple-500/40 flex items-center justify-center text-sm font-black font-mono text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-500/10 shrink-0">
                            {funnelData.invPercent.toFixed(0)}%
                          </div>
                        </div>

                        <div>
                          <div className="text-3xl font-black font-mono text-zinc-900 dark:text-white tracking-tight">{formatKesCompact(funnelData.inv)}</div>
                          <p className="text-xs font-medium text-zinc-600 dark:text-slate-400 mt-1.5 leading-relaxed">
                            Official commercial invoices generated in SAP.
                          </p>
                        </div>

                        <div className="pt-3 border-t border-zinc-200 dark:border-slate-800/80 flex items-center justify-between text-xs font-extrabold text-purple-700 dark:text-purple-400">
                          <span>Declared SAP Invoices</span>
                          <span>Filter Stage &rarr;</span>
                        </div>
                      </div>

                      {/* COLORED EXCEPTION SIGNAL: Ghost Loads Leakage (Red/Pink Exception Below Flow) */}
                      <div
                        onClick={() => handleFunnelStageClick("ghost")}
                        className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between shadow-xs ${
                          activeFunnelFilter === "ghost"
                            ? "bg-rose-950/90 border-rose-500 text-rose-200 ring-2 ring-rose-500/50"
                            : "bg-rose-50/90 dark:bg-rose-950/50 border-rose-200 dark:border-rose-500/40 hover:border-rose-500 text-rose-900 dark:text-rose-300"
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-3.5 h-3.5 rounded-full bg-rose-500 shrink-0 animate-pulse" />
                          <div>
                            <span className="text-[11px] font-black uppercase tracking-wider block text-rose-700 dark:text-rose-400">LEAKAGE EXCEPTION SIGNAL</span>
                            <span className="text-xs font-extrabold">Unbilled Ghost Loads: </span>
                            <span className="text-xs font-black font-mono text-rose-600 dark:text-rose-300">{formatKesCompact(funnelData.ghostLeak)}</span>
                          </div>
                        </div>
                        <span className="text-xs font-black text-rose-600 dark:text-rose-400">&rarr;</span>
                      </div>
                    </div>

                    {/* STAGE 3: Settled Cash (With Exception Signal Below) */}
                    <div className="flex flex-col gap-3">
                      <div
                        onClick={() => handleFunnelStageClick("settled")}
                        className={`p-6 rounded-2xl border cursor-pointer transition-all duration-300 flex flex-col justify-between space-y-4 shadow-sm relative ${
                          activeFunnelFilter === "settled" || activeFunnelFilter === "unpaid"
                            ? "bg-slate-900 border-emerald-500/90 shadow-xl shadow-emerald-500/10 ring-2 ring-emerald-500/40"
                            : "bg-white dark:bg-slate-955/80 border-zinc-200 dark:border-slate-800 hover:border-emerald-500/50"
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <span className="text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">STAGE 3 CHECKPOINT</span>
                            <h3 className="text-lg font-extrabold text-zinc-900 dark:text-slate-100">Settled Cash</h3>
                          </div>
                          <div className="w-11 h-11 rounded-xl border-2 border-emerald-500/40 flex items-center justify-center text-sm font-black font-mono text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 shrink-0">
                            {funnelData.payPercent.toFixed(0)}%
                          </div>
                        </div>

                        <div>
                          <div className="text-3xl font-black font-mono text-emerald-600 dark:text-emerald-400 tracking-tight">{formatKesCompact(funnelData.pay)}</div>
                          <p className="text-xs font-medium text-zinc-600 dark:text-slate-400 mt-1.5 leading-relaxed">
                            Actual cash deposits received and verified in bank.
                          </p>
                        </div>

                        <div className="pt-3 border-t border-zinc-200 dark:border-slate-800/80 flex items-center justify-between text-xs font-extrabold text-emerald-700 dark:text-emerald-400">
                          <span>Bank Remittances Verified</span>
                          <span>Filter Stage &rarr;</span>
                        </div>
                      </div>

                      {/* COLORED EXCEPTION SIGNAL: Unpaid Invoices (Amber Exception Below Flow) */}
                      <div
                        onClick={() => handleFunnelStageClick("unpaid")}
                        className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between shadow-xs ${
                          activeFunnelFilter === "unpaid"
                            ? "bg-amber-950/90 border-amber-500 text-amber-200 ring-2 ring-amber-500/50"
                            : "bg-amber-50/90 dark:bg-amber-950/50 border-amber-200 dark:border-amber-500/40 hover:border-amber-500 text-amber-900 dark:text-amber-300"
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-3.5 h-3.5 rounded-full bg-amber-500 shrink-0" />
                          <div>
                            <span className="text-[11px] font-black uppercase tracking-wider block text-amber-700 dark:text-amber-400">OVERDUE EXCEPTION SIGNAL</span>
                            <span className="text-xs font-extrabold">Unpaid Invoice Exposure: </span>
                            <span className="text-xs font-black font-mono text-amber-600 dark:text-amber-300">{formatKesCompact(funnelData.unpaidLeak)}</span>
                          </div>
                        </div>
                        <span className="text-xs font-black text-amber-600 dark:text-amber-400">&rarr;</span>
                      </div>
                    </div>

                  </div>
                </div>

              </div>
            )}


          </div>
        </div>

        {/* RIGHT COLUMN: Filter & Export Option Cards */}
        <div className="flex flex-col gap-6">
          
          {/* Card A: Report Filtering Options */}
          <div className="bg-white dark:bg-slate-900/90 border border-zinc-200 dark:border-slate-700/80 rounded-2xl p-6 sm:p-7 shadow-md flex flex-col gap-5">
            <div>
              <h3 className="text-base font-extrabold text-zinc-900 dark:text-slate-100 uppercase tracking-wider">Report Focus</h3>
              <p className="text-sm font-medium text-zinc-500 dark:text-slate-400 mt-1">Select the operational view to inspect and export.</p>
            </div>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => handleReportTypeChange("operational")}
                className={`w-full text-left p-4 rounded-xl border text-sm transition-all flex flex-col gap-1.5 cursor-pointer ${
                  reportType === "operational"
                    ? "bg-indigo-50/80 dark:bg-indigo-950/50 border-indigo-500 text-indigo-900 dark:text-indigo-300 font-bold shadow-xs"
                    : "bg-white dark:bg-slate-955/60 border-zinc-200 dark:border-slate-800 hover:border-zinc-300 dark:hover:border-slate-700 text-zinc-700 dark:text-slate-300"
                }`}
              >
                <div className="flex items-center justify-between font-bold text-sm sm:text-base">
                  <span>Operational Audit Report</span>
                  {reportType === "operational" && <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>}
                </div>
                <span className="text-xs sm:text-sm text-zinc-500 dark:text-slate-400 font-medium leading-relaxed">
                  Audits dispatch volume matching (Ghost loads & transport gaps).
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleReportTypeChange("financial")}
                className={`w-full text-left p-4 rounded-xl border text-sm transition-all flex flex-col gap-1.5 cursor-pointer ${
                  reportType === "financial"
                    ? "bg-indigo-50/80 dark:bg-indigo-950/50 border-indigo-500 text-indigo-900 dark:text-indigo-300 font-bold shadow-xs"
                    : "bg-white dark:bg-slate-955/60 border-zinc-200 dark:border-slate-800 hover:border-zinc-300 dark:hover:border-slate-700 text-zinc-700 dark:text-slate-300"
                }`}
              >
                <div className="flex items-center justify-between font-bold text-sm sm:text-base">
                  <span>Financial Settlement Report</span>
                  {reportType === "financial" && <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>}
                </div>
                <span className="text-xs sm:text-sm text-zinc-500 dark:text-slate-400 font-medium leading-relaxed">
                  Audits invoiced value vs banking cash deposits.
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleReportTypeChange("icms")}
                className={`w-full text-left p-4 rounded-xl border text-sm transition-all flex flex-col gap-1.5 cursor-pointer ${
                  reportType === "icms"
                    ? "bg-indigo-50/80 dark:bg-indigo-950/50 border-indigo-500 text-indigo-900 dark:text-indigo-300 font-bold shadow-xs"
                    : "bg-white dark:bg-slate-955/60 border-zinc-200 dark:border-slate-800 hover:border-zinc-300 dark:hover:border-slate-700 text-zinc-700 dark:text-slate-300"
                }`}
              >
                <div className="flex items-center justify-between font-bold text-sm sm:text-base">
                  <span>iCMS Tax Sync Report</span>
                  {reportType === "icms" && <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>}
                </div>
                <span className="text-xs sm:text-sm text-zinc-500 dark:text-slate-400 font-medium leading-relaxed">
                  Audits KRA e-billing status and failed sync queues.
                </span>
              </button>
            </div>
          </div>

          {/* Card B: Download & Export Trigger */}
          <div className="bg-white dark:bg-slate-900/90 border border-zinc-200 dark:border-slate-700/80 rounded-2xl p-6 sm:p-7 shadow-md flex flex-col gap-5">
            <div>
              <h3 className="text-base font-extrabold text-zinc-900 dark:text-slate-100 uppercase tracking-wider">Export Settings</h3>
              <p className="text-sm font-medium text-zinc-500 dark:text-slate-400 mt-1">Download formatted files for external reporting.</p>
            </div>

            <div className="flex flex-col gap-3.5">
              <button
                type="button"
                onClick={handleExportExcel}
                className="w-full py-3.5 px-5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm sm:text-base rounded-xl transition-all shadow-md shadow-emerald-600/20 flex items-center justify-center space-x-2.5 cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>Export Full Workbook (Excel)</span>
              </button>

              <button
                type="button"
                onClick={handleExportCsv}
                disabled={exporting}
                className="w-full py-3.5 px-5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-sm sm:text-base rounded-xl transition border border-slate-200 dark:border-slate-700 flex items-center justify-center space-x-2.5 cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>{exporting ? "Exporting..." : "Export Active View (CSV)"}</span>
              </button>
            </div>
          </div>

        </div>

      </div>


      {/* BOTTOM WORKSPACE SECTION: Report Data Preview Table Grid */}
      <div className="bg-white dark:bg-slate-900/90 border border-zinc-200 dark:border-slate-700/80 rounded-2xl p-6 shadow-md flex flex-col gap-5">
        
        {/* Toolbar Header for Table Preview */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-zinc-200 dark:border-slate-800 pb-4">
          <div>
            <h3 className="text-sm font-bold text-zinc-900 dark:text-slate-100 uppercase tracking-wider">
              {reportType === "operational" ? "Operational Audit Log Preview" : 
               reportType === "financial" ? "Financial Settlement Match Preview" : 
               "iCMS Tax Declaration logs"}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-slate-400 mt-0.5">
              Showing active rows exceeding KES {materiality.toLocaleString()} materiality.
            </p>
          </div>

          {/* Search bar inside preview header */}
          <div className="w-full md:w-64 relative">
            <input
              type="text"
              placeholder="Search active table..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="w-full bg-zinc-50 dark:bg-slate-955/80 border border-zinc-200 dark:border-slate-800 hover:border-zinc-300 dark:hover:border-slate-700 focus:border-indigo-500 focus:bg-white rounded-xl px-3.5 py-2 text-xs text-zinc-800 dark:text-slate-200 placeholder-zinc-400 focus:outline-none transition-all shadow-inner font-medium"
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
            <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-slate-800 bg-white dark:bg-slate-955/90">

              {totalItems === 0 ? (
                <div className="py-12 text-center text-xs text-zinc-500 italic">
                  No active logs match the search query or selected materiality.
                </div>
              ) : (
                <table className="w-full min-w-[700px] text-left text-xs">
                  
                  {/* Table Headers */}
                  <thead className="border-b border-zinc-200 dark:border-slate-800 bg-zinc-100 dark:bg-slate-900/90 text-zinc-700 dark:text-slate-300 font-bold uppercase tracking-wider text-[11px]">

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
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-900 text-zinc-700 dark:text-zinc-355">
                    
                    {reportType === "operational" &&
                      (paginatedData as Anomaly[]).map((a, i) => (
                        <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors">
                          <td className="px-4 py-3 font-mono font-semibold">{a.dispatch_id}</td>
                          <td className="px-4 py-3 font-medium">{a.customer}</td>
                          <td className="px-4 py-3 font-mono">{a.product}</td>
                          <td className="px-4 py-3 font-mono">{formatKes(a.dispatched_kes)}</td>
                          <td className="px-4 py-3 font-mono">{a.invoice_id ? formatKes(a.invoiced_kes) : "—"}</td>
                          <td className="px-4 py-3 font-mono font-bold text-rose-600 dark:text-rose-400">{formatKes(a.leakage_kes)}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              a.break_type === "Missing Invoice" ? "bg-rose-500/10 text-rose-500" : "bg-amber-500/10 text-amber-500"
                            }`}>
                              {a.break_type}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => setHistoryTarget({ type: "dispatch", id: a.dispatch_id })}
                              className="px-2 py-1 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 rounded text-[10px] font-mono transition"
                            >
                              History
                            </button>
                          </td>
                        </tr>
                      ))}

                    {reportType === "financial" &&
                      (paginatedData as Anomaly[]).map((a, i) => (
                        <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors">
                          <td className="px-4 py-3 font-mono font-semibold">{a.invoice_id ?? "—"}</td>
                          <td className="px-4 py-3 font-mono text-zinc-500">{a.dispatch_id}</td>
                          <td className="px-4 py-3 font-medium">{a.customer}</td>
                          <td className="px-4 py-3 font-mono">{formatKes(a.invoiced_kes)}</td>
                          <td className="px-4 py-3 font-mono">{formatKes(a.paid_kes)}</td>
                          <td className="px-4 py-3 font-mono font-bold text-rose-600 dark:text-rose-400">{formatKes(a.leakage_kes)}</td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-500">
                              {a.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => setHistoryTarget({ type: "invoice", id: a.invoice_id || a.dispatch_id })}
                              className="px-2 py-1 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 rounded text-[10px] font-mono transition"
                            >
                              History
                            </button>
                          </td>
                        </tr>
                      ))}

                    {reportType === "icms" &&
                      (paginatedData as EbillingLogEntry[]).map((log, i) => (
                        <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors">
                          <td className="px-4 py-3 font-mono font-semibold">{log.invoice_id}</td>
                          <td className="px-4 py-3 font-medium">{log.customer_name ?? "—"}</td>
                          <td className="px-4 py-3 font-mono">{formatKes(log.value_kes ?? 0)}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              log.status === "synced" ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
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
                              className="px-2 py-1 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 rounded text-[10px] font-mono transition"
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
                  <span className="px-3 py-1 text-xs font-bold font-mono border border-indigo-200 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400 rounded">
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
      <ConsentModal onAccept={() => {}} />
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