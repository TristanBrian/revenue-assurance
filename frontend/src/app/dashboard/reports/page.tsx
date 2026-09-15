import { redirect } from "next/navigation";

/**
 * Legacy report entry point. The active report experience is scoped to the
 * Oil Revenue Assurance workspace; retain this URL only as a compatibility
 * redirect so the retired dual-domain UI cannot be opened directly.
 */
export default function LegacyReportsPage() {
  redirect("/dashboard/inbound/reports");
}
