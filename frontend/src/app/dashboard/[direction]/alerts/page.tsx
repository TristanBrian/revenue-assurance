"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, getAlerts, markAlertRead, markAllAlertsRead } from "@/lib/api";
import type { AlertItem } from "@/lib/types";
import type { WorkspaceDirection } from "@/lib/workspace";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function relatedHref(direction: WorkspaceDirection, alert: AlertItem) {
  if (!alert.related_id) return null;
  if ((alert.related_type ?? "").toLowerCase().includes("cluster")) return `/dashboard/${direction}/risk`;
  if ((alert.related_type ?? "").toLowerCase().includes("anomal")) return `/dashboard/${direction}/anomalies`;
  return direction === "outbound" ? "/dashboard/outbound/anomalies" : "/dashboard/inbound/anomalies";
}

export default function AlertsPage() {
  const { direction } = useParams<{ direction: WorkspaceDirection }>();
  const [items, setItems] = useState<AlertItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const result = await getAlerts({ page: 1, pageSize: 50, unreadOnly, workspace: direction });
      setItems(result.items);
      setUnreadCount(result.unread_count);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load alerts.");
    } finally {
      setLoading(false);
    }
  }

  // load is intentionally tied to the selected unread filter.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [unreadOnly, direction]);

  async function read(id: string) {
    setWorking(true);
    try {
      await markAlertRead(id);
      setItems((current) => current.map((item) => item.id === id ? { ...item, is_read: true } : item));
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this alert.");
    } finally {
      setWorking(false);
    }
  }

  async function readAll() {
    setWorking(true);
    try {
      await markAllAlertsRead();
      setItems((current) => current.map((item) => ({ ...item, is_read: true })));
      setUnreadCount(0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not mark alerts as read.");
    } finally {
      setWorking(false);
    }
  }

  const workspace = direction === "outbound" ? "Inuka programme assurance" : "Oil revenue assurance";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{workspace}</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Alerts and notifications</h1><p className="mt-1 text-sm text-muted-foreground">Signals that need acknowledgement, evidence review, or escalation.</p></div>
        <div className="flex items-center gap-2"><label className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground"><input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} /> Unread only</label><button type="button" disabled={working || unreadCount === 0} onClick={() => void readAll()} className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground disabled:opacity-50">Mark all read</button></div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="rounded-xl border border-border bg-card p-4 shadow-sm"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Visible alerts</p><p className="mt-1 text-2xl font-bold text-foreground">{total}</p></div><div className="rounded-xl border border-border bg-card p-4 shadow-sm"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Unread</p><p className="mt-1 text-2xl font-bold text-status-critical">{unreadCount}</p></div><div className="hidden rounded-xl border border-border bg-card p-4 shadow-sm sm:block"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Response rule</p><p className="mt-1 text-sm font-semibold text-foreground">Acknowledge, evidence, escalate</p></div></div>

      {error && <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg p-4 text-sm text-status-critical">{error}</div>}
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {loading ? <div className="flex items-center justify-center p-16"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /></div> : items.length === 0 ? <div className="p-16 text-center"><p className="font-semibold text-foreground">No alerts to review</p><p className="mt-1 text-sm text-muted-foreground">New operational signals will appear here when assurance services create them.</p></div> : <div className="divide-y divide-border">{items.map((alert) => { const href = relatedHref(direction, alert); return <article key={alert.id} className={`p-5 ${alert.is_read ? "bg-card" : "bg-primary/5"}`}><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex min-w-0 items-start gap-3"><span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${alert.severity === "critical" ? "bg-status-critical" : alert.severity === "warning" ? "bg-status-medium" : "bg-status-low"}`} /><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-foreground">{alert.title}</h2>{!alert.is_read && <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">New</span>}<span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{alert.severity}</span></div><p className="mt-2 text-sm leading-6 text-muted-foreground">{alert.message}</p><p className="mt-2 text-[11px] text-muted-foreground">{formatDate(alert.created_at)} · {alert.category}{alert.related_id ? ` · ${alert.related_id}` : ""}</p></div></div><div className="flex shrink-0 items-center gap-2">{href && <Link href={href} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted">Investigate</Link>}{!alert.is_read && <button type="button" disabled={working} onClick={() => void read(alert.id)} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">Acknowledge</button>}</div></div></article>; })}</div>}
      </section>
    </div>
  );
}
