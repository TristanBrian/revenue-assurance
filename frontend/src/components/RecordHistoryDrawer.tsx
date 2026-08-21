"use client";

import { useEffect, useState } from "react";
import { getRecordHistory } from "@/lib/api";

interface RecordHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  targetType: string;
  targetId: string;
}

interface AuditHistoryItem {
  id: string;
  actor_user_id: string | null;
  action: string;
  before_value: Record<string, unknown> | null;
  after_value: Record<string, unknown> | null;
  extra_metadata: Record<string, unknown> | null;
  created_at: string;
}

export default function RecordHistoryDrawer({
  isOpen,
  onClose,
  targetType,
  targetId,
}: RecordHistoryDrawerProps) {
  const [history, setHistory] = useState<AuditHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && targetType && targetId) {
      let cancelled = false;
      async function loadHistory() {
        setLoading(true);
        setError(null);
        try {
          const res = await getRecordHistory(targetType, targetId);
          if (!cancelled) {
            setHistory(res.history || []);
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Failed to load history.");
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      }
      loadHistory();
      return () => {
        cancelled = true;
      };
    }
  }, [isOpen, targetType, targetId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/80 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-lg bg-slate-900 border-l border-slate-700/80 h-full p-8 shadow-2xl flex flex-col space-y-6 overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-100 tracking-tight">Immutable Record Provenance</h2>
            <p className="text-sm font-mono text-slate-400 mt-1">
              {targetType.toUpperCase()}: {targetId}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 p-1">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-400 text-sm">
            Loading audit history timeline...
          </div>
        ) : error ? (
          <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm rounded-2xl">
            {error}
          </div>
        ) : history.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">
            No history record events logged for this entity yet.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-slate-300 font-semibold">Chronological Change Logs ({history.length}):</div>
            <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
              {history.map((item) => (
                <div key={item.id} className="relative space-y-2">
                  <div className="absolute -left-6 top-1 w-3.5 h-3.5 rounded-full bg-emerald-500 ring-4 ring-slate-900" />
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-bold text-slate-100">{item.action}</span>
                    <span className="text-xs text-slate-400 font-mono">
                      {new Date(item.created_at).toLocaleString()}
                    </span>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-955/80 border border-slate-800 text-xs sm:text-sm space-y-2 font-mono">
                    {item.actor_user_id && (
                      <div className="text-slate-300">
                        Actor UUID: <span className="text-slate-100">{item.actor_user_id}</span>
                      </div>
                    )}

                    {item.before_value && (
                      <div className="text-rose-300">
                        <span className="text-slate-400">Before:</span> {JSON.stringify(item.before_value)}
                      </div>
                    )}

                    {item.after_value && (
                      <div className="text-emerald-300">
                        <span className="text-slate-400">After:</span> {JSON.stringify(item.after_value)}
                      </div>
                    )}

                    {item.extra_metadata && (
                      <div className="text-slate-300">
                        <span className="text-slate-400">Meta:</span> {JSON.stringify(item.extra_metadata)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-auto pt-4 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold rounded-xl transition"
          >
            Close Timeline
          </button>
        </div>
      </div>
    </div>

  );
}
