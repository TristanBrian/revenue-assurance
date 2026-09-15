"use client";

import { FormEvent, useState } from "react";
import { askSupport, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

interface Message { from: "user" | "assistant"; text: string }

/** First-party KPC support assistant. It stays useful without the optional
 * LLM/RAG service because the API supplies a deterministic fallback. */
export default function KpcSupportWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const value = question.trim();
    if (!value || sending) return;
    setQuestion("");
    setMessages((items) => [...items, { from: "user", text: value }]);
    setSending(true);
    try {
      const answer = await askSupport(value);
      setMessages((items) => [...items, { from: "assistant", text: answer }]);
    } catch (error) {
      const message = error instanceof ApiError && error.status === 403
        ? "Support chat is available after signing in. Please contact your KPC assurance administrator for access help."
        : "Support chat is temporarily unavailable. Please contact assurance@kpc.co.ke.";
      setMessages((items) => [...items, { from: "assistant", text: message }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
      {open && (
        <div role="dialog" aria-label="KPC support assistant" className="w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[#33302c] bg-[#171310] text-white shadow-2xl">
          <div className="flex items-start justify-between border-b border-[#33302c] p-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#ec835a]">KPC support</p>
              <h2 className="mt-1 text-sm font-bold">FlowGuard assistant</h2>
              <p className="mt-1 text-xs text-[#b9b0aa]">Ask about navigation, reconciliation, or investigations.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close KPC support" className="rounded-md px-2 text-xl leading-none text-[#b9b0aa] hover:bg-[#2a2725] hover:text-white">×</button>
          </div>
          <div className="max-h-56 space-y-2 overflow-y-auto p-4" aria-live="polite">
            {messages.length === 0 && <p className="rounded-lg bg-[#2a2725] p-3 text-xs leading-relaxed text-[#d8d0ca]">Hello{user ? ` ${user.full_name ?? ""}` : ""}. How can I help?</p>}
            {messages.map((message, index) => <p key={index} className={`max-w-[90%] rounded-lg p-3 text-xs leading-relaxed ${message.from === "user" ? "ml-auto bg-[#b3312c] text-white" : "bg-[#2a2725] text-[#d8d0ca]"}`}>{message.text}</p>)}
            {sending && <p className="text-xs text-[#b9b0aa]">Preparing a response…</p>}
          </div>
          <form onSubmit={send} className="flex gap-2 border-t border-[#33302c] p-3">
            <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask a question…" aria-label="Ask KPC support" className="min-w-0 flex-1 rounded-lg border border-[#4a433e] bg-[#2a2725] px-3 py-2 text-xs text-white outline-none placeholder:text-[#928981] focus:border-[#ec835a]" />
            <button type="submit" disabled={sending || !question.trim()} className="rounded-lg bg-[#b3312c] px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">Ask</button>
          </form>
        </div>
      )}
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label="Open KPC support" className="flex items-center gap-2 rounded-full bg-[#b3312c] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-[#171310]/25 transition hover:bg-[#962723]">
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/50 bg-[#171310] text-[9px] font-black">KPC</span>
        <span>Support</span>
      </button>
    </div>
  );
}
