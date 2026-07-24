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

  useEffect(() => {
    let cancelled = false;

    Promise.all([getEbillingStatus(), getEbillingMonitor(), getEbillingLogs(50)])
      .then(([statusRes, monitorRes, logsRes]) => {
        if (cancelled) return;
        setStatus(statusRes);
        setMonitor(monitorRes);
        setLogs(logsRes);
        setError(null);
        // Pre-populate webhook invoice selector
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

  useEffect(() => {
    if (!taskId) return;

    pollRef.current = setInterval(async () => {
      try {
        const t = await getEbillingTask(taskId);
        setTask(t);
        if (t.status === "completed" || t.status === "failed" || t.status === "not_found") {
          if (pollRef.current) clearInterval(pollRef.current);
          setTaskId(null);
          loadAll();
        }
      } catch {
        if (pollRef.current) clearInterval(pollRef.current);
        setTaskId(null);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [taskId, loadAll]);

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
      loadAll(); // refresh logs instantly!
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
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <h2 className="text-lg font-bold text-white">
            E-Billing Integration (KRA iCMS)
          </h2>
          <p className="text-xs text-zinc-400">Manage tax invoice declarations and monitor sync logs</p>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing || loading}
          className="rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 active:scale-[0.98] transition-all disabled:opacity-40 text-xs px-3.5 py-2 font-semibold"
        >
          {syncing ? "Syncing…" : "Sync Pending Invoices"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {task && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-ping"></span>
            {task.status === "running" && (
              <span className="text-zinc-300 font-medium">Sync task in progress...</span>
            )}
            {task.status === "completed" && task.result && (
              <span className="text-emerald-400 font-medium">
                Last sync complete: {task.result.synced} success, {task.result.failed} failed.
              </span>
            )}
            {task.status === "failed" && (
              <span className="text-rose-400 font-medium">Sync failed: {task.error}</span>
            )}
          </div>
        </div>
      )}

      {loading && !error && (
        <div className="flex items-center justify-center p-12">
          <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-400 rounded-full animate-spin"></div>
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
            <section className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-5 shadow-lg flex flex-col gap-4">
              <div>
                <h3 className="text-sm font-bold text-white">KRA Webhook Simulator</h3>
                <p className="text-[11px] text-zinc-400">Simulate callback responses from the KRA iCMS gateway</p>
              </div>

              <form onSubmit={handleWebhookSubmit} className="flex flex-col gap-3 text-xs">
                <div className="flex flex-col gap-1">
                  <label className="text-zinc-400 font-medium">Target Invoice ID</label>
                  <input
                    type="text"
                    required
                    value={webhookInvoiceId}
                    onChange={(e) => setWebhookInvoiceId(e.target.value)}
                    placeholder="e.g. INV-10001"
                    className="bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-[9px] text-zinc-500">
                    Hint: paste an invoice ID from the log table.
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-zinc-400 font-medium">Callback Status</label>
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
                    className="bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="synced">Synced (Success)</option>
                    <option value="failed">Failed (Error)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-zinc-400 font-medium">Callback Message</label>
                  <textarea
                    rows={2}
                    value={webhookMessage}
                    onChange={(e) => setWebhookMessage(e.target.value)}
                    placeholder="Custom response error or logs..."
                    className="bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-indigo-500 resize-none"
                  />
                </div>

                {webhookFeedback && (
                  <p className={`p-2 rounded text-[11px] font-medium border ${
                    webhookFeedback.startsWith("Success")
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                  }`}>
                    {webhookFeedback}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={webhookSubmitting || !webhookInvoiceId}
                  className="w-full rounded bg-zinc-800 hover:bg-zinc-750 text-white font-semibold py-2 transition-all disabled:opacity-40"
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
