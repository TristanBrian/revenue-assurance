"use client";

import { useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { anomaliesConfig } from "@/config/direction-config";
import type { WorkspaceDirection } from "@/lib/workspace";
import AnomaliesTable from "@/components/AnomaliesTable";
import RequirePermission from "@/components/RequirePermission";

/**
 * Outbound-only scoped drill-down — /dashboard/inbound/anomalies/[groupId]
 * is not a valid route (inbound has no grouping concept at all); hitting
 * it redirects back to the plain inbound anomalies list.
 */
export default function AnomaliesGroupPage() {
  const { direction, groupId } = useParams<{ direction: WorkspaceDirection; groupId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const by = searchParams.get("by") === "officer" ? "officer" : "pillar";

  useEffect(() => {
    if (direction === "inbound") router.replace("/dashboard/inbound/anomalies");
  }, [direction, router]);

  if (direction === "inbound") return null;

  return (
    <RequirePermission code="view_anomaly_table">
      <AnomaliesTable
        direction="outbound"
        config={anomaliesConfig.outbound}
        scopeParams={by === "officer" ? { officerId: groupId } : { pillarId: groupId }}
        title={`${decodeURIComponent(groupId)} cases`}
        subtitle={`Scoped by ${by === "officer" ? "officer" : "pillar"}`}
      />
    </RequirePermission>
  );
}
