"use client";

// Fraud scoring layer (ML) — Section 6/7. Shows the SHAP local
// explanation for one anomaly (top contributing features, plain-language
// direction) plus a small chat-style "ask a question" widget, per the
// fraud-scoring spec. Lives inside the existing anomaly detail drawer —
// no new page, same principle as every other extension in this project.
import { useEffect, useState } from "react";
import { explainAnomalyScore, fraudChat, ApiError } from "@/lib/api";
import type { FraudExplainData } from "@/lib/types";

function tierClass(tier: string | null) {
  switch (tier) {
    case "Likely Fraud":
      return "bg-red-500/10 text-red-500 border border-red-500/20";
    case "Suspicious":
      return "bg-amber-500/10 text-amber-500 border border-amber-500/20";
    default:
      return "bg-zinc-500/10 text-zinc-500 border border-zinc-500/20";
  }
}

interface ChatEntry {
  from: "user" | "assistant";
  text: string;
}

export default function FraudExplainPanel({ anomalyId }: { anomalyId: string }) {
  const [explanation, setExplanation] = useState<FraudExplainData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatEntry[]>([]);
  const [chatSending, setChatSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setExplanation(null);
    setChatHistory([]);

    explainAnomalyScore(anomalyId)
      .then((data) => {
        if (!cancelled) setExplanation(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // 503 = model not trained yet — a normal, expected state, not
        // an error worth alarming the investigator over.
        if (err instanceof ApiError && err.status === 503) {
          setError("not_configured");
        } else {
          setError(err instanceof ApiError ? err.message : "Could not load the fraud explanation.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [anomalyId]);

  async function sendChat() {
    const message = chatInput.trim();
    if (!message || chatSending) return;
    setChatInput("");
    setChatHistory((h) => [...h, { from: "user", text: message }]);
    setChatSending(true);
    try {
      const reply = await fraudChat(message, anomalyId);
      setChatHistory((h) => [...h, { from: "assistant", text: reply }]);
    } catch (err) {
      setChatHistory((h) => [
        ...h,
        { from: "assistant", text: err instanceof ApiError ? err.message : "Something went wrong." },
      ]);
    } finally {
      setChatSending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-6">
        <div className="w-5 h-5 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin"></div>
      </div>
    );
  }

  if (error === "not_configured") {
    return (
      <div className="bg-zinc-50 dark:bg-zinc-950/20 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 text-xs text-zinc-500 dark:text-zinc-400">
        The fraud scoring model hasn&apos;t been trained yet — no explanation available for this anomaly.
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-xs text-red-600 dark:text-red-400">
        {error}
      </div>
    );
  }

  if (!explanation) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
          Fraud Score Explanation
        </h3>
        {explanation.fraud_tier && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${tierClass(explanation.fraud_tier)}`}>
            {explanation.fraud_tier} · {explanation.fraud_score?.toFixed(0)}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {explanation.contributors.slice(0, 5).map((c) => {
          const magnitude = Math.min(Math.abs(c.contribution), 3) / 3; // rough visual scale
          const towardFraud = c.direction === "toward_fraud";
          return (
            <div key={c.feature} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {c.feature.replace(/_/g, " ")}
                </span>
                <span className={towardFraud ? "text-red-500 font-mono" : "text-emerald-500 font-mono"}>
                  {c.contribution >= 0 ? "+" : ""}
                  {c.contribution.toFixed(3)}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full rounded-full ${towardFraud ? "bg-red-500" : "bg-emerald-500"}`}
                  style={{ width: `${Math.max(magnitude * 100, 4)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Chat-style explain widget */}
      <div className="flex flex-col gap-2 border-t border-zinc-200 dark:border-zinc-800 pt-4">
        <h3 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
          Ask about this score
        </h3>
        {chatHistory.length > 0 && (
          <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
            {chatHistory.map((entry, i) => (
              <div
                key={i}
                className={`text-xs rounded-lg px-3 py-2 whitespace-pre-line ${
                  entry.from === "user"
                    ? "bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 self-end"
                    : "bg-zinc-50 dark:bg-zinc-950/30 text-zinc-700 dark:text-zinc-300 self-start"
                }`}
              >
                {entry.text}
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendChat();
            }}
            placeholder='Try "why is this flagged" or "how good is the model"'
            className="flex-1 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none"
          />
          <button
            onClick={sendChat}
            disabled={chatSending || !chatInput.trim()}
            className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-2 text-xs font-semibold text-white transition-all"
          >
            {chatSending ? "…" : "Ask"}
          </button>
        </div>
      </div>
    </div>
  );
}
