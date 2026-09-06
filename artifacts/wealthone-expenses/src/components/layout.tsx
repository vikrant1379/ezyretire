import { createContext, Dispatch, ReactNode, SetStateAction, UIEvent, useContext, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@workspace/wealthone-design-system/lib/utils";
import { ArrowLeft, LayoutDashboard, Receipt, TrendingUp, Wallet, Briefcase, PiggyBank, Landmark, MoreHorizontal, User, MessageSquareHeart, LogIn, Calculator, CircleHelp } from "lucide-react";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/wealthone-design-system/components/ui/popover";
import { useProfileInputs } from "@/hooks/use-retirement";
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/wealthone-design-system/components/ui/avatar";
import { useAuth } from "@workspace/replit-auth-web";
import { WhatsAppSupport } from "@/components/whatsapp-support";
import { BrandLogo } from "@/components/brand-logo";

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/income", label: "Income", icon: Wallet },
  { path: "/transactions", label: "Expenses", icon: Receipt },
  { path: "/loans", label: "Loans / EMI", icon: Landmark },
  { path: "/investments", label: "Investments", icon: PiggyBank },
  { path: "/tax", label: "Tax", icon: Calculator },
  { path: "/retirement", label: "Retirement", icon: Briefcase },
  { path: "/trends", label: "Trends", icon: TrendingUp },
  { path: "/advice", label: "Advice", icon: MessageSquareHeart },
  { path: "/profile", label: "Profile", icon: User },
  { path: "/about", label: "About", icon: CircleHelp },
];

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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [isMobileMoreOpen, setIsMobileMoreOpen] = useState(false);
  const [isMobileHeaderVisible, setIsMobileHeaderVisible] = useState(true);
  const [isPageLoading, setIsPageLoading] = useState(location === "/retirement");
  const headerScrollAnchorRef = useRef(0);
  const { data: profile } = useProfileInputs();
  const { user, isAuthenticated, isLoading: authLoading, login } = useAuth();

  const desktopPrimaryItems = navItems.slice(0, 3);
  const desktopPlanningItems = navItems.slice(3);
  const mobileDashboardItem = navItems[0];
  const mobileInvestmentItem = navItems[4];
  const mobileRetirementItem = navItems[6];
  const mobileOptionalItems = [
    { ...navItems[1], visibility: "hidden sm:flex" },
    { ...navItems[5], visibility: "hidden md:flex" },
    { ...navItems[7], visibility: "hidden md:flex" },
  ];
  const mobileMoreItems = [
    { ...navItems[1], visibility: "flex sm:hidden" },
    { ...navItems[3], visibility: "flex" },
    { ...navItems[5], visibility: "flex md:hidden" },
    { ...navItems[7], visibility: "flex md:hidden" },
    ...navItems.slice(8).map((item) => ({ ...item, visibility: "flex" })),
  ];
  const isExpenseRoute = location === "/transactions" || location === "/budgets";
  const isImmersiveMobileRoute = location === "/retirement";
  const isNavItemActive = (path: string) =>
    path === "/transactions" ? isExpenseRoute : location === path;
  const displayName = profile?.fullName || user?.email || "ezyRetire account";
  const initial = displayName.charAt(0).toUpperCase();

  useEffect(() => {
    setIsMobileHeaderVisible(true);
    setIsPageLoading(location === "/retirement");
    headerScrollAnchorRef.current = 0;
  }, [location]);

  const handlePageScroll = (event: UIEvent<HTMLDivElement>) => {
    const scrollTop = event.currentTarget.scrollTop;

    if (scrollTop <= 8) {
      setIsMobileHeaderVisible(true);
      headerScrollAnchorRef.current = scrollTop;
      return;
    }

    const distanceFromAnchor = scrollTop - headerScrollAnchorRef.current;
    if (Math.abs(distanceFromAnchor) < 8) return;

    setIsMobileHeaderVisible(distanceFromAnchor < 0);
    headerScrollAnchorRef.current = scrollTop;
  };

  return (
    <div className="flex h-[100dvh] bg-background text-foreground overflow-hidden font-sans">
      {/* Desktop Sidebar */}
      <aside
        className="relative z-20 hidden h-full w-20 shrink-0 lg:block"
        onMouseEnter={() => setIsSidebarCollapsed(false)}
        onMouseLeave={() => setIsSidebarCollapsed(true)}
      >
        <div className="pointer-events-none absolute left-0 top-3 z-30 flex h-10 w-20 items-center justify-center">
          <BrandLogo className="h-10 max-w-[4.5rem]" />
        </div>

        {/* This icon rail never changes size or position. */}
        <div className={cn(
          "absolute inset-0 flex w-20 flex-col bg-background p-3 transition-opacity duration-150",
          isSidebarCollapsed ? "opacity-100" : "pointer-events-none opacity-0",
        )}>
        <div className="mb-6 h-10" aria-hidden="true" />
        <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden">
          {desktopPrimaryItems.map((item) => {
            const isActive = isNavItemActive(item.path);
            const Icon = item.icon;
            return (
              <Link key={item.path} href={item.path}>
                <div
                  data-testid={`link-desktop-nav-${item.label.toLowerCase()}`}
                  title={item.label}
                  className={cn(
                    "flex h-10 items-center justify-center rounded-lg px-3 transition-colors cursor-pointer",
                    isActive
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
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
                    data-testid={`link-desktop-nav-${item.label.toLowerCase()}`}
                    title={item.label}
                    className={cn(
                      "flex h-10 cursor-pointer items-center justify-center rounded-lg px-3 transition-colors",
                      isActive
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
                  </div>
                </Link>
              );
            })}
          </div>
        </nav>
        <div className="mt-6 border-t border-border pt-6">
          {!authLoading && isAuthenticated && (
            <WhatsAppSupport compact />
          )}
          {!authLoading && !isAuthenticated && (
            <Button
              variant="ghost"
              size="icon"
              className="mb-2 w-full text-muted-foreground"
              onClick={login}
              aria-label="Log in"
              title="Log in"
            >
              <LogIn className="h-4 w-4" />
            </Button>
          )}
        </div>
        </div>

        {/* Unified expanded menu overlays the rail without moving the layout anchor. */}
        <div
          className={cn(
            "absolute inset-y-0 left-0 flex w-52 flex-col bg-background p-3 transition-[opacity,transform] duration-200",
            isSidebarCollapsed
              ? "pointer-events-none -translate-x-2 opacity-0"
              : "translate-x-0 opacity-100",
          )}
          aria-hidden={isSidebarCollapsed}
        >
          <div className="mb-6 h-10" aria-hidden="true" />
          <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden">
            {desktopPrimaryItems.map((item) => {
              const isActive = isNavItemActive(item.path);
              const Icon = item.icon;
              return (
                <Link key={item.path} href={item.path}>
                  <div className={cn(
                    "flex h-10 cursor-pointer items-center gap-3 whitespace-nowrap rounded-lg pl-[18px] pr-3 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}>
                    <Icon className="h-5 w-5 shrink-0" strokeWidth={isActive ? 2.5 : 2} />
                    <span>{item.label}</span>
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
                    <div className={cn(
                      "flex h-10 cursor-pointer items-center gap-3 whitespace-nowrap rounded-lg pl-[18px] pr-3 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}>
                      <Icon className="h-5 w-5 shrink-0" strokeWidth={isActive ? 2.5 : 2} />
                      <span>{item.label}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </nav>
          <div className="mt-6 border-t border-border px-4 pt-6 text-center text-xs font-medium text-muted-foreground">
            ezyRetire © {new Date().getFullYear()}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div
          className={cn(
            "mobile-header-motion absolute inset-x-0 top-0 z-10 flex h-16 items-center justify-between overflow-hidden border-b bg-card px-4 transition-[opacity,transform,border-color,box-shadow] duration-200 ease-out lg:hidden",
            isMobileHeaderVisible
              ? "h-16 translate-y-0 border-border opacity-100 shadow-sm"
              : "pointer-events-none -translate-y-full border-transparent opacity-0 shadow-none",
          )}
          aria-hidden={!isMobileHeaderVisible}
          data-testid="mobile-header"
        >
          <div className="flex items-center">
            {isImmersiveMobileRoute ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="-ml-2 rounded-full text-foreground"
                 onClick={() => setLocation("/")}
                 aria-label="Back to dashboard"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            ) : (
              <BrandLogo />
            )}
          </div>
          <div className="flex items-center gap-1">
            {!authLoading && isAuthenticated && (
              <Link href="/profile">
                <Avatar
                  className={cn(
                    "h-9 w-9 cursor-pointer border border-border transition-shadow hover:shadow-sm",
                    location === "/profile" && "ring-2 ring-primary ring-offset-2 ring-offset-card",
                  )}
                  title="Profile"
                >
                  {user?.profileImageUrl && (
                    <AvatarImage src={user.profileImageUrl} alt={displayName} />
                  )}
                  <AvatarFallback className="bg-primary font-serif font-bold italic text-primary-foreground">
                    {initial}
                  </AvatarFallback>
                </Avatar>
              </Link>
            )}
            {!authLoading && !isAuthenticated && (
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
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-16 lg:pt-0"
          data-testid="page-scroll-container"
          onScroll={handlePageScroll}
        >
          <div
            className={cn(
              "container mx-auto max-w-6xl px-4 pt-4 md:px-8 md:pt-8 lg:pb-8",
              isImmersiveMobileRoute
                ? "pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
                : "pb-[calc(6rem+env(safe-area-inset-bottom))]",
            )}
            data-testid="page-content"
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
        className="fixed bottom-0 left-0 right-0 z-20 grid h-[calc(4rem+env(safe-area-inset-bottom))] grid-cols-5 items-stretch border-t border-border bg-card px-1 pb-safe shadow-[0_-4px_16px_rgba(0,0,0,0.02)] sm:grid-cols-6 md:grid-cols-8 lg:hidden"
        data-testid="mobile-bottom-navigation"
      >
        {[mobileDashboardItem, mobileInvestmentItem].map((item) => {
          const isActive = location === item.path;
          const Icon = item.icon;
          return (
            <Link key={item.path} href={item.path}>
              <div
                className={cn(
                  "flex flex-col items-center justify-center w-full h-full space-y-1 cursor-pointer",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}
              >
                <Icon
                  className="h-5 w-5"
                  strokeWidth={isActive ? 2.5 : 2}
                  absoluteStrokeWidth
                />
                <span className={cn("text-[10px] font-medium", isActive && "font-bold")}>
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
            "flex h-full w-full cursor-pointer flex-col items-center justify-center space-y-1",
            isExpenseRoute ? "text-primary" : "text-muted-foreground",
          )}>
            <Receipt className="h-5 w-5" strokeWidth={isExpenseRoute ? 2.5 : 2} absoluteStrokeWidth />
            <span className={cn("text-[10px] font-medium", isExpenseRoute && "font-bold")}>Expenses</span>
          </div>
        </Link>

        <Link href={mobileRetirementItem.path}>
          <div
            className={cn(
              "flex h-full w-full cursor-pointer flex-col items-center justify-center space-y-1",
              location === mobileRetirementItem.path ? "text-primary" : "text-muted-foreground",
            )}
          >
            <mobileRetirementItem.icon
              className="h-5 w-5"
              strokeWidth={location === mobileRetirementItem.path ? 2.5 : 2}
              absoluteStrokeWidth
            />
            <span className={cn("text-[10px] font-medium", location === mobileRetirementItem.path && "font-bold")}>
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
                "h-full w-full cursor-pointer flex-col items-center justify-center space-y-1",
                item.visibility,
                isActive ? "text-primary" : "text-muted-foreground",
              )}>
                <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} absoluteStrokeWidth />
                <span className={cn("text-[10px] font-medium", isActive && "font-bold")}>
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
              "flex flex-col items-center justify-center w-full h-full space-y-1 cursor-pointer",
               mobileMoreItems.some(i => i.path === location) ? "text-primary" : "text-muted-foreground"
            )}>
              <MoreHorizontal className="h-5 w-5" strokeWidth={2} absoluteStrokeWidth />
              <span className="text-[10px] font-medium">More</span>
            </div>
          </PopoverTrigger>
          <PopoverContent sideOffset={16} align="end" className="w-48 p-2 rounded-xl border-border/50 shadow-xl bg-card/95 backdrop-blur-md z-[100]">
            <div className="flex flex-col space-y-1">
              {mobileMoreItems.map((item) => {
                const isActive = location === item.path;
                const Icon = item.icon;
                return (
                  <Link key={item.path} href={item.path} onClick={() => setIsMobileMoreOpen(false)}>
                    <div
                      data-testid={`link-mobile-nav-${item.label.toLowerCase()}`}
                      className={cn(
                      "items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer",
                      item.visibility || "flex",
                      isActive ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"
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
