import { createContext, Dispatch, ReactNode, SetStateAction, useContext, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@workspace/wealthone-design-system/lib/utils";
import { LayoutDashboard, Receipt, TrendingUp, Wallet, Briefcase, PiggyBank, Landmark, MoreHorizontal, User, Settings, MessageSquareHeart, LogIn, Calculator, CircleHelp, ShieldCheck, Target, CalendarDays, Bell, FileLock2 } from "lucide-react";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/wealthone-design-system/components/ui/popover";
import { useProfileInputs } from "@/hooks/use-retirement";
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/wealthone-design-system/components/ui/avatar";
import { useAuth } from "@workspace/replit-auth-web";
import { WhatsAppSupport } from "@/components/whatsapp-support";
import { BrandLogo } from "@/components/brand-logo";
import { preloadRoute } from "@/lib/route-preload";

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/income", label: "Income", icon: Wallet },
  { path: "/transactions", label: "Expenses", icon: Receipt },
  { path: "/loans", label: "Loans / EMI", icon: Landmark },
  { path: "/investments", label: "Investments", icon: PiggyBank },
  { path: "/tax", label: "Tax", icon: Calculator },
  { path: "/goals", label: "Goals", icon: Target },
  { path: "/retirement", label: "Retirement", icon: Briefcase },
  { path: "/financial-health", label: "Financial Health", icon: ShieldCheck },
  { path: "/planner", label: "Planner", icon: CalendarDays },
  { path: "/protection", label: "Protection", icon: FileLock2 },
  { path: "/trends", label: "Trends", icon: TrendingUp },
  { path: "/advice", label: "Advice", icon: MessageSquareHeart },
  { path: "/profile", label: "Profile", icon: User },
  { path: "/settings", label: "Settings", icon: Settings },
  { path: "/about", label: "About", icon: CircleHelp },
  { path: "/decision-tools", label: "Decision Tools", icon: Calculator },
];

const adminNavItem = { path: "/admin", label: "Admin", icon: ShieldCheck };

const mobileRouteHeadingPaths = new Set([
  "/income",
  "/transactions",
  "/budgets",
  "/investments",
  "/loans",
  "/tax",
  "/goals",
  "/retirement",
  "/financial-health",
  "/planner",
  "/protection",
  "/trends",
  "/profile",
  "/settings",
  "/decision-tools",
]);

const PageLoadingContext = createContext<Dispatch<SetStateAction<boolean>> | null>(null);

export function usePageLoadingState() {
  const setPageLoading = useContext(PageLoadingContext);
  if (!setPageLoading) {
    throw new Error("usePageLoadingState must be used within Layout");
  }
  return setPageLoading;
}

export function Layout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [isMobileMoreOpen, setIsMobileMoreOpen] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(location === "/retirement");
  const [isMobileHeaderVisible, setIsMobileHeaderVisible] = useState(true);
  const pageScrollContainerRef = useRef<HTMLDivElement>(null);
  const lastMobileScrollTopRef = useRef(0);
  const { data: profile } = useProfileInputs();
  const { user, isAuthenticated, isLoading: authLoading, login } = useAuth();

  const desktopPrimaryItems = navItems.slice(0, 3);
  const desktopPlanningItems = user?.isAdmin === true
    ? [...navItems.slice(3), adminNavItem]
    : navItems.slice(3);
  const mobileDashboardItem = navItems[0];
  const mobileInvestmentItem = navItems[4];
  const mobileRetirementItem = navItems[7];
  const mobileOptionalItems = [
    { ...navItems[1], visibility: "hidden sm:flex" },
    { ...navItems[5], visibility: "hidden md:flex" },
    { ...navItems[8], visibility: "hidden md:flex" }, // Financial Health
  ];
  const mobileMoreItems = [
    { ...navItems[1], visibility: "flex sm:hidden" },
    { ...navItems[3], visibility: "flex" },
    { ...navItems[5], visibility: "flex md:hidden" },
    { ...navItems[6], visibility: "flex" }, // Goals
    { ...navItems[8], visibility: "flex md:hidden" }, // Financial Health
    ...navItems.slice(9).map((item) => ({ ...item, visibility: "flex" })), // Planner onwards
    ...(user?.isAdmin === true ? [{ ...adminNavItem, visibility: "flex" }] : []),
  ];
  const pathname = location.split("?")[0];
  const normalizedNavPath = pathname === "/dashboard"
    ? "/"
    : pathname === "/budgets"
      ? "/transactions"
      : pathname;
  const currentNavItem = navItems.find((item) => item.path === normalizedNavPath)
    ?? (pathname === "/advisor"
      ? { path: "/advisor", label: "Advisor", icon: MessageSquareHeart }
      : { path: pathname, label: "ezyRetire", icon: LayoutDashboard });
  const hidesDuplicateMobileHeading = mobileRouteHeadingPaths.has(pathname);
  const isExpenseRoute = pathname === "/transactions" || pathname === "/budgets";
  const isImmersiveMobileRoute = pathname === "/retirement";
  const isProfileRoute = pathname === "/profile";
  const isNavItemActive = (path: string) =>
    path === "/transactions" ? isExpenseRoute : pathname === path;
  const displayName = profile?.fullName || user?.email || "ezyRetire account";
  const initial = displayName.charAt(0).toUpperCase();

  useEffect(() => {
    setIsPageLoading(location === "/retirement");
    setIsMobileHeaderVisible(true);
    lastMobileScrollTopRef.current = 0;
    pageScrollContainerRef.current?.scrollTo({ top: 0 });
  }, [location]);

  const handlePageScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = Math.max(0, event.currentTarget.scrollTop);
    const scrollDelta = scrollTop - lastMobileScrollTopRef.current;

    if (scrollTop <= 8) {
      setIsMobileHeaderVisible(true);
      lastMobileScrollTopRef.current = scrollTop;
      return;
    }

    if (scrollDelta >= 10 && scrollTop > 56) {
      setIsMobileHeaderVisible(false);
      lastMobileScrollTopRef.current = scrollTop;
    } else if (scrollDelta <= -10) {
      setIsMobileHeaderVisible(true);
      lastMobileScrollTopRef.current = scrollTop;
    }
  };

  return (
    <div className="flex h-[100dvh] bg-background text-foreground overflow-hidden font-sans">
      {/* Desktop Sidebar */}
      <aside
        className="group/desktop-sidebar relative z-20 hidden h-full w-20 shrink-0 xl:block"
        data-testid="desktop-sidebar"
      >
        <div
          className="absolute inset-y-0 left-0 flex w-20 flex-col overflow-hidden bg-background p-3 transition-[width] duration-200 ease-out group-hover/desktop-sidebar:w-60 group-focus-within/desktop-sidebar:w-60"
          data-testid="desktop-sidebar-panel"
        >
        <div className="mb-6 h-10" aria-hidden="true" />
        <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden">
          {desktopPrimaryItems.map((item) => {
            const isActive = isNavItemActive(item.path);
            const Icon = item.icon;
            return (
              <Link key={item.path} href={item.path}>
                <div
                   onPointerEnter={() => void preloadRoute(item.path)}
                   onFocus={() => void preloadRoute(item.path)}
                  data-testid={`link-desktop-nav-${item.label.toLowerCase()}`}
                  title={item.label}
                  className={cn(
                    "flex h-11 items-center gap-3 rounded-lg border-l-2 px-3 transition-colors cursor-pointer",
                    isActive
                      ? "border-primary bg-muted text-primary"
                      : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" strokeWidth={isActive ? 2.5 : 2} />
                  <span className="min-w-0 flex-1 translate-x-1 truncate whitespace-nowrap text-sm font-medium opacity-0 transition-[opacity,transform] duration-150 group-hover/desktop-sidebar:translate-x-0 group-hover/desktop-sidebar:opacity-100 group-focus-within/desktop-sidebar:translate-x-0 group-focus-within/desktop-sidebar:opacity-100">
                    {item.label}
                  </span>
                </div>
              </Link>
            );
          })}
          <div className="pt-2">
            {desktopPlanningItems.map((item) => {
              const isActive = isNavItemActive(item.path);
              const Icon = item.icon;
              return (
                <Link key={item.path} href={item.path}>
                  <div
                    onPointerEnter={() => void preloadRoute(item.path)}
                    onFocus={() => void preloadRoute(item.path)}
                    data-testid={`link-desktop-nav-${item.label.toLowerCase()}`}
                    title={item.label}
                    className={cn(
                    "flex h-11 cursor-pointer items-center gap-3 rounded-lg border-l-2 px-3 transition-colors",
                      isActive
                        ? "border-primary bg-muted text-primary"
                        : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon className="h-5 w-5 shrink-0" strokeWidth={isActive ? 2.5 : 2} />
                    <span className="min-w-0 flex-1 translate-x-1 truncate whitespace-nowrap text-sm font-medium opacity-0 transition-[opacity,transform] duration-150 group-hover/desktop-sidebar:translate-x-0 group-hover/desktop-sidebar:opacity-100 group-focus-within/desktop-sidebar:translate-x-0 group-focus-within/desktop-sidebar:opacity-100">
                      {item.label}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </nav>
        <div className="mt-6 border-t border-border pt-6 flex flex-col items-center">
          {!authLoading && isAuthenticated && (
            <WhatsAppSupport compact />
          )}
          {!authLoading && !isAuthenticated && (
            <Button
              variant="ghost"
              className="mb-2 flex h-10 w-full justify-start gap-3 overflow-hidden px-3 text-muted-foreground"
              onClick={login}
              aria-label="Log in"
              title="Log in"
            >
              <LogIn className="h-4 w-4 shrink-0" />
              <span className="translate-x-1 whitespace-nowrap text-sm font-medium opacity-0 transition-[opacity,transform] duration-150 group-hover/desktop-sidebar:translate-x-0 group-hover/desktop-sidebar:opacity-100 group-focus-within/desktop-sidebar:translate-x-0 group-focus-within/desktop-sidebar:opacity-100">
                Log in
              </span>
            </Button>
          )}
        </div>
        </div>
      </aside>

      <div
        className="pointer-events-none fixed left-6 top-4 z-30 hidden h-9 items-center justify-start xl:flex"
        data-testid="desktop-sidebar-logo"
      >
        <BrandLogo compact className="h-auto w-20 max-h-9 min-[1360px]:h-9 min-[1360px]:w-auto" />
      </div>

      {/* Main Content */}
      <main className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div
          className={cn(
            "relative z-10 flex shrink-0 items-end justify-between overflow-hidden bg-card pl-[calc(1rem+var(--app-safe-left))] pr-[calc(1rem+var(--app-safe-right))] pt-[var(--app-safe-top)] transition-[height,transform,opacity,border-color] duration-200 ease-out xl:hidden",
            isMobileHeaderVisible
              ? "h-[calc(3.5rem+var(--app-safe-top))] translate-y-0 border-b border-border opacity-100 shadow-sm"
              : "pointer-events-none h-0 -translate-y-full border-0 opacity-0",
          )}
          data-testid="mobile-header"
          data-scroll-state={isMobileHeaderVisible ? "visible" : "hidden"}
          inert={!isMobileHeaderVisible}
        >
          <div className="flex min-w-0 items-center gap-2">
            {isImmersiveMobileRoute && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="-ml-1 h-10 w-8 rounded-lg p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setLocation("/")}
                  aria-label="Back to dashboard"
                >
                  <span className="-translate-y-px font-sans text-[28px] font-light leading-none" aria-hidden="true">‹</span>
                </Button>
                <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
              </>
            )}
            <p
              className="flex h-10 min-w-0 items-center truncate font-serif text-base font-semibold leading-none text-foreground"
              data-testid="mobile-page-title"
            >
              {currentNavItem.label}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {!isProfileRoute && !authLoading && isAuthenticated && (
              <Link href="/planner?tab=notifications" className="relative flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
                <Bell className="h-5 w-5" />
                <span className="sr-only">Notifications</span>
              </Link>
            )}
            {!isProfileRoute && !authLoading && isAuthenticated && (
              <Link
                href="/profile"
                className="flex h-11 w-11 items-center justify-center rounded-full"
                aria-label="Profile"
              >
                <Avatar
                  className={cn(
                    "h-9 w-9 cursor-pointer border border-border transition-shadow hover:shadow-sm",
                    (pathname === "/profile" || pathname === "/settings") && "ring-2 ring-primary ring-offset-2 ring-offset-card",
                  )}
                  title="Profile"
                >
                  {user?.profileImageUrl && (
                    <AvatarImage src={user.profileImageUrl} alt={displayName} />
                  )}
                  <AvatarFallback className="bg-muted font-sans font-semibold text-foreground">
                    {initial}
                  </AvatarFallback>
                </Avatar>
              </Link>
            )}
            {!isProfileRoute && !authLoading && !isAuthenticated && (
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground"
                onClick={login}
                aria-label="Log in"
                title="Log in"
              >
                <LogIn className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        
        <div
          ref={pageScrollContainerRef}
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
          data-testid="page-scroll-container"
          onScroll={handlePageScroll}
        >
          <div
            className={cn(
              "container mx-auto max-w-6xl pl-[calc(1rem+var(--app-safe-left))] pr-[calc(1rem+var(--app-safe-right))] pt-6 md:pl-[calc(2rem+var(--app-safe-left))] md:pr-[calc(2rem+var(--app-safe-right))] md:pt-8 xl:px-8 xl:pb-8",
              isImmersiveMobileRoute
                ? "pb-[calc(1.5rem+var(--app-safe-bottom))]"
                : "pb-[calc(6rem+var(--app-safe-bottom))]",
            )}
            data-testid="page-content"
            data-hide-mobile-route-heading={hidesDuplicateMobileHeading ? "true" : undefined}
          >
            <PageLoadingContext.Provider value={setIsPageLoading}>
              {children}
            </PageLoadingContext.Provider>
          </div>
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      {!isImmersiveMobileRoute && (
      <nav
        className="fixed bottom-0 left-0 right-0 z-20 grid h-[calc(4rem+var(--app-safe-bottom))] grid-cols-5 items-stretch border-t border-border bg-card pl-[calc(0.25rem+var(--app-safe-left))] pr-[calc(0.25rem+var(--app-safe-right))] pb-[var(--app-safe-bottom)] shadow-[0_-4px_16px_rgba(0,0,0,0.02)] sm:grid-cols-6 md:grid-cols-8 xl:hidden"
        data-testid="mobile-bottom-navigation"
      >
        {[mobileDashboardItem, mobileInvestmentItem].map((item) => {
          const isActive = location === item.path;
          const Icon = item.icon;
          return (
            <Link key={item.path} href={item.path}>
              <div
                className={cn(
                  "relative flex h-full w-full cursor-pointer flex-col items-center justify-center space-y-1 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent",
                  isActive ? "font-semibold text-foreground after:bg-primary" : "text-muted-foreground"
                )}
              >
                <Icon
                  className="h-5 w-5"
                  strokeWidth={isActive ? 2.5 : 2}
                  absoluteStrokeWidth
                />
                <span className={cn("text-tiny font-medium leading-4", isActive && "font-semibold")}>
                  {item.label}
                </span>
              </div>
            </Link>
          );
        })}

        <Link href="/transactions">
          <div
            data-testid="button-mobile-nav-expenses"
            className={cn(
            "relative flex h-full w-full cursor-pointer flex-col items-center justify-center space-y-1 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent",
            isExpenseRoute ? "font-semibold text-foreground after:bg-primary" : "text-muted-foreground",
          )}>
            <Receipt className="h-5 w-5" strokeWidth={isExpenseRoute ? 2.5 : 2} absoluteStrokeWidth />
            <span className={cn("text-tiny font-medium leading-4", isExpenseRoute && "font-semibold")}>Expenses</span>
          </div>
        </Link>

        <Link href={mobileRetirementItem.path}>
          <div
            className={cn(
              "relative flex h-full w-full cursor-pointer flex-col items-center justify-center space-y-1 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent",
              location === mobileRetirementItem.path ? "font-semibold text-foreground after:bg-primary" : "text-muted-foreground",
            )}
          >
            <mobileRetirementItem.icon
              className="h-5 w-5"
              strokeWidth={location === mobileRetirementItem.path ? 2.5 : 2}
              absoluteStrokeWidth
            />
            <span className={cn("text-tiny font-medium leading-4", location === mobileRetirementItem.path && "font-semibold")}>
              Retirement
            </span>
          </div>
        </Link>

        {mobileOptionalItems.map((item) => {
          const isActive = location === item.path;
          const Icon = item.icon;
          return (
            <Link key={item.path} href={item.path} className={item.visibility}>
              <div className={cn(
                "relative h-full w-full cursor-pointer flex-col items-center justify-center space-y-1 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent",
                item.visibility,
                isActive ? "font-semibold text-foreground after:bg-primary" : "text-muted-foreground",
              )}>
                <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} absoluteStrokeWidth />
                <span className={cn("text-tiny font-medium leading-4", isActive && "font-semibold")}>
                  {item.label}
                </span>
              </div>
            </Link>
          );
        })}
        
        <Popover open={isMobileMoreOpen} onOpenChange={setIsMobileMoreOpen}>
          <PopoverTrigger asChild>
            <div
              data-testid="button-mobile-nav-more"
              className={cn(
              "relative flex h-full w-full cursor-pointer flex-col items-center justify-center space-y-1 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent",
               mobileMoreItems.some(i => i.path === location) ? "font-semibold text-foreground after:bg-primary" : "text-muted-foreground"
            )}>
              <MoreHorizontal className="h-5 w-5" strokeWidth={2} absoluteStrokeWidth />
              <span className="text-tiny font-medium leading-4">More</span>
            </div>
          </PopoverTrigger>
          <PopoverContent
            sideOffset={16}
            align="end"
            collisionPadding={{
              top: 8,
              right: 8,
              bottom: 8,
              left: 8,
            }}
            data-testid="mobile-more-menu"
            className="z-[100] max-h-[calc(100dvh-6rem-var(--app-safe-top)-var(--app-safe-bottom))] w-48 overflow-y-auto overscroll-contain rounded-xl border-border/50 bg-card/95 p-2 shadow-xl backdrop-blur-md"
          >
            <div className="flex flex-col space-y-1">
              {mobileMoreItems.map((item) => {
                const isActive = location === item.path;
                const Icon = item.icon;
                return (
                  <Link key={item.path} href={item.path} onClick={() => setIsMobileMoreOpen(false)}>
                    <div
                      data-testid={`link-mobile-nav-${item.label.toLowerCase()}`}
                      className={cn(
                      "min-h-12 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
                      item.visibility || "flex",
                      isActive ? "border-l-2 border-primary bg-muted text-primary" : "border-l-2 border-transparent text-foreground hover:bg-muted"
                    )}>
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </div>
                  </Link>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </nav>
      )}
    </div>
  );
}
