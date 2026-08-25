import { redirect } from "next/navigation";

/** Superseded by /dashboard/outbound/anomalies (pillar grouping). */
export default function InukaProgramsRedirect() {
  redirect("/dashboard/outbound/anomalies");
}
