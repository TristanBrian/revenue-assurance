import { redirect } from "next/navigation";

/** OMC risk is now part of the Oil Leakage Explorer. */
export default function OmcRiskRedirect() {
  redirect("/dashboard/heatmap");
}
