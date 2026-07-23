import type { OmcRiskProfile as OmcRiskProfileEntry } from "@/lib/types";

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

function riskBadgeClass(risk: OmcRiskProfileEntry["risk_level"]): string {
  switch (risk) {
    case "High":
      return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
    case "Medium":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
    default:
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  }
}

export default function OmcRiskProfile({ profiles }: { profiles: OmcRiskProfileEntry[] }) {
  if (profiles.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">No OMC risk data available.</p>
    );
  }

  const sorted = [...profiles].sort((a, b) => b.leakage_kes - a.leakage_kes);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">OMC Risk Profile</h2>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-2 font-medium text-zinc-500 dark:text-zinc-400">OMC</th>
              <th className="px-4 py-2 font-medium text-zinc-500 dark:text-zinc-400">Leakage</th>
              <th className="px-4 py-2 font-medium text-zinc-500 dark:text-zinc-400">Anomalies</th>
              <th className="px-4 py-2 font-medium text-zinc-500 dark:text-zinc-400">Risk</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.customer} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                <td className="px-4 py-2">{p.customer}</td>
                <td className="px-4 py-2">{formatKes(p.leakage_kes)}</td>
                <td className="px-4 py-2">{p.anomaly_count}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${riskBadgeClass(p.risk_level)}`}>
                    {p.risk_level}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
