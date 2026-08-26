import { redirect } from "next/navigation";

/** Superseded by /dashboard/outbound/anomalies (officer grouping). */
export default function InukaOfficersRedirect() {
  redirect("/dashboard/outbound/anomalies");
}
