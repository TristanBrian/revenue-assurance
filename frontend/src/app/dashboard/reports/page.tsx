import { redirect } from "next/navigation";

/** Superseded by /dashboard/[direction]/reports. */
export default function ReportsPageRedirect() {
  redirect("/dashboard/inbound/reports");
}
