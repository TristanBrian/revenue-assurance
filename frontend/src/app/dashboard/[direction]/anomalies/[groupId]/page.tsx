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

  // groupId comes back from useParams() still percent-encoded (e.g.
  // "Inuka%20Scholarship", not "Inuka Scholarship") — decode once here
  // and reuse everywhere below. Previously only `title` did this; the
  // undecoded value used to leak into scopeParams, which api.ts's
  // getAnomalies() then encodes AGAIN via URLSearchParams.set() —
  // "Inuka%20Scholarship" becomes "Inuka%2520Scholarship" on the wire,
  // matches zero rows server-side, and the case queue always rendered
  // empty for any pillar/officer whose id needs escaping (any name with
  // a space).
  const decodedGroupId = decodeURIComponent(groupId);

  return (
    <RequirePermission code="view_anomaly_table">
      <AnomaliesTable
        direction="outbound"
        config={anomaliesConfig.outbound}
        scopeParams={by === "officer" ? { officerId: decodedGroupId } : { pillarId: decodedGroupId }}
        title={`${decodedGroupId} cases`}
        subtitle={`Scoped by ${by === "officer" ? "officer" : "pillar"}`}
      />
    </RequirePermission>
  );
}
