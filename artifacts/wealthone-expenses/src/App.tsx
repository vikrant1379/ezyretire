import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@workspace/wealthone-design-system/components/ui/toaster';
import { TooltipProvider } from '@workspace/wealthone-design-system/components/ui/tooltip';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';
import { useProfileInputs } from '@/hooks/use-retirement';

import { BrandLoader } from '@/components/brand-logo';
import { useAuth } from '@workspace/replit-auth-web';
import { useToast } from '@workspace/wealthone-design-system/hooks/use-toast';
import {
  ACCOUNT_SWITCH_SAVE_TITLE,
  consumePendingFinancialChangeLogoutNotice,
} from '@/hooks/use-financial-write';
import {
  activateFinancialDataAccount,
  FinancialAccountSwitchError,
} from '@/lib/financial-api';
import {
  createAppQueryClient,
  synchronizeAccountQueryCache,
} from '@/lib/query-policy';
import { installMobileViewportBehavior } from '@/lib/mobile-viewport';
import {
  priorityPageLoaders,
  schedulePriorityPagePreloads,
} from '@/lib/route-preload';
import { QueryErrorState } from '@/components/query-error-state';

const Dashboard = lazy(priorityPageLoaders.dashboard);
const Layout = lazy(() => import('@/components/layout').then((module) => ({ default: module.Layout })));
const Income = lazy(() => import('@/pages/income'));
const Tax = lazy(() => import('@/pages/tax'));
const Transactions = lazy(priorityPageLoaders.transactions);
const Budgets = lazy(() => import('@/pages/budgets'));
const Trends = lazy(() => import('@/pages/trends'));
const Investments = lazy(() => import('@/pages/investments'));
const Loans = lazy(() => import('@/pages/loans'));
const Retirement = lazy(priorityPageLoaders.retirement);
const FinancialHealth = lazy(() => import('@/pages/financial-health'));
const DecisionTools = lazy(() => import('@/pages/decision-tools'));
const Profile = lazy(() => import('@/pages/profile'));

const Settings = lazy(() => import('@/pages/settings'));
const About = lazy(() => import('@/pages/about'));
const Advice = lazy(() => import('@/pages/advice'));
const Advisor = lazy(() => import('@/pages/advisor'));
const AdminAdvice = lazy(() => import('@/pages/admin-advice'));
const Admin = lazy(() => import('@/pages/admin'));
const AdminLogin = lazy(() => import('@/pages/admin-login'));
const AdminLoginActivity = lazy(() => import('@/pages/admin-login-activity'));
const loginModulePromise = import('@/pages/login');
const Login = lazy(() => loginModulePromise);
const Onboarding = lazy(() => import('@/pages/onboarding'));
const NotFound = lazy(() => import('@/pages/not-found'));
const Goals = lazy(() => import('@/pages/goals'));
const Planner = lazy(() => import('@/pages/planner'));

const Protection = lazy(() => import('@/pages/protection'));
const DatePickerTestHarness = import.meta.env.DEV
  ? lazy(() => import('@/pages/date-picker-test-harness'))
  : null;

export const queryClient = createAppQueryClient();

/**
 * Admin routes render outside the customer Layout and outside the onboarding
 * gate. They carry their own chrome (AdminShell) and auth guard (AdminGuard),
 * so an admin can reach the panel without a completed customer onboarding.
 */
function AdminRouter() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/admin/login" component={AdminLogin} />
        <Route path="/admin/advice" component={AdminAdvice} />
        <Route path="/admin/login-activity" component={AdminLoginActivity} />
        <Route path="/admin" component={Admin} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function CustomerRouter() {
  return (
    <Layout>
      <Suspense fallback={<ShellLoadingFallback />}>
        <RoutedErrorBoundary>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/dashboard" component={Dashboard} />
            <Route path="/onboarding" component={Onboarding} />
            <Route path="/income" component={Income} />
            <Route path="/tax" component={Tax} />
            <Route path="/transactions" component={Transactions} />
            <Route path="/budgets" component={Budgets} />
            <Route path="/investments" component={Investments} />
            <Route path="/loans" component={Loans} />
            <Route path="/retirement" component={Retirement} />
            <Route path="/financial-health" component={FinancialHealth} />
            <Route path="/decision-tools" component={DecisionTools} />
            <Route path="/trends" component={Trends} />
            <Route path="/goals" component={Goals} />
            <Route path="/planner" component={Planner} />
            <Route path="/protection" component={Protection} />
            <Route path="/advice" component={Advice} />
            <Route path="/advisor" component={Advisor} />
            <Route path="/profile" component={Profile} />
            <Route path="/settings" component={Settings} />
            <Route path="/about" component={About} />
            <Route component={NotFound} />
          </Switch>
        </RoutedErrorBoundary>
      </Suspense>
    </Layout>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function RouteLoadingFallback() {
  return (
    <main
      className="flex min-h-[100dvh] items-center justify-center bg-background"
      aria-busy="true"
    >
      <div
        className="flex flex-col items-center gap-1 text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <BrandLoader className="animate-pulse" />
        <p className="-mt-1 animate-pulse text-sm font-medium tracking-[0.18em] text-loading-tagline">
          Track • Plan • Retire
        </p>
      </div>
    </main>
  );
}

function ShellLoadingFallback() {
  return (
    <div
      className="flex min-h-[60vh] items-center justify-center"
      aria-busy="true"
    >
      <div
        className="flex flex-col items-center gap-1 text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <BrandLoader className="animate-pulse" />
        <p className="-mt-1 animate-pulse text-sm font-medium tracking-[0.18em] text-loading-tagline">
          Track • Plan • Retire
        </p>
      </div>
    </div>
  );
}

function AppRoutes() {
  const [location] = useLocation();

  return (
    <ErrorBoundary resetKey={location}>
      <Suspense fallback={<RouteLoadingFallback />}>
        <AppContent />
      </Suspense>
    </ErrorBoundary>
  );
}

function AppContent() {
  const [location] = useLocation();
  const { user, isAuthenticated, isLoading } = useAuth();
  if (!isLoading) {
    const accountId = user?.id ?? null;
    activateFinancialDataAccount(accountId);
    synchronizeAccountQueryCache(queryClient, accountId);
  }
  if (location === '/__date-picker-test' && DatePickerTestHarness) {
    return <DatePickerTestHarness />;
  }
  if (location === '/login') {
    return <Login />;
  }
  const isAdminRoute = location === '/admin' || location.startsWith('/admin/');

  // Admin routes bypass the customer onboarding gate and Layout entirely.
  if (isAdminRoute) {
    return <AdminRouter />;
  }

  if (isLoading) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <BrandLoader className="animate-pulse" />
          <p className="text-sm">Checking your account...</p>
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  return <CustomerContent />;
}

function PendingFinancialChangeLogoutNotice() {
  const { isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (isLoading || !isAuthenticated || !consumePendingFinancialChangeLogoutNotice()) {
      return;
    }
    toast({
      title: ACCOUNT_SWITCH_SAVE_TITLE,
      description: new FinancialAccountSwitchError().message,
      variant: 'default',
    });
  }, [isAuthenticated, isLoading, toast]);

  return null;
}

function CustomerContent() {
  const { data: profile, isLoading, isError, refetch } = useProfileInputs();
  const canUseMainApp = profile?.onboardingCompleted || profile?.onboardingProgress?.dismissed;

  useEffect(() => {
    if (!canUseMainApp) return;
    return schedulePriorityPagePreloads();
  }, [canUseMainApp]);

  if (isLoading) {
    return (
      <Layout>
        <ShellLoadingFallback />
      </Layout>
    );
  }

  if (isError) {
    return (
      <QueryErrorState
        fullPage
        title="We couldn't open your account"
        description="We couldn't confirm your profile, so we won't send you to onboarding or show incomplete financial data."
        onRetry={refetch}
      />
    );
  }

  if (!canUseMainApp) {
    return <Onboarding />;
  }

  return <CustomerRouter />;
}

import { ThemeProvider } from '@/components/theme-provider';

function App() {
  useEffect(() => installMobileViewportBehavior(), []);

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, '') || ''}>
            <AppRoutes />
            <PendingFinancialChangeLogoutNotice />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
