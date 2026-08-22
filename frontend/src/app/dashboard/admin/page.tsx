import UserManagementTable from "@/components/UserManagementTable";
import RequirePermission from "@/components/RequirePermission";

export default function AdminPage() {
  return (
    <RequirePermission code="manage_users">
      <UserManagementTable />
    </RequirePermission>
  );
}
