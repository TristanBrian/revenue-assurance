"use client";

import { useParams } from "next/navigation";
import type { WorkspaceDirection } from "@/lib/workspace";
import EbillingPanel from "@/components/EbillingPanel";
import BeneficiaryList from "@/components/BeneficiaryList";
import RequirePermission from "@/components/RequirePermission";

/**
 * "Extra" nav slot — E-Billing (inbound) / Beneficiaries (outbound). No
 * backend overlap between the two (see the workspace refactor spec) —
 * genuinely two components, chosen at the page level, not one
 * config-driven one.
 */
export default function ExtraPage() {
  const { direction } = useParams<{ direction: WorkspaceDirection }>();
  return (
    <RequirePermission code={direction === "inbound" ? "manage_ebilling" : "view_anomaly_table"}>
      {direction === "inbound" ? <EbillingPanel /> : <BeneficiaryList />}
    </RequirePermission>
  );
}
