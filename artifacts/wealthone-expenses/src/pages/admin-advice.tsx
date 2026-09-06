import { AdminGuard } from "@/components/admin/admin-guard";
import { AdminAdvicePanel } from "@/components/admin/admin-advice-panel";

/**
 * Backwards-compatible alias for /admin/advice. Renders the exact same guarded
 * operations panel as /admin so existing links keep working. The returnRoute
 * is kept as /admin so re-auth lands on the canonical panel path.
 */
export default function AdminAdvice() {
  return (
    <AdminGuard returnRoute="/admin">
      <AdminAdvicePanel />
    </AdminGuard>
  );
}
