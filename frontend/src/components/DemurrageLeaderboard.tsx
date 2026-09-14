"use client";

import React from "react";
import { BarChart2, ShieldAlert } from "lucide-react";
import type { OmcRiskProfile as OmcRiskProfileEntry } from "@/lib/types";

interface DemurrageLeaderboardProps {
  profiles?: OmcRiskProfileEntry[];
}

export default function DemurrageLeaderboard({ profiles }: DemurrageLeaderboardProps) {
  const leaderboardData = [...(profiles ?? [])].sort((a, b) => b.leakage_kes - a.leakage_kes).slice(0, 6);

  const maxLeakage = Math.max(1, ...leaderboardData.map((d) => d.leakage_kes));

  const formatKes = (val: number) => {
    if (val >= 1e6) return `KES ${(val / 1e6).toFixed(1)}M`;
    return `KES ${val.toLocaleString()}`;
  };

  return (
    <div className="p-6 rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-primary" />
            <h3 className="text-base font-bold text-foreground tracking-tight">
              OMC Discrepancy Leaderboard
            </h3>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ranked by reconciliation exposure; demurrage billing is not yet connected
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {leaderboardData.map((entry, idx) => {
          const widthPct = (entry.leakage_kes / maxLeakage) * 100;
          const isCritical = entry.risk_level === "High";

          return (
            <div key={idx} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-muted-foreground w-4">{idx + 1}.</span>
                  <span className="font-semibold text-foreground">{entry.customer}</span>
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                      entry.risk_level === "High"
                        ? "bg-rose-500/10 text-rose-500 border-rose-500/30"
                        : entry.risk_level === "Medium"
                        ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
                        : "bg-blue-500/10 text-blue-500 border-blue-500/30"
                    }`}
                  >
                    {entry.risk_level}
                  </span>
                </div>

                <div className="font-mono text-xs">
                  <strong className={isCritical ? "text-rose-500" : "text-foreground"}>
                    {formatKes(entry.leakage_kes)}
                  </strong>
                  <span className="text-muted-foreground ml-2">({entry.anomaly_count} breaks)</span>
                </div>
              </div>

              <div className="h-2.5 w-full bg-muted/40 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    entry.risk_level === "High"
                      ? "bg-rose-500"
                      : entry.risk_level === "Medium"
                      ? "bg-amber-500"
                      : "bg-blue-500"
                  }`}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 pt-4 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <ShieldAlert className="w-4 h-4 text-amber-500" /> Reconciliation exposure ranking
        </span>
        <span>Filterable by materiality & workspace direction</span>
      </div>
    </div>
  );
}
