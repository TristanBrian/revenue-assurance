"use client";

import { useEffect, useState, useMemo } from "react";
import { ApiError, getHeatmap } from "@/lib/api";
import { useMateriality } from "@/context/MaterialityContext";
import { useDirection } from "@/context/DirectionContext";
import type { HeatmapData } from "@/lib/types";
import DepotMap from "./DepotMap";

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

/**
 * Unified beneficiary masking – "bank statement" style.
 * - BEN-0158 → BEN-****0158
 * - Audrey Anderson → BEN-****5837 (consistent hash-based)
 */
function maskBeneficiaryId(id: string | undefined | null): string {
  if (!id) return "Beneficiary";

  // If it's already a BEN-XXXX format, mask it
  if (id.startsWith("BEN-")) {
    const clean = id.replace(/^BEN-/, "");
    // If it already has ****, return as-is
    if (clean.includes('****')) return id;
    return `BEN-****${clean.slice(-4)}`;
  }

  // If it contains a space (likely a person's name) OR is a name pattern
  if (id.includes(' ') || /^[A-Z][a-z]+\s[A-Z][a-z]+$/.test(id)) {
    const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const suffix = String(hash % 10000).padStart(4, '0');
    return `BEN-****${suffix}`;
  }

  // If it's a long name that's not all caps (likely a person's name without space)
  if (id.length > 8 && id !== id.toUpperCase() && !id.includes('ENERGY') && !id.includes('OIL')) {
    const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const suffix = String(hash % 10000).padStart(4, '0');
    return `BEN-****${suffix}`;
  }

  // Return unchanged for company names, product names, etc.
  return id;
}

interface HoveredCell {
  omc: string;
  product: string;
  value: number;
  x: number;
  y: number;
}

export default function Heatmap() {
  const { materiality } = useMateriality();
  const { direction } = useDirection();
  const [heatmap, setHeatmap] = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"bar" | "list" | "map">("bar");
  const [hoveredCell, setHoveredCell] = useState<HoveredCell | null>(null);
  const [listPage, setListPage] = useState(1);
  const [selectedProduct, setSelectedProduct] = useState<string>("All");
  const LIST_PAGE_SIZE = 15;

  useEffect(() => {
    let cancelled = false;

    getHeatmap(materiality, direction)
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
  }, [materiality, direction]);

  const productOptions = useMemo(() => ["All", ...(heatmap?.products ?? [])], [heatmap]);

  const barItems = useMemo(() => {
    if (!heatmap) return [];
    const productIndex = selectedProduct === "All" ? -1 : heatmap.products.indexOf(selectedProduct);
    return heatmap.omcs
        .map((omc, ri) => {
          const row = heatmap.data[ri] ?? [];
          const value = productIndex === -1 ? row.reduce((sum, v) => sum + v, 0) : (row[productIndex] ?? 0);
          // ALWAYS MASK - this ensures all names are masked
          const maskedOmc = maskBeneficiaryId(omc);
          return { omc: maskedOmc, originalOmc: omc, value };
        })
        .filter((item) => item.value > 0)
        .sort((a, b) => b.value - a.value);
  }, [heatmap, selectedProduct]);

  const barMax = useMemo(() => barItems.reduce((max, item) => Math.max(max, item.value), 0) || 1, [barItems]);

  const listItems = useMemo(() => {
    if (!heatmap) return [];
    const items: { omc: string; originalOmc: string; product: string; value: number }[] = [];
    heatmap.omcs.forEach((omc, ri) => {
      heatmap.products.forEach((product, ci) => {
        const val = heatmap.data[ri]?.[ci] ?? 0;
        if (val > 0) {
          // ALWAYS MASK - this ensures all names are masked in the list view
          const maskedOmc = maskBeneficiaryId(omc);
          items.push({
            omc: maskedOmc,
            originalOmc: omc,
            product,
            value: val
          });
        }
      });
    });
    return items.sort((a, b) => b.value - a.value);
  }, [heatmap]);

  useEffect(() => {
    Promise.resolve().then(() => setListPage(1));
  }, [heatmap]);

  const listTotalPages = Math.max(1, Math.ceil(listItems.length / LIST_PAGE_SIZE));
  const pagedListItems = useMemo(
      () => listItems.slice((listPage - 1) * LIST_PAGE_SIZE, listPage * LIST_PAGE_SIZE),
      [listItems, listPage],
  );

  return (
      <section className="relative flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-col items-start justify-between gap-4 border-b border-border pb-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-base font-bold text-foreground">Leakage Explorer</h2>
            <p className="text-xs text-muted-foreground">
              {viewMode === "map"
                  ? "Geographic exposure across KPC's depot network and pipeline corridor"
                  : viewMode === "bar"
                      ? "Total leakage by Oil Marketing Company, ranked highest to lowest"
                      : "Every OMC × product leakage combination, sorted by value"}
            </p>
          </div>

          <div className="flex items-center self-end rounded-lg border border-border bg-muted/40 p-0.5">
            <button
                onClick={() => setViewMode("bar")}
                className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                    viewMode === "bar"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h9M4 12h14M4 18h6" />
              </svg>
              <span>Bar Chart</span>
            </button>
            <button
                onClick={() => setViewMode("list")}
                className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                    viewMode === "list"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              <span>List View</span>
            </button>
            <button
                onClick={() => setViewMode("map")}
                className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                    viewMode === "map"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              <span>Map View</span>
            </button>
          </div>
        </div>

        {viewMode !== "map" && error && (
            <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg p-4 text-sm text-status-critical">
              {error}
            </div>
        )}

        {viewMode !== "map" && loading && !error && (
            <div className="flex items-center justify-center p-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-ring/30 border-t-ring"></div>
            </div>
        )}

        {viewMode === "map" && <DepotMap />}

        {viewMode !== "map" && heatmap && !loading && heatmap.omcs.length === 0 && (
            <p className="py-8 text-center text-sm italic text-muted-foreground">No leakage data to chart at the current threshold.</p>
        )}

        {viewMode !== "map" && heatmap && heatmap.omcs.length > 0 && (
            <div className="flex flex-col gap-4">
              {viewMode === "bar" ? (
                  <>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {productOptions.map((p) => (
                          <button
                              key={p}
                              type="button"
                              onClick={() => setSelectedProduct(p)}
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                                  selectedProduct === p
                                      ? "border-primary bg-primary text-primary-foreground"
                                      : "border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
                              }`}
                          >
                            {p === "All" ? "All products" : p}
                          </button>
                      ))}
                    </div>

                    {barItems.length === 0 ? (
                        <p className="py-8 text-center text-sm italic text-muted-foreground">
                          No leakage for {selectedProduct === "All" ? "any product" : selectedProduct} at the current threshold.
                        </p>
                    ) : (
                        <div className="flex max-h-[520px] flex-col gap-2.5 overflow-y-auto rounded-lg border border-border bg-muted/20 p-4 pr-3">
                          {barItems.map((item) => (
                              <div key={item.originalOmc} className="grid grid-cols-[minmax(0,168px)_1fr_92px] items-center gap-3">
                      <span className="truncate text-xs font-semibold text-foreground/90" title={item.originalOmc}>
                        {item.omc}
                      </span>
                                <div
                                    className="relative h-3 cursor-pointer rounded-full bg-muted"
                                    onMouseEnter={(e) => {
                                      const rect = e.currentTarget.getBoundingClientRect();
                                      setHoveredCell({
                                        omc: item.originalOmc,
                                        product: selectedProduct === "All" ? "All products" : selectedProduct,
                                        value: item.value,
                                        x: rect.left + rect.width / 2,
                                        y: rect.top - 8,
                                      });
                                    }}
                                    onMouseLeave={() => setHoveredCell(null)}
                                >
                                  <div
                                      className="h-3 rounded-full bg-[var(--chart-1)] transition-all duration-300"
                                      style={{ width: `${Math.max((item.value / barMax) * 100, 2)}%` }}
                                  />
                                </div>
                                <span className="text-right font-mono text-xs font-bold text-foreground">{formatKes(item.value)}</span>
                              </div>
                          ))}
                        </div>
                    )}
                  </>
              ) : (
                  <div className="overflow-x-auto rounded-lg border border-border bg-muted/20">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-border bg-muted/50 font-medium text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 text-xs uppercase tracking-wider font-semibold">Beneficiary</th>
                        <th className="px-4 py-3 text-xs uppercase tracking-wider font-semibold">Product Group</th>
                        <th className="px-4 py-3 text-xs uppercase tracking-wider font-semibold">Leakage (KSh)</th>
                      </tr>
                      </thead>
                      <tbody className="divide-y divide-border text-foreground/90">
                      {pagedListItems.map((item, index) => (
                          <tr key={index} className="transition-colors hover:bg-accent/60">
                            <td className="px-4 py-3 font-semibold" title={item.originalOmc}>
                              {item.omc}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{item.product}</td>
                            <td className="px-4 py-3 font-mono font-bold text-foreground">
                              {formatKesFull(item.value)}
                            </td>
                          </tr>
                      ))}
                      </tbody>
                    </table>
                    {listItems.length > LIST_PAGE_SIZE && (
                        <div className="flex items-center justify-between border-t border-border px-4 py-3">
                  <span className="text-xs text-muted-foreground">
                    Showing {(listPage - 1) * LIST_PAGE_SIZE + 1}–
                    {Math.min(listPage * LIST_PAGE_SIZE, listItems.length)} of {listItems.length}
                  </span>
                          <div className="flex items-center gap-1">
                            <button
                                type="button"
                                disabled={listPage === 1}
                                onClick={() => setListPage((p) => Math.max(1, p - 1))}
                                className="rounded-md px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                            >
                              Prev
                            </button>
                            <span className="px-2 text-xs font-medium text-foreground/90">
                      {listPage} / {listTotalPages}
                    </span>
                            <button
                                type="button"
                                disabled={listPage === listTotalPages}
                                onClick={() => setListPage((p) => Math.min(listTotalPages, p + 1))}
                                className="rounded-md px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                            >
                              Next
                            </button>
                          </div>
                        </div>
                    )}
                  </div>
              )}
            </div>
        )}

        {hoveredCell && hoveredCell.value > 0 && (
            <div
                className="fixed z-50 flex -translate-x-1/2 -translate-y-full transform flex-col gap-1 rounded-lg border border-border bg-card px-3.5 py-2.5 pointer-events-none shadow-2xl transition-opacity duration-150"
                style={{ left: hoveredCell.x, top: hoveredCell.y }}
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Reconciliation Break</span>
              <span className="text-xs font-bold text-foreground">{maskBeneficiaryId(hoveredCell.omc)}</span>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>{hoveredCell.product}:</span>
                <span className="font-mono font-bold text-primary">
              {formatKesFull(hoveredCell.value)}
            </span>
              </div>
              <div className="absolute bottom-0 left-1/2 h-2 w-2 -translate-x-1/2 translate-y-1/2 rotate-45 transform border-b border-r border-border bg-card"></div>
            </div>
        )}
      </section>
  );
}