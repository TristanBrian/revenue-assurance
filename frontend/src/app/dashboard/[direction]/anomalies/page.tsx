"use client";

import { useParams } from "next/navigation";
import { anomaliesConfig } from "@/config/direction-config";
import type { WorkspaceDirection } from "@/lib/workspace";
import AnomaliesTable from "@/components/AnomaliesTable";
import RequirePermission from "@/components/RequirePermission";

export default function AnomaliesPage() {
  const { direction } = useParams<{ direction: WorkspaceDirection }>();

  return (
    <RequirePermission code="view_anomaly_table">
      {direction === "inbound" ? (
        <AnomaliesTable direction="inbound" config={anomaliesConfig.inbound} />
      ) : (
        <AnomaliesTable
          direction="outbound"
          config={anomaliesConfig.outbound}
          title="Inuka assurance cases"
          subtitle="Review individual beneficiaries, officers, and stipend exceptions."
        />
      )}
    </RequirePermission>
  );
}
