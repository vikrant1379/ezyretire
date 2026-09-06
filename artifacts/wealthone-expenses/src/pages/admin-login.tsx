import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Card, CardContent } from "@workspace/wealthone-design-system/components/ui/card";
import { Badge } from "@workspace/wealthone-design-system/components/ui/badge";
import { Skeleton } from "@workspace/wealthone-design-system/components/ui/skeleton";
import {
  ShieldCheck,
  Lock,
  ArrowRight,
  ArrowUpRight,
  KeyRound,
  Users,
  ListOrdered,
  Settings,
} from "lucide-react";
import { adminLoginUrl, adminAppPath } from "@/lib/admin-path";
import Login from "@/pages/login";
import { BrandMark } from "@/components/brand-logo";

/**
 * Dedicated admin sign-in entry point.
 *
 * - authenticated admins are sent straight to /admin.
 * - signed-in non-admins are clearly told the account lacks access and can
 *   continue with a different admin account.
 * - everyone else sees the branded sign-in call to action, which navigates to
 *   the server OIDC redirect at /api/admin/login.
 */
export default function AdminLogin() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const isAdmin = isAuthenticated && user?.isAdmin === true;
  const wasDenied = new URLSearchParams(window.location.search).get("error") === "not-authorized";

  useEffect(() => {
    if (!isLoading && isAdmin) {
      setLocation("/admin");
    }
  }, [isLoading, isAdmin, setLocation]);

  const displayName =
    user?.fullName || user?.email ||
    "your account";

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-background md:flex-row">
      {/* Brand / assurance panel */}
      <aside className="relative flex flex-col justify-between overflow-hidden bg-primary px-6 py-10 text-primary-foreground md:w-1/2 md:px-12 md:py-14">
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          aria-hidden="true"
          style={{
            backgroundImage:
              "radial-gradient(60rem 30rem at 80% -10%, hsl(var(--secondary) / 0.35), transparent 60%)",
          }}
        />
        <div className="relative flex items-center gap-3">
          <BrandMark className="h-10 w-10" decorative />
          <span className="font-serif text-xl font-semibold italic tracking-tight">
            ezyRetire
          </span>
          <Badge
            variant="outline"
            className="border-primary-foreground/30 bg-primary-foreground/10 text-[10px] uppercase tracking-wider text-primary-foreground"
          >
            Admin
          </Badge>
        </div>

        <div className="relative my-10 max-w-md">
          <h1 className="font-serif text-3xl leading-tight text-primary-foreground md:text-4xl">
            Operations panel
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-primary-foreground/80">
            Secure, staff-only access to consultation requests, advisor profiles,
            and service settings. Sign in with an administrator account to
            continue.
          </p>

          <ul className="mt-8 space-y-3 text-sm">
            {[
              { icon: ListOrdered, text: "Review and route consultation requests" },
              { icon: Users, text: "Manage advisor profiles and assignments" },
              { icon: Settings, text: "Configure fees and payment settings" },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-foreground/10 ring-1 ring-primary-foreground/15">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-primary-foreground/85">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative flex items-center gap-1.5 text-xs text-primary-foreground/70">
          <Lock className="h-3 w-3" />
          Encrypted, single sign-on authentication
        </p>
      </aside>

      {/* Sign-in panel */}
      <section className="flex flex-1 items-center justify-center px-6 py-10 md:px-12">
        <Card className="w-full max-w-md border-border shadow-lg">
          <CardContent className="p-6 sm:p-8">
            {isLoading ? (
              <div className="space-y-5">
                <Skeleton className="h-12 w-12 rounded-2xl" />
                <div className="space-y-2">
                  <Skeleton className="h-6 w-40" />
                  <Skeleton className="h-4 w-64" />
                </div>
                <Skeleton className="h-11 w-full rounded-md" />
              </div>
            ) : isAdmin ? (
              <div className="space-y-5 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="font-serif text-xl text-foreground">
                    You&rsquo;re signed in
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Taking you to the operations panel&hellip;
                  </p>
                </div>
                <Button
                  className="w-full"
                  onClick={() => setLocation("/admin")}
                  data-testid="button-go-to-admin"
                >
                  Go to admin panel
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            ) : isAuthenticated ? (
              // Signed in, but not an admin.
              <div className="space-y-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary/15 text-secondary-foreground">
                  <KeyRound className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="font-serif text-xl text-foreground">
                    This account lacks admin access
                  </h2>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    You are signed in as{" "}
                    <span className="font-medium text-foreground">{displayName}</span>.
                    That account can&rsquo;t open the admin panel. Continue with an
                    administrator account instead.
                  </p>
                </div>
                <div className="space-y-2.5">
                  <Button asChild className="w-full" data-testid="button-admin-signin">
                    <a href={adminLoginUrl("/admin")}>
                      Continue with a different admin account
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    asChild
                    className="w-full text-muted-foreground"
                    data-testid="link-back-to-app"
                  >
                    <a href={adminAppPath("/")}>
                      Return to ezyRetire
                      <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
                    </a>
                  </Button>
                </div>
              </div>
            ) : (
              // Not signed in.
              <Login adminOnly />
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
