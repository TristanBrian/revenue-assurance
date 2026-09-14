"use client";

import React, { useState } from "react";
import { Truck, Clock, ShieldAlert, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import AccessibleDialog from "./AccessibleDialog";
import type { GantryLane } from "@/lib/types";

interface GantryYardGridProps {
  lanes: GantryLane[];
  onRefresh?: () => void;
  loading?: boolean;
}

export default function GantryYardGrid({ lanes, onRefresh, loading = false }: GantryYardGridProps) {
  const [selectedLane, setSelectedLane] = useState<GantryLane | null>(null);

  const getStatusBadge = (lane: GantryLane) => {
    switch (lane.status) {
      case "green":
        return {
          bg: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
          dot: "bg-emerald-500 animate-pulse",
          label: "Green: Clean",
          desc: "Meter matched invoice. Sample clearance recorded.",
          icon: CheckCircle2,
        };
      case "yellow":
        return {
          bg: "bg-amber-500/10 text-amber-500 border-amber-500/30",
          dot: "bg-amber-500 animate-ping",
          label: "Yellow: Demurrage Warning",
          desc: `Dwell time approaching the ${lane.free_time_limit_mins}-minute free-time limit.`,
          icon: AlertTriangle,
        };
      case "red":
      default:
        return {
          bg: "bg-rose-500/10 text-rose-500 border-rose-500/30",
          dot: "bg-rose-500 animate-pulse",
          label: "Red: Hold / Leakage",
          desc: "Meter volume ≠ Invoice volume. Sample hold indicated.",
          icon: ShieldAlert,
        };
    }
  };

  return (
    <div className="p-6 rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-primary" />
            <h3 className="text-xl font-extrabold text-foreground tracking-tight">
              Loading lanes
            </h3>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1 font-medium">
            Select a lane to inspect its sample meter, invoice and dwell-time records.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
            <span className="flex items-center gap-1.5 text-emerald-500 font-bold bg-emerald-500/10 px-2.5 py-1 rounded border border-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Matched
            </span>
            <span className="flex items-center gap-1.5 text-amber-500 font-bold bg-amber-500/10 px-2.5 py-1 rounded border border-amber-500/20">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              Warning
            </span>
            <span className="flex items-center gap-1.5 text-rose-500 font-bold bg-rose-500/10 px-2.5 py-1 rounded border border-rose-500/20">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              Hold preview
            </span>
          </div>

          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={loading}
              className="p-2 rounded-lg border border-border bg-background hover:bg-accent text-foreground transition-colors disabled:opacity-50"
              title="Refresh Gantry Grid"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          )}
        </div>
      </div>

      {/* Grid of Gantry Lanes 1 to 6 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {lanes.map((lane) => {
          const statusInfo = getStatusBadge(lane);
          const StatusIcon = statusInfo.icon;
          const delta = lane.meter_volume_l - lane.invoiced_volume_l;

          return (
            <button
              type="button"
              aria-label={`Inspect ${lane.lane_name}: ${statusInfo.label}`}
              key={lane.lane_id}
              onClick={() => setSelectedLane(lane)}
              className={`text-left min-w-0 p-4 rounded-xl border transition-all duration-200 cursor-pointer hover:scale-[1.01] ${
                lane.status === "red"
                  ? "border-rose-500/40 bg-rose-500/5 shadow-rose-500/5"
                  : lane.status === "yellow"
                  ? "border-amber-500/40 bg-amber-500/5 shadow-amber-500/5"
                  : "border-border/60 bg-background/50 hover:border-primary/40"
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-base text-foreground">{lane.lane_name}</span>
                  <span className="text-xs font-mono font-bold bg-muted px-2 py-0.5 rounded text-muted-foreground">
                    {lane.product_code}
                  </span>
                </div>

                <div className={`px-2.5 py-0.5 rounded-full border text-xs font-bold flex items-center gap-1.5 ${statusInfo.bg}`}>
                  <span className={`w-2 h-2 rounded-full ${statusInfo.dot}`} />
                  {lane.status.toUpperCase()}
                </div>
              </div>

              <div className="space-y-2 mb-3">
                <div className="flex items-center justify-between text-xs sm:text-sm">
                  <span className="text-muted-foreground font-medium flex items-center gap-1">
                    <Truck className="w-4 h-4 text-muted-foreground" /> Truck ID:
                  </span>
                  <span className="font-mono font-bold text-foreground">{lane.current_truck_id}</span>
                </div>

                <div className="flex items-center justify-between text-xs sm:text-sm">
                  <span className="text-muted-foreground font-medium">OMC Customer:</span>
                  <span className="font-bold text-foreground truncate max-w-[160px]">{lane.omc_name}</span>
                </div>

                <div className="flex items-center justify-between text-xs sm:text-sm">
                  <span className="text-muted-foreground font-medium">Meter vs Invoice:</span>
                  <span className={`font-mono font-bold ${delta !== 0 ? "text-rose-500" : "text-emerald-500"}`}>
                    {lane.meter_volume_l.toLocaleString()} L / {lane.invoiced_volume_l.toLocaleString()} L
                    {delta > 0 && <span className="ml-1 text-xs font-bold">(+{delta.toLocaleString()}L)</span>}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs sm:text-sm">
                  <span className="text-muted-foreground font-medium flex items-center gap-1">
                    <Clock className="w-4 h-4 text-muted-foreground" /> Dwell Time:
                  </span>
                  <span className={`font-mono font-bold ${lane.dwell_time_mins > lane.free_time_limit_mins ? "text-amber-500" : "text-foreground"}`}>
                    {lane.dwell_time_mins} min / {lane.free_time_limit_mins} min limit
                  </span>
                </div>
              </div>

              {lane.automated_hold_reason && (
                <div className="p-2.5 rounded border border-rose-500/30 bg-rose-500/10 text-xs text-rose-500 font-semibold flex items-start gap-1.5">
                  <StatusIcon className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{lane.automated_hold_reason}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected Lane Inspector Modal */}
      {selectedLane && (
        <AccessibleDialog label={`${selectedLane.lane_name} inspector`} onClose={() => setSelectedLane(null)}>
          <div className="bg-card border border-border rounded-xl max-w-md w-full p-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-border">
              <div>
                <h4 className="text-lg font-bold text-foreground">{selectedLane.lane_name} Inspector</h4>
                <p className="text-xs text-muted-foreground">Truck {selectedLane.current_truck_id} • {selectedLane.omc_name}</p>
              </div>
              <button
                aria-label="Close lane inspector"
                onClick={() => setSelectedLane(null)}
                className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs mb-6">
              <div className="flex justify-between p-2 rounded bg-muted/40">
                <span className="text-muted-foreground">Gate Clearance Status:</span>
                <span className={`font-bold ${selectedLane.gate_clearance === "ISSUED" ? "text-emerald-500" : "text-rose-500"}`}>
                  {selectedLane.gate_clearance}
                </span>
              </div>

              <div className="flex justify-between p-2 rounded bg-muted/40">
                <span className="text-muted-foreground">Physical Meter Reading:</span>
                <span className="font-mono font-bold text-foreground">{selectedLane.meter_volume_l.toLocaleString()} Liters</span>
              </div>

              <div className="flex justify-between p-2 rounded bg-muted/40">
                <span className="text-muted-foreground">Billed Commercial Invoice:</span>
                <span className="font-mono font-bold text-foreground">{selectedLane.invoiced_volume_l.toLocaleString()} Liters</span>
              </div>

              <div className="flex justify-between p-2 rounded bg-muted/40">
                <span className="text-muted-foreground">Volume Variance Delta:</span>
                <span className={`font-mono font-bold ${selectedLane.meter_volume_l - selectedLane.invoiced_volume_l > 0 ? "text-rose-500" : "text-emerald-500"}`}>
                  {`${selectedLane.meter_volume_l - selectedLane.invoiced_volume_l > 0 ? "+" : ""}${(selectedLane.meter_volume_l - selectedLane.invoiced_volume_l).toLocaleString()} Liters`}
                </span>
              </div>

              <div className="flex justify-between p-2 rounded bg-muted/40">
                <span className="text-muted-foreground">Gantry Dwell Duration:</span>
                <span className="font-mono font-semibold text-foreground">{selectedLane.dwell_time_mins} minutes (Free limit: {selectedLane.free_time_limit_mins}m)</span>
              </div>

              {selectedLane.automated_hold_reason && (
                <div className="p-3 rounded border border-rose-500/30 bg-rose-500/10 text-rose-400 font-medium">
                  <div className="font-bold mb-1 flex items-center gap-1">
                    <ShieldAlert className="w-4 h-4" /> Automated Hold preview
                  </div>
                  <p>{selectedLane.automated_hold_reason}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setSelectedLane(null)}
                className="px-4 py-2 text-xs font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </AccessibleDialog>
      )}
    </div>
  );
}
