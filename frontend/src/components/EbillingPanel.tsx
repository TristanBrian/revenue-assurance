"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  getEbillingLogs,
  getEbillingMonitor,
  getEbillingStatus,
  getEbillingTask,
  startEbillingSync,
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
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not reach the E-Billing API. Is the backend running?",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    Promise.all([getEbillingStatus(), getEbillingMonitor(), getEbillingLogs(50)])
      .then(([statusRes, monitorRes, logsRes]) => {
        if (cancelled) return;
        setStatus(statusRes);
        setMonitor(monitorRes);
        setLogs(logsRes);
        setError(null);
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

  const syncing = taskId !== null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          E-Billing Integration (KRA iCMS)
        </h2>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing || loading}
          className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {syncing ? "Syncing…" : "Sync Pending Invoices"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {task && (
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          {task.status === "running" && (
            <p className="text-zinc-600 dark:text-zinc-400">Sync in progress…</p>
          )}
          {task.status === "completed" && task.result && (
            <p className="text-zinc-700 dark:text-zinc-300">
              Last sync: {task.result.synced} synced, {task.result.failed} failed, of{" "}
              {task.result.total_processed} processed.
            </p>
          )}
          {task.status === "failed" && (
            <p className="text-red-700 dark:text-red-400">Sync failed: {task.error}</p>
          )}
        </div>
      )}

      {loading && !error && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading E-Billing status…</p>
      )}

      {status && !loading && (
        <>
          <EbillingStatusCards status={status} />
          {monitor && <EbillingMonitorBanner monitor={monitor} />}
          <EbillingLogsTable logs={logs} onRetried={loadAll} />
        </>
      )}
    </section>
  );
}
