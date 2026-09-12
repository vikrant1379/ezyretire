import { useEffect } from "react";
import { adminAppPath } from "@/lib/admin-path";
import { BrandLoader } from "@/components/brand-logo";

/**
 * Backwards-compatible redirect for old admin-login links.
 * Admins now use the same email-code login as every other account.
 */
export default function AdminLogin() {
  useEffect(() => {
    window.location.replace(
      adminAppPath(`/login?returnTo=${encodeURIComponent("/admin")}`),
    );
  }, []);

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3 text-muted-foreground" role="status">
        <BrandLoader className="animate-pulse" />
        <p className="text-sm">Taking you to sign in...</p>
      </div>
    </main>
  );
}
