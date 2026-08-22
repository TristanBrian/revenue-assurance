"use client";

import { useEffect, useRef, useState } from "react";
import type * as LeafletType from "leaflet";
import "leaflet/dist/leaflet.css";
import { ApiError, getDepotRisk, getOmcDepotMap } from "@/lib/api";
import type { DepotRiskEntry, OmcDepotEntry } from "@/lib/types";

function formatKesFull(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

// Real coordinates — KPC's actual depots and the pipeline corridor between
// them (Mombasa -> Nairobi -> Nakuru, splitting to Kisumu and Eldoret).
// Nakuru isn't one of our depots (no reconciliation data there); it's kept
// purely as the corridor's real junction point, matching how the reference
// mockup shows unnamed waypoints along the route.
const DEPOT_COORDS: Record<string, [number, number]> = {
  "Mombasa (KOSF)": [-4.0345, 39.6682],
  "Mombasa (Kipevu)": [-4.0165, 39.6497],
  Nairobi: [-1.3197, 36.8971],
  Kisumu: [-0.0917, 34.768],
  Eldoret: [0.5143, 35.2698],
};
const NAKURU: [number, number] = [-0.3031, 36.08];

const RISK_ORDER: Record<DepotRiskEntry["risk_level"], number> = { Low: 0, Medium: 1, High: 2 };

function worseRisk(a?: DepotRiskEntry["risk_level"], b?: DepotRiskEntry["risk_level"]): DepotRiskEntry["risk_level"] {
  if (!a) return b ?? "Low";
  if (!b) return a;
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

// No real OMC coordinates exist (they're customer accounts, not physical
// sites) — this fans each OMC out a short, deterministic distance from its
// primary depot (same name always lands in the same spot) rather than
// stacking every OMC on top of the depot marker or inventing an address.
function jitter(name: string): [number, number] {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const angle = (Math.abs(h) % 360) * (Math.PI / 180);
  const dist = 0.12 + ((Math.abs(h) >> 8) % 100) / 100 / 5; // ~0.12-0.32 degrees, roughly 13-35km
  return [Math.sin(angle) * dist, Math.cos(angle) * dist];
}

const TILE_LAYERS = {
  Light: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  Terrain: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: '&copy; OpenStreetMap contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
  },
};

export default function DepotMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletType.Map | null>(null);
  const tileLayerRef = useRef<LeafletType.TileLayer | null>(null);
  const omcLayerRef = useRef<LeafletType.LayerGroup | null>(null);
  const [depots, setDepots] = useState<DepotRiskEntry[]>([]);
  const [omcs, setOmcs] = useState<OmcDepotEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [basemap, setBasemap] = useState<"Light" | "Terrain">("Light");
  const [showOmcs, setShowOmcs] = useState(true);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDepotRisk()
      .then((data) => {
        if (!cancelled) setDepots(data.depots);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load depot risk data.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // OMC markers are a secondary layer — a failure here shouldn't block the
    // depot map (which is the primary, required content) from rendering.
    getOmcDepotMap()
      .then((data) => {
        if (!cancelled) setOmcs(data.omcs);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Build the map once real depot data is in (need it for marker colors).
  useEffect(() => {
    if (loading || error || !containerRef.current || mapRef.current) return;

    let disposed = false;
    import("leaflet").then((L) => {
      if (disposed || !containerRef.current || mapRef.current) return;

      const style = getComputedStyle(document.documentElement);
      const riskColor: Record<DepotRiskEntry["risk_level"], string> = {
        High: style.getPropertyValue("--status-critical").trim() || "#d03b3b",
        Medium: style.getPropertyValue("--status-medium").trim() || "#b6790a",
        Low: style.getPropertyValue("--status-low").trim() || "#0ca30c",
      };
      const byDepot = new Map(depots.map((d) => [d.depot_id, d]));

      const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView([-1.7, 37.3], 6);
      const tiles = L.tileLayer(TILE_LAYERS[basemap].url, {
        attribution: TILE_LAYERS[basemap].attribution,
        maxZoom: 18,
      }).addTo(map);
      mapRef.current = map;
      tileLayerRef.current = tiles;

      // Corridor segments — each colored by the worse risk of its two ends.
      const mombasaHub = DEPOT_COORDS["Mombasa (KOSF)"];
      const segments: [string | null, [number, number], string | null, [number, number]][] = [
        ["Mombasa (KOSF)", mombasaHub, "Mombasa (Kipevu)", DEPOT_COORDS["Mombasa (Kipevu)"]],
        ["Mombasa (KOSF)", mombasaHub, "Nairobi", DEPOT_COORDS.Nairobi],
        ["Nairobi", DEPOT_COORDS.Nairobi, null, NAKURU],
        [null, NAKURU, "Kisumu", DEPOT_COORDS.Kisumu],
        [null, NAKURU, "Eldoret", DEPOT_COORDS.Eldoret],
      ];
      for (const [idA, a, idB, b] of segments) {
        const risk = worseRisk(idA ? byDepot.get(idA)?.risk_level : undefined, idB ? byDepot.get(idB)?.risk_level : undefined);
        L.polyline([a, b], { color: riskColor[risk], weight: 5, opacity: 0.85, lineCap: "round" }).addTo(map);
      }

      // Nakuru junction — a plain waypoint, not one of our depots.
      L.circleMarker(NAKURU, {
        radius: 5,
        color: "#ffffff",
        weight: 2,
        fillColor: style.getPropertyValue("--muted-foreground").trim() || "#6b6b6b",
        fillOpacity: 1,
      })
        .addTo(map)
        .bindTooltip("Nakuru junction", { direction: "top" });

      // Depot markers, sized/colored by real leakage data.
      for (const [depotId, coord] of Object.entries(DEPOT_COORDS)) {
        const d = byDepot.get(depotId);
        const color = d ? riskColor[d.risk_level] : "#999999";
        const marker = L.circleMarker(coord, {
          radius: 9,
          color: "#ffffff",
          weight: 2,
          fillColor: color,
          fillOpacity: 1,
        }).addTo(map);
        marker.bindPopup(
          `<div style="font: 12px system-ui; min-width:160px">
             <div style="font-weight:700; margin-bottom:4px">${depotId}</div>
             ${
               d
                 ? `<div>Leakage: <b>${formatKesFull(d.leakage_kes)}</b></div>
                    <div>Anomalies: <b>${d.anomaly_count}</b> (${d.critical_count} critical)</div>
                    <div>Risk: <b>${d.risk_level}</b></div>`
                 : "<div>No reconciliation data for this depot yet.</div>"
             }
           </div>`,
        );
      }

      setMapReady(true);
    });

    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, depots]);

  // OMC markers — its own layer group, built once OMC data + the map both
  // exist, so it can be toggled on/off without touching the depot layer.
  // Depends on mapReady (not just omcs) because the two data fetches race:
  // if the OMC response lands before the map finishes its own async
  // construction, mapRef.current would still be null and this effect would
  // bail out for good, since omcs only changes once.
  useEffect(() => {
    if (!mapRef.current || omcs.length === 0 || omcLayerRef.current) return;
    const map = mapRef.current;

    let disposed = false;
    import("leaflet").then((L) => {
      if (disposed || omcLayerRef.current) return;

      const style = getComputedStyle(document.documentElement);
      const riskColor: Record<OmcDepotEntry["risk_level"], string> = {
        High: style.getPropertyValue("--status-critical").trim() || "#d03b3b",
        Medium: style.getPropertyValue("--status-medium").trim() || "#b6790a",
        Low: style.getPropertyValue("--status-low").trim() || "#0ca30c",
      };

      const group = L.layerGroup();
      for (const o of omcs) {
        const base = DEPOT_COORDS[o.depot_id];
        if (!base) continue;
        const [dLat, dLng] = jitter(o.omc);
        const marker = L.circleMarker([base[0] + dLat, base[1] + dLng], {
          radius: 4,
          color: "#ffffff",
          weight: 1,
          fillColor: riskColor[o.risk_level],
          fillOpacity: 0.9,
        });
        marker.bindPopup(
          `<div style="font: 12px system-ui; min-width:160px">
             <div style="font-weight:700; margin-bottom:4px">${o.omc}</div>
             <div>Leakage: <b>${formatKesFull(o.leakage_kes)}</b></div>
             <div>Primary depot: <b>${o.depot_id}</b></div>
             <div>Risk: <b>${o.risk_level}</b></div>
           </div>`,
        );
        group.addLayer(marker);
      }
      omcLayerRef.current = group;
      if (showOmcs) group.addTo(map);
    });

    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [omcs, mapReady]);

  // Toggle the OMC layer's map membership without rebuilding it.
  useEffect(() => {
    if (!mapRef.current || !omcLayerRef.current) return;
    if (showOmcs) {
      omcLayerRef.current.addTo(mapRef.current);
    } else {
      omcLayerRef.current.remove();
    }
  }, [showOmcs]);

  // Swap tile layer when the basemap toggle changes, without rebuilding the map.
  useEffect(() => {
    if (!mapRef.current || !tileLayerRef.current) return;
    import("leaflet").then((L) => {
      if (!mapRef.current) return;
      mapRef.current.removeLayer(tileLayerRef.current!);
      const tiles = L.tileLayer(TILE_LAYERS[basemap].url, { attribution: TILE_LAYERS[basemap].attribution, maxZoom: 18 }).addTo(
        mapRef.current,
      );
      tileLayerRef.current = tiles;
    });
  }, [basemap]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-lg border border-status-critical/30 bg-status-critical-bg p-4 text-sm text-status-critical">
          {error}
        </div>
      )}

      {loading && !error && (
        <div className="flex items-center justify-center p-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-ring/30 border-t-ring" />
        </div>
      )}

      {!loading && !error && (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="relative min-w-0 flex-1 overflow-hidden rounded-lg border border-border">
            <div ref={containerRef} className="h-[520px] w-full" />
            <div className="absolute right-3 top-3 z-[1000] flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground/90 shadow-sm">
                <input type="checkbox" checked={showOmcs} onChange={(e) => setShowOmcs(e.target.checked)} className="accent-primary" />
                OMCs
              </label>
              <div className="flex overflow-hidden rounded-md border border-border bg-card shadow-sm">
                {(["Light", "Terrain"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setBasemap(mode)}
                    className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                      basemap === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex w-full shrink-0 flex-col gap-4 rounded-xl border border-border bg-muted/40 p-4 shadow-sm lg:w-60">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">Pipeline Corridor</h3>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                Segment color is the worse risk level of its two endpoints
              </p>
            </div>
            <div className="flex flex-col gap-2.5 text-xs">
              {(["High", "Medium", "Low"] as const).map((level) => (
                <div key={level} className="flex items-center gap-3">
                  <span
                    className={`h-1 w-6 shrink-0 rounded-full ${
                      level === "High" ? "bg-status-critical" : level === "Medium" ? "bg-status-medium" : "bg-status-low"
                    }`}
                  />
                  <span className="text-foreground/90">{level} risk</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 border-t border-border pt-3 text-[10px] text-muted-foreground">
              <span className="h-2 w-2 shrink-0 rounded-full border border-white/50 bg-muted-foreground" />
              Small dots are OMCs, fanned out near the depot they transact through most (no real OMC address exists)
            </div>
            <div className="border-t border-border pt-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">Depots</h3>
              <div className="mt-2.5 flex flex-col gap-2 text-xs">
                {depots
                  .slice()
                  .sort((a, b) => b.leakage_kes - a.leakage_kes)
                  .map((d) => (
                    <div key={d.depot_id} className="flex items-center justify-between gap-2">
                      <span className="truncate text-foreground/90">{d.depot_id}</span>
                      <span
                        className={`shrink-0 font-mono font-semibold ${
                          d.risk_level === "High"
                            ? "text-status-critical"
                            : d.risk_level === "Medium"
                              ? "text-status-medium"
                              : "text-status-low"
                        }`}
                      >
                        {formatKesFull(d.leakage_kes)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
