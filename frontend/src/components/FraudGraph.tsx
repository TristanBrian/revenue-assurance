"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { ApiError, getFraudGraph } from "@/lib/api";
import type { FraudGraphData, GraphNode } from "@/lib/types";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

function riskFillClass(risk: GraphNode["risk_level"]): string {
  switch (risk) {
    case "High":
      return "fill-rose-500/90";
    case "Medium":
      return "fill-amber-500/90";
    default:
      return "fill-emerald-500/90";
  }
}

function riskBadgeClass(risk: GraphNode["risk_level"]): string {
  switch (risk) {
    case "High":
      return "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20";
    case "Medium":
      return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20";
    default:
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20";
  }
}

// Same rose/amber/emerald triad as riskFillClass/riskBadgeClass, as hex —
// used for edge strokes and the high-risk halo, where SVG needs a real
// color value rather than a Tailwind fill class.
function riskHex(risk: GraphNode["risk_level"]): string {
  switch (risk) {
    case "High":
      return "#f43f5e";
    case "Medium":
      return "#f59e0b";
    default:
      return "#10b981";
  }
}

const RISK_RANK: Record<GraphNode["risk_level"], number> = {
  High: 2,
  Medium: 1,
  Low: 0,
};

// An edge's color follows the worse-risk endpoint, so the busiest/riskiest
// leakage flows read as a heatmap at a glance instead of uniform indigo.
function edgeRiskColor(a: GraphNode["risk_level"], b: GraphNode["risk_level"]): string {
  return riskHex(RISK_RANK[a] >= RISK_RANK[b] ? a : b);
}

interface HoverState {
  node: GraphNode;
  x: number;
  y: number;
}

const WIDTH = 680;
const HEIGHT = 460;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;

export default function FraudGraph() {
  const [graph, setGraph] = useState<FraudGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    getFraudGraph()
      .then((data) => {
        if (!cancelled) setGraph(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Could not load the Fraud Graph network.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const WIDTH = 680;
  const HEIGHT = 460;

  // The backend never returns per-node coordinates, so lay nodes out
  // deterministically here: all OMC nodes on one outer ring, and depot
  // nodes clustered on a small ring at the canvas center. OMCs are ordered
  // around the ring by risk severity (High first) so risky accounts cluster
  // into a contiguous, scannable arc instead of falling in random order.
  const laidOutNodes = useMemo(() => {
    if (!graph) return [];

    const centerX = WIDTH / 2;
    const centerY = HEIGHT / 2;
    const omcRadius = Math.min(WIDTH, HEIGHT) / 2 - 70;

    const omcNodes = [...graph.nodes]
      .filter((n) => n.type === "omc")
      .sort(
        (a, b) =>
          RISK_RANK[b.risk_level] - RISK_RANK[a.risk_level] ||
          b.leakage_kes - a.leakage_kes,
      );
    const depotNodes = [...graph.nodes]
      .filter((n) => n.type !== "omc")
      .sort((a, b) => b.leakage_kes - a.leakage_kes);
    const depotRadius =
      depotNodes.length > 1 ? Math.min(60, 16 + depotNodes.length * 6) : 0;

    const positions = new Map<string, { x: number; y: number }>();

    omcNodes.forEach((n, i) => {
      const angle = (i / Math.max(omcNodes.length, 1)) * 2 * Math.PI;
      positions.set(n.id, {
        x: centerX + omcRadius * Math.cos(angle),
        y: centerY + omcRadius * Math.sin(angle),
      });
    });

    depotNodes.forEach((n, i) => {
      const angle = (i / Math.max(depotNodes.length, 1)) * 2 * Math.PI;
      positions.set(n.id, {
        x: centerX + depotRadius * Math.cos(angle),
        y: centerY + depotRadius * Math.sin(angle),
      });
    });

    // Radius encodes leakage magnitude (area-proportional via sqrt), scaled
    // within each node type separately — depot totals aggregate many OMCs'
    // leakage, so a shared scale would flatten OMC-to-OMC differences.
    const maxOmcLeakage = Math.max(1, ...omcNodes.map((n) => n.leakage_kes));
    const maxDepotLeakage = Math.max(1, ...depotNodes.map((n) => n.leakage_kes));

    return graph.nodes.map((n) => {
      const pos = positions.get(n.id) ?? { x: centerX, y: centerY };
      const isDepot = n.type === "depot";
      const base = isDepot ? 9 : 6;
      const extra = isDepot ? 9 : 13;
      const maxLeakage = isDepot ? maxDepotLeakage : maxOmcLeakage;
      const t = Math.sqrt(Math.max(0, n.leakage_kes) / maxLeakage);
      return {
        ...n,
        x: pos.x,
        y: pos.y,
        r: base + extra * t,
      };
    });
  }, [graph]);

  const nodeById = useMemo(() => {
    const map = new Map<string, (typeof laidOutNodes)[0]>();
    laidOutNodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [laidOutNodes]);

  function strokeWidthFor(weight: number): number {
    return Math.min(Math.max(weight * 2.2, 1.2), 6.5);
  }

  // Label the top-5 by leakage, plus every High-risk node — an investigator
  // scanning for fraud should never have to hover to find a red node's name.
  const topLabelIds = useMemo(() => {
    if (!graph) return new Set<string>();
    const sorted = [...graph.nodes].sort(
      (a, b) => b.leakage_kes - a.leakage_kes,
    );
    const ids = new Set(sorted.slice(0, 5).map((n) => n.id));
    graph.nodes.forEach((n) => {
      if (n.risk_level === "High") ids.add(n.id);
    });
    return ids;
  }, [graph]);

  function handleNodeEnter(node: GraphNode, e: React.MouseEvent) {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setHover({
      node,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }

  function handleNodeMove(e: React.MouseEvent) {
    if (!hover || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setHover((prev) =>
      prev
        ? {
            ...prev,
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
          }
        : null,
    );
  }

  const selectedNode = selectedId ? (nodeById.get(selectedId) ?? null) : null;
  const selectedEdges =
    graph && selectedId
      ? graph.edges.filter(
          (e) => e.source === selectedId || e.target === selectedId,
        )
      : [];

  return (
    <section className="flex flex-col gap-5 bg-white dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm relative text-zinc-800 dark:text-zinc-100">
      <div>
        <h2 className="text-base font-bold text-zinc-900 dark:text-white">
          Fraud Graph — OMC × Depot Leakage Clusters
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed mt-1">
          OMCs ring the depots at the center of the network. Node size scales
          with leakage value, node/edge color with risk severity — the
          biggest, reddest shapes are where to look first.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && !error && (
        <div className="flex items-center justify-center p-12">
          <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
        </div>
      )}

      {graph && !loading && graph.nodes.length === 0 && (
        <p className="text-sm text-zinc-500 py-8 text-center italic">
          No anomalies to graph yet at the current materiality threshold.
        </p>
      )}

      {graph && !loading && graph.nodes.length > 0 && (
        <>
          {/* Legend and stats */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-950/40 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3">
            <span className="flex items-center gap-1.5 font-medium">
              <svg width="10" height="10">
                <circle
                  cx="5"
                  cy="5"
                  r="5"
                  className="fill-zinc-500 dark:fill-zinc-400"
                />
              </svg>
              OMC (Circle)
            </span>
            <span className="flex items-center gap-1.5 font-medium">
              <svg width="10" height="10">
                <rect
                  width="10"
                  height="10"
                  rx="2"
                  className="fill-zinc-500 dark:fill-zinc-400"
                />
              </svg>
              Depot (Square)
            </span>
            <span className="flex items-center gap-1.5 font-medium">
              <svg width="10" height="10">
                <circle cx="5" cy="5" r="5" className="fill-emerald-500" />
              </svg>
              Low Risk
            </span>
            <span className="flex items-center gap-1.5 font-medium">
              <svg width="10" height="10">
                <circle cx="5" cy="5" r="5" className="fill-amber-500" />
              </svg>
              Medium Risk
            </span>
            <span className="flex items-center gap-1.5 font-medium">
              <svg width="10" height="10">
                <circle cx="5" cy="5" r="5" className="fill-rose-500" />
              </svg>
              High Risk
            </span>
            <span className="flex items-center gap-1.5 font-medium text-zinc-400 dark:text-zinc-500">
              Size = leakage value
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            {/* SVG Graph View */}
            <div
              ref={containerRef}
              className="lg:col-span-2 relative overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/40"
            >
              <svg
                viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                className="h-auto w-full"
                onMouseMove={handleNodeMove}
              >
                {/* Edges */}
                {graph.edges.map((edge, i) => {
                  const source = nodeById.get(edge.source);
                  const target = nodeById.get(edge.target);
                  if (!source || !target) return null;

                  // Dim non-connected edges when a node is selected
                  const isHighlighted =
                    !selectedId ||
                    edge.source === selectedId ||
                    edge.target === selectedId;
                  const color = edgeRiskColor(
                    source.risk_level,
                    target.risk_level,
                  );

                  return (
                    <line
                      key={i}
                      x1={source.x}
                      y1={source.y}
                      x2={target.x}
                      y2={target.y}
                      stroke={isHighlighted ? color : "currentColor"}
                      strokeWidth={strokeWidthFor(edge.weight)}
                      strokeOpacity={isHighlighted ? 0.7 : 0.15}
                      className={`transition-all duration-300 ${
                        isHighlighted
                          ? ""
                          : "text-zinc-200 dark:text-zinc-800"
                      }`}
                    />
                  );
                })}

                {/* Nodes */}
                {laidOutNodes.map((node) => {
                  const isSelected = selectedId === node.id;
                  const isDimmed =
                    selectedId &&
                    selectedId !== node.id &&
                    !selectedEdges.some(
                      (e) => e.source === node.id || e.target === node.id,
                    );

                  return (
                    <g
                      key={node.id}
                      onMouseEnter={(e) => handleNodeEnter(node, e)}
                      onMouseLeave={() => setHover(null)}
                      onClick={() =>
                        setSelectedId((prev) =>
                          prev === node.id ? null : node.id,
                        )
                      }
                      style={{ opacity: isDimmed ? 0.35 : 1 }}
                      className="cursor-pointer transition-all duration-300"
                    >
                      {/* Transparent hit area */}
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={Math.max(node.r, 12) + 8}
                        fill="transparent"
                      />

                      {/* Subtle attention halo for High-risk nodes — a
                          secondary cue beyond fill color, so severity is
                          legible even without color vision. */}
                      {node.risk_level === "High" && !isDimmed && (
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={node.r + 6}
                          fill="#f43f5e"
                          fillOpacity={0.18}
                          className="animate-pulse pointer-events-none"
                        />
                      )}

                      {node.type === "omc" ? (
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={node.r}
                          stroke={isSelected ? "#6366f1" : "currentColor"}
                          strokeWidth={isSelected ? 3.5 : 1.5}
                          className={`transition-all duration-300 ${
                            isSelected ? "" : "text-white dark:text-zinc-900"
                          } ${riskFillClass(node.risk_level)}`}
                          style={{
                            filter: isSelected
                              ? "drop-shadow(0 0 8px rgba(99,102,241,0.5))"
                              : "none",
                          }}
                        />
                      ) : (
                        <rect
                          x={node.x - node.r}
                          y={node.y - node.r}
                          width={node.r * 2}
                          height={node.r * 2}
                          rx={4}
                          stroke={isSelected ? "#6366f1" : "currentColor"}
                          strokeWidth={isSelected ? 3.5 : 1.5}
                          className={`transition-all duration-300 ${
                            isSelected ? "" : "text-white dark:text-zinc-900"
                          } ${riskFillClass(node.risk_level)}`}
                          style={{
                            filter: isSelected
                              ? "drop-shadow(0 0 8px rgba(99,102,241,0.5))"
                              : "none",
                          }}
                        />
                      )}

                      {/* Label for top nodes */}
                      {(topLabelIds.has(node.id) || isSelected) && (
                        <text
                          x={node.x}
                          y={node.y + node.r + 13}
                          textAnchor="middle"
                          className="fill-zinc-600 dark:fill-zinc-300 text-[10px] font-bold tracking-wide pointer-events-none"
                        >
                          {node.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>

              {/* Float Hover Details */}
              {hover && (
                <div
                  className="pointer-events-none absolute z-50 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3.5 py-2.5 text-xs shadow-2xl flex flex-col gap-1 transition-opacity duration-150 animate-fade-in"
                  style={{ left: hover.x + 12, top: hover.y + 12 }}
                >
                  <p className="font-bold text-zinc-900 dark:text-white">
                    {hover.node.label}
                  </p>
                  <p className="text-zinc-500 dark:text-zinc-400 capitalize">
                    {hover.node.type === "omc" ? "OMC" : "Depot"} · Community #
                    {hover.node.community}
                  </p>
                  <div className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-bold mt-1">
                    <span>Leakage:</span>
                    <span className="font-mono">
                      {formatKes(hover.node.leakage_kes)}
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-semibold">
                    {hover.node.anomaly_count} active anomalies
                  </p>
                </div>
              )}
            </div>

            {/* Inspection / Communities Sidebar */}
            <div className="flex flex-col gap-6">
              {/* Inspection Details Panel */}
              <div className="bg-white dark:bg-zinc-950/40 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm flex flex-col gap-3 min-h-[160px]">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                  Node Inspector
                </h3>

                {selectedNode ? (
                  <div className="flex flex-col gap-2.5 text-sm">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-zinc-900 dark:text-white text-base">
                          {selectedNode.label}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${riskBadgeClass(selectedNode.risk_level)}`}
                        >
                          {selectedNode.risk_level} Risk
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 capitalize">
                        {selectedNode.type === "omc"
                          ? "OMC Customer"
                          : "Physical Depot"}{" "}
                        · Community #{selectedNode.community}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mt-2">
                      <div className="bg-zinc-50 dark:bg-zinc-900/60 rounded p-2 border border-zinc-200 dark:border-zinc-800/40 shadow-sm">
                        <p className="text-[9px] text-zinc-500 font-bold uppercase">
                          Leakage Value
                        </p>
                        <p className="font-bold font-mono text-rose-600 dark:text-rose-400 text-xs mt-0.5">
                          {formatKes(selectedNode.leakage_kes)}
                        </p>
                      </div>
                      <div className="bg-zinc-50 dark:bg-zinc-900/60 rounded p-2 border border-zinc-200 dark:border-zinc-800/40 shadow-sm">
                        <p className="text-[9px] text-zinc-500 font-bold uppercase">
                          Anomalies Count
                        </p>
                        <p className="font-bold font-mono text-zinc-900 dark:text-white text-xs mt-0.5">
                          {selectedNode.anomaly_count} breaks
                        </p>
                      </div>
                    </div>

                    {selectedEdges.length > 0 && (
                      <div className="mt-2.5">
                        <p className="text-[9px] text-zinc-500 font-bold uppercase">
                          Direct Network Connections
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {selectedEdges.map((e, index) => {
                            const otherId =
                              e.source === selectedId ? e.target : e.source;
                            const otherNode = nodeById.get(otherId);
                            return (
                              <span
                                key={index}
                                onClick={() => setSelectedId(otherId)}
                                className="px-2 py-0.5 rounded bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700/80 text-[10px] text-zinc-700 dark:text-zinc-300 font-medium hover:text-zinc-950 dark:hover:text-white cursor-pointer transition-colors border border-zinc-200/50 dark:border-zinc-700"
                              >
                                {otherNode?.label ?? otherId}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-zinc-500 text-xs italic py-6 my-auto text-center">
                    Select a node in the graph matrix to inspect its leakage
                    profile.
                  </p>
                )}
              </div>

              {/* Communities Summary Table */}
              <div className="bg-white dark:bg-zinc-950/20 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 flex flex-col gap-3 shadow-sm">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                  Louvain Risk Communities
                </h3>
                <div className="max-h-[180px] overflow-y-auto pr-1">
                  <div className="flex flex-col gap-2.5">
                    {graph.communities.map((c) => (
                      <div
                        key={c.id}
                        className="bg-zinc-50 dark:bg-zinc-950/40 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-800 p-2.5 rounded-lg text-xs flex justify-between items-center transition-colors"
                      >
                        <div className="flex flex-col gap-0.5 max-w-[140px]">
                          <span className="font-bold text-zinc-700 dark:text-zinc-200">
                            Community #{c.id}
                          </span>
                          <span className="text-[10px] text-zinc-500 truncate">
                            {c.node_ids
                              .map((id) => nodeById.get(id)?.label ?? id)
                              .join(", ")}
                          </span>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className="font-bold font-mono text-zinc-900 dark:text-white">
                            {formatKes(c.total_leakage_kes)}
                          </span>
                          <span
                            className={`px-1.5 py-0.2 rounded-full text-[8px] font-bold ${riskBadgeClass(c.risk_level)}`}
                          >
                            {c.risk_level}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
