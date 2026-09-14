"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useMateriality } from "@/context/MaterialityContext";
import { getAnomalies, updateAnomalyStatus, getAnomalyActions, createAnomalyAction, downloadExport, ApiError, type FraudFeedbackLabel } from "@/lib/api";
import type { Anomaly, AnomalyAction, FraudTier } from "@/lib/types";
import type { AnomaliesConfig } from "@/config/direction-config";
import type { WorkspaceDirection } from "@/lib/workspace";
import AnomalyTable from "@/components/AnomalyTable";
import FraudExplainPanel from "@/components/FraudExplainPanel";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(value);
}

interface AnomaliesTableProps {
  direction: WorkspaceDirection;
  config: AnomaliesConfig;
  /** Outbound drill-down scope (/dashboard/outbound/anomalies/[groupId]) —
   * omitted entirely for the unscoped inbound/outbound list views. */
  scopeParams?: { pillarId?: string; officerId?: string };
  title?: string;
  subtitle?: string;
}

export default function AnomaliesTable({ direction, config, scopeParams, title, subtitle }: AnomaliesTableProps) {
  const { user } = useAuth();
  const { materiality } = useMateriality();
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [selectedAnomaly, setSelectedAnomaly] = useState<Anomaly | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [breakTypeFilter, setBreakTypeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [fraudTierFilter, setFraudTierFilter] = useState<"All" | FraudTier>("All");
  const [minLeakageInput, setMinLeakageInput] = useState<string>("");
  const [maxLeakageInput, setMaxLeakageInput] = useState<string>("");
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalAnomalies, setTotalAnomalies] = useState(0);
  const pageSize = 25;

  const [resolving, setResolving] = useState(false);
  const [caseAction, setCaseAction] = useState("acknowledge");
  const [caseNote, setCaseNote] = useState("");
  const [caseHistory, setCaseHistory] = useState<AnomalyAction[]>([]);
  const [caseActionMessage, setCaseActionMessage] = useState<string | null>(null);
  const [savingCaseAction, setSavingCaseAction] = useState(false);

  useEffect(() => {
    if (!selectedAnomaly) return;
    Promise.resolve().then(async () => {
      try {
        setCaseHistory(await getAnomalyActions(selectedAnomaly.dispatch_id, direction));
      } catch (err) {
        setCaseActionMessage(err instanceof ApiError ? err.message : "Could not load the case history.");
      }
    });
  }, [selectedAnomaly, direction]);

  async function recordCaseAction() {
    if (!selectedAnomaly) return;
    if (["add_note", "request_evidence"].includes(caseAction) && !caseNote.trim()) {
      setCaseActionMessage("Add a short note so the next reviewer knows what is required.");
      return;
    }
    setSavingCaseAction(true);
    setCaseActionMessage(null);
    try {
      const action = await createAnomalyAction(selectedAnomaly.dispatch_id, caseAction, caseNote.trim(), direction);
      setCaseHistory((history) => [action, ...history]);
      setCaseNote("");
      setCaseActionMessage("Action recorded in the audit trail.");
    } catch (err) {
      setCaseActionMessage(err instanceof ApiError ? err.message : "Could not record the case action.");
    } finally {
      setSavingCaseAction(false);
    }
  }

  function selectAnomaly(anomaly: Anomaly | null) {
    setSelectedAnomaly(anomaly);
    if (anomaly) {
      setCaseHistory([]);
      setCaseActionMessage(null);
    }
  }

  useEffect(() => {
    const handle = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  async function loadAnomalies() {
    await Promise.resolve();
    setLoading(true);
    setError(null);
    try {
      const minL = minLeakageInput ? Number(minLeakageInput) : undefined;
      const maxL = maxLeakageInput ? Number(maxLeakageInput) : undefined;
      const data = await getAnomalies(
        materiality,
        page,
        pageSize,
        {
          breakType: breakTypeFilter === "All" ? undefined : breakTypeFilter,
          status: statusFilter === "All" ? undefined : statusFilter,
          search: searchQuery || undefined,
          minLeakage: Number.isFinite(minL) ? minL : undefined,
          maxLeakage: Number.isFinite(maxL) ? maxL : undefined,
          pillarId: scopeParams?.pillarId,
          officerId: scopeParams?.officerId,
        },
        direction,
      );
      setAnomalies(data.anomalies);
      setTotalPages(data.pagination.total_pages);
      setTotalAnomalies(data.pagination.total);
      if (selectedAnomaly) {
        const fresh = data.anomalies.find((x) => x.dispatch_id === selectedAnomaly.dispatch_id);
        if (fresh) setSelectedAnomaly(fresh);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not retrieve anomalies list from the gateway.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    Promise.resolve().then(() => loadAnomalies());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materiality, direction, breakTypeFilter, statusFilter, searchQuery, minLeakageInput, maxLeakageInput, page, scopeParams?.pillarId, scopeParams?.officerId]);

  async function handleExportFormat(fmt: "xlsx" | "csv" | "json") {
    setExportingFormat(fmt);
    try {
      const minL = minLeakageInput ? Number(minLeakageInput) : undefined;
      const maxL = maxLeakageInput ? Number(maxLeakageInput) : undefined;
      await downloadExport(materiality, direction, fmt, {
        breakType: breakTypeFilter === "All" ? undefined : breakTypeFilter,
        status: statusFilter === "All" ? undefined : statusFilter,
        search: searchQuery || undefined,
        minLeakage: Number.isFinite(minL) ? minL : undefined,
        maxLeakage: Number.isFinite(maxL) ? maxL : undefined,
      });
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to download export file.");
    } finally {
      setExportingFormat(null);
    }
  }

  async function handleResolve(dispatchId: string, fraudFeedbackLabel?: FraudFeedbackLabel) {
    if (!confirm("Are you sure you want to mark this anomaly as resolved?")) return;
    setResolving(true);
    try {
      await updateAnomalyStatus(dispatchId, "Resolved", "", fraudFeedbackLabel);
      await loadAnomalies();
      setSelectedAnomaly(null);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to resolve anomaly.");
    } finally {
      setResolving(false);
    }
  }

  const canResolve = user?.permissions.includes("resolve_anomaly");

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto relative text-zinc-800 dark:text-zinc-100">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{title ?? "Anomalies"}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{subtitle ?? `${config.entityLabel} reconciliation leaks`}</p>
      </header>

      <div className="flex flex-col gap-4 bg-white dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl shadow-sm">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder={`Search by ${config.entityLabel}, ${config.idLabel}, ${config.productLabel}, or ${config.secondaryRecordLabel} ID...`}
              value={searchInput}
              onChange={(e) => { setSearchInput(e.target.value); setPage(1); }}
              className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 focus:border-indigo-500 focus:bg-white rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none transition-all shadow-inner"
            />
          </div>
          <div className="flex flex-wrap md:flex-nowrap gap-3">
            <div className="flex flex-col gap-1 w-full sm:w-44">
              <select
                value={breakTypeFilter}
                onChange={(e) => { setBreakTypeFilter(e.target.value); setPage(1); }}
                className="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 focus:border-indigo-500 rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-100 focus:outline-none transition-all cursor-pointer shadow-sm"
              >
                <option value="All">All Break Types</option>
                {config.breakTypeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1 w-full sm:w-36">
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                className="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 focus:border-indigo-500 rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-100 focus:outline-none transition-all cursor-pointer shadow-sm"
              >
                <option value="All">All Statuses</option>
                <option value="Critical">Critical</option>
                <option value="Pending">Pending</option>
                <option value="Review Required">Review Required</option>
                <option value="Resolved">Resolved</option>
              </select>
            </div>
            <div className="flex flex-col gap-1 w-full sm:w-36">
              <select
                value={fraudTierFilter}
                onChange={(e) => setFraudTierFilter(e.target.value as "All" | FraudTier)}
                className="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 focus:border-indigo-500 rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-100 focus:outline-none transition-all cursor-pointer shadow-sm"
              >
                <option value="All">All Fraud Tiers</option>
                <option value="Likely Fraud">Likely Fraud</option>
                <option value="Suspicious">Suspicious</option>
                <option value="Likely Benign">Likely Benign</option>
              </select>
            </div>
          </div>
        </div>

        {/* Second row: Min/Max Leakage Range & Multi-Format Export Buttons */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500 dark:text-zinc-400 font-medium">Leakage KSh:</span>
            <input
              type="number"
              placeholder="Min KSh"
              value={minLeakageInput}
              onChange={(e) => { setMinLeakageInput(e.target.value); setPage(1); }}
              className="w-28 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded px-2 py-1 text-xs text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-indigo-500"
            />
            <span className="text-zinc-400">–</span>
            <input
              type="number"
              placeholder="Max KSh"
              value={maxLeakageInput}
              onChange={(e) => { setMaxLeakageInput(e.target.value); setPage(1); }}
              className="w-28 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded px-2 py-1 text-xs text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {user?.permissions.includes("export_reports") && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Export:</span>
              <button
                type="button"
                disabled={!!exportingFormat}
                onClick={() => handleExportFormat("xlsx")}
                className="px-2.5 py-1 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50"
              >
                {exportingFormat === "xlsx" ? "..." : "Excel (.xlsx)"}
              </button>
              <button
                type="button"
                disabled={!!exportingFormat}
                onClick={() => handleExportFormat("csv")}
                className="px-2.5 py-1 text-xs font-semibold rounded bg-indigo-600 hover:bg-indigo-700 text-white transition-colors disabled:opacity-50"
              >
                {exportingFormat === "csv" ? "..." : "CSV (.csv)"}
              </button>
              <button
                type="button"
                disabled={!!exportingFormat}
                onClick={() => handleExportFormat("json")}
                className="px-2.5 py-1 text-xs font-semibold rounded bg-purple-600 hover:bg-purple-700 text-white transition-colors disabled:opacity-50"
              >
                {exportingFormat === "json" ? "..." : "JSON (.json)"}
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-600 dark:text-red-300">{error}</div>
      )}

      {loading && !error && (
        <div className="flex items-center justify-center p-12">
          <div className="w-8 h-8 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin"></div>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <AnomalyTable
              anomalies={fraudTierFilter === "All" ? anomalies : anomalies.filter((a) => a.fraud_tier === fraudTierFilter)}
              onSelectAnomaly={selectAnomaly}
              selectedAnomalyId={selectedAnomaly?.dispatch_id}
              columnLabels={config.columns}
              idLabel={config.idLabel}
            />
          </div>
          <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/40 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-zinc-500 dark:text-zinc-400">Showing {anomalies.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, totalAnomalies)} of {totalAnomalies.toLocaleString()} cases</p>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-md border border-zinc-200 px-3 py-1.5 font-semibold text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200">Previous</button>
              <span className="min-w-20 text-center font-mono text-zinc-500 dark:text-zinc-400">Page {page} / {totalPages}</span>
              <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} className="rounded-md border border-zinc-200 px-3 py-1.5 font-semibold text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200">Next</button>
            </div>
          </div>
        </>
      )}

      {selectedAnomaly && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity" onClick={() => selectAnomaly(null)}></div>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
            <div className="flex h-[calc(100vh-1.5rem)] max-h-[900px] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:h-[calc(100vh-3rem)]">
              <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-start bg-zinc-50 dark:bg-zinc-950/50">
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-600 dark:text-indigo-400">Investigation</span>
                  <h2 className="text-lg font-bold text-zinc-900 dark:text-white mt-0.5">{config.investigationTitle} #{selectedAnomaly.dispatch_id}</h2>
                  <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                    {direction === "inbound" ? "Oil revenue assurance" : "Inuka programme assurance"} · {canResolve ? "Investigation & resolution" : "Oversight & escalation"}
                  </p>
                </div>
                <button onClick={() => selectAnomaly(null)} className="text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-white p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col gap-6">
                <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">Investigation context</p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                    {canResolve
                      ? "Review the source records, record a fraud judgment where appropriate, and resolve or escalate the case."
                      : "This is an evidence view for oversight. Review the source records and escalate the case through the assurance process; resolution controls are restricted to Revenue Assurance."}
                  </p>
                </div>

                <div className="flex items-center justify-between bg-zinc-50 dark:bg-zinc-950/40 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800/50">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Current Status</span>
                    <span className={`text-xs font-bold px-2.5 py-0.5 mt-1 rounded-full text-center inline-block ${
                      selectedAnomaly.status === "Critical" ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                        : selectedAnomaly.status === "Review Required" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                        : selectedAnomaly.status === "Resolved" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                        : "bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-300"
                    }`}>{selectedAnomaly.status}</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Leakage (KSh)</span>
                    <span className="text-base font-bold text-rose-600 dark:text-rose-400 font-mono mt-0.5">{formatKes(selectedAnomaly.leakage_kes)}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <h3 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{config.sourceRecordsLabel}</h3>
                  <div className="grid grid-cols-2 gap-4 bg-zinc-50 dark:bg-zinc-950/20 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl text-sm">
                    <div>
                      <p className="text-[10px] text-zinc-500 font-semibold uppercase">{config.entityLabel}</p>
                      <p className="text-zinc-700 dark:text-zinc-200 mt-0.5 font-medium">{selectedAnomaly.customer}</p>{direction === "outbound" && (<><p className="mt-1 font-mono text-[11px] text-zinc-500">ID: {selectedAnomaly.beneficiary_id || "Unavailable"}</p><p className="mt-1 text-[11px] text-zinc-500">Officer: {selectedAnomaly.officer_id || "Unavailable"}</p></>)}
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-500 font-semibold uppercase">{config.productLabel}</p>
                      <p className="text-zinc-700 dark:text-zinc-200 mt-0.5 font-medium">{selectedAnomaly.product}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-500 font-semibold uppercase">{config.columns.dispatched_kes ?? "Dispatched Value"}</p>
                      <p className="text-zinc-900 dark:text-white font-bold font-mono mt-0.5">{formatKes(selectedAnomaly.dispatched_kes)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-500 font-semibold uppercase">Age</p>
                      <p className="text-zinc-700 dark:text-zinc-200 mt-0.5 font-medium">{selectedAnomaly.age_days} days</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <h3 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{config.secondaryRecordLabel} Match</h3>
                  {selectedAnomaly.invoice_id ? (
                    <div className="grid grid-cols-2 gap-4 bg-zinc-50 dark:bg-zinc-950/20 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl text-sm">
                      <div>
                        <p className="text-[10px] text-zinc-500 font-semibold uppercase">{config.secondaryRecordLabel} ID</p>
                        <p className="text-zinc-700 dark:text-zinc-200 font-mono mt-0.5">{selectedAnomaly.invoice_id}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-500 font-semibold uppercase">{config.columns.invoiced_kes ?? "Invoiced Value"}</p>
                        <p className="text-zinc-900 dark:text-white font-bold font-mono mt-0.5">{formatKes(selectedAnomaly.invoiced_kes)}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 flex gap-3 text-sm text-rose-600 dark:text-rose-400">
                      <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                      <div>
                        <p className="font-bold">Missing {config.secondaryRecordLabel} Detected</p>
                        <p className="text-xs text-rose-600/80 dark:text-rose-400/80 mt-1">
                          {direction === "inbound"
                            ? "Fuel was physically dispatched from KPC gantry but no commercial invoice was registered for this OMC."
                            : "Attendance was recorded but no stipend authorization was ever raised for this beneficiary."}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-3">
                  <h3 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{config.paymentRecordLabel} Match</h3>
                  {selectedAnomaly.paid_kes > 0 ? (
                    <div className="grid grid-cols-2 gap-4 bg-zinc-50 dark:bg-zinc-950/20 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl text-sm">
                      <div>
                        <p className="text-[10px] text-zinc-500 font-semibold uppercase">{config.paymentRecordLabel} Amount</p>
                        <p className="text-zinc-900 dark:text-white font-bold font-mono mt-0.5">{formatKes(selectedAnomaly.paid_kes)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-500 font-semibold uppercase">Reconciliation Status</p>
                        <p className="text-zinc-700 dark:text-zinc-200 mt-0.5 font-medium">Partial {config.paymentRecordLabel}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex gap-3 text-sm text-amber-600 dark:text-amber-400">
                      <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                      <div>
                        <p className="font-bold">Missing {config.paymentRecordLabel} Match</p>
                        <p className="text-xs text-amber-600/80 dark:text-amber-400/80 mt-1">No {config.paymentRecordLabel.toLowerCase()} reference matched this {config.secondaryRecordLabel.toLowerCase()}. It remains unfulfilled.</p>
                      </div>
                    </div>
                  )}
                </div>

                {config.showEbilling && (
                  <div className="flex flex-col gap-3">
                    <h3 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">KRA iCMS Status</h3>
                    <div className="grid grid-cols-2 gap-4 bg-zinc-50 dark:bg-zinc-950/20 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl text-sm">
                      <div>
                        <p className="text-[10px] text-zinc-500 font-semibold uppercase">E-Billing Status</p>
                        <p className="text-zinc-700 dark:text-zinc-200 mt-0.5 capitalize">{selectedAnomaly.ebilling_status}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-500 font-semibold uppercase">Sync Date</p>
                        <p className="text-zinc-700 dark:text-zinc-200 mt-0.5 font-mono">{selectedAnomaly.ebilling_sync_date ?? "Pending"}</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-3 border-t border-zinc-200 dark:border-zinc-800 pt-6">
                  <FraudExplainPanel anomalyId={selectedAnomaly.dispatch_id} />
                </div>

                <div className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Review action</h3>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Record what was done next so the case can move between teams without losing context.</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_1fr]">
                    <select value={caseAction} onChange={(event) => setCaseAction(event.target.value)} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950">
                      <option value="acknowledge">Acknowledge</option>
                      <option value="request_evidence">Request evidence</option>
                      <option value="add_note">Add note</option>
                      <option value="escalate">Escalate</option>
                    </select>
                    <textarea value={caseNote} onChange={(event) => setCaseNote(event.target.value)} maxLength={2000} rows={2} placeholder="Optional context, evidence requested, or escalation reason" className="resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" />
                  </div>
                  <button type="button" onClick={recordCaseAction} disabled={savingCaseAction} className="self-start rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
                    {savingCaseAction ? "Recording…" : "Record action"}
                  </button>
                  {caseActionMessage && <p className="text-xs text-zinc-500 dark:text-zinc-400">{caseActionMessage}</p>}
                  {caseHistory.length > 0 && (
                    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
                      <p className="border-b border-zinc-200 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:border-zinc-800">Case history</p>
                      <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                        {caseHistory.slice(0, 8).map((item) => (
                          <div key={item.id} className="px-3 py-2 text-xs">
                            <div className="flex flex-wrap justify-between gap-2 font-semibold text-zinc-700 dark:text-zinc-200"><span>{item.label ?? item.action}</span><time className="font-normal text-zinc-400">{new Date(item.created_at).toLocaleString()}</time></div>
                            {item.note && <p className="mt-1 text-zinc-500 dark:text-zinc-400">{item.note}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {canResolve && selectedAnomaly.status !== "Resolved" && (
                <div className="shrink-0 p-4 sm:p-6 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 flex flex-col gap-2">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Investigator actions · resolution is recorded in the audit trail</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => handleResolve(selectedAnomaly.dispatch_id, "confirmed_fraud")} disabled={resolving} className="rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed py-2.5 text-xs font-semibold text-white active:scale-[0.98] transition-all">Confirmed Fraud</button>
                    <button onClick={() => handleResolve(selectedAnomaly.dispatch_id, "false_positive")} disabled={resolving} className="rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed py-2.5 text-xs font-semibold text-white active:scale-[0.98] transition-all">False Positive</button>
                  </div>
                  <button onClick={() => handleResolve(selectedAnomaly.dispatch_id)} disabled={resolving} className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-200 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                    {resolving ? "Resolving..." : "Mark Resolved (no fraud judgment)"}
                  </button>
                </div>
              )}
              {!canResolve && (
                <div className="shrink-0 border-t border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/50 sm:px-6">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Read-only oversight</p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Revenue Assurance owns the resolution decision. Use the review queue or escalation process for follow-up.</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
