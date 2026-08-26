"use client";

import { useEffect } from "react";
import { useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { WorkspaceDirection } from "@/lib/workspace";
import InukaCasesTable from "@/components/InukaCasesTable";
import InukaCaseDetailModal from "@/components/InukaCaseDetailModal";
import RequirePermission from "@/components/RequirePermission";
import type { InukaRiskCase } from "@/lib/types";

/**
 * Outbound-only scoped drill-down — /dashboard/inbound/anomalies/[groupId]
 * is not a valid route (inbound has no grouping concept at all); hitting
 * it redirects back to the plain inbound anomalies list.
 */
export default function AnomaliesGroupPage() {
  const { direction, groupId } = useParams<{ direction: WorkspaceDirection; groupId: string }>();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<InukaRiskCase | null>(null);
  const router = useRouter();
  const by = searchParams.get("by") === "officer" ? "officer" : "pillar";

  useEffect(() => {
    if (direction === "inbound") router.replace("/dashboard/inbound/anomalies");
  }, [direction, router]);

  if (direction === "inbound") return null;

  return (
    <RequirePermission code="view_anomaly_table">
      <InukaCasesTable scopeParams={by === "officer" ? { officerId: groupId } : { pillarId: groupId }} title={`${decodeURIComponent(groupId)} cases`} subtitle={`Scoped by ${by === "officer" ? "officer" : "pillar"}`} onSelect={setSelected} />
      {selected && <InukaCaseDetailModal item={selected} onClose={() => setSelected(null)} />}
    </RequirePermission>
  );
}
