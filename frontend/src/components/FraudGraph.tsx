"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { ApiError, getFraudGraph } from "@/lib/api";
import { useMateriality } from "@/context/MaterialityContext";
import type { FraudGraphData, GraphNode } from "@/lib/types";
import type { WorkspaceDirection } from "@/lib/workspace";
import { riskConfig } from "@/config/direction-config";

// Outbound (stipend/disbursement) — Stage 2. "officer"/"beneficiary" nodes
// (graph_engine.build_outbound_fraud_graph_from_dataframes()) join the
// same node-type vocabulary "omc"/"depot" nodes already use here. OUTER_TYPES
// is the "hub" role in each direction's graph — OMC/Officer are drawn on
// the outer ring as circles; Depot/Beneficiary are the inner ring as
// squares — same visual grammar reused for both directions rather than a
// second graph component.
const OUTER_TYPES = new Set(["omc", "officer"]);
const NODE_TYPE_LABEL: Record<string, string> = {
  omc: "OMC",
  depot: "Depot",
  officer: "Officer",
  beneficiary: "Beneficiary",
};

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

function edgeRiskColor(a: GraphNode["risk_level"], b: GraphNode["risk_level"]): string {
  return riskHex(RISK_RANK[a] >= RISK_RANK[b] ? a : b);
}

// --- Layout: deterministic, dependency-free cluster + collision avoidance
// --- No d3-force or similar here — nothing else in this codebase pulls
// one in (DepotMap.tsx is hand-rolled SVG too), and both graphs are small
// enough (<= ~200 nodes) that a couple of O(n²) relax passes are
// effectively free. Two-level phyllotaxis (sunflower-spiral) seed +
// iterative pairwise separation: seed each Louvain community's members
// around their own local origin, de-overlap that cluster, then seed+
// de-overlap the clusters themselves against each other, compose, and
// run one final global pass as a safety net before fitting to the
// canvas. See laidOutNodes below for how these compose.

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~137.5° — the
// standard sunflower-seed angle: successive items never land on the same
// ray as a close neighbor, so the spiral starts from an already-decent
// spacing instead of a fully-overlapping pile at the origin.

function phyllotaxisSeed(
  count: number,
  spacing: number,
): { x: number; y: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const radius = spacing * Math.sqrt(i + 0.5);
    const angle = i * GOLDEN_ANGLE;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });
}

// Pushes any pair of items closer than radiusOf(a) + radiusOf(b) + padding
// apart until none overlap (or `iterations` runs out). This — not the seed
// above — is what actually guarantees no-overlap; the seed just gives it a
// starting layout close enough to converge in a handful of passes. Mutates
// x/y on the items in place.
function relaxOverlaps<T extends { x: number; y: number }>(
  items: T[],
  radiusOf: (item: T) => number,
  iterations: number,
  padding: number,
): void {
  for (let iter = 0; iter < iterations; iter++) {
    let anyOverlap = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDist = radiusOf(a) + radiusOf(b) + padding;
        let dist = Math.hypot(dx, dy);
        if (dist >= minDist) continue;
        anyOverlap = true;
        // Deterministic fallback direction if two items start on the
        // exact same point (dist ~ 0) — derived from the pair's indices
        // rather than random, so layout stays stable across re-renders.
        const ux = dist > 0.01 ? dx / dist : Math.cos(i - j);
        const uy = dist > 0.01 ? dy / dist : Math.sin(i - j);
        if (dist < 0.01) dist = 0.01;
        const push = (minDist - dist) / 2;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
      }
    }
    if (!anyOverlap) break;
  }
}

interface HoverState {
  node: GraphNode;
  x: number;
  y: number;
}

const WIDTH = 680;
const HEIGHT = 460;

interface FraudGraphProps {
  direction: WorkspaceDirection;
}

export default function FraudGraph({ direction }: FraudGraphProps) {
  const { materiality } = useMateriality(); // ✅ Get from context
  const [graph, setGraph] = useState<FraudGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    getFraudGraph(materiality, direction)
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
  }, [materiality, direction]);

  const laidOutNodes = useMemo(() => {
    if (!graph) return [];

    // --- Radius: the existing sqrt(leakage) sizing, untouched — only
    // where each node ends up changes below, never how big it is
    // relative to its peers. ---
    const hubNodes = graph.nodes.filter((n) => OUTER_TYPES.has(n.type));
    const leafNodes = graph.nodes.filter((n) => !OUTER_TYPES.has(n.type));
    const maxHubLeakage = Math.max(1, ...hubNodes.map((n) => n.leakage_kes));
    const maxLeafLeakage = Math.max(1, ...leafNodes.map((n) => n.leakage_kes));

    const radiusFor = (n: GraphNode): number => {
      const isLeaf = !OUTER_TYPES.has(n.type);
      const base = isLeaf ? 9 : 6;
      const extra = isLeaf ? 9 : 13;
      const maxLeakage = isLeaf ? maxLeafLeakage : maxHubLeakage;
      const t = Math.sqrt(Math.max(0, n.leakage_kes) / maxLeakage);
      return base + extra * t;
    };

    // Nodes that will actually draw a <text> label (see topLabelIds
    // below — same top-5-by-leakage + all-High-risk selection) get extra
    // clearance reserved around them during layout, so the label itself
    // doesn't collide with a neighboring node.
    const sortedByLeakage = [...graph.nodes].sort((a, b) => b.leakage_kes - a.leakage_kes);
    const labeledIds = new Set(sortedByLeakage.slice(0, 5).map((n) => n.id));
    graph.nodes.forEach((n) => {
      if (n.risk_level === "High") labeledIds.add(n.id);
    });
    const LABEL_CLEARANCE = 16;

    interface LayoutItem {
      r: number;
      effR: number;
      x: number;
      y: number;
    }
    const itemById = new Map<string, LayoutItem>();
    graph.nodes.forEach((n) => {
      const r = radiusFor(n);
      itemById.set(n.id, {
        r,
        effR: r + (labeledIds.has(n.id) ? LABEL_CLEARANCE : 0),
        x: 0,
        y: 0,
      });
    });

    // --- Cluster by Louvain community, laid out locally around its own
    // origin (hub-role members ordered first so they land near that
    // origin, leaves fanned out around them), then de-overlapped within
    // the cluster only. ---
    const byCommunity = new Map<number, GraphNode[]>();
    graph.nodes.forEach((n) => {
      const list = byCommunity.get(n.community) ?? [];
      list.push(n);
      byCommunity.set(n.community, list);
    });

    interface ClusterItem {
      x: number;
      y: number;
      r: number;
      members: LayoutItem[];
    }
    const clusters: ClusterItem[] = [];

    byCommunity.forEach((members) => {
      const ordered = [...members].sort((a, b) => {
        const aHub = OUTER_TYPES.has(a.type) ? 0 : 1;
        const bHub = OUTER_TYPES.has(b.type) ? 0 : 1;
        if (aHub !== bHub) return aHub - bHub;
        return (
          RISK_RANK[b.risk_level] - RISK_RANK[a.risk_level] ||
          b.leakage_kes - a.leakage_kes
        );
      });
      const items = ordered.map((n) => itemById.get(n.id)!);
      const avgEffR = items.reduce((sum, it) => sum + it.effR, 0) / Math.max(1, items.length);
      // Tight multiplier — the relax pass right below is what actually
      // guarantees no overlap, so this only needs to get the spiral seed
      // in the right neighborhood, not already collision-free. Loosening
      // it just inflates the natural (pre-fit) layout size, which the
      // fit-to-canvas step below would then have to scale back down
      // anyway — net effect is smaller rendered nodes for no benefit.
      const spacing = avgEffR * 0.4 + 1;

      const seed = phyllotaxisSeed(items.length, spacing);
      items.forEach((it, i) => {
        it.x = seed[i].x;
        it.y = seed[i].y;
      });
      relaxOverlaps(items, (it) => it.effR, 60, 4);

      const boundingR =
        Math.max(...items.map((it) => Math.hypot(it.x, it.y) + it.effR), 1) + 10;
      clusters.push({ x: 0, y: 0, r: boundingR, members: items });
    });

    // --- Seed and de-overlap the clusters themselves, so community
    // boundaries stay spatially distinct instead of interleaving. ---
    const avgClusterR = clusters.reduce((sum, c) => sum + c.r, 0) / Math.max(1, clusters.length);
    const macroSpacing = avgClusterR * 0.5 + 2;
    const macroSeed = phyllotaxisSeed(clusters.length, macroSpacing);
    clusters.forEach((c, i) => {
      c.x = macroSeed[i].x;
      c.y = macroSeed[i].y;
    });
    relaxOverlaps(clusters, (c) => c.r, 80, 16);

    // Compose: each member's absolute (pre-fit) position is its
    // cluster-local offset plus that cluster's own resolved anchor.
    clusters.forEach((c) => {
      c.members.forEach((m) => {
        m.x += c.x;
        m.y += c.y;
      });
    });

    // Final global safety pass across every node together — mops up any
    // residual overlap the two-level composition above left at cluster
    // boundaries, so "never overlap" holds regardless of graph shape.
    const allItems = Array.from(itemById.values());
    relaxOverlaps(allItems, (it) => it.r, 40, 3);

    // --- Fit to canvas: scale + translate the whole layout so it fills
    // the panel without excessive white space (small graphs) or spilling
    // off-canvas (dense ones), while keeping every node's size relative
    // to its peers exactly as computed above (uniform scale preserves
    // ratios). ---
    const MARGIN = 36;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    allItems.forEach((it) => {
      minX = Math.min(minX, it.x - it.effR);
      maxX = Math.max(maxX, it.x + it.effR);
      minY = Math.min(minY, it.y - it.effR);
      maxY = Math.max(maxY, it.y + it.effR);
    });
    const bboxW = Math.max(1, maxX - minX);
    const bboxH = Math.max(1, maxY - minY);
    const rawScale = Math.min(
      (WIDTH - MARGIN * 2) / bboxW,
      (HEIGHT - MARGIN * 2) / bboxH,
    );
    const scale = Math.min(2.4, Math.max(0.4, rawScale));
    const bboxCx = (minX + maxX) / 2;
    const bboxCy = (minY + maxY) / 2;
    const tx = WIDTH / 2 - bboxCx * scale;
    const ty = HEIGHT / 2 - bboxCy * scale;

    return graph.nodes.map((n) => {
      const it = itemById.get(n.id)!;
      return {
        ...n,
        x: it.x * scale + tx,
        y: it.y * scale + ty,
        r: it.r * scale,
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
        <h2 className="text-base font-bold text-zinc-900 dark:text-white">{riskConfig[direction].title}</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed mt-1">{riskConfig[direction].description}</p>
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
          <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-950/40 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3">
            <span className="flex items-center gap-1.5 font-medium">
              <svg width="10" height="10">
                <circle cx="5" cy="5" r="5" className="fill-zinc-500 dark:fill-zinc-400" />
              </svg>
              OMC (Circle)
            </span>
            <span className="flex items-center gap-1.5 font-medium">
              <svg width="10" height="10">
                <rect width="10" height="10" rx="2" className="fill-zinc-500 dark:fill-zinc-400" />
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
            <div
              ref={containerRef}
              className="lg:col-span-2 relative overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/40"
            >
              <svg
                viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                className="h-auto w-full"
                onMouseMove={handleNodeMove}
              >
                {graph.edges.map((edge, i) => {
                  const source = nodeById.get(edge.source);
                  const target = nodeById.get(edge.target);
                  if (!source || !target) return null;

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
                        isHighlighted ? "" : "text-zinc-200 dark:text-zinc-800"
                      }`}
                    />
                  );
                })}

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
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={Math.max(node.r, 12) + 8}
                        fill="transparent"
                      />

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

                      {OUTER_TYPES.has(node.type) ? (
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

              {hover && (
                <div
                  className="pointer-events-none absolute z-50 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3.5 py-2.5 text-xs shadow-2xl flex flex-col gap-1 transition-opacity duration-150 animate-fade-in"
                  style={{ left: hover.x + 12, top: hover.y + 12 }}
                >
                  <p className="font-bold text-zinc-900 dark:text-white">
                    {hover.node.label}
                  </p>
                  <p className="text-zinc-500 dark:text-zinc-400 capitalize">
                    {NODE_TYPE_LABEL[hover.node.type] ?? hover.node.type} · Community #
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

            <div className="flex flex-col gap-6">
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
                        {NODE_TYPE_LABEL[selectedNode.type] ?? selectedNode.type}{" "}
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
