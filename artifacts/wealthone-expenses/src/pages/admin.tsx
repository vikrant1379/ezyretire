import { AdminGuard } from "@/components/admin/admin-guard";
import { AdminAdvicePanel } from "@/components/admin/admin-advice-panel";

/** Guarded admin operations panel at /admin. */
export default function Admin() {
  return (
    <AdminGuard returnRoute="/admin">
      <AdminAdvicePanel />
    </AdminGuard>
  );
}
