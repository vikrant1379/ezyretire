import { AdminGuard } from "@/components/admin/admin-guard";
import { AdminLoginActivityPanel } from "@/components/admin/admin-login-activity-panel";

export default function AdminLoginActivity() {
  return (
    <AdminGuard returnRoute="/admin/login-activity">
      <AdminLoginActivityPanel />
    </AdminGuard>
  );
}