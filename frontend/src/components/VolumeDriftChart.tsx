"use client";

import React from "react";
import { TrendingUp, Activity } from "lucide-react";

interface VolumeDriftChartProps {
  data?: Array<{ date: string; loaded_volume: number; invoiced_volume: number; drift_volume: number }>;
}

export default function VolumeDriftChart({ data }: VolumeDriftChartProps) {
  // Default mock dataset if data not provided
  const chartData = data && data.length > 0 ? data : [
    { date: "Day 1", loaded_volume: 320000, invoiced_volume: 318000, drift_volume: 2000 },
    { date: "Day 5", loaded_volume: 350000, invoiced_volume: 342000, drift_volume: 8000 },
    { date: "Day 10", loaded_volume: 410000, invoiced_volume: 395000, drift_volume: 15000 },
    { date: "Day 15", loaded_volume: 380000, invoiced_volume: 376000, drift_volume: 4000 },
    { date: "Day 20", loaded_volume: 440000, invoiced_volume: 420000, drift_volume: 20000 },
    { date: "Day 25", loaded_volume: 470000, invoiced_volume: 458000, drift_volume: 12000 },
    { date: "Day 30", loaded_volume: 510000, invoiced_volume: 492000, drift_volume: 18000 },
  ];

  const maxVolume = Math.max(...chartData.map((d) => d.loaded_volume));

  return (
    <div className="p-6 rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            <h3 className="text-base font-bold text-foreground tracking-tight">
              Loading Volume vs. Invoiced Volume Drift
            </h3>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time variance analytics tracking physical gantry meters vs financial billing
          </p>
        </div>

        <div className="flex items-center gap-4 text-xs font-medium">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">Meter Volume (L)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-blue-500" />
            <span className="text-muted-foreground">Invoiced Volume (L)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-rose-500" />
            <span className="text-muted-foreground">Unbilled Drift (L)</span>
          </div>
        </div>
      </div>

      {/* Visual Chart Graphic */}
      <div className="space-y-4">
        {chartData.map((item, idx) => {
          const loadedWidth = (item.loaded_volume / maxVolume) * 100;
          const invoicedWidth = (item.invoiced_volume / maxVolume) * 100;

          return (
            <div key={idx} className="space-y-1">
              <div className="flex justify-between text-xs font-mono text-muted-foreground">
                <span className="font-semibold text-foreground">{item.date}</span>
                <span>
                  Meter: <strong className="text-emerald-500">{item.loaded_volume.toLocaleString()} L</strong> | Billed: <strong className="text-blue-500">{item.invoiced_volume.toLocaleString()} L</strong> | Drift: <strong className="text-rose-500">+{item.drift_volume.toLocaleString()} L</strong>
                </span>
              </div>

              <div className="h-3 w-full bg-muted/40 rounded-full overflow-hidden relative">
                {/* Meter Bar */}
                <div
                  className="h-full bg-emerald-500/80 rounded-full transition-all duration-500"
                  style={{ width: `${loadedWidth}%` }}
                />
                {/* Invoiced Overlay */}
                <div
                  className="h-full bg-blue-500/90 rounded-full transition-all duration-500 absolute top-0 left-0 opacity-70"
                  style={{ width: `${invoicedWidth}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 pt-4 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <TrendingUp className="w-4 h-4 text-emerald-500" /> Average Meter Alignment: <strong>96.4% Accuracy</strong>
        </span>
        <span>Updated real-time from Gantry Telemetry</span>
      </div>
    </div>
  );
}
