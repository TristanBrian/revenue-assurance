"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, getExposureRecoveryTrend } from "@/lib/api";
import type { ExposureRecoveryPoint } from "@/lib/types";

function formatKesMillions(value: number): string {
  return (value / 1_000_000).toFixed(1);
}

function formatKesFull(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatAxisDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-KE", { day: "2-digit", month: "short" });
}

interface HoverState {
  index: number;
  x: number;
  y: number;
}

const WIDTH = 720;
const HEIGHT = 220;
const PAD_LEFT = 42;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;

export default function ExposureRecoveryChart() {
  const [series, setSeries] = useState<ExposureRecoveryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  useEffect(() => {
    let cancelled = false;
    getExposureRecoveryTrend(30)
      .then((data) => {
        if (!cancelled) setSeries(data.series);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load the exposure/recovery trend.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const plotW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const maxValue = useMemo(() => {
    if (series.length === 0) return 1;
    const max = Math.max(...series.map((p) => Math.max(p.exposure_identified_kes, p.recovered_kes)));
    if (max <= 0) return 1_000_000;
    // Round up to a clean step so gridlines land on nice KES-millions marks.
    const millions = max / 1_000_000;
    const step = millions <= 5 ? 1 : millions <= 10 ? 2 : millions <= 50 ? 10 : 50;
    return Math.ceil(millions / step) * step * 1_000_000;
  }, [series]);

  const gridSteps = [0, 0.25, 0.5, 0.75, 1];

  function xFor(i: number): number {
    if (series.length <= 1) return PAD_LEFT;
    return PAD_LEFT + (i / (series.length - 1)) * plotW;
  }
  function yFor(value: number): number {
    return PAD_TOP + plotH - (value / maxValue) * plotH;
  }

  function pathFor(key: "exposure_identified_kes" | "recovered_kes"): string {
    return series.map((p, i) => `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yFor(p[key]).toFixed(1)}`).join(" ");
  }

  // Show roughly one label per week, always including the last point.
  const labelIndices = useMemo(() => {
    if (series.length === 0) return [];
    const step = Math.max(1, Math.round(series.length / 5));
    const idxs: number[] = [];
    for (let i = 0; i < series.length; i += step) idxs.push(i);
    if (idxs[idxs.length - 1] !== series.length - 1) idxs.push(series.length - 1);
    return idxs;
  }, [series]);

  return (
    <div className="relative flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-foreground">Exposure vs recovery</h2>
          <p className="text-xs text-muted-foreground">Daily, rolling 30 days · KES millions</p>
        </div>
        <div className="flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-foreground" />
            Exposure identified
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-muted-foreground/50" />
            Recovered
          </span>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg p-3 text-xs text-status-critical">
          {error}
        </div>
      )}

      {loading && !error && (
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-ring/30 border-t-ring" />
        </div>
      )}

      {!loading && !error && series.length > 0 && (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full"
          onMouseLeave={() => setHover(null)}
        >
          {gridSteps.map((s) => {
            const y = PAD_TOP + plotH - s * plotH;
            return (
              <g key={s}>
                <line x1={PAD_LEFT} y1={y} x2={WIDTH - PAD_RIGHT} y2={y} className="stroke-chart-gridline" strokeWidth={1} />
                <text x={PAD_LEFT - 8} y={y + 3} textAnchor="end" className="fill-muted-foreground text-[9px] font-mono">
                  {formatKesMillions(maxValue * s)}
                </text>
              </g>
            );
          })}

          {labelIndices.map((i) => (
            <text
              key={i}
              x={xFor(i)}
              y={HEIGHT - 8}
              textAnchor={i === series.length - 1 ? "end" : i === 0 ? "start" : "middle"}
              className="fill-muted-foreground text-[9px] font-mono"
            >
              {formatAxisDate(series[i].date)}
            </text>
          ))}

          <path d={pathFor("recovered_kes")} fill="none" className="stroke-muted-foreground/50" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <path d={pathFor("exposure_identified_kes")} fill="none" className="stroke-foreground" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          <circle cx={xFor(series.length - 1)} cy={yFor(series[series.length - 1].recovered_kes)} r={3.5} className="fill-muted-foreground/50" />
          <circle cx={xFor(series.length - 1)} cy={yFor(series[series.length - 1].exposure_identified_kes)} r={3.5} className="fill-foreground" />

          {/* Hover layer: one hit target per day, full plot height. */}
          {series.map((p, i) => (
            <rect
              key={p.date}
              x={xFor(i) - plotW / series.length / 2}
              y={PAD_TOP}
              width={plotW / series.length}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover({ index: i, x: xFor(i), y: PAD_TOP })}
            />
          ))}

          {hover && (
            <line
              x1={xFor(hover.index)}
              y1={PAD_TOP}
              x2={xFor(hover.index)}
              y2={PAD_TOP + plotH}
              className="stroke-ring"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}
        </svg>
      )}

      {!loading && !error && series.length === 0 && (
        <p className="py-8 text-center text-sm italic text-muted-foreground">No trend data available yet.</p>
      )}

      {hover && series[hover.index] && (
        <div
          className="pointer-events-none absolute z-10 flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2 shadow-2xl"
          style={{
            left: `${(hover.x / WIDTH) * 100}%`,
            top: 64,
            transform: "translateX(-50%)",
          }}
        >
          <span className="text-[10px] font-bold text-muted-foreground">
            {new Date(series[hover.index].date).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}
          </span>
          <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
            Exposure {formatKesFull(series[hover.index].exposure_identified_kes)}
          </span>
          <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
            Recovered {formatKesFull(series[hover.index].recovered_kes)}
          </span>
        </div>
      )}
    </div>
  );
}
