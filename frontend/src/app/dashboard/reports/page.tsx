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
    <div className="flex flex-col gap-6 max-w-5xl mx-auto text-zinc-800 dark:text-zinc-100">
      
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

        {/* Materiality Control */}
        <div className="flex items-center gap-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2 shadow-sm shrink-0">
          <label htmlFor="materiality" className="text-xs font-semibold text-zinc-500">
            Materiality (KES)
          </label>
          <input
            id="materiality"
            type="number"
            min={0}
            step={25000}
            value={materiality}
            onChange={(e) => setMateriality(Number(e.target.value))}
            className="w-32 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-55 dark:bg-zinc-950 px-2.5 py-1 text-xs text-indigo-650 dark:text-indigo-400 font-bold font-mono focus:outline-none focus:border-indigo-500 transition-all shadow-inner"
          />
        </div>
      </header>

      {/* Compliance & Governance Banner */}
      <div className="bg-emerald-50/80 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-500/20 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-emerald-100 dark:bg-emerald-500/10 rounded-lg text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-500/20 shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-extrabold text-emerald-900 dark:text-emerald-400">Governance Health Metric:</span>
              <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">98.4% Verified Active Consent & KRA PIN Coverage</span>
            </div>
            <p className="text-[11px] font-medium text-emerald-900/80 dark:text-zinc-400 mt-0.5">
              Order-to-Cash exports are cryptographically signed with SHA-256 digests and audited under KDPA standards.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsVerifierOpen(true)}
          className="px-3.5 py-1.5 bg-cyan-100 hover:bg-cyan-200 text-cyan-900 border border-cyan-300 dark:bg-cyan-600/20 dark:hover:bg-cyan-600/30 dark:text-cyan-300 dark:border-cyan-500/30 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 shrink-0 shadow-xs cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
          <div className="bg-white dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider flex items-center space-x-2">
                  <span>Revenue Lifecycle Funnel</span>
                  <span className="text-[10px] px-2 py-0.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-full normal-case font-normal">
                    Interactive
                  </span>
                </h2>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Click any stage or leakage drop to automatically filter the audit preview table below.
                </p>
              </div>

              {activeFunnelFilter !== "all" && (
                <button
                  onClick={() => handleFunnelStageClick("all")}
                  className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition flex items-center space-x-1"
                >
                  <span>Reset Filter</span>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                
                {/* Horizontal Step Funnel Interactive SVG Chart */}
                <div className="w-full bg-zinc-950/60 border border-zinc-800 rounded-xl p-5 flex flex-col items-center shadow-inner relative overflow-hidden">
                  
                  {/* Subtle Grid Background */}
                  <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f293715_1px,transparent_1px),linear-gradient(to_bottom,#1f293715_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none" />

                  <svg viewBox="0 0 620 250" className="w-full max-w-[580px] h-auto relative z-10" fill="none" xmlns="http://www.w3.org/2000/svg">
                    
                    {/* SVG Definitions & Gradients */}
                    <defs>
                      <linearGradient id="funnel-grad-disp" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#4f46e5" />
                        <stop offset="100%" stopColor="#06b6d4" />
                      </linearGradient>
                      <linearGradient id="funnel-grad-inv" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#7c3aed" />
                        <stop offset="100%" stopColor="#c084fc" />
                      </linearGradient>
                      <linearGradient id="funnel-grad-pay" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#059669" />
                        <stop offset="100%" stopColor="#10b981" />
                      </linearGradient>
                      
                      <filter id="glow-disp" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="4" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                      </filter>
                    </defs>

                    {/* Funnel Stage 1: Dispatched (Clickable) */}
                    <g
                      onClick={() => handleFunnelStageClick("dispatched")}
                      className={`cursor-pointer transition-all duration-300 ${
                        activeFunnelFilter === "dispatched" ? "opacity-100 scale-[1.02]" : "hover:opacity-90"
                      }`}
                    >
                      <polygon
                        points="20,20 180,20 160,85 20,85"
                        fill="url(#funnel-grad-disp)"
                        className={`transition-all ${
                          activeFunnelFilter === "dispatched" ? "stroke-cyan-400 stroke-[3]" : "stroke-indigo-400/40 stroke-1 hover:stroke-cyan-300"
                        }`}
                      />
                      <text x="35" y="44" className="fill-white text-[9px] font-black uppercase tracking-wider">1. DISPATCHED</text>
                      <text x="35" y="66" className="fill-white text-sm font-black font-mono">{formatKesCompact(funnelData.disp)}</text>
                      <text x="132" y="45" className="fill-cyan-200 text-[10px] font-black font-mono">100%</text>
                    </g>

                    {/* Funnel Connector 1 -> 2 (Animated Pulse Line & Interactive Red Ghost Badge) */}
                    <path
                      d="M 180,30 L 215,30 L 215,125 L 230,125"
                      stroke="#f43f5e"
                      strokeWidth="2"
                      strokeDasharray="4 4"
                      className="animate-pulse opacity-70"
                    />
                    
                    {/* Ghost Loads Clickable Badge */}
                    <g
                      onClick={() => handleFunnelStageClick("ghost")}
                      className="cursor-pointer group"
                    >
                      <rect
                        x="165"
                        y="62"
                        width="100"
                        height="26"
                        rx="6"
                        className={`transition-all ${
                          activeFunnelFilter === "ghost"
                            ? "fill-rose-950 stroke-rose-500 stroke-2"
                            : "fill-slate-900/90 stroke-rose-500/40 stroke-1 group-hover:stroke-rose-400 group-hover:fill-rose-950/80"
                        }`}
                      />
                      <text x="215" y="75" className="fill-rose-400 text-[8px] font-black text-center" textAnchor="middle">
                        -{funnelData.ghostPercent.toFixed(1)}% GHOST LOADS
                      </text>
                      <text x="215" y="84" className="fill-rose-200 text-[7px] font-mono text-center" textAnchor="middle">
                        {formatKesCompact(funnelData.ghostLeak)}
                      </text>
                    </g>

                    {/* Funnel Stage 2: Invoiced (Clickable) */}
                    <g
                      onClick={() => handleFunnelStageClick("invoiced")}
                      className={`cursor-pointer transition-all duration-300 ${
                        activeFunnelFilter === "invoiced" ? "opacity-100 scale-[1.02]" : "hover:opacity-90"
                      }`}
                    >
                      <polygon
                        points="235,105 395,105 375,170 235,170"
                        fill="url(#funnel-grad-inv)"
                        className={`transition-all ${
                          activeFunnelFilter === "invoiced" ? "stroke-purple-300 stroke-[3]" : "stroke-purple-400/40 stroke-1 hover:stroke-purple-300"
                        }`}
                      />
                      <text x="250" y="129" className="fill-white text-[9px] font-black uppercase tracking-wider">2. INVOICED</text>
                      <text x="250" y="151" className="fill-white text-sm font-black font-mono">{formatKesCompact(funnelData.inv)}</text>
                      <text x="348" y="130" className="fill-purple-200 text-[10px] font-black font-mono">{funnelData.invPercent.toFixed(1)}%</text>
                    </g>

                    {/* Funnel Connector 2 -> 3 (Animated Pulse Line & Interactive Amber Unpaid Badge) */}
                    <path
                      d="M 395,115 L 430,115 L 430,205 L 445,205"
                      stroke="#f59e0b"
                      strokeWidth="2"
                      strokeDasharray="4 4"
                      className="animate-pulse opacity-70"
                    />

                    {/* Unpaid Invoices Clickable Badge */}
                    <g
                      onClick={() => handleFunnelStageClick("unpaid")}
                      className="cursor-pointer group"
                    >
                      <rect
                        x="380"
                        y="142"
                        width="95"
                        height="26"
                        rx="6"
                        className={`transition-all ${
                          activeFunnelFilter === "unpaid"
                            ? "fill-amber-950 stroke-amber-500 stroke-2"
                            : "fill-slate-900/90 stroke-amber-500/40 stroke-1 group-hover:stroke-amber-400 group-hover:fill-amber-950/80"
                        }`}
                      />
                      <text x="427.5" y="155" className="fill-amber-400 text-[8px] font-black text-center" textAnchor="middle">
                        -{((funnelData.inv - funnelData.pay) / (funnelData.disp || 1) * 100).toFixed(1)}% UNPAID
                      </text>
                      <text x="427.5" y="164" className="fill-amber-200 text-[7px] font-mono text-center" textAnchor="middle">
                        {formatKesCompact(funnelData.unpaidLeak)}
                      </text>
                    </g>

                    {/* Funnel Stage 3: Settled Cash (Clickable) */}
                    <g
                      onClick={() => handleFunnelStageClick("settled")}
                      className={`cursor-pointer transition-all duration-300 ${
                        activeFunnelFilter === "settled" ? "opacity-100 scale-[1.02]" : "hover:opacity-90"
                      }`}
                    >
                      <polygon
                        points="450,185 595,185 580,235 450,235"
                        fill="url(#funnel-grad-pay)"
                        className={`transition-all ${
                          activeFunnelFilter === "settled" ? "stroke-emerald-300 stroke-[3]" : "stroke-emerald-400/40 stroke-1 hover:stroke-emerald-300"
                        }`}
                      />
                      <text x="462" y="206" className="fill-white text-[8px] font-black uppercase tracking-wider">3. SETTLED CASH</text>
                      <text x="462" y="224" className="fill-white text-xs font-black font-mono">{formatKesCompact(funnelData.pay)}</text>
                      <text x="548" y="207" className="fill-emerald-200 text-[9px] font-black font-mono">{funnelData.payPercent.toFixed(1)}%</text>
                    </g>

                  </svg>
                </div>

                {/* Explanatory Interactive KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-zinc-150 dark:border-zinc-800/80 pt-4">
                  
                  {/* Card 1: Dispatched */}
                  <div
                    onClick={() => handleFunnelStageClick("dispatched")}
                    className={`flex flex-col gap-2 p-3.5 rounded-xl border cursor-pointer transition-all ${
                      activeFunnelFilter === "dispatched"
                        ? "bg-indigo-950/40 border-cyan-500/60 shadow-lg shadow-cyan-500/10"
                        : "bg-zinc-900/30 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-gradient-to-r from-[#4f46e5] to-[#06b6d4]"></span>
                        <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">1. Dispatched Volume</span>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-cyan-400">100%</span>
                    </div>
                    <p className="text-[10px] text-zinc-550 dark:text-zinc-400 leading-relaxed">
                      Physical inventory metered leaving KPC loading arms. Baseline volume.
                    </p>
                    <div className="mt-1 flex items-center justify-between text-[10px] pt-1 border-t border-zinc-800/60 text-indigo-400 font-medium">
                      <span>Total: {formatKesCompact(funnelData.disp)}</span>
                      <span>Click to view &rarr;</span>
                    </div>
                  </div>
                  
                  {/* Card 2: Commercial Billing */}
                  <div
                    onClick={() => handleFunnelStageClick("ghost")}
                    className={`flex flex-col gap-2 p-3.5 rounded-xl border cursor-pointer transition-all ${
                      activeFunnelFilter === "ghost" || activeFunnelFilter === "invoiced"
                        ? "bg-purple-950/40 border-purple-500/60 shadow-lg shadow-purple-500/10"
                        : "bg-zinc-900/30 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-gradient-to-r from-[#7c3aed] to-[#a855f7]"></span>
                        <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">2. Commercial Billing</span>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-purple-400">{funnelData.invPercent.toFixed(1)}%</span>
                    </div>
                    <div className="p-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-[10px] text-rose-300 flex items-center justify-between">
                      <span>Ghost Loads Gap:</span>
                      <span className="font-bold font-mono">{formatKesCompact(funnelData.ghostLeak)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-rose-400 font-medium pt-1">
                      <span>Unbilled fuel dispatches</span>
                      <span>Inspect Ghost Loads &rarr;</span>
                    </div>
                  </div>

                  {/* Card 3: Cash Remittances */}
                  <div
                    onClick={() => handleFunnelStageClick("unpaid")}
                    className={`flex flex-col gap-2 p-3.5 rounded-xl border cursor-pointer transition-all ${
                      activeFunnelFilter === "unpaid" || activeFunnelFilter === "settled"
                        ? "bg-emerald-950/40 border-emerald-500/60 shadow-lg shadow-emerald-500/10"
                        : "bg-zinc-900/30 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-gradient-to-r from-[#059669] to-[#10b981]"></span>
                        <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">3. Cash Remittances</span>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-emerald-400">{funnelData.payPercent.toFixed(1)}%</span>
                    </div>
                    <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-300 flex items-center justify-between">
                      <span>Unpaid Invoices Gap:</span>
                      <span className="font-bold font-mono">{formatKesCompact(funnelData.unpaidLeak)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-amber-400 font-medium pt-1">
                      <span>Unmatched / partial payments</span>
                      <span>Inspect Unpaid &rarr;</span>
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
          <div className="bg-white dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">Report Focus</h3>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Select the operational view to inspect and export.</p>
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => handleReportTypeChange("operational")}
                className={`w-full text-left p-3 rounded-lg border text-xs transition-all flex flex-col gap-1 ${
                  reportType === "operational"
                    ? "bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-500 text-indigo-700 dark:text-indigo-300 font-bold"
                    : "bg-white dark:bg-transparent border-zinc-200 dark:border-zinc-800 hover:bg-zinc-55 dark:hover:bg-zinc-900/40 text-zinc-650 dark:text-zinc-400"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>Operational Audit Report</span>
                  {reportType === "operational" && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>}
                </div>
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-normal leading-tight">
                  Audits dispatch volume matching (Ghost loads & transport gaps).
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleReportTypeChange("financial")}
                className={`w-full text-left p-3 rounded-lg border text-xs transition-all flex flex-col gap-1 ${
                  reportType === "financial"
                    ? "bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-500 text-indigo-700 dark:text-indigo-300 font-bold"
                    : "bg-white dark:bg-transparent border-zinc-200 dark:border-zinc-800 hover:bg-zinc-55 dark:hover:bg-zinc-900/40 text-zinc-650 dark:text-zinc-400"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>Financial Settlement Report</span>
                  {reportType === "financial" && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>}
                </div>
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-normal leading-tight">
                  Audits invoiced value vs banking cash deposits.
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleReportTypeChange("icms")}
                className={`w-full text-left p-3 rounded-lg border text-xs transition-all flex flex-col gap-1 ${
                  reportType === "icms"
                    ? "bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-500 text-indigo-700 dark:text-indigo-300 font-bold"
                    : "bg-white dark:bg-transparent border-zinc-200 dark:border-zinc-800 hover:bg-zinc-55 dark:hover:bg-zinc-900/40 text-zinc-650 dark:text-zinc-400"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>iCMS Tax Sync Report</span>
                  {reportType === "icms" && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>}
                </div>
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-normal leading-tight">
                  Audits KRA e-billing status and failed sync queues.
                </span>
              </button>
            </div>
          </div>

          {/* Card B: Export Formats Card */}
          <div className="bg-white dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">Export Settings</h3>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Download formatted files for external reporting.</p>
            </div>

            <div className="flex flex-col gap-3">
              {/* Export Excel (Multi-sheet, full DB) */}
              <button
                type="button"
                onClick={handleExportExcel}
                disabled={exporting || loading}
                className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-200 dark:disabled:bg-zinc-800 py-3 text-xs font-bold text-white shadow-lg active:scale-[0.98] transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>{exporting ? "Generating Excel..." : "Export Full Workbook (Excel)"}</span>
              </button>

              {/* Export CSV (Client-side, filtered table data) */}
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={loading}
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-55 dark:hover:bg-zinc-900 bg-white dark:bg-zinc-900 py-3 text-xs font-bold text-zinc-700 dark:text-zinc-200 shadow-sm active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>Export Active View (CSV)</span>
              </button>
            </div>
          </div>

        </div>

      </div>

      {/* BOTTOM WORKSPACE SECTION: Report Data Preview Table Grid */}
      <div className="bg-white dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm flex flex-col gap-4">
        
        {/* Toolbar Header for Table Preview */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-zinc-150 dark:border-zinc-800/80 pb-4">
          <div>
            <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">
              {reportType === "operational" ? "Operational Audit Log Preview" : 
               reportType === "financial" ? "Financial Settlement Match Preview" : 
               "iCMS Tax Declaration logs"}
            </h3>
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
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
              className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 focus:border-indigo-500 focus:bg-white rounded-lg px-3 py-1.5 text-xs text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none transition-all shadow-inner"
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
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/40">
              {totalItems === 0 ? (
                <div className="py-12 text-center text-xs text-zinc-500 italic">
                  No active logs match the search query or selected materiality.
                </div>
              ) : (
                <table className="w-full min-w-[700px] text-left text-xs">
                  
                  {/* Table Headers */}
                  <thead className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 text-zinc-550 dark:text-zinc-400 font-medium">
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