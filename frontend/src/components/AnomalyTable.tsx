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
      return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
    case "Review Required":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
    default:
      return "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300";
  }
}

export default function AnomalyTable({ anomalies }: { anomalies: Anomaly[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("leakage_kes");
  const [sortDesc, setSortDesc] = useState(true);

  const sorted = useMemo(() => {
    const copy = [...anomalies];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "number" && typeof bv === "number"
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
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No anomalies at or above the current materiality threshold.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
          <tr>
            <th className="px-4 py-2 font-medium text-zinc-500 dark:text-zinc-400">
              Dispatch ID
            </th>
            {columns.map((col) => (
              <th
                key={col.key}
                className="cursor-pointer select-none px-4 py-2 font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                onClick={() => toggleSort(col.key)}
              >
                {col.label}
                {sortKey === col.key ? (sortDesc ? " ↓" : " ↑") : ""}
              </th>
            ))}
            <th className="px-4 py-2 font-medium text-zinc-500 dark:text-zinc-400">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a, i) => (
            <tr
              key={`${a.dispatch_id}-${i}`}
              className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
            >
              <td className="px-4 py-2 font-mono text-xs">{a.dispatch_id}</td>
              <td className="px-4 py-2">{a.customer}</td>
              <td className="px-4 py-2">{a.break_type}</td>
              <td className="px-4 py-2">{formatKes(a.leakage_kes)}</td>
              <td className="px-4 py-2">{a.age_days}</td>
              <td className="px-4 py-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(a.status)}`}
                >
                  {a.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
