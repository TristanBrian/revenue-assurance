import { redirect } from "next/navigation";

/** OMC risk is part of the Oil Leakage Explorer — superseded by
 * /dashboard/[direction]/leakage. */
export default function OmcRiskRedirect() {
  redirect("/dashboard/inbound/leakage");
}
