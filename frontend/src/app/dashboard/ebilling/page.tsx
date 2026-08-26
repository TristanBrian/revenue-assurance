import { redirect } from "next/navigation";

/** Superseded by /dashboard/[direction]/extra (inbound). */
export default function EbillingPageRedirect() {
  redirect("/dashboard/inbound/extra");
}
