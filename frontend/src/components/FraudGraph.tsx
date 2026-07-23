"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { ApiError, getFraudGraph } from "@/lib/api";
import type { FraudGraphData, GraphNode, RiskLevel } from "@/lib/types";

const WIDTH = 640;
const HEIGHT = 560;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2 - 10;
const DEPOT_RING_RADIUS = 90;
const OMC_RING_RADIUS = 220;

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
      return "fill-red-600 dark:fill-red-500";
    case "Medium":
      return "fill-amber-600 dark:fill-amber-500";
    default:
      return "fill-emerald-600 dark:fill-emerald-500";
  }
}

function riskBadgeClass(risk: RiskLevel): string {
  switch (risk) {
    case "High":
      return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
    case "Medium":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
    default:
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
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
  const radiusFor = (leakage: number) => 7 + 13 * Math.sqrt(leakage / maxLeak);

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
            : "Could not reach the fraud graph API. Is the backend running?",
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
  const strokeWidthFor = (weight: number) => 1 + 4 * Math.sqrt(weight / maxWeight);

  // Label only the top-3 highest-leakage nodes directly — selective labels,
  // everything else is reachable via hover/click/the table below.
  const topLabelIds = useMemo(
    () =>
      new Set(
        [...laidOutNodes]
          .sort((a, b) => b.leakage_kes - a.leakage_kes)
          .slice(0, 3)
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
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Fraud Graph — OMC × Depot Leakage Clusters
        </h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Nodes are OMCs and depots, connected wherever an anomaly ties them together.
          Colored clusters (communities) are found via Louvain community detection —
          they flag correlated leakage worth a closer look, not confirmed fraud.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && !error && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading fraud graph…</p>
      )}

      {graph && !loading && graph.nodes.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No anomalies to graph yet — the OMC × Depot leakage graph will populate once
          reconciliation finds breaks.
        </p>
      )}

      {graph && !loading && graph.nodes.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-600 dark:text-zinc-400">
            <span className="flex items-center gap-1.5">
              <svg width="10" height="10"><circle cx="5" cy="5" r="5" className="fill-zinc-400 dark:fill-zinc-500" /></svg>
              OMC (circle)
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="10" height="10"><rect width="10" height="10" rx="2" className="fill-zinc-400 dark:fill-zinc-500" /></svg>
              Depot (square)
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="10" height="10"><circle cx="5" cy="5" r="5" className="fill-emerald-600 dark:fill-emerald-500" /></svg>
              Low risk
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="10" height="10"><circle cx="5" cy="5" r="5" className="fill-amber-600 dark:fill-amber-500" /></svg>
              Medium risk
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="10" height="10"><circle cx="5" cy="5" r="5" className="fill-red-600 dark:fill-red-500" /></svg>
              High risk
            </span>
            <span className="text-zinc-400 dark:text-zinc-500">Line thickness = leakage between the pair</span>
          </div>

          <div
            ref={containerRef}
            className="relative w-full overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
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
                return (
                  <line
                    key={i}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    className="stroke-zinc-300 dark:stroke-zinc-700"
                    strokeWidth={strokeWidthFor(edge.weight)}
                    strokeOpacity={0.7}
                  />
                );
              })}

              {laidOutNodes.map((node) => (
                <g
                  key={node.id}
                  className="cursor-pointer"
                  onMouseEnter={(e) => handleNodeEnter(node, e)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setSelectedId((prev) => (prev === node.id ? null : node.id))}
                >
                  {/* transparent hit area, bigger than the visible mark */}
                  <circle cx={node.x} cy={node.y} r={Math.max(node.r, 12) + 8} fill="transparent" />
                  {node.type === "omc" ? (
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={node.r}
                      className={riskFillClass(node.risk_level)}
                      stroke={selectedId === node.id ? "currentColor" : "white"}
                      strokeOpacity={selectedId === node.id ? 1 : 0.7}
                      strokeWidth={selectedId === node.id ? 3 : 2}
                    />
                  ) : (
                    <rect
                      x={node.x - node.r}
                      y={node.y - node.r}
                      width={node.r * 2}
                      height={node.r * 2}
                      rx={3}
                      className={riskFillClass(node.risk_level)}
                      stroke={selectedId === node.id ? "currentColor" : "white"}
                      strokeOpacity={selectedId === node.id ? 1 : 0.7}
                      strokeWidth={selectedId === node.id ? 3 : 2}
                    />
                  )}
                  {topLabelIds.has(node.id) && (
                    <text
                      x={node.x}
                      y={node.y + node.r + 12}
                      textAnchor="middle"
                      className="fill-zinc-600 text-[10px] dark:fill-zinc-400"
                    >
                      {node.label}
                    </text>
                  )}
                </g>
              ))}
            </svg>

            {hover && (
              <div
                className="pointer-events-none absolute z-10 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                style={{ left: hover.x + 12, top: hover.y + 12 }}
              >
                <p className="font-medium text-zinc-900 dark:text-zinc-50">{hover.node.label}</p>
                <p className="text-zinc-500 dark:text-zinc-400">
                  {hover.node.type === "omc" ? "OMC" : "Depot"} · Community {hover.node.community}
                </p>
                <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-50">
                  {formatKes(hover.node.leakage_kes)}
                </p>
                <p className="text-zinc-500 dark:text-zinc-400">
                  {hover.node.anomaly_count} anomal{hover.node.anomaly_count === 1 ? "y" : "ies"}
                </p>
                <span
                  className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${riskBadgeClass(hover.node.risk_level)}`}
                >
                  {hover.node.risk_level} risk
                </span>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
            {selectedNode ? (
              <div className="flex flex-col gap-1">
                <p className="font-medium text-zinc-900 dark:text-zinc-50">
                  {selectedNode.label}{" "}
                  <span
                    className={`ml-1 rounded-full px-2 py-0.5 text-xs font-medium ${riskBadgeClass(selectedNode.risk_level)}`}
                  >
                    {selectedNode.risk_level} risk
                  </span>
                </p>
                <p className="text-zinc-500 dark:text-zinc-400">
                  {selectedNode.type === "omc" ? "OMC" : "Depot"} · Community {selectedNode.community} ·{" "}
                  {formatKes(selectedNode.leakage_kes)} leakage across {selectedNode.anomaly_count} anomalies
                </p>
                <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                  Connected to:{" "}
                  {selectedEdges
                    .map((e) => {
                      const otherId = e.source === selectedId ? e.target : e.source;
                      return nodeById.get(otherId)?.label ?? otherId;
                    })
                    .join(", ")}
                </p>
              </div>
            ) : (
              <p className="text-zinc-500 dark:text-zinc-400">
                Click a node above to see its details.
              </p>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2 font-medium text-zinc-500 dark:text-zinc-400">Community</th>
                  <th className="px-4 py-2 font-medium text-zinc-500 dark:text-zinc-400">Members</th>
                  <th className="px-4 py-2 font-medium text-zinc-500 dark:text-zinc-400">Total Leakage</th>
                  <th className="px-4 py-2 font-medium text-zinc-500 dark:text-zinc-400">Risk</th>
                </tr>
              </thead>
              <tbody>
                {graph.communities.map((community) => (
                  <tr key={community.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                    <td className="px-4 py-2 font-mono text-xs">#{community.id}</td>
                    <td className="px-4 py-2">
                      {community.node_ids
                        .map((id) => nodeById.get(id)?.label ?? id)
                        .join(", ")}
                    </td>
                    <td className="px-4 py-2">{formatKes(community.total_leakage_kes)}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${riskBadgeClass(community.risk_level)}`}>
                        {community.risk_level}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
