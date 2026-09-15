"use client";

import { useEffect, useState } from "react";
import { ApiError, getGantryLanes, getOmcRiskProfile } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { GantryLane, OmcRiskProfile } from "@/lib/types";
import GantryYardGrid from "@/components/GantryYardGrid";
import DemurrageLeaderboard from "@/components/DemurrageLeaderboard";
import VolumeDriftChart from "@/components/VolumeDriftChart";

export default function DepotOperationsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"yard" | "analytics">("yard");
  const [filter, setFilter] = useState("all");
  const [lanes, setLanes] = useState<GantryLane[]>([]);
  const [profiles, setProfiles] = useState<OmcRiskProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const canViewRisk = user?.permissions.includes("view_omc_risk_profile") ?? false;

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    getGantryLanes().then((result) => {
      if (!cancelled) { setLanes(result.lanes); setUpdatedAt(new Date()); }
    }).catch((err) => {
      if (!cancelled) { setLanes([]); setError(err instanceof ApiError ? err.message : "Loading lane data is unavailable. Try refreshing."); }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    if (canViewRisk && tab === "analytics") getOmcRiskProfile(0, "inbound").then((result) => { if (!cancelled) setProfiles(result); }).catch(() => { if (!cancelled) setError("OMC exposure data is unavailable. Refresh or return to the yard."); });
    return () => { cancelled = true; };
  }, [tab, canViewRisk, refresh]);

  const filtered = lanes.filter((lane) => filter === "all" || lane.status === filter);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-primary font-['Outfit',sans-serif]">KPC DEPOT CONTROL PLANE</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-foreground font-['Outfit',sans-serif]">Depot Operations & Yard Matrix</h1>
        <p className="mt-1 text-xs text-muted-foreground">Inspect loading volumetric variance, physical meter telemetry, and dwell-time exceptions in real-time.</p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-1 rounded-xl border border-border bg-card p-1" aria-label="Depot views">
          {(["yard", "analytics"] as const).map((view) => (
            <button
              key={view}
              aria-pressed={tab === view}
              onClick={() => setTab(view)}
              className={`rounded-lg px-4 py-2 text-xs font-bold transition-all cursor-pointer ${
                tab === view ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {view === "yard" ? "Loading Yard Grid" : "Variance & Demurrage Analytics"}
            </button>
          ))}
        </div>
        <p className="text-xs font-mono text-muted-foreground" role="status">
          {loading ? "Syncing telemetry…" : updatedAt ? `Telemetry updated ${updatedAt.toLocaleTimeString("en-KE")}` : "Telemetry online"}
        </p>
      </div>

      {error && <p role="alert" className="rounded-xl border border-status-critical/30 bg-status-critical-bg p-4 text-sm text-status-critical font-medium">{error}</p>}

      {tab === "yard" ? (
        <>
          <div className="flex flex-wrap gap-2" aria-label="Filter loading lanes">
            {[{id:"all", label:"All Lanes"}, {id:"red",label:"Gate Hold"}, {id:"yellow",label:"Dwell Warning"}, {id:"green",label:"Matched & Clear"}].map((item) => (
              <button
                key={item.id}
                onClick={() => setFilter(item.id)}
                aria-pressed={filter === item.id}
                className={`rounded-full border px-4 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                  filter === item.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40"
                }`}
              >
                {item.label} · {lanes.filter((lane) => item.id === "all" || lane.status === item.id).length}
              </button>
            ))}
          </div>
          <GantryYardGrid lanes={filtered} loading={loading} onRefresh={() => setRefresh((value) => value + 1)} />
          {!loading && !error && filtered.length === 0 && <p className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground italic text-sm">No gantry lanes match this filter criteria.</p>}
        </>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <VolumeDriftChart />
          {canViewRisk && <DemurrageLeaderboard profiles={profiles} />}
        </div>
      )}
    </div>
  );
}
