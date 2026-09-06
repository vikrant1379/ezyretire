import { ReactNode } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import { cn } from "@workspace/wealthone-design-system/lib/utils";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Badge } from "@workspace/wealthone-design-system/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/wealthone-design-system/components/ui/avatar";
import { ShieldCheck, LogOut, ArrowUpRight, Lock, History } from "lucide-react";
import { adminAppPath } from "@/lib/admin-path";
import { BrandMark } from "@/components/brand-logo";

/**
 * The admin chrome. A visually distinct, secure-feeling frame that stays
 * unmistakably ezyRetire: same serif wordmark, indigo primary, and warm
 * surfaces, but sealed inside a darker indigo command bar so operators always
 * know they are in the operations panel rather than the customer app.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  const displayName = user?.fullName || user?.email || "Administrator";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="min-h-[100dvh] bg-background text-foreground font-sans flex flex-col">
      <header className="sticky top-0 z-30 bg-primary text-primary-foreground border-b border-primary shadow-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-foreground ring-1 ring-primary-foreground/20">
              <BrandMark className="h-7 w-7" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-serif text-lg font-semibold italic tracking-tight">
                  ezyRetire
                </span>
                <Badge
                  variant="outline"
                  className="border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground text-[10px] uppercase tracking-wider"
                >
                  Admin
                </Badge>
              </div>
              <p className="hidden text-[11px] text-primary-foreground/70 sm:block">
                Operations panel
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <a href={adminAppPath("/admin/login-activity")}>
                <History className="mr-1.5 h-4 w-4" />
                <span className="hidden md:inline">Login activity</span>
              </a>
            </Button>
            <div className="hidden items-center gap-2.5 rounded-full bg-primary-foreground/10 py-1 pl-1 pr-3 ring-1 ring-primary-foreground/15 sm:flex">
              <Avatar className="h-7 w-7">
                {user?.profileImageUrl ? (
                  <AvatarImage src={user.profileImageUrl} alt={displayName} />
                ) : null}
                <AvatarFallback className="bg-secondary text-secondary-foreground text-xs font-semibold">
                  {initial}
                </AvatarFallback>
              </Avatar>
              <div className="max-w-[9rem] truncate text-xs">
                <p className="truncate font-medium leading-tight">{displayName}</p>
                <p className="flex items-center gap-1 text-[10px] text-primary-foreground/70 leading-tight">
                  <Lock className="h-2.5 w-2.5" /> Verified admin
                </p>
              </div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              asChild
              className="text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground"
              data-testid="link-exit-admin"
            >
              <a href={adminAppPath("/")}>
                Exit to app
                <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
              </a>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              aria-label="Sign out"
              title="Sign out"
              className="text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground"
              data-testid="button-admin-signout"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">{children}</div>
      </main>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-1 px-4 py-4 text-xs text-muted-foreground md:flex-row md:px-8">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            ezyRetire Admin &middot; Restricted access
          </span>
          <span>&copy; {new Date().getFullYear()} ezyRetire</span>
        </div>
      </footer>
    </div>
  );
}

/** Consistent page-header block for admin surfaces. */
export function AdminPageHeader({
  title,
  description,
  icon: Icon,
  actions,
  className,
}: {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-center md:justify-between",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {Icon ? (
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </div>
        ) : null}
        <div>
          <h1 className="font-serif text-2xl text-foreground md:text-3xl">{title}</h1>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
