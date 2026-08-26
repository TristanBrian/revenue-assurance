"use client";

import { useEffect, useState } from "react";
import { ApiError, createInukaCaseAction, getInukaCase, getInukaCaseActions } from "@/lib/api";
import type { InukaRiskCase } from "@/lib/types";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(value);
}

export default function InukaCaseDetailModal({ item, onClose }: { item: InukaRiskCase; onClose: () => void }) {
  const [detail, setDetail] = useState(item);
  const [action, setAction] = useState("acknowledge");
  const [note, setNote] = useState("");
  const [history, setHistory] = useState<Array<{ id: string; action: string; note: string; created_at: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      getInukaCase(item.case_id).then(setDetail),
      getInukaCaseActions(item.case_id).then(setHistory),
    ]).catch(() => setMessage("Some investigation details could not be loaded."));
  }, [item.case_id]);

  async function submitAction() {
    if (["add_note", "request_evidence"].includes(action) && !note.trim()) {
      setMessage("Add a note so the next reviewer knows what is required.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const created = await createInukaCaseAction(detail.case_id, action, note.trim());
      setHistory((current) => [created, ...current]);
      setNote("");
      setMessage("Action recorded in the case audit trail.");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Could not record this action.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Inuka case investigation" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between border-b border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-950/50">
          <div><p className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Inuka case investigation</p><h2 className="mt-1 text-xl font-bold text-zinc-900 dark:text-white">{detail.primary_record_id || detail.case_id}</h2><p className="mt-1 text-xs text-zinc-500">{detail.case_id}</p></div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-xl text-zinc-500 hover:bg-zinc-200" aria-label="Close">×</button>
        </header>

        <div className="min-h-0 overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"><p className="text-[10px] uppercase text-zinc-500">Beneficiary</p><p className="mt-1 font-semibold">{detail.beneficiary_name || "Name unavailable"}</p><p className="mt-1 font-mono text-xs text-zinc-500">{detail.beneficiary_id || "ID unavailable"}</p></div>
            <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"><p className="text-[10px] uppercase text-zinc-500">Amount at risk</p><p className="mt-1 font-mono font-semibold text-rose-600">{formatKes(detail.amount_at_risk)}</p></div>
            <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"><p className="text-[10px] uppercase text-zinc-500">Fraud score</p><p className="mt-1 font-mono font-semibold">{detail.fraud_score} · {detail.fraud_tier}</p></div>
            <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"><p className="text-[10px] uppercase text-zinc-500">Confidence</p><p className="mt-1 font-semibold capitalize">{detail.confidence}</p></div>
          </div>

          <div className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-900 dark:bg-indigo-950/20"><p className="text-xs font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">Investigation summary</p><p className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">{detail.reason}</p><p className="mt-2 text-xs text-zinc-500">The score prioritizes explainable control evidence. It is not a finding of fraud.</p></div>

          <section className="mt-6"><h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Signals in this case</h3><div className="mt-2 space-y-2">{detail.signals.map((signal, index) => <div key={signal.risk_type + index} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold text-zinc-900 dark:text-white">{signal.label}</p><p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{signal.reason}</p></div><span className="rounded-full border border-zinc-200 px-2 py-1 text-xs font-mono dark:border-zinc-700">{formatKes(signal.amount_at_risk)}</span></div><div className="mt-2 flex flex-wrap gap-2 text-[11px] text-zinc-500"><span>Confidence: {signal.confidence}</span>{signal.source_records.map((record) => <span key={record} className="font-mono">Source: {record}</span>)}</div></div>)}</div></section>

          <section className="mt-6 grid gap-3 sm:grid-cols-3"><div><p className="text-[10px] uppercase text-zinc-500">Pillar</p><p className="mt-1 font-semibold">{detail.pillar_id || "Unassigned"}</p></div><div><p className="text-[10px] uppercase text-zinc-500">Officer ID</p><p className="mt-1 font-mono">{detail.officer_id || "Unavailable"}</p></div><div><p className="text-[10px] uppercase text-zinc-500">Review status</p><p className="mt-1 font-semibold">{detail.review_status}</p></div></section>

          <section className="mt-6 border-t border-zinc-200 pt-5 dark:border-zinc-800"><p className="text-xs font-bold uppercase tracking-wider text-zinc-500">Record next action</p><div className="mt-3 grid gap-2 sm:grid-cols-[190px_1fr]"><select value={action} onChange={(event) => setAction(event.target.value)} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"><option value="acknowledge">Acknowledge</option><option value="request_evidence">Request evidence</option><option value="add_note">Add review note</option><option value="escalate">Escalate</option></select><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="What evidence was checked or requested?" className="min-h-20 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950" /></div><div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs text-emerald-600">{message}</span><button onClick={submitAction} disabled={saving} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{saving ? "Saving…" : "Record action"}</button></div></section>

          <section className="mt-6 border-t border-zinc-200 pt-5 dark:border-zinc-800"><p className="text-xs font-bold uppercase tracking-wider text-zinc-500">Review history</p>{history.length === 0 ? <p className="mt-2 text-sm text-zinc-500">No actions recorded yet.</p> : <div className="mt-2 space-y-2">{history.map((entry) => <div key={entry.id} className="rounded-lg bg-zinc-50 px-3 py-2 text-xs dark:bg-zinc-950/40"><span className="font-semibold">{entry.action.replaceAll("_", " ")}</span><span className="ml-2 text-zinc-500">{entry.note || "No note"} · {new Date(entry.created_at).toLocaleString()}</span></div>)}</div>}</section>
        </div>
        <footer className="flex justify-end border-t border-zinc-200 p-4 dark:border-zinc-800"><button onClick={onClose} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Close case</button></footer>
      </div>
    </div>
  );
}

