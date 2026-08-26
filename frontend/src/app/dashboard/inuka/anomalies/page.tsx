import { redirect } from "next/navigation";

/** Superseded by /dashboard/outbound/anomalies. */
export default function InukaAnomaliesRedirect() {
  redirect("/dashboard/outbound/anomalies");
}
