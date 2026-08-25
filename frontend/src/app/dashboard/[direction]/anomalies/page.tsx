"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { anomaliesConfig } from "@/config/direction-config";
import type { WorkspaceDirection } from "@/lib/workspace";
import AnomaliesTable from "@/components/AnomaliesTable";
import InukaCasesTable from "@/components/InukaCasesTable";
import InukaCaseDetailModal from "@/components/InukaCaseDetailModal";
import RequirePermission from "@/components/RequirePermission";
import type { InukaRiskCase } from "@/lib/types";

export default function AnomaliesPage() {
  const { direction } = useParams<{ direction: WorkspaceDirection }>();
  const [selected, setSelected] = useState<InukaRiskCase | null>(null);

  return (
    <RequirePermission code="view_anomaly_table">
      {direction === "inbound" ? (
        <AnomaliesTable direction="inbound" config={anomaliesConfig.inbound} />
      ) : (
        <><InukaCasesTable title="Inuka assurance cases" subtitle="One case per payment subject, with every supporting control signal grouped for investigation." onSelect={setSelected} />
          {selected && <InukaCaseDetailModal item={selected} onClose={() => setSelected(null)} />}</>
      )}
    </RequirePermission>
  );
}
