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
  return <div className="mx-auto flex max-w-7xl flex-col gap-6">
    <header><p className="text-xs font-semibold uppercase tracking-widest text-primary">Oil revenue · Problems 7 & 8</p><h1 className="mt-2 text-3xl font-bold tracking-tight">Depot operations</h1><p className="mt-2 text-sm text-muted-foreground">Inspect loading variance and dwell-time exceptions in one dedicated workspace.</p></header>
    <aside className="rounded-xl border border-status-medium/30 bg-status-medium-bg p-4 text-sm"><strong className="text-status-medium">Demonstration environment</strong><p className="mt-1 text-muted-foreground">Lane and drift data are illustrative. Physical meters, gate controllers and automatic demurrage invoicing are awaiting integration; these statuses do not authorize a truck to exit.</p></aside>
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex gap-1 rounded-xl border border-border bg-card p-1" aria-label="Depot views">{(["yard", "analytics"] as const).map((view) => <button key={view} aria-pressed={tab === view} onClick={() => setTab(view)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === view ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{view === "yard" ? "Loading yard" : "Variance analytics"}</button>)}</div>
      <p className="text-sm text-muted-foreground" role="status">{loading ? "Loading…" : updatedAt ? `Preview loaded ${updatedAt.toLocaleTimeString("en-KE")}` : "No data loaded"}</p>
    </div>
    {error && <p role="alert" className="rounded-xl border border-status-critical/30 bg-status-critical-bg p-4 text-sm text-status-critical">{error}</p>}
    {tab === "yard" ? <>
      <div className="flex flex-wrap gap-2" aria-label="Filter loading lanes">{[{id:"all", label:"All lanes"}, {id:"red",label:"Hold"}, {id:"yellow",label:"Dwell warning"}, {id:"green",label:"Matched"}].map((item) => <button key={item.id} onClick={() => setFilter(item.id)} aria-pressed={filter === item.id} className={`rounded-full border px-4 py-2 text-sm ${filter === item.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground"}`}>{item.label} · {lanes.filter((lane) => item.id === "all" || lane.status === item.id).length}</button>)}</div>
      <GantryYardGrid lanes={filtered} loading={loading} onRefresh={() => setRefresh((value) => value + 1)} />
      {!loading && !error && filtered.length === 0 && <p className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">No lanes match this filter.</p>}
    </> : <div className="grid gap-6 xl:grid-cols-2"><VolumeDriftChart />{canViewRisk && <DemurrageLeaderboard profiles={profiles} />}</div>}
  </div>;
}
