"use client";

import { useParams } from "next/navigation";
import type { WorkspaceDirection } from "@/lib/workspace";
import FraudGraph from "@/components/FraudGraph";
import InukaRiskIntelligence from "@/components/InukaRiskIntelligence";
import RequirePermission from "@/components/RequirePermission";

export default function RiskPage() {
  const { direction } = useParams<{ direction: WorkspaceDirection }>();
  return (
    <RequirePermission code="view_fraud_graph">
      <div className="max-w-6xl mx-auto">
        {direction === "outbound" ? <InukaRiskIntelligence /> : <FraudGraph direction={direction} />}
      </div>
    </RequirePermission>
  );
}
