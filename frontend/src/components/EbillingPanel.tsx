"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  getEbillingLogs,
  getEbillingMonitor,
  getEbillingStatus,
  getEbillingTask,
  startEbillingSync,
  sendEbillingWebhook,
} from "@/lib/api";
import type {
  EbillingIntegrationStatus,
  EbillingLogEntry,
  FailureRateMonitor,
  TaskStatusResponse,
} from "@/lib/types";
import EbillingStatusCards from "./EbillingStatusCards";
import EbillingMonitorBanner from "./EbillingMonitorBanner";
import EbillingLogsTable from "./EbillingLogsTable";

const POLL_INTERVAL_MS = 1000;

export default function EbillingPanel() {
  const [status, setStatus] = useState<EbillingIntegrationStatus | null>(null);
  const [monitor, setMonitor] = useState<FailureRateMonitor | null>(null);
  const [logs, setLogs] = useState<EbillingLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [taskId, setTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<TaskStatusResponse | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Webhook Simulator State
  const [webhookInvoiceId, setWebhookInvoiceId] = useState("");
  const [webhookStatus, setWebhookStatus] = useState("synced");
  const [webhookMessage, setWebhookMessage] = useState("Simulated successful sync via KRA system callback");
  const [webhookSubmitting, setWebhookSubmitting] = useState(false);
  const [webhookFeedback, setWebhookFeedback] = useState<string | null>(null);

  // ✅ Refresh function – re-fetches all data
  const loadAll = useCallback(async () => {
    try {
      const [statusRes, monitorRes, logsRes] = await Promise.all([
        getEbillingStatus(),
        getEbillingMonitor(),
        getEbillingLogs(50),
      ]);
      setStatus(statusRes);
      setMonitor(monitorRes);
      setLogs(logsRes);
      setError(null);
      // Pre-populate webhook invoice selector with the first failed or pending log if available
      const firstLog = logsRes.find(l => l.status === "failed" || l.status === "pending");
      if (firstLog && !webhookInvoiceId) {
        setWebhookInvoiceId(firstLog.invoice_id);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not reach the E-Billing API. Is the backend running?",
      );
    } finally {
      setLoading(false);
    }
  }, [webhookInvoiceId]);

  // Initial load
  useEffect(() => {
    let cancelled = false;

    Promise.all([getEbillingStatus(), getEbillingMonitor(), getEbillingLogs(50)])
      .then(([statusRes, monitorRes, logsRes]) => {
        if (cancelled) return;
        setStatus(statusRes);
        setMonitor(monitorRes);
        setLogs(logsRes);
        setError(null);
        const firstLog = logsRes.find(l => l.status === "failed" || l.status === "pending");
        if (firstLog) {
          setWebhookInvoiceId(firstLog.invoice_id);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Could not reach the E-Billing API. Is the backend running?",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // ✅ Poll for task completion
  useEffect(() => {
    if (!taskId) return;

    pollRef.current = setInterval(async () => {
      try {
        const t = await getEbillingTask(taskId);
        setTask(t);
        if (t.status === "completed" || t.status === "failed" || t.status === "not_found") {
          if (pollRef.current) clearInterval(pollRef.current);
          setTaskId(null);
          setTask(null);  
          loadAll(); 
        }
      } catch {
        if (pollRef.current) clearInterval(pollRef.current);
        setTaskId(null);
        setTask(null);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [taskId, loadAll]);

  // ✅ Sync handler
  async function handleSync() {
    setError(null);
    try {
      const { task_id } = await startEbillingSync();
      setTask({ status: "running", progress: 0 });
      setTaskId(task_id);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not start the sync — is the backend running?",
      );
    }
  }

  // ✅ Webhook handler
  async function handleWebhookSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!webhookInvoiceId) return;

    setWebhookSubmitting(true);
    setWebhookFeedback(null);
    try {
      await sendEbillingWebhook({
        invoice_id: webhookInvoiceId,
        status: webhookStatus,
        message: webhookMessage,
      });
      setWebhookFeedback(`Success: Webhook processed. Invoice status updated to ${webhookStatus}.`);
      loadAll(); // ✅ Refresh logs instantly
    } catch (err) {
      setWebhookFeedback(
        err instanceof ApiError ? `Error: ${err.message}` : "Failed to connect to the webhook endpoint."
      );
    } finally {
      setWebhookSubmitting(false);
    }
  }

  const syncing = taskId !== null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-border pb-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-bold text-foreground">
            E-Billing Integration (KRA iCMS)
          </h2>
          <p className="text-xs text-muted-foreground">Manage tax invoice declarations and monitor sync logs</p>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing || loading}
          className="rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-all active:scale-[0.98] disabled:opacity-40"
        >
          {syncing ? "Syncing…" : "Sync Pending Invoices"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg p-4 text-sm text-status-critical">
          {error}
        </div>
      )}

      {task && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-ping rounded-full bg-primary"></span>
              {task.status === "running" && (
                <span className="font-medium text-foreground/90">
                  Sync task in progress
                  {typeof task.total === "number" &&
                    ` — ${task.synced_so_far ?? 0} synced, ${task.failed_so_far ?? 0} failed of ${task.total}`}
                </span>
              )}
              {task.status === "completed" && task.result && (
                <span className="font-medium text-status-low">
                  Last sync complete: {task.result.synced} success, {task.result.failed} failed.
                </span>
              )}
              {task.status === "failed" && (
                <span className="font-medium text-status-critical">Sync failed: {task.error}</span>
              )}
            </div>
            {typeof task.progress === "number" && task.status === "running" && (
              <span className="font-mono font-bold text-primary">{task.progress}%</span>
            )}
          </div>

          {typeof task.progress === "number" && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all duration-300 ease-out ${
                  task.status === "failed" ? "bg-status-critical" : task.status === "completed" ? "bg-status-low" : "bg-primary"
                }`}
                style={{ width: `${Math.min(Math.max(task.progress, 0), 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {loading && !error && (
        <div className="flex items-center justify-center p-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-ring/30 border-t-ring"></div>
        </div>
      )}

      {status && !loading && (
        <div className="flex flex-col gap-6">
          {/* Metrics summary cards */}
          <EbillingStatusCards status={status} />
          
          {monitor && <EbillingMonitorBanner monitor={monitor} />}

          {/* Webhook tester and Logs layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            {/* Logs list */}
            <div className="lg:col-span-2">
              <EbillingLogsTable logs={logs} onRetried={loadAll} />
            </div>

            {/* Webhook sandbox simulator */}
            <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
              <div>
                <h3 className="text-sm font-bold text-foreground">KRA Webhook Simulator</h3>
                <p className="text-[11px] text-muted-foreground">Simulate callback responses from the KRA iCMS gateway</p>
              </div>

              <form onSubmit={handleWebhookSubmit} className="flex flex-col gap-3 text-xs">
                <div className="flex flex-col gap-1">
                  <label className="font-medium text-muted-foreground">Target Invoice ID</label>
                  <input
                    type="text"
                    required
                    value={webhookInvoiceId}
                    onChange={(e) => setWebhookInvoiceId(e.target.value)}
                    placeholder="e.g. INV-10001"
                    className="rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-foreground/90 focus:border-ring focus:outline-none"
                  />
                  <span className="text-[9px] text-muted-foreground">
                    Hint: paste an invoice ID from the log table.
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="font-medium text-muted-foreground">Callback Status</label>
                  <select
                    value={webhookStatus}
                    onChange={(e) => {
                      setWebhookStatus(e.target.value);
                      setWebhookMessage(
                        e.target.value === "synced"
                          ? "Simulated successful sync via KRA system callback"
                          : "Failed: Invalid merchant PIN verification"
                      );
                    }}
                    className="cursor-pointer rounded-md border border-border bg-card px-2.5 py-1.5 text-foreground/90 focus:border-ring focus:outline-none"
                  >
                    <option value="synced">Synced (Success)</option>
                    <option value="failed">Failed (Error)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="font-medium text-muted-foreground">Callback Message</label>
                  <textarea
                    rows={2}
                    value={webhookMessage}
                    onChange={(e) => setWebhookMessage(e.target.value)}
                    placeholder="Custom response error or logs..."
                    className="resize-none rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-foreground/90 focus:border-ring focus:outline-none"
                  />
                </div>

                {webhookFeedback && (
                  <p className={`rounded-md border p-2 text-[11px] font-medium ${
                    webhookFeedback.startsWith("Success")
                      ? "border-status-low/30 bg-status-low-bg text-status-low"
                      : "border-status-critical/30 bg-status-critical-bg text-status-critical"
                  }`}>
                    {webhookFeedback}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={webhookSubmitting || !webhookInvoiceId}
                  className="w-full rounded-md bg-primary py-2 font-semibold text-primary-foreground transition-all disabled:opacity-40"
                >
                  {webhookSubmitting ? "Sending..." : "Submit Mock Callback"}
                </button>
              </form>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}