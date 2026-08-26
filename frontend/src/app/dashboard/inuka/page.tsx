import { redirect } from "next/navigation";

/** Superseded by /dashboard/outbound/overview. */
export default function InukaOverviewRedirect() {
  redirect("/dashboard/outbound/overview");
}
