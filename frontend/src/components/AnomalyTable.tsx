"use client";

import { useMemo, useState } from "react";
import type { Anomaly } from "@/lib/types";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

type SortKey = "leakage_kes" | "age_days" | "customer" | "break_type";

const columns: { key: SortKey; label: string }[] = [
  { key: "customer", label: "Customer" },
  { key: "break_type", label: "Break Type" },
  { key: "leakage_kes", label: "Leakage" },
  { key: "age_days", label: "Age (days)" },
];

function statusClass(status: Anomaly["status"]): string {
  switch (status) {
    case "Critical":
      return "bg-rose-500/10 text-rose-400 border border-rose-500/20";
    case "Review Required":
      return "bg-amber-500/10 text-amber-400 border border-amber-500/20";
    default:
      return "bg-zinc-800 text-zinc-300 border border-zinc-700/50";
  }
}

interface AnomalyTableProps {
  anomalies: Anomaly[];
  onSelectAnomaly?: (anomaly: Anomaly) => void;
  selectedAnomalyId?: string | null;
}

export default function AnomalyTable({
  anomalies,
  onSelectAnomaly,
  selectedAnomalyId,
}: AnomalyTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("leakage_kes");
  const [sortDesc, setSortDesc] = useState(true);

  const sorted = useMemo(() => {
    const copy = [...anomalies];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDesc ? -cmp : cmp;
    });
    return copy;
  }, [anomalies, sortKey, sortDesc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  if (anomalies.length === 0) {
    return (
      <div className="bg-zinc-900/30 border border-zinc-800 rounded-lg p-8 text-center">
        <p className="text-sm text-zinc-500">
          No anomalies match the current filters or materiality threshold.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/40">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-zinc-800 bg-zinc-900/60 text-zinc-400 font-medium">
          <tr>
            <th className="px-4 py-3 text-xs uppercase tracking-wider font-semibold">
              Dispatch ID
            </th>
            {columns.map((col) => (
              <th
                key={col.key}
                className="cursor-pointer select-none px-4 py-3 text-xs uppercase tracking-wider font-semibold hover:text-white transition-colors"
                onClick={() => toggleSort(col.key)}
              >
                <div className="flex items-center gap-1">
                  <span>{col.label}</span>
                  {sortKey === col.key && (
                    <span className="text-indigo-400">{sortDesc ? "↓" : "↑"}</span>
                  )}
                </div>
              </th>
            ))}
            <th className="px-4 py-3 text-xs uppercase tracking-wider font-semibold">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-900 text-zinc-300">
          {sorted.map((a, i) => {
            const isSelected = selectedAnomalyId === a.dispatch_id;
            return (
              <tr
                key={`${a.dispatch_id}-${i}`}
                onClick={() => onSelectAnomaly?.(a)}
                className={`group cursor-pointer border-zinc-900 transition-all duration-150 ${
                  isSelected
                    ? "bg-indigo-950/20 text-indigo-300"
                    : "hover:bg-zinc-900/40"
                }`}
              >
                <td className="px-4 py-3.5 font-mono text-xs font-semibold text-zinc-400 group-hover:text-zinc-200">
                  {a.dispatch_id}
                </td>
                <td className="px-4 py-3.5 font-medium">{a.customer}</td>
                <td className="px-4 py-3.5 text-zinc-400">{a.break_type}</td>
                <td className="px-4 py-3.5 font-semibold font-mono text-white">
                  {formatKes(a.leakage_kes)}
                </td>
                <td className="px-4 py-3.5 text-zinc-400">{a.age_days}</td>
                <td className="px-4 py-3.5">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${statusClass(a.status)}`}
                  >
                    {a.status}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
