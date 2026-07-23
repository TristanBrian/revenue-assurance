"use client";

import { useEffect, useState } from "react";
import { ApiError, getHeatmap } from "@/lib/api";
import type { HeatmapData } from "@/lib/types";

function formatKes(value: number): string {
  if (value === 0) return "—";
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

// Sequential single-hue scale (red = leakage severity), light -> dark. Cell
// text switches to white past the midpoint so it always clears contrast.
const INTENSITY_STEPS = [
  { threshold: 0, fill: "fill-red-50 dark:fill-red-950/40", text: "fill-zinc-500" },
  { threshold: 0.2, fill: "fill-red-100 dark:fill-red-900/60", text: "fill-zinc-700 dark:fill-zinc-200" },
  { threshold: 0.4, fill: "fill-red-300 dark:fill-red-800", text: "fill-zinc-900 dark:fill-zinc-50" },
  { threshold: 0.6, fill: "fill-red-500 dark:fill-red-600", text: "fill-white" },
  { threshold: 0.8, fill: "fill-red-700 dark:fill-red-500", text: "fill-white" },
];

function stepFor(intensity: number) {
  let step = INTENSITY_STEPS[0];
  for (const s of INTENSITY_STEPS) {
    if (intensity >= s.threshold) step = s;
  }
  return step;
}

const CELL_W = 90;
const CELL_H = 32;
const LABEL_W = 160;
const HEADER_H = 60;

export default function Heatmap() {
  const [heatmap, setHeatmap] = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getHeatmap(0)
      .then((data) => {
        if (!cancelled) setHeatmap(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load the heatmap.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const maxValue = heatmap ? Math.max(...heatmap.data.flat(), 1) : 1;
  const width = LABEL_W + (heatmap?.products.length ?? 0) * CELL_W;
  const height = HEADER_H + (heatmap?.omcs.length ?? 0) * CELL_H;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        Leakage Heatmap — OMC × Product
      </h2>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && !error && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading heatmap…</p>
      )}

      {heatmap && !loading && heatmap.omcs.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No leakage data to chart.</p>
      )}

      {heatmap && heatmap.omcs.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950">
          <svg width={width} height={height} className="min-w-full">
            {heatmap.products.map((product, ci) => (
              <text
                key={product}
                x={LABEL_W + ci * CELL_W + CELL_W / 2}
                y={HEADER_H - 10}
                textAnchor="middle"
                className="fill-zinc-500 text-[10px] dark:fill-zinc-400"
              >
                {product}
              </text>
            ))}

            {heatmap.omcs.map((omc, ri) => (
              <g key={omc}>
                <text
                  x={LABEL_W - 8}
                  y={HEADER_H + ri * CELL_H + CELL_H / 2 + 4}
                  textAnchor="end"
                  className="fill-zinc-600 text-[11px] dark:fill-zinc-400"
                >
                  {omc}
                </text>
                {heatmap.products.map((product, ci) => {
                  const value = heatmap.data[ri]?.[ci] ?? 0;
                  const step = stepFor(value / maxValue);
                  return (
                    <g key={product}>
                      <rect
                        x={LABEL_W + ci * CELL_W + 2}
                        y={HEADER_H + ri * CELL_H + 2}
                        width={CELL_W - 4}
                        height={CELL_H - 4}
                        rx={3}
                        className={step.fill}
                      >
                        <title>{`${omc} × ${product}: ${formatKes(value)}`}</title>
                      </rect>
                      <text
                        x={LABEL_W + ci * CELL_W + CELL_W / 2}
                        y={HEADER_H + ri * CELL_H + CELL_H / 2 + 4}
                        textAnchor="middle"
                        className={`pointer-events-none text-[10px] ${step.text}`}
                      >
                        {formatKes(value)}
                      </text>
                    </g>
                  );
                })}
              </g>
            ))}
          </svg>
        </div>
      )}
    </section>
  );
}
