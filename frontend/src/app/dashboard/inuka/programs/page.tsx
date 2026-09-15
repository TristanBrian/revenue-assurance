import { redirect } from "next/navigation";

/** Retired while the Inuka workspace is disabled for the Oil-only release. */
export default function RetiredInukaRoute() {
  redirect("/dashboard/inbound/anomalies");
}
