import { ReactNode, useEffect } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Card, CardContent } from "@workspace/wealthone-design-system/components/ui/card";
import { Skeleton } from "@workspace/wealthone-design-system/components/ui/skeleton";
import { ShieldAlert, ShieldCheck, LogIn, ArrowUpRight } from "lucide-react";
import { adminLoginUrl, adminAppPath } from "@/lib/admin-path";
import { AdminShell } from "./admin-shell";

/**
 * Guards every admin surface.
 *
 * - loading: branded skeleton so the panel never flashes blank.
 * - not signed in: redirect to the dedicated /admin/login entry point.
 * - signed in without admin rights: a clear, on-brand denial with the option to
 *   continue with a different admin account (re-runs the OIDC redirect).
 * - admin: renders children inside the AdminShell.
 */
export function AdminGuard({
  children,
  returnRoute = "/admin",
}: {
  children: ReactNode;
  returnRoute?: string;
}) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const isAdmin = isAuthenticated && user?.isAdmin === true;

  // Not signed in at all: send them to the dedicated admin sign-in screen.
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      window.location.replace(adminAppPath("/admin/login"));
    }
  }, [isLoading, isAuthenticated]);

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <div className="h-14 w-full bg-primary" />
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-10 md:px-8">
          <div className="flex items-center gap-3 border-b border-border pb-6">
            <Skeleton className="h-10 w-10 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  // Redirect in progress.
  if (!isAuthenticated) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
          <span className="text-sm">Redirecting to admin sign-in&hellip;</span>
        </div>
      </div>
    );
  }

  // Signed in, but this account is not an admin.
  if (!isAdmin) {
    const displayName = user?.fullName || user?.email || "your account";

    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-12">
        <Card className="w-full max-w-md overflow-hidden border-border shadow-lg">
          <div className="h-1.5 w-full bg-secondary" />
          <CardContent className="p-6 text-center sm:p-8">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary/15 text-secondary-foreground">
              <ShieldAlert className="h-7 w-7" />
            </div>
            <h1 className="font-serif text-2xl text-foreground">
              This account lacks admin access
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              You are signed in as{" "}
              <span className="font-medium text-foreground">{displayName}</span>, which
              does not have permission to open the ezyRetire operations panel.
            </p>
            <div className="mt-6 flex flex-col gap-2.5">
              <Button asChild data-testid="button-switch-admin-account">
                <a href={adminLoginUrl(returnRoute)}>
                  <LogIn className="mr-2 h-4 w-4" />
                  Continue with a different admin account
                </a>
              </Button>
              <Button variant="ghost" asChild data-testid="link-return-app">
                <a href={adminAppPath("/")}>
                  Return to ezyRetire
                  <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
            <p className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" />
              Access is restricted to verified administrators
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <AdminShell>{children}</AdminShell>;
}
