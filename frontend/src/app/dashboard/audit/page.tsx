"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { getAuditLogs, getAuditSummary, AuditLog, AuditSummary } from "@/lib/api";
import RequirePermission from "@/components/RequirePermission";
import { format } from "date-fns";

function AuditContent() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState({
    actor: "",
    action: "",
    target: "",
    date_from: "",
    date_to: "",
  });
  const [total, setTotal] = useState(0);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [logsRes, summaryRes] = await Promise.all([
        getAuditLogs({ limit, offset, ...filters }),
        getAuditSummary(7),
      ]);
      console.log("Audit logs response:", logsRes);
      console.log("Audit summary response:", summaryRes);
      setLogs(logsRes.logs || []);
      setTotal(logsRes.total || 0);
      // summaryRes is already the raw data – it has total_actions, actions_by_type, actions_by_actor
      setSummary(summaryRes);
    } catch (err) {
      console.error("Audit page error:", err);
      setError(err instanceof Error ? err.message : "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, offset, filters]);

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setOffset(0);
  };

  const handlePrevPage = () => setOffset((o) => Math.max(0, o - limit));
  const handleNextPage = () => setOffset((o) => o + limit);

  // Safely extract top action from actions_by_type
  const getTopAction = (): string => {
    if (!summary) return "—";
    const byAction = (summary as any).actions_by_type || {};
    const entries = Object.entries(byAction);
    if (entries.length === 0) return "—";
    return entries.sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
  };

  // Safely extract top actor from actions_by_actor
  const getTopActor = (): string => {
    if (!summary) return "—";
    const byActor = (summary as any).actions_by_actor || {};
    const entries = Object.entries(byActor);
    if (entries.length === 0) return "—";
    return entries.sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
  };

  // Safe date formatting
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
    <div className="max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-foreground">Audit Trail</h1>
        <p className="text-sm text-muted-foreground">
          Immutable record of every critical action in the platform.
        </p>
      </header>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground uppercase font-semibold">Total Events (7d)</p>
          <p className="text-2xl font-bold">
            {summary?.total_actions ?? 0}
          </p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground uppercase font-semibold">Top Action</p>
          <p className="text-lg font-bold">{getTopAction()}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground uppercase font-semibold">Top Actor</p>
          <p className="text-lg font-bold">{getTopActor()}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 items-end bg-card border border-border rounded-lg p-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Actor</label>
          <input
            type="text"
            value={filters.actor}
            onChange={(e) => handleFilterChange("actor", e.target.value)}
            placeholder="User ID or email"
            className="mt-1 w-48 bg-background border border-border rounded-md px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Action</label>
          <input
            type="text"
            value={filters.action}
            onChange={(e) => handleFilterChange("action", e.target.value)}
            placeholder="e.g. anomaly.resolved"
            className="mt-1 w-48 bg-background border border-border rounded-md px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Target</label>
          <input
            type="text"
            value={filters.target}
            onChange={(e) => handleFilterChange("target", e.target.value)}
            placeholder="Record ID"
            className="mt-1 w-48 bg-background border border-border rounded-md px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Date From</label>
          <input
            type="date"
            value={filters.date_from}
            onChange={(e) => handleFilterChange("date_from", e.target.value)}
            className="mt-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Date To</label>
          <input
            type="date"
            value={filters.date_to}
            onChange={(e) => handleFilterChange("date_to", e.target.value)}
            className="mt-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm"
          />
        </div>
        <button
          onClick={() => {
            setFilters({ actor: "", action: "", target: "", date_from: "", date_to: "" });
            setOffset(0);
          }}
          className="px-4 py-1.5 text-sm bg-muted hover:bg-muted/80 rounded-md"
        >
          Clear
        </button>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="bg-card border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold text-muted-foreground">Timestamp</th>
                  <th className="px-4 py-2 text-left font-semibold text-muted-foreground">Actor</th>
                  <th className="px-4 py-2 text-left font-semibold text-muted-foreground">Action</th>
                  <th className="px-4 py-2 text-left font-semibold text-muted-foreground">Target</th>
                  <th className="px-4 py-2 text-left font-semibold text-muted-foreground">Block Index</th>
                </tr>
              </thead>
              <tbody>
                {!logs || logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      No audit logs found.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="border-b border-border hover:bg-muted/30">
                      <td className="px-4 py-2 text-nowrap">
                        {formatAuditDate(log)}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {log.actor_user_id || log.external_actor || "system"}
                      </td>
                      <td className="px-4 py-2">
                        <span className="px-2 py-0.5 bg-primary/10 text-primary rounded-full text-xs">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {log.target_type}: {log.target_id}
                      </td>
                      <td className="px-4 py-2 text-xs font-mono">{log.block_index}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}
            </p>
            <div className="flex gap-2">
              <button
                onClick={handlePrevPage}
                disabled={offset === 0}
                className="px-4 py-1.5 text-sm border border-border rounded-md disabled:opacity-50 hover:bg-muted"
              >
                Previous
              </button>
              <button
                onClick={handleNextPage}
                disabled={offset + limit >= total}
                className="px-4 py-1.5 text-sm border border-border rounded-md disabled:opacity-50 hover:bg-muted"
              >
                Next
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