import EbillingPanel from "@/components/EbillingPanel";
import RequirePermission from "@/components/RequirePermission";

export default function EbillingPage() {
  return (
    <RequirePermission code="manage_ebilling">
      <EbillingPanel />
    </RequirePermission>
  );
}
