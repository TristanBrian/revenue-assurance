"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ApiError, downloadExportWithFields, getAnomalies, getEbillingLogs, getMetrics } from "@/lib/api";
import { useMateriality } from "@/context/MaterialityContext";
import { reportsConfig, anomaliesConfig } from "@/config/direction-config";
import type { WorkspaceDirection } from "@/lib/workspace";
import { useAuth } from "@/lib/auth-context";
import RequirePermission from "@/components/RequirePermission";
import ConsentModal from "@/components/ConsentModal";
import FieldSelectorModal from "@/components/FieldSelectorModal";
import RecordHistoryDrawer from "@/components/RecordHistoryDrawer";
import ReportVerifierModal from "@/components/ReportVerifierModal";
import type { Anomaly, EbillingLogEntry, Metrics } from "@/lib/types";

type ReportType = "operational" | "financial" | "icms";

function kes(value: number): string {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(value);
}

function compactKes(value: number): string {
  if (value >= 1_000_000_000) return `KES ${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `KES ${(value / 1_000_000).toFixed(2)}M`;
  return kes(value);
}

function escapeCsv(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function statusTone(status: string): string {
  if (status === "Critical" || status === "failed") return "bg-status-critical-bg text-status-critical";
  if (status === "Pending" || status === "Review Required" || status === "pending") return "bg-status-medium-bg text-status-medium";
  return "bg-status-low-bg text-status-low";
}

function ReportsContent({ direction }: { direction: WorkspaceDirection }) {
  const { materiality } = useMateriality();
  const { user } = useAuth();
  const config = reportsConfig[direction];
  const anomalyLabels = anomaliesConfig[direction];
  const REPORTS: Array<{ id: ReportType; label: string; description: string }> = [
    { id: "operational", label: "Operational exceptions", description: `Missing ${anomalyLabels.secondaryRecordLabel.toLowerCase()} and underpayment breaks.` },
    { id: "financial", label: "Financial settlement", description: `${anomalyLabels.secondaryRecordLabel}, ${anomalyLabels.paymentRecordLabel.toLowerCase()}, overpayment, and outstanding-value checks.` },
    ...(config.showEbillingLogs && user?.permissions.includes("manage_ebilling") ? [{ id: "icms" as const, label: "iCMS synchronisation", description: "Invoice delivery status, retries, and integration errors." }] : []),
  ];

  const [reportType, setReportType] = useState<ReportType>("operational");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [icmsLogs, setIcmsLogs] = useState<EbillingLogEntry[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldSelectorOpen, setFieldSelectorOpen] = useState(false);
  const [verifierOpen, setVerifierOpen] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<{ type: string; id: string } | null>(null);
  // The privacy notice is deliberately shown on every entry to Reports.
  const [consentOpen, setConsentOpen] = useState(true);
  const pageSize = 10;

  useEffect(() => {
    let cancelled = false;

    async function loadReports() {
      setLoading(true);
      setError(null);
      try {
        // getMetrics() (POST /api/reconcile/metrics) deliberately has no
        // `anomalies` field — see MetricsResponse's own docstring:
        // "Everything from ReconciliationData except the anomaly table...
        // which are gated separately and live in their own endpoints."
        // The actual rows live at getAnomalies() (GET
        // /api/reconcile/anomalies) — reading them off metricsResult
        // instead left this table permanently empty regardless of
        // report type or direction. page_size capped at the server's
        // max (100, `le=100` on that route) — same "good enough for a
        // demo-scale set" tradeoff BeneficiaryList.tsx already makes,
        // not a full unpaginated fetch.
        const [metricsResult, anomaliesResult, logs] = await Promise.all([
          getMetrics(materiality, direction),
          getAnomalies(materiality, 1, 100, {}, direction),
          reportType === "icms" ? getEbillingLogs(200) : Promise.resolve([] as EbillingLogEntry[]),
        ]);
        if (cancelled) return;
        setMetrics(metricsResult.metrics);
        setAnomalies(anomaliesResult.anomalies);
        setIcmsLogs(logs);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load report data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadReports();
    return () => { cancelled = true; };
  }, [direction, materiality, reportType]);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (reportType === "icms") {
      return icmsLogs.filter((log) => [log.invoice_id, log.customer_name, log.status, log.error_message].some((value) => value?.toLowerCase().includes(query)));
    }
    const allowed = reportType === "operational"
      ? [anomalyLabels.breakTypeOptions[0]?.value, "Underpayment"]
      : [anomalyLabels.breakTypeOptions[1]?.value, "Underpayment", "Overpayment"];
    return anomalies.filter((item) => allowed.includes(item.break_type) && [item.dispatch_id, item.invoice_id, item.customer, item.product, item.break_type, item.status].some((value) => value?.toLowerCase().includes(query)));
  }, [anomalies, icmsLogs, reportType, search, anomalyLabels]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const visibleRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const exposure = (metrics?.missing_invoice_leak ?? 0) + (metrics?.missing_payment_leak ?? 0);

  function changeReport(type: ReportType) {
    setReportType(type);
    setSearch("");
    setPage(1);
  }

  async function exportExcel(fields: string[]) {
    setExporting(true);
    try {
      const blob = await downloadExportWithFields(materiality, fields, direction);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `kpc-${direction}-${reportType}-report.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      setFieldSelectorOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not export the workbook.");
    } finally {
      setExporting(false);
    }
  }

  function exportCsv() {
    const headers = reportType === "icms"
      ? ["Invoice ID", "Customer", "Value (KES)", "Status", "Retries", "Last Attempt", "Error"]
      : ["ID", anomalyLabels.secondaryRecordLabel + " ID", anomalyLabels.entityLabel, anomalyLabels.productLabel, "Dispatched (KES)", "Invoiced (KES)", "Paid (KES)", "Leakage (KES)", "Break Type", "Status"];
    const body = reportType === "icms"
      ? (rows as EbillingLogEntry[]).map((item) => [item.invoice_id, item.customer_name, item.value_kes, item.status, item.retry_count, item.last_attempt, item.error_message])
      : (rows as Anomaly[]).map((item) => [item.dispatch_id, item.invoice_id, item.customer, item.product, item.dispatched_kes, item.invoiced_kes, item.paid_kes, item.leakage_kes, item.break_type, item.status]);
    const csv = [headers, ...body].map((line) => line.map(escapeCsv).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = `data:text/csv;charset=utf-8,﻿${encodeURIComponent(csv)}`;
    link.download = `kpc-${direction}-${reportType}-report.csv`;
    link.click();
  }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">{direction === "inbound" ? "Oil Revenue" : "Inuka Programs"} workspace</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Reports and evidence</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Select a report purpose, inspect the records behind the totals, and export a traceable file for review or decision-making.</p></div>
        <button type="button" onClick={() => setConsentOpen(true)} className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-accent">Data privacy notice</button>
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Exceptions in scope</p><p className="mt-2 text-2xl font-bold text-foreground">{loading ? "—" : (metrics?.anomaly_count ?? 0).toLocaleString("en-KE")}</p><p className="mt-1 text-xs text-muted-foreground">Live reconciled records.</p></div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Exposure identified</p><p className="mt-2 text-2xl font-bold text-status-critical">{compactKes(exposure)}</p><p className="mt-1 text-xs text-muted-foreground">Missing {anomalyLabels.secondaryRecordLabel.toLowerCase()} and {anomalyLabels.paymentRecordLabel.toLowerCase()} exposure.</p></div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Reconciliation rate</p><p className="mt-2 text-2xl font-bold text-status-low">{metrics ? `${metrics.reconciliation_rate.toFixed(1)}%` : "—"}</p><p className="mt-1 text-xs text-muted-foreground">Current live scope.</p></div>
      </section>

      {error && <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg p-4 text-sm text-status-critical">{error}</div>}

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">1. Choose a report</p><h2 className="mt-1 text-lg font-bold text-foreground">Report focus</h2><p className="mt-1 text-sm text-muted-foreground">Each view has a different evidence set and export purpose.</p></div><div className="flex flex-wrap gap-2" role="tablist" aria-label="Report types">{REPORTS.map((report) => <button key={report.id} type="button" role="tab" aria-selected={reportType === report.id} onClick={() => changeReport(report.id)} className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${reportType === report.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"}`}>{report.label}</button>)}</div></div>
        <p className="mt-4 rounded-lg bg-muted/60 px-4 py-3 text-sm text-muted-foreground">{REPORTS.find((report) => report.id === reportType)?.description}</p>
      </section>

      <section className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6"><div><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">2. Inspect evidence</p><h2 className="mt-1 text-lg font-bold text-foreground">{reportType === "icms" ? "iCMS synchronization records" : reportType === "operational" ? "Operational exceptions" : "Financial settlement exceptions"}</h2><p className="mt-1 text-xs text-muted-foreground">{reportType === "icms" ? "Integration logs returned by the e-Billing service." : `Exceptions at or above KES ${materiality.toLocaleString("en-KE")} materiality.`}</p></div><div className="flex w-full gap-2 sm:w-auto"><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={`Search ID, ${anomalyLabels.entityLabel.toLowerCase()}, status…`} className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 sm:w-72" />{search && <button type="button" onClick={() => { setSearch(""); setPage(1); }} className="rounded-lg border border-border px-3 text-sm font-semibold text-muted-foreground hover:bg-accent">Clear</button>}</div></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground"><tr>{reportType === "icms" ? <><th className="px-5 py-3">Invoice</th><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Value</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Retries</th><th className="px-5 py-3">Last attempt</th><th className="px-5 py-3">Action</th></> : <><th className="px-5 py-3">ID</th><th className="px-5 py-3">{anomalyLabels.secondaryRecordLabel}</th><th className="px-5 py-3">{anomalyLabels.entityLabel}</th><th className="px-5 py-3">Break</th><th className="px-5 py-3">Leakage</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Action</th></>}</tr></thead><tbody className="divide-y divide-border">{loading ? <tr><td colSpan={7} className="px-5 py-14 text-center text-muted-foreground">Loading live report data…</td></tr> : visibleRows.length === 0 ? <tr><td colSpan={7} className="px-5 py-14 text-center text-muted-foreground">No records match this report and search.</td></tr> : reportType === "icms" ? (visibleRows as EbillingLogEntry[]).map((item) => <tr key={item.invoice_id} className="hover:bg-accent/40"><td className="px-5 py-3 font-mono text-xs font-semibold">{item.invoice_id}</td><td className="px-5 py-3">{item.customer_name ?? "—"}</td><td className="px-5 py-3 font-mono">{kes(item.value_kes ?? 0)}</td><td className="px-5 py-3"><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${statusTone(item.status)}`}>{item.status}</span></td><td className="px-5 py-3 font-mono">{item.retry_count}</td><td className="px-5 py-3 text-xs text-muted-foreground">{item.last_attempt || "—"}</td><td className="px-5 py-3"><button type="button" onClick={() => setHistoryTarget({ type: "invoice", id: item.invoice_id })} className="text-xs font-semibold text-primary hover:underline">View history</button></td></tr>) : (visibleRows as Anomaly[]).map((item) => <tr key={`${item.dispatch_id}-${item.break_type}`} className="hover:bg-accent/40"><td className="px-5 py-3 font-mono text-xs font-semibold">{item.dispatch_id}</td><td className="px-5 py-3 font-mono text-xs">{item.invoice_id ?? "—"}</td><td className="px-5 py-3">{item.customer}</td><td className="px-5 py-3"><span className="rounded-full bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground">{item.break_type}</span></td><td className="px-5 py-3 font-mono font-semibold text-status-critical">{kes(item.leakage_kes)}</td><td className="px-5 py-3"><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${statusTone(item.status)}`}>{item.status}</span></td><td className="px-5 py-3"><button type="button" onClick={() => setHistoryTarget({ type: item.invoice_id ? "invoice" : "dispatch", id: item.invoice_id ?? item.dispatch_id })} className="text-xs font-semibold text-primary hover:underline">View history</button></td></tr>)}</tbody></table></div>
        <div className="flex flex-col gap-3 border-t border-border p-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6"><span>{rows.length === 0 ? "0" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, rows.length)}`} of {rows.length} records</span><div className="flex items-center gap-2"><button type="button" disabled={page === 1} onClick={() => setPage((current) => current - 1)} className="rounded-lg border border-border px-3 py-1.5 font-semibold hover:bg-accent disabled:opacity-40">Previous</button><span>Page {page} of {totalPages}</span><button type="button" disabled={page === totalPages} onClick={() => setPage((current) => current + 1)} className="rounded-lg border border-border px-3 py-1.5 font-semibold hover:bg-accent disabled:opacity-40">Next</button></div></div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">3. Export report</p><h2 className="mt-1 text-lg font-bold text-foreground">Create a minimized report package</h2><p className="mt-1 text-sm text-muted-foreground">{config.exportLabel}. Select only the fields required for the report purpose.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setFieldSelectorOpen(true)} disabled={reportType === "icms"} className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40">Export Excel</button><button type="button" onClick={exportCsv} disabled={rows.length === 0} className="rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40">Export CSV</button></div></div>{reportType === "icms" && <p className="mt-4 rounded-lg border border-status-info/25 bg-status-info-bg px-4 py-3 text-xs text-status-info">Excel export is available for reconciliation datasets. Use the CSV export above for the selected iCMS log view.</p>}</section>

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">4. Verify authenticity</p><h2 className="mt-1 text-lg font-bold text-foreground">SHA-256 report verifier</h2><p className="mt-1 text-sm text-muted-foreground">Validate the cryptographic digest before relying on or sharing an exported file.</p></div><button type="button" onClick={() => setVerifierOpen(true)} className="rounded-lg border border-primary/30 px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary/5">Verify file</button></div></section>

      <FieldSelectorModal isOpen={fieldSelectorOpen} onClose={() => setFieldSelectorOpen(false)} onConfirmExport={exportExcel} exporting={exporting} />
      <ReportVerifierModal isOpen={verifierOpen} onClose={() => setVerifierOpen(false)} />
      <RecordHistoryDrawer isOpen={!!historyTarget} onClose={() => setHistoryTarget(null)} targetType={historyTarget?.type ?? ""} targetId={historyTarget?.id ?? ""} />
      <ConsentModal forceShow={consentOpen} onAccept={() => setConsentOpen(false)} />
    </div>
  );
}

export default function ReportsPage() {
  const { direction } = useParams<{ direction: WorkspaceDirection }>();
  return (
    <RequirePermission code="export_reports">
      <ReportsContent direction={direction} />
    </RequirePermission>
  );
}
