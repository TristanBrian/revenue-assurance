import { redirect } from "next/navigation";

/** Superseded by /dashboard/[direction]/leakage. */
export default function HeatmapPageRedirect() {
  redirect("/dashboard/inbound/leakage");
}
