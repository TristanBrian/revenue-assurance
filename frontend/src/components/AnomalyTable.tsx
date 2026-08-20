import type { Anomaly } from "@/lib/types";
import { useState } from "react";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

function statusClass(status: string) {
  switch (status) {
    case "Critical":
      return "bg-red-500/10 text-red-500 border border-red-500/20";
    case "Resolved":
      return "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20";
    default:
      return "bg-amber-500/10 text-amber-500 border border-amber-500/20";
  }
}

interface Column {
  key: keyof Anomaly;
  label: string;
}

const columns: Column[] = [
  { key: "customer", label: "Customer OMC" },
  { key: "break_type", label: "Anomaly Type" },
  { key: "leakage_kes", label: "Leakage" },
  { key: "age_days", label: "Age" },
];

interface AnomalyTableProps {
  anomalies: Anomaly[];
  selectedAnomalyId?: string;
  onSelectAnomaly?: (anomaly: Anomaly) => void;
}

export default function AnomalyTable({
  anomalies,
  selectedAnomalyId,
  onSelectAnomaly,
}: AnomalyTableProps) {
  const [sortKey, setSortKey] = useState<keyof Anomaly>("leakage_kes");
  const [sortDesc, setSortDesc] = useState<boolean>(true);

  const sorted = [...anomalies].sort((a, b) => {
    const valA = a[sortKey];
    const valB = b[sortKey];

    if (typeof valA === "number" && typeof valB === "number") {
      return sortDesc ? valB - valA : valA - valB;
    }
    return sortDesc
      ? String(valB).localeCompare(String(valA))
      : String(valA).localeCompare(String(valB));
  });

  function toggleSort(key: keyof Anomaly) {
    if (sortKey === key) {
      setSortDesc(!sortDesc);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  if (anomalies.length === 0) {
    return (
      <div className="bg-zinc-50 dark:bg-zinc-900/30 border border-zinc-200 dark:border-zinc-800 rounded-lg p-8 text-center shadow-sm">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No anomalies match the current filters or materiality threshold.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/40 shadow-sm">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 text-zinc-500 dark:text-zinc-400 font-medium">
          <tr>
            <th className="px-4 py-3 text-xs uppercase tracking-wider font-semibold">
              Dispatch ID
            </th>
            {columns.map((col) => (
              <th
                key={col.key}
                className="cursor-pointer select-none px-4 py-3 text-xs uppercase tracking-wider font-semibold hover:text-zinc-950 dark:hover:text-white transition-colors"
                onClick={() => toggleSort(col.key)}
              >
                <div className="flex items-center gap-1">
                  <span>{col.label}</span>
                  {sortKey === col.key && (
                    <span className="text-indigo-500 dark:text-indigo-400">{sortDesc ? "↓" : "↑"}</span>
                  )}
                </div>
              </th>
            ))}
            <th className="px-4 py-3 text-xs uppercase tracking-wider font-semibold">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-900 text-zinc-700 dark:text-zinc-350">
          {sorted.map((a, i) => {
            const isSelected = selectedAnomalyId === a.dispatch_id;
            return (
              <tr
                key={`${a.dispatch_id}-${i}`}
                onClick={() => onSelectAnomaly?.(a)}
                className={`group cursor-pointer border-zinc-200 dark:border-zinc-900 transition-all duration-150 ${
                  isSelected
                    ? "bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-300"
                    : "hover:bg-zinc-100/60 dark:hover:bg-zinc-900/40"
                }`}
              >
                <td className="px-4 py-3.5 font-mono text-xs font-semibold text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-850 group-hover:dark:text-zinc-200">
                  {a.dispatch_id}
                </td>
                <td className="px-4 py-3.5 font-medium">{a.customer}</td>
                <td className="px-4 py-3.5 text-zinc-550 dark:text-zinc-400">{a.break_type}</td>
                <td className="px-4 py-3.5 font-semibold font-mono text-zinc-900 dark:text-white">
                  {formatKes(a.leakage_kes)}
                </td>
                <td className="px-4 py-3.5 text-zinc-550 dark:text-zinc-400">{a.age_days}</td>
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
