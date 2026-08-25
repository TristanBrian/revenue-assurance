import { redirect } from "next/navigation";

/** Superseded by /dashboard/[direction]/anomalies. */
export default function AnomaliesRedirect() {
  redirect("/dashboard/inbound/anomalies");
}
