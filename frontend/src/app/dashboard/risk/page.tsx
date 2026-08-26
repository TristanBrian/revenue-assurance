import { redirect } from "next/navigation";

/** Superseded by /dashboard/[direction]/leakage — see the workspace refactor. */
export default function RiskPage() {
  redirect("/dashboard/inbound/leakage");
}
