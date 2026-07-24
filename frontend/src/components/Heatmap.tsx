"use client";

import { useEffect, useState, useMemo } from "react";
import { ApiError, getHeatmap } from "@/lib/api";
import type { HeatmapData } from "@/lib/types";
import { useMateriality } from "@/context/MaterialityContext";

function formatKes(value: number): string {
  if (value === 0) return "—";
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

const INTENSITY_STEPS = [
  { threshold: 0, fill: "fill-zinc-900 border-zinc-800", colorCode: "#18181b", text: "text-zinc-600" },
  { threshold: 0.1, fill: "fill-indigo-950/20 border-indigo-900/30", colorCode: "#1e1b4b", text: "text-indigo-400" },
  { threshold: 0.3, fill: "fill-indigo-900/40 border-indigo-800/50", colorCode: "#312e81", text: "text-indigo-300" },
  { threshold: 0.5, fill: "fill-indigo-800/60 border-indigo-700", colorCode: "#3730a3", text: "text-indigo-200" },
  { threshold: 0.7, fill: "fill-indigo-600 border-indigo-500", colorCode: "#4f46e5", text: "text-white font-bold" },
  { threshold: 0.9, fill: "fill-violet-600 border-violet-500", colorCode: "#7c3aed", text: "text-white font-bold" },
];

function stepFor(intensity: number) {
  let step = INTENSITY_STEPS[0];
  for (const s of INTENSITY_STEPS) {
    if (intensity >= s.threshold) step = s;
  }
  return step;
}

const CELL_W = 100;
const CELL_H = 36;
const LABEL_W = 180;
const HEADER_H = 50;

interface HoveredCell {
  omc: string;
  product: string;
  value: number;
  x: number;
  y: number;
}

export default function Heatmap() {
  const { materiality } = useMateriality();
  const [heatmap, setHeatmap] = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [hoveredCell, setHoveredCell] = useState<HoveredCell | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }
    });

    getHeatmap(materiality)
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
  }, [materiality]);

  const maxValue = heatmap ? Math.max(...heatmap.data.flat(), 1) : 1;
  const width = LABEL_W + (heatmap?.products.length ?? 0) * CELL_W;
  const height = HEADER_H + (heatmap?.omcs.length ?? 0) * CELL_H;

  // Compute list view items sorted by leakage amount descending
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
    <section className="flex flex-col gap-4 bg-zinc-900/40 border border-zinc-800 rounded-xl p-5 shadow-lg relative">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-zinc-800 pb-4">
        <div>
          <h2 className="text-base font-bold text-white">
            Leakage Heatmap — OMC × Product
          </h2>
          <p className="text-xs text-zinc-400">Leakage intensity by Oil Marketing Company and fuel category</p>
        </div>

        {/* View toggle */}
        <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-lg p-0.5 self-end">
          <button
            onClick={() => setViewMode("grid")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1 transition-all ${
              viewMode === "grid"
                ? "bg-zinc-800 text-white shadow-sm"
                : "text-zinc-500 hover:text-zinc-300"
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
                ? "bg-zinc-800 text-white shadow-sm"
                : "text-zinc-500 hover:text-zinc-300"
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
        <div className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading && !error && (
        <div className="flex items-center justify-center p-12">
          <div className="w-6 h-6 rounded-full border-2 border-indigo-500/30 border-t-indigo-400 animate-spin"></div>
        </div>
      )}

      {heatmap && !loading && heatmap.omcs.length === 0 && (
        <p className="text-sm text-zinc-500 py-8 text-center italic">No leakage data to chart at the current threshold.</p>
      )}

      {heatmap && heatmap.omcs.length > 0 && (
        <>
          {viewMode === "grid" ? (
            <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/30 p-4">
              <svg width={width} height={height} className="mx-auto min-w-full">
                {/* Column Headers (Products) */}
                {heatmap.products.map((product, ci) => (
                  <text
                    key={product}
                    x={LABEL_W + ci * CELL_W + CELL_W / 2}
                    y={HEADER_H - 12}
                    textAnchor="middle"
                    className="fill-zinc-400 text-[10px] font-bold uppercase tracking-wider font-mono"
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
                      className="fill-zinc-300 text-xs font-semibold"
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
                              stroke: isHovered ? "#6366f1" : "rgba(63,63,70,0.4)",
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
            <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/20">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-800 bg-zinc-900/40 text-zinc-400 font-medium">
                  <tr>
                    <th className="px-4 py-3 text-xs uppercase tracking-wider font-semibold">OMC Customer</th>
                    <th className="px-4 py-3 text-xs uppercase tracking-wider font-semibold">Product Group</th>
                    <th className="px-4 py-3 text-xs uppercase tracking-wider font-semibold">Leakage (KSh)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900 text-zinc-300">
                  {listItems.map((item, index) => (
                    <tr key={index} className="hover:bg-zinc-900/40 transition-colors">
                      <td className="px-4 py-3 font-semibold">{item.omc}</td>
                      <td className="px-4 py-3 text-zinc-400">{item.product}</td>
                      <td className="px-4 py-3 font-mono font-bold text-white">
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
          className="fixed z-50 pointer-events-none transform -translate-x-1/2 -translate-y-full bg-zinc-900 border border-zinc-800 px-3.5 py-2.5 rounded-lg shadow-2xl flex flex-col gap-1 transition-opacity duration-150 animate-fade-in"
          style={{ left: hoveredCell.x, top: hoveredCell.y }}
        >
          <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Reconciliation Break</span>
          <span className="text-xs text-white font-bold">{hoveredCell.omc}</span>
          <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-0.5">
            <span>{hoveredCell.product}:</span>
            <span className="text-indigo-400 font-mono font-bold">
              {formatKesFull(hoveredCell.value)}
            </span>
          </div>
          <div className="absolute left-1/2 bottom-0 w-2 h-2 bg-zinc-900 border-r border-b border-zinc-800 transform -translate-x-1/2 translate-y-1/2 rotate-45"></div>
        </div>
      )}
    </section>
  );
}
