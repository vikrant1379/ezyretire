type PageModule = typeof import("../pages/dashboard");
type PageLoader = () => Promise<PageModule>;

function memoizePage(loader: PageLoader): PageLoader {
  let pending: Promise<PageModule> | undefined;
  return () => pending ??= loader();
}

const loadDashboard = memoizePage(() => import("../pages/dashboard"));
const loadTransactions = memoizePage(() => import("../pages/transactions"));
const loadRetirement = memoizePage(() => import("../pages/retirement"));

export const priorityPageLoaders = {
  dashboard: loadDashboard,
  transactions: loadTransactions,
  retirement: loadRetirement,
};

export const PRIORITY_ROUTE_PATHS = [
  "/",
  "/transactions",
  "/retirement",
] as const;

const loadersByPath: Record<string, PageLoader | undefined> = {
  "/": loadDashboard,
  "/dashboard": loadDashboard,
  "/transactions": loadTransactions,
  "/retirement": loadRetirement,
};

export function preloadRoute(path: string): Promise<PageModule> | undefined {
  return loadersByPath[path]?.();
}

export function schedulePriorityPagePreloads(): () => void {
  const preload = () => {
    for (const path of PRIORITY_ROUTE_PATHS) {
      void preloadRoute(path);
    }
  };

  if ("requestIdleCallback" in window) {
    const idleId = window.requestIdleCallback(preload, { timeout: 1_500 });
    return () => window.cancelIdleCallback(idleId);
  }

  const timeoutId = globalThis.setTimeout(preload, 250);
  return () => globalThis.clearTimeout(timeoutId);
}