"use client";

import { useEffect, useState } from "react";
import { ApiError, createInukaCaseAction, getInukaCaseActions } from "@/lib/api";
import type { InukaRiskCase } from "@/lib/types";

function formatKes(value: number): string { return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(value); }

export default function InukaCaseModal({ item, onClose }: { item: InukaRiskCase; onClose: () => void }) {
  const [action, setAction] = useState("acknowledge");
  const [note, setNote] = useState("");
  const [history, setHistory] = useState<Array<{ id: string; action: string; note: string; created_at: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    getInukaCaseActions(item.case_id).then(setHistory).catch(() => setHistory([]));
  }, [item.case_id]);

  async function submitAction() {
    setSaving(true);
    setMessage(null);
    try {
      const created = await createInukaCaseAction(item.case_id, action, note);
      setHistory((current) => [created, ...current]);
      setNote("");
      setMessage("Action recorded in the case audit trail.");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Could not record this action.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label="Assurance case details" onClick={onClose}><div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Case details</p><h2 className="mt-1 text-xl font-bold text-foreground">{item.title}</h2><p className="mt-1 font-mono text-[10px] text-muted-foreground">{item.case_id}</p></div><button onClick={onClose} className="rounded-md px-2 py-1 text-xl text-muted-foreground hover:bg-muted" aria-label="Close">×</button></div><div className="mt-5 rounded-lg bg-muted/40 p-4"><p className="text-sm font-medium text-foreground">Why it was flagged</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.reason}</p></div><div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div><p className="text-[10px] uppercase text-muted-foreground">Pillar</p><p className="mt-1 font-semibold text-foreground">{item.pillar_id || "Unassigned"}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Beneficiary</p><p className="mt-1 font-semibold text-foreground">{item.beneficiary_name || "Unknown beneficiary"}</p><p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{item.beneficiary_id || "No beneficiary ID"}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Officer</p><p className="mt-1 font-semibold text-foreground">{item.officer_name || "Unknown officer"}</p><p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{item.officer_id || "No officer ID"}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Period</p><p className="mt-1 font-semibold text-foreground">{item.period || "Unassigned"}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Amount at risk</p><p className="mt-1 font-mono font-semibold text-status-critical">{formatKes(item.amount_at_risk)}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Identity status</p><p className="mt-1 font-semibold capitalize text-foreground">{item.identity_status.replaceAll("_", " ")}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Risk confidence</p><p className="mt-1 font-semibold capitalize text-foreground">{item.confidence}</p></div></div><div className="mt-5 border-t border-border pt-4"><p className="text-[10px] uppercase text-muted-foreground">Source records</p><div className="mt-2 flex flex-wrap gap-2">{item.source_records.length ? item.source_records.map((record) => <span key={record} className="rounded-full bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">{record}</span>) : <span className="text-sm text-muted-foreground">No source record attached.</span>}</div></div><div className="mt-5 border-t border-border pt-4"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Take action</p><p className="mt-1 text-xs text-muted-foreground">Record the next review step. This does not block payment or make a final fraud finding.</p><div className="mt-3 grid gap-2 sm:grid-cols-[180px_1fr]"><select value={action} onChange={(event) => setAction(event.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm"><option value="acknowledge">Acknowledge</option><option value="request_evidence">Request evidence</option><option value="add_note">Add review note</option><option value="escalate">Escalate</option></select><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="What should the next reviewer know?" className="min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm" /></div><div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs text-status-low">{message}</span><button type="button" disabled={saving} onClick={submitAction} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{saving ? "Saving…" : "Record action"}</button></div></div><div className="mt-5 border-t border-border pt-4"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Review history</p>{history.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No actions recorded yet.</p> : <div className="mt-2 space-y-2">{history.slice(0, 5).map((entry) => <div key={entry.id} className="rounded-lg bg-muted/30 px-3 py-2"><p className="text-xs font-semibold capitalize text-foreground">{entry.action.replaceAll("_", " ")}</p><p className="text-[11px] text-muted-foreground">{entry.note || "No note"} · {new Date(entry.created_at).toLocaleString()}</p></div>)}</div>}</div><div className="mt-6 flex justify-end"><button onClick={onClose} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Close case details</button></div></div></div>;
}
