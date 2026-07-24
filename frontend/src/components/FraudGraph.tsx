"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { ApiError, getFraudGraph } from "@/lib/api";
import type { FraudGraphData, GraphNode, RiskLevel } from "@/lib/types";

const WIDTH = 640;
const HEIGHT = 500;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2 - 10;
const DEPOT_RING_RADIUS = 90;
const OMC_RING_RADIUS = 200;

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

function riskFillClass(risk: RiskLevel): string {
  switch (risk) {
    case "High":
      return "fill-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.5)]";
    case "Medium":
      return "fill-amber-500";
    default:
      return "fill-emerald-500";
  }
}

function riskBadgeClass(risk: RiskLevel): string {
  switch (risk) {
    case "High":
      return "bg-rose-500/10 text-rose-400 border border-rose-500/20";
    case "Medium":
      return "bg-amber-500/10 text-amber-400 border border-amber-500/20";
    default:
      return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
  }
}

function polarPoint(cx: number, cy: number, radius: number, angle: number) {
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

interface LaidOutNode extends GraphNode {
  x: number;
  y: number;
  r: number;
}

function layoutNodes(nodes: GraphNode[]): LaidOutNode[] {
  const maxLeak = Math.max(...nodes.map((n) => n.leakage_kes), 1);
  const radiusFor = (leakage: number) => 8 + 14 * Math.sqrt(leakage / maxLeak);

  const depots = nodes.filter((n) => n.type === "depot");
  const omcs = [...nodes.filter((n) => n.type === "omc")].sort(
    (a, b) => a.community - b.community || a.label.localeCompare(b.label),
  );

  const laidOut: LaidOutNode[] = [];

  depots.forEach((node, i) => {
    const angle = (i / Math.max(depots.length, 1)) * 2 * Math.PI - Math.PI / 2;
    const { x, y } = polarPoint(CENTER_X, CENTER_Y, DEPOT_RING_RADIUS, angle);
    laidOut.push({ ...node, x, y, r: radiusFor(node.leakage_kes) });
  });

  omcs.forEach((node, i) => {
    const angle = (i / Math.max(omcs.length, 1)) * 2 * Math.PI - Math.PI / 2;
    const { x, y } = polarPoint(CENTER_X, CENTER_Y, OMC_RING_RADIUS, angle);
    laidOut.push({ ...node, x, y, r: radiusFor(node.leakage_kes) });
  });

  return laidOut;
}

export default function FraudGraph() {
  const [graph, setGraph] = useState<FraudGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ node: LaidOutNode; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    getFraudGraph(0)
      .then((data) => {
        if (!cancelled) setGraph(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Could not reach the fraud graph API. Is the database online?",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const laidOutNodes = useMemo(() => (graph ? layoutNodes(graph.nodes) : []), [graph]);
  const nodeById = useMemo(() => {
    const map = new Map<string, LaidOutNode>();
    laidOutNodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [laidOutNodes]);

  const maxWeight = useMemo(
    () => Math.max(...(graph?.edges.map((e) => e.weight) ?? [1]), 1),
    [graph],
  );
  const strokeWidthFor = (weight: number) => 1.5 + 4.5 * Math.sqrt(weight / maxWeight);

  const topLabelIds = useMemo(
    () =>
      new Set(
        [...laidOutNodes]
          .sort((a, b) => b.leakage_kes - a.leakage_kes)
          .slice(0, 5)
          .map((n) => n.id),
      ),
    [laidOutNodes],
  );

  function handleNodeEnter(node: LaidOutNode, e: React.MouseEvent) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ node, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  function handleNodeMove(e: React.MouseEvent) {
    if (!hover) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover((h) => (h ? { ...h, x: e.clientX - rect.left, y: e.clientY - rect.top } : h));
  }

  const selectedNode = selectedId ? nodeById.get(selectedId) ?? null : null;
  const selectedEdges = graph && selectedId
    ? graph.edges.filter((e) => e.source === selectedId || e.target === selectedId)
    : [];

  return (
    <section className="flex flex-col gap-5 bg-zinc-900/40 border border-zinc-800 rounded-xl p-5 shadow-lg relative">
      <div>
        <h2 className="text-base font-bold text-white">
          Fraud Graph — OMC × Depot Leakage Clusters
        </h2>
        <p className="text-xs text-zinc-400">
          Visual network representing dispatches between OMCs and depots. Color groupings indicate communities parsed by the Louvain Community Detection algorithm.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading && !error && (
        <div className="flex items-center justify-center p-12">
          <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-400 rounded-full animate-spin"></div>
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
          <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-400 bg-zinc-950/40 border border-zinc-800/80 rounded-lg p-3">
            <span className="flex items-center gap-1.5">
              <svg width="10" height="10"><circle cx="5" cy="5" r="5" className="fill-zinc-500" /></svg>
              OMC (Circle)
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="10" height="10"><rect width="10" height="10" rx="2" className="fill-zinc-500" /></svg>
              Depot (Square)
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="10" height="10"><circle cx="5" cy="5" r="5" className="fill-emerald-500" /></svg>
              Low Risk
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="10" height="10"><circle cx="5" cy="5" r="5" className="fill-amber-500" /></svg>
              Medium Risk
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="10" height="10"><circle cx="5" cy="5" r="5" className="fill-rose-500" /></svg>
              High Risk
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            {/* SVG Graph View */}
            <div
              ref={containerRef}
              className="lg:col-span-2 relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40"
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
                  const isHighlighted = !selectedId || edge.source === selectedId || edge.target === selectedId;

                  return (
                    <line
                      key={i}
                      x1={source.x}
                      y1={source.y}
                      x2={target.x}
                      y2={target.y}
                      stroke={isHighlighted ? "#6366f1" : "#27272a"}
                      strokeWidth={strokeWidthFor(edge.weight)}
                      strokeOpacity={isHighlighted ? 0.75 : 0.15}
                      className="transition-all duration-300"
                    />
                  );
                })}

                {/* Nodes */}
                {laidOutNodes.map((node) => {
                  const isSelected = selectedId === node.id;
                  const isDimmed = selectedId && selectedId !== node.id && !selectedEdges.some(e => e.source === node.id || e.target === node.id);

                  return (
                    <g
                      key={node.id}
                      className="cursor-pointer"
                      onMouseEnter={(e) => handleNodeEnter(node, e)}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => setSelectedId((prev) => (prev === node.id ? null : node.id))}
                      style={{ opacity: isDimmed ? 0.35 : 1 }}
                      className="transition-all duration-300"
                    >
                      {/* Transparent hit area */}
                      <circle cx={node.x} cy={node.y} r={Math.max(node.r, 12) + 8} fill="transparent" />
                      
                      {node.type === "omc" ? (
                        <circle
                          cx={node.x}
                          cy={node.y}
                          r={node.r}
                          className={riskFillClass(node.risk_level)}
                          stroke={isSelected ? "#6366f1" : "#18181b"}
                          strokeWidth={isSelected ? 3.5 : 1.5}
                          style={{
                            filter: isSelected ? "drop-shadow(0 0 8px rgba(99,102,241,0.5))" : "none"
                          }}
                        />
                      ) : (
                        <rect
                          x={node.x - node.r}
                          y={node.y - node.r}
                          width={node.r * 2}
                          height={node.r * 2}
                          rx={4}
                          className={riskFillClass(node.risk_level)}
                          stroke={isSelected ? "#6366f1" : "#18181b"}
                          strokeWidth={isSelected ? 3.5 : 1.5}
                          style={{
                            filter: isSelected ? "drop-shadow(0 0 8px rgba(99,102,241,0.5))" : "none"
                          }}
                        />
                      )}
                      
                      {/* Label for top nodes */}
                      {(topLabelIds.has(node.id) || isSelected) && (
                        <text
                          x={node.x}
                          y={node.y + node.r + 13}
                          textAnchor="middle"
                          className="fill-zinc-300 text-[10px] font-bold tracking-wide pointer-events-none"
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
                  className="pointer-events-none absolute z-15 rounded-lg border border-zinc-800 bg-zinc-900 px-3.5 py-2.5 text-xs shadow-2xl flex flex-col gap-1 transition-opacity duration-150 animate-fade-in"
                  style={{ left: hover.x + 12, top: hover.y + 12 }}
                >
                  <p className="font-bold text-white">{hover.node.label}</p>
                  <p className="text-zinc-400 capitalize">
                    {hover.node.type === "omc" ? "OMC" : "Depot"} · Community #{hover.node.community}
                  </p>
                  <div className="flex items-center gap-1.5 text-rose-400 font-bold mt-1">
                    <span>Leakage:</span>
                    <span className="font-mono">{formatKes(hover.node.leakage_kes)}</span>
                  </div>
                  <p className="text-[10px] text-zinc-500 font-semibold">{hover.node.anomaly_count} active anomalies</p>
                </div>
              )}
            </div>

            {/* Inspection / Communities Sidebar */}
            <div className="flex flex-col gap-6">
              {/* Inspection Details Panel */}
              <div className="bg-zinc-950/40 border border-zinc-800 rounded-xl p-5 shadow-lg flex flex-col gap-3 min-h-[160px]">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Node Inspector</h3>
                
                {selectedNode ? (
                  <div className="flex flex-col gap-2.5 text-sm">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white text-base">{selectedNode.label}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${riskBadgeClass(selectedNode.risk_level)}`}>
                          {selectedNode.risk_level} Risk
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 mt-0.5 capitalize">
                        {selectedNode.type === "omc" ? "OMC Customer" : "Physical Depot"} · Community #{selectedNode.community}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mt-2">
                      <div className="bg-zinc-900/60 rounded p-2 border border-zinc-800/40">
                        <p className="text-[9px] text-zinc-500 font-bold uppercase">Leakage Value</p>
                        <p className="font-bold font-mono text-rose-400 text-xs mt-0.5">{formatKes(selectedNode.leakage_kes)}</p>
                      </div>
                      <div className="bg-zinc-900/60 rounded p-2 border border-zinc-800/40">
                        <p className="text-[9px] text-zinc-500 font-bold uppercase">Anomalies Count</p>
                        <p className="font-bold font-mono text-white text-xs mt-0.5">{selectedNode.anomaly_count} breaks</p>
                      </div>
                    </div>

                    {selectedEdges.length > 0 && (
                      <div className="mt-2.5">
                        <p className="text-[9px] text-zinc-500 font-bold uppercase">Direct Network Connections</p>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {selectedEdges.map((e, index) => {
                            const otherId = e.source === selectedId ? e.target : e.source;
                            const otherNode = nodeById.get(otherId);
                            return (
                              <span
                                key={index}
                                onClick={() => setSelectedId(otherId)}
                                className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700/80 text-[10px] text-zinc-300 font-medium hover:text-white cursor-pointer transition-colors"
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
                    Select a node in the graph matrix to inspect its leakage profile.
                  </p>
                )}
              </div>

              {/* Communities Summary Table */}
              <div className="bg-zinc-950/20 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Louvain Risk Communities</h3>
                <div className="max-h-[180px] overflow-y-auto pr-1">
                  <div className="flex flex-col gap-2.5">
                    {graph.communities.map((c) => (
                      <div
                        key={c.id}
                        className="bg-zinc-950/40 border border-zinc-850 hover:border-zinc-800 p-2.5 rounded-lg text-xs flex justify-between items-center transition-colors"
                      >
                        <div className="flex flex-col gap-0.5 max-w-[140px]">
                          <span className="font-bold text-zinc-200">Community #{c.id}</span>
                          <span className="text-[10px] text-zinc-500 truncate">
                            {c.node_ids.map(id => nodeById.get(id)?.label ?? id).join(", ")}
                          </span>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className="font-bold font-mono text-white">{formatKes(c.total_leakage_kes)}</span>
                          <span className={`px-1.5 py-0.2 rounded-full text-[8px] font-bold ${riskBadgeClass(c.risk_level)}`}>
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
