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
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/70 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-md bg-slate-900 border-l border-slate-800 h-full p-6 shadow-2xl flex flex-col space-y-6 overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Immutable Record Provenance</h2>
            <p className="text-xs text-slate-400 font-mono">
              {targetType.toUpperCase()}: {targetId}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-400 text-xs">
            Loading audit history timeline...
          </div>
        ) : error ? (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs rounded-xl">
            {error}
          </div>
        ) : history.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-xs">
            No history record events logged for this entity yet.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-xs text-slate-400 font-medium">Chronological Change Logs ({history.length}):</div>
            <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
              {history.map((item) => (
                <div key={item.id} className="relative space-y-2">
                  <div className="absolute -left-6 top-1 w-3 h-3 rounded-full bg-emerald-500 ring-4 ring-slate-900" />
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-200">{item.action}</span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {new Date(item.created_at).toLocaleString()}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-[11px] space-y-2 font-mono">
                    {item.actor_user_id && (
                      <div className="text-slate-400">
                        Actor UUID: <span className="text-slate-200">{item.actor_user_id}</span>
                      </div>
                    )}

                    {item.before_value && (
                      <div className="text-rose-400/90">
                        <span className="text-slate-500">Before:</span> {JSON.stringify(item.before_value)}
                      </div>
                    )}

                    {item.after_value && (
                      <div className="text-emerald-400/90">
                        <span className="text-slate-500">After:</span> {JSON.stringify(item.after_value)}
                      </div>
                    )}

                    {item.extra_metadata && (
                      <div className="text-slate-400">
                        <span className="text-slate-500">Meta:</span> {JSON.stringify(item.extra_metadata)}
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
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-xl transition"
          >
            Close Timeline
          </button>
        </div>
      </div>
    </div>
  );
}
