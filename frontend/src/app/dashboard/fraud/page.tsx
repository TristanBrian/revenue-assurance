"use client";

import FraudGraph from "@/components/FraudGraph";
import RequirePermission from "@/components/RequirePermission";

export default function FraudPage() {
  return (
    <RequirePermission code="view_fraud_graph">
      <FraudGraph />
    </RequirePermission>
  );
}
