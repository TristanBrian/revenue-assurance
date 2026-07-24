"use client";

import { useEffect, useState, useMemo } from "react";
import { ApiError, getHeatmap } from "@/lib/api";
import type { HeatmapData } from "@/lib/types";

function formatKes(value: number): string {
  if (value === 0) return "—";
  if (value >= 1e6) {
    return `${(value / 1e6).toFixed(1)}M`;
  }
  if (value >= 1e3) {
    return `${(value / 1e3).toFixed(0)}k`;
  }
  return String(value);
}

function formatKesFull(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

interface Step {
  threshold: number;
  fill: string;
  colorCode: string;
  text: string;
}

const colorSteps: Step[] = [
  { threshold: 0.1, fill: "fill-zinc-100 dark:fill-zinc-900/60", colorCode: "rgba(39,39,42,0.1)", text: "text-zinc-500 dark:text-zinc-550" },
  { threshold: 0.4, fill: "fill-indigo-300 dark:fill-indigo-950/40", colorCode: "rgba(99,102,241,0.25)", text: "text-indigo-700 dark:text-indigo-400 font-semibold" },
  { threshold: 0.7, fill: "fill-indigo-600 border-indigo-500", colorCode: "#4f46e5", text: "text-white font-bold" },
  { threshold: 0.9, fill: "fill-violet-600 border-violet-500", colorCode: "#7c3aed", text: "text-white font-bold" },
  { threshold: Infinity, fill: "fill-rose-600 border-rose-500", colorCode: "#e11d48", text: "text-white font-black" },
];

function stepFor(ratio: number): Step {
  return colorSteps.find((step) => ratio <= step.threshold) || colorSteps[colorSteps.length - 1];
}

interface HoveredCell {
  omc: string;
  product: string;
  value: number;
  x: number;
  y: number;
}

export default function Heatmap() {
  const [heatmap, setHeatmap] = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [hoveredCell, setHoveredCell] = useState<HoveredCell | null>(null);

  useEffect(() => {
    let cancelled = false;

    getHeatmap()
      .then((data) => {
        if (!cancelled) setHeatmap(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load the heatmap dataset.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const CELL_W = 110;
  const CELL_H = 46;
  const LABEL_W = 160;
  const HEADER_H = 40;

  const width = useMemo(() => {
    if (!heatmap) return 0;
    return LABEL_W + heatmap.products.length * CELL_W;
  }, [heatmap]);

  const height = useMemo(() => {
    if (!heatmap) return 0;
    return HEADER_H + heatmap.omcs.length * CELL_H;
  }, [heatmap]);

  const maxValue = useMemo(() => {
    if (!heatmap) return 0;
    let max = 0;
    heatmap.data.forEach((row) => {
      row.forEach((val) => {
        if (val > max) max = val;
      });
    });
    return max || 1;
  }, [heatmap]);

  const listItems = useMemo(() => {
    if (!heatmap) return [];
    const items: { omc: string; product: string; value: number }[] = [];
    heatmap.omcs.forEach((omc, ri) => {
      heatmap.products.forEach((product, ci) => {
        const val = heatmap.data[ri]?.[ci] ?? 0;
        if (val > 0) {
          items.push({ omc, product, value: val });
        }
      });
    });
    return items.sort((a, b) => b.value - a.value);
  }, [heatmap]);

  return (
    <section className="flex flex-col gap-4 bg-white dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm relative text-zinc-850 dark:text-zinc-100">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-4">
        <div>
          <h2 className="text-base font-bold text-zinc-900 dark:text-white">
            Leakage Heatmap — OMC × Product
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Leakage intensity by Oil Marketing Company and fuel category</p>
        </div>

        {/* View toggle */}
        <div className="flex items-center bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-0.5 self-end">
          <button
            onClick={() => setViewMode("grid")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1 transition-all ${
              viewMode === "grid"
                ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm"
                : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z" />
            </svg>
            <span>Grid View</span>
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1 transition-all ${
              viewMode === "list"
                ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm"
                : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <span>List View</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-650 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && !error && (
        <div className="flex items-center justify-center p-12">
          <div className="w-6 h-6 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin"></div>
        </div>
      )}

      {heatmap && !loading && heatmap.omcs.length === 0 && (
        <p className="text-sm text-zinc-500 py-8 text-center italic">No leakage data to chart at the current threshold.</p>
      )}

      {heatmap && heatmap.omcs.length > 0 && (
        <>
          {viewMode === "grid" ? (
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/30 p-4">
              <svg width={width} height={height} className="mx-auto min-w-full">
                {/* Column Headers (Products) */}
                {heatmap.products.map((product, ci) => (
                  <text
                    key={product}
                    x={LABEL_W + ci * CELL_W + CELL_W / 2}
                    y={HEADER_H - 12}
                    textAnchor="middle"
                    className="fill-zinc-500 dark:fill-zinc-400 text-[10px] font-bold uppercase tracking-wider font-mono"
                  >
                    {product}
                  </text>
                ))}

                {/* Rows (OMCs and Cells) */}
                {heatmap.omcs.map((omc, ri) => (
                  <g key={omc}>
                    {/* Row Label */}
                    <text
                      x={LABEL_W - 12}
                      y={HEADER_H + ri * CELL_H + CELL_H / 2 + 4}
                      textAnchor="end"
                      className="fill-zinc-700 dark:fill-zinc-300 text-xs font-semibold"
                    >
                      {omc}
                    </text>

                    {/* Heat Cells */}
                    {heatmap.products.map((product, ci) => {
                      const value = heatmap.data[ri]?.[ci] ?? 0;
                      const step = stepFor(value / maxValue);
                      const isHovered = hoveredCell?.omc === omc && hoveredCell?.product === product;

                      return (
                        <g key={product}>
                          <rect
                            x={LABEL_W + ci * CELL_W + 2}
                            y={HEADER_H + ri * CELL_H + 2}
                            width={CELL_W - 4}
                            height={CELL_H - 4}
                            rx={4}
                            onMouseEnter={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setHoveredCell({
                                omc,
                                product,
                                value,
                                x: rect.left + rect.width / 2,
                                y: rect.top - 8,
                              });
                            }}
                            onMouseLeave={() => setHoveredCell(null)}
                            style={{
                              fill: step.colorCode,
                              stroke: isHovered ? "#6366f1" : "rgba(100,116,139,0.2)",
                              strokeWidth: isHovered ? 2 : 1,
                              cursor: "pointer",
                            }}
                            className="transition-all duration-150"
                          />
                          <text
                            x={LABEL_W + ci * CELL_W + CELL_W / 2}
                            y={HEADER_H + ri * CELL_H + CELL_H / 2 + 4}
                            textAnchor="middle"
                            className={`pointer-events-none text-[10px] font-semibold font-mono ${step.text}`}
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
          ) : (
            // List View table representation
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/20">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900/40 text-zinc-550 dark:text-zinc-400 font-medium">
                  <tr>
                    <th className="px-4 py-3 text-xs uppercase tracking-wider font-semibold">OMC Customer</th>
                    <th className="px-4 py-3 text-xs uppercase tracking-wider font-semibold">Product Group</th>
                    <th className="px-4 py-3 text-xs uppercase tracking-wider font-semibold">Leakage (KSh)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-205 dark:divide-zinc-900 text-zinc-700 dark:text-zinc-300">
                  {listItems.map((item, index) => (
                    <tr key={index} className="hover:bg-zinc-100 dark:hover:bg-zinc-900/40 transition-colors">
                      <td className="px-4 py-3 font-semibold">{item.omc}</td>
                      <td className="px-4 py-3 text-zinc-550 dark:text-zinc-400">{item.product}</td>
                      <td className="px-4 py-3 font-mono font-bold text-zinc-900 dark:text-white">
                        {formatKesFull(item.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Floating Interactive HTML Tooltip */}
      {hoveredCell && hoveredCell.value > 0 && (
        <div
          className="fixed z-50 pointer-events-none transform -translate-x-1/2 -translate-y-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-3.5 py-2.5 rounded-lg shadow-2xl flex flex-col gap-1 transition-opacity duration-150 animate-fade-in"
          style={{ left: hoveredCell.x, top: hoveredCell.y }}
        >
          <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Reconciliation Break</span>
          <span className="text-xs text-zinc-900 dark:text-white font-bold">{hoveredCell.omc}</span>
          <div className="flex items-center gap-1.5 text-xs text-zinc-550 dark:text-zinc-400 mt-0.5">
            <span>{hoveredCell.product}:</span>
            <span className="text-indigo-650 dark:text-indigo-400 font-mono font-bold">
              {formatKesFull(hoveredCell.value)}
            </span>
          </div>
          <div className="absolute left-1/2 bottom-0 w-2 h-2 bg-white dark:bg-zinc-900 border-r border-b border-zinc-200 dark:border-zinc-800 transform -translate-x-1/2 translate-y-1/2 rotate-45"></div>
        </div>
      )}
    </section>
  );
}
