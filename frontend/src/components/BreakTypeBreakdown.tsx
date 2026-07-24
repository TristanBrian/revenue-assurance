"use client";

import { useState } from "react";
import type { Metrics } from "@/lib/types";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatKesFull(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

// Validated categorical slots 1-4 (dataviz skill palette.md) — adjacent
// pairlist clears CVD/contrast gates in both modes for exactly 4 bars.
const SLOTS = [
  { key: "missing_invoice_leak", label: "Missing Invoice", light: "#2a78d6", dark: "#3987e5" },
  { key: "missing_payment_leak", label: "Missing Payment", light: "#eb6834", dark: "#d95926" },
  { key: "underpayment_leak", label: "Underpayment", light: "#1baf7a", dark: "#199e70" },
  { key: "overpayment_leak", label: "Overpayment", light: "#eda100", dark: "#c98500" },
] as const;

const WIDTH = 560;
const BAR_H = 28;
const GAP = 14;
const LABEL_W = 140;
const CHART_H = SLOTS.length * (BAR_H + GAP);

export default function BreakTypeBreakdown({ metrics }: { metrics: Metrics }) {
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const values = SLOTS.map((s) => metrics[s.key]);
  const maxValue = Math.max(...values, 1);
  const trackW = WIDTH - LABEL_W - 70;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        Leakage by Break Type
      </h2>
      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <svg width={WIDTH} height={CHART_H} className="max-w-full">
          {SLOTS.map((slot, i) => {
            const value = metrics[slot.key];
            const barW = Math.max((value / maxValue) * trackW, value > 0 ? 3 : 0);
            const y = i * (BAR_H + GAP);
            const isHovered = hoverKey === slot.key;
            return (
              <g
                key={slot.key}
                onMouseEnter={() => setHoverKey(slot.key)}
                onMouseLeave={() => setHoverKey(null)}
                className="cursor-default"
              >
                <text
                  x={LABEL_W - 10}
                  y={y + BAR_H / 2 + 4}
                  textAnchor="end"
                  className="fill-zinc-600 text-xs dark:fill-zinc-400"
                >
                  {slot.label}
                </text>
                {/* transparent hit area, full track height */}
                <rect x={LABEL_W} y={y} width={trackW + 60} height={BAR_H} fill="transparent" />
                <rect
                  x={LABEL_W}
                  y={y}
                  width={barW}
                  height={BAR_H}
                  rx={4}
                  fill={slot.light}
                  className="dark:hidden"
                  opacity={isHovered ? 1 : 0.85}
                />
                <rect
                  x={LABEL_W}
                  y={y}
                  width={barW}
                  height={BAR_H}
                  rx={4}
                  fill={slot.dark}
                  className="hidden dark:block"
                  opacity={isHovered ? 1 : 0.85}
                />
                <text
                  x={LABEL_W + barW + 8}
                  y={y + BAR_H / 2 + 4}
                  className="fill-zinc-900 text-xs font-medium dark:fill-zinc-50"
                >
                  {formatKes(value)}
                </text>
              </g>
            );
          })}
        </svg>
        {hoverKey && (
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {SLOTS.find((s) => s.key === hoverKey)?.label}:{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {formatKesFull(metrics[hoverKey as keyof Metrics] as number)}
            </span>
          </p>
        )}
      </div>
    </section>
  );
}
