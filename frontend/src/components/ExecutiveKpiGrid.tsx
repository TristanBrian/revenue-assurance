"use client";

import React from "react";
import { ShieldCheck, BarChart3, Clock, AlertTriangle } from "lucide-react";
import type { GantrySummary } from "@/lib/types";

interface ExecutiveKpiGridProps {
  totalRevenueProtectedKes: number;
  volumeVarianceIndexPct?: number;
  automatedDemurrageRecoveredKes?: number;
  activeGateHoldsCount?: number;
  gantrySummary?: GantrySummary | null;
}

function formatKes(val: number): string {
  if (val >= 1e9) return `KES ${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `KES ${(val / 1e6).toFixed(2)}M`;
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(val);
}

export default function ExecutiveKpiGrid({
  totalRevenueProtectedKes,
  volumeVarianceIndexPct,
  automatedDemurrageRecoveredKes,
  activeGateHoldsCount,
  gantrySummary,
}: ExecutiveKpiGridProps) {
  const varianceIndex = gantrySummary?.volume_variance_index_pct ?? volumeVarianceIndexPct;
  const demurrageRecovered = gantrySummary?.automated_demurrage_recovered_kes ?? automatedDemurrageRecoveredKes;
  const gateHolds = gantrySummary?.active_gate_holds_count ?? activeGateHoldsCount;

  const cards = [
    {
      id: "revenue-protected",
      title: "Recorded Payments",
      subtitle: "Payments recorded in reconciliation data",
      value: formatKes(totalRevenueProtectedKes),
      trend: "Payments are not leakage savings",
      trendPositive: true,
      icon: ShieldCheck,
      iconBg: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    },
    {
      id: "variance-index",
      title: "Volume Variance Index",
      subtitle: "Physical meter vs invoice alignment",
      value: varianceIndex == null ? "Unavailable" : `${varianceIndex.toFixed(1)}%`,
      trend: "Target: >95.0%",
      trendPositive: (varianceIndex ?? 0) >= 95.0,
      icon: BarChart3,
      iconBg: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    },
    {
      id: "demurrage-recovered",
      title: "Automated Demurrage Billed",
      subtitle: "Automated dwell-time cost recovery",
      value: demurrageRecovered == null ? "Unavailable" : formatKes(demurrageRecovered),
      trend: "Billing integration pending",
      trendPositive: true,
      icon: Clock,
      iconBg: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    },
    {
      id: "gate-holds",
      title: "Active Gate-Holds",
      subtitle: "Trucks held due to volume mismatch",
      value: gateHolds == null ? "Unavailable" : `${gateHolds} Trucks`,
      trend: (gateHolds ?? 0) > 0 ? "Automated Hold Active" : "All Lanes Clear",
      trendPositive: gateHolds === 0,
      icon: AlertTriangle,
      iconBg: (gateHolds ?? 0) > 0 ? "bg-rose-500/10 text-rose-500 border-rose-500/20" : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.id}
            className="p-5 rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm shadow-sm hover:shadow-md transition-all duration-200 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  {card.title}
                </span>
                <div className={`p-2 rounded-lg border ${card.iconBg}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>

              <div className="text-2xl font-bold tracking-tight text-foreground mb-1">
                {card.value}
              </div>

              <p className="text-xs text-muted-foreground font-medium mb-3">
                {card.subtitle}
              </p>
            </div>

            <div className="pt-3 border-t border-border/40 flex items-center justify-between text-xs">
              <span className={`font-semibold ${card.trendPositive ? "text-emerald-500" : "text-amber-500"}`}>
                {card.trend}
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                Demo preview
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
