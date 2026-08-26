import { redirect } from "next/navigation";

/** Superseded by /dashboard/[direction]/risk. */
export default function FraudPageRedirect() {
  redirect("/dashboard/inbound/risk");
}
