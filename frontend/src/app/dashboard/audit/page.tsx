"use client";

import { useEffect, useState, useCallback } from "react";
import { getAuditLogs, getAuditSummary, AuditLog, AuditSummary } from "@/lib/api";
import RequirePermission from "@/components/RequirePermission";
import AuditVerifyPanel from "@/components/AuditVerifyPanel";
import { format } from "date-fns";

function AuditContent() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const limit = 50;
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState({
    actor: "",
    action: "",
    target: "",
    date_from: "",
    date_to: "",
  });
  const [total, setTotal] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [logsRes, summaryRes] = await Promise.all([
        getAuditLogs({ limit, offset, ...filters }),
        getAuditSummary(7),
      ]);
      setLogs(logsRes.logs || []);
      setTotal(logsRes.total || (logsRes.logs || []).length);
      setSummary(summaryRes);
    } catch (err) {
      console.error("Audit page error:", err);
      setError(err instanceof Error ? err.message : "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }, [limit, offset, filters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setOffset(0);
  };

  const handlePrevPage = () => setOffset((o) => Math.max(0, o - limit));
  const handleNextPage = () => setOffset((o) => o + limit);

  const getTopAction = (): string => {
    if (!summary) return "—";
    const entries = Object.entries(summary.actions_by_type);
    if (entries.length === 0) return "—";
    return entries.sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
  };

  const getTopActor = (): string => {
    if (!summary) return "—";
    const entries = Object.entries(summary.actions_by_actor);
    if (entries.length === 0) return "—";
    return entries.sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
  };

  const formatAuditDate = (log: AuditLog): string => {
    const ts = log.event_timestamp || log.created_at;
    if (!ts) return "—";
    try {
      return format(new Date(ts), "yyyy-MM-dd HH:mm:ss");
    } catch {
      return "Invalid date";
    }
  };

  return (
    <div className="w-full max-w-[1700px] mx-auto space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-border">
        <div>
          <h1 className="text-2xl font-black text-foreground font-['Outfit',sans-serif]">Immutable Cryptographic Audit Trail</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            SHA-256 Merkle tree event log anchored to Base Sepolia smart contracts.
          </p>
        </div>
      </header>

      {/* Instant Blockchain Verification Panel */}
      <AuditVerifyPanel />

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Total Sealed Events (7d)</p>
          <p className="text-2xl font-black text-foreground font-['Outfit',sans-serif] mt-1">{summary?.total_actions ?? 0}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Top Event Type</p>
          <p className="text-lg font-bold text-foreground font-mono mt-1">{getTopAction()}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Primary System Actor</p>
          <p className="text-lg font-bold text-foreground font-mono mt-1">{getTopActor()}</p>
        </div>
      </div>

      {/* Advanced Filter Bar matching User Specs */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-['Outfit',sans-serif]">
            🔍 Filter Audit Events
          </span>
          <button
            onClick={() => {
              setFilters({ actor: "", action: "", target: "", date_from: "", date_to: "" });
              setOffset(0);
            }}
            className="text-xs font-bold text-primary hover:underline cursor-pointer"
          >
            Clear Filters
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Actor</label>
            <input
              type="text"
              value={filters.actor}
              onChange={(e) => handleFilterChange("actor", e.target.value)}
              placeholder="User ID or email"
              className="mt-1 w-full bg-background border border-border rounded-xl px-3 py-1.5 text-xs font-mono font-medium focus:border-primary outline-none"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Action</label>
            <input
              type="text"
              value={filters.action}
              onChange={(e) => handleFilterChange("action", e.target.value)}
              placeholder="e.g. anomaly.resolved"
              className="mt-1 w-full bg-background border border-border rounded-xl px-3 py-1.5 text-xs font-mono font-medium focus:border-primary outline-none"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Target</label>
            <input
              type="text"
              value={filters.target}
              onChange={(e) => handleFilterChange("target", e.target.value)}
              placeholder="Record ID"
              className="mt-1 w-full bg-background border border-border rounded-xl px-3 py-1.5 text-xs font-mono font-medium focus:border-primary outline-none"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Date From</label>
            <input
              type="date"
              value={filters.date_from}
              onChange={(e) => handleFilterChange("date_from", e.target.value)}
              className="mt-1 w-full bg-background border border-border rounded-xl px-3 py-1.5 text-xs font-mono font-medium focus:border-primary outline-none"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Date To</label>
            <input
              type="date"
              value={filters.date_to}
              onChange={(e) => handleFilterChange("date_to", e.target.value)}
              className="mt-1 w-full bg-background border border-border rounded-xl px-3 py-1.5 text-xs font-mono font-medium focus:border-primary outline-none"
            />
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-4 text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead className="bg-muted/60 border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <tr>
                    <th className="px-4 py-3 text-left">Timestamp</th>
                    <th className="px-4 py-3 text-left">Actor (User / Email)</th>
                    <th className="px-4 py-3 text-left">Action Code</th>
                    <th className="px-4 py-3 text-left">Target Record</th>
                    <th className="px-4 py-3 text-left">Block Index</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {!logs || logs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground italic">
                        No audit logs match current filters.
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => (
                      <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 text-foreground whitespace-nowrap">{formatAuditDate(log)}</td>
                        <td className="px-4 py-2.5 font-bold text-slate-300">
                          {log.actor_user_id || log.external_actor || "system"}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded-full font-bold">
                            {log.action}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {log.target_type}: <strong className="text-foreground">{log.target_id}</strong>
                        </td>
                        <td className="px-4 py-2.5 font-bold text-cyan-400">#{log.block_index}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs font-mono">
            <p className="text-muted-foreground">
              Showing {total > 0 ? offset + 1 : 0}–{Math.min(offset + limit, total)} of {total} records
            </p>
            <div className="flex gap-2">
              <button
                onClick={handlePrevPage}
                disabled={offset === 0}
                className="px-3.5 py-1.5 border border-border rounded-xl disabled:opacity-40 hover:bg-muted font-bold transition-all cursor-pointer"
              >
                ← Previous
              </button>
              <button
                onClick={handleNextPage}
                disabled={offset + limit >= total}
                className="px-3.5 py-1.5 border border-border rounded-xl disabled:opacity-40 hover:bg-muted font-bold transition-all cursor-pointer"
              >
                Next →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function AuditPage() {
  return (
    <RequirePermission code="view_audit">
      <AuditContent />
    </RequirePermission>
  );
}