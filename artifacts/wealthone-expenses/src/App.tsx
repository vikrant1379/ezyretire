import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

import { Layout } from '@/components/layout';
import { BrandLoader, BrandLogo } from '@/components/brand-logo';
import { Button } from '@workspace/wealthone-design-system/components/ui/button';
import { UserPlus, LogIn } from 'lucide-react';
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

const Dashboard = lazy(() => import('@/pages/dashboard'));
const Income = lazy(() => import('@/pages/income'));
const Tax = lazy(() => import('@/pages/tax'));
const Transactions = lazy(() => import('@/pages/transactions'));
const Budgets = lazy(() => import('@/pages/budgets'));
const Trends = lazy(() => import('@/pages/trends'));
const Investments = lazy(() => import('@/pages/investments'));
const Loans = lazy(() => import('@/pages/loans'));
const Retirement = lazy(() => import('@/pages/retirement'));
const Profile = lazy(() => import('@/pages/profile'));
const About = lazy(() => import('@/pages/about'));
const Advice = lazy(() => import('@/pages/advice'));
const Advisor = lazy(() => import('@/pages/advisor'));
const AdminAdvice = lazy(() => import('@/pages/admin-advice'));
const Admin = lazy(() => import('@/pages/admin'));
const AdminLogin = lazy(() => import('@/pages/admin-login'));
const AdminLoginActivity = lazy(() => import('@/pages/admin-login-activity'));
const Login = lazy(() => import('@/pages/login'));
const Onboarding = lazy(() => import('@/pages/onboarding'));
const NotFound = lazy(() => import('@/pages/not-found'));
const DatePickerTestHarness = import.meta.env.DEV
  ? lazy(() => import('@/pages/date-picker-test-harness'))
  : null;

const queryClient = new QueryClient();

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
            <Route path="/income" component={Income} />
            <Route path="/tax" component={Tax} />
            <Route path="/transactions" component={Transactions} />
            <Route path="/budgets" component={Budgets} />
            <Route path="/investments" component={Investments} />
            <Route path="/loans" component={Loans} />
            <Route path="/retirement" component={Retirement} />
            <Route path="/trends" component={Trends} />
            <Route path="/advice" component={Advice} />
            <Route path="/advisor" component={Advisor} />
            <Route path="/profile" component={Profile} />
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
        <p className="-mt-1 animate-pulse text-sm font-medium tracking-[0.18em] text-[#D4AF37]">
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
        <p className="-mt-1 animate-pulse text-sm font-medium tracking-[0.18em] text-[#D4AF37]">
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
    activateFinancialDataAccount(user?.id ?? null);
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
    return <AuthenticationPrompt />;
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
      variant: 'destructive',
    });
  }, [isAuthenticated, isLoading, toast]);

  return null;
}

function AuthenticationPrompt() {
  const [, setLocation] = useLocation();

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-lg rounded-xl border border-border bg-card p-8 text-center shadow-lg sm:p-10">
        <BrandLogo className="mx-auto mb-6 h-28 max-w-full" />
        <h1 className="font-serif text-3xl font-semibold text-foreground">Welcome to ezyRetire</h1>
        <p className="mx-auto mt-3 max-w-md text-muted-foreground">
          Sign in to continue to your personal financial workspace, or create an account to get started.
        </p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <Button size="lg" onClick={() => setLocation('/login')}>
            <LogIn className="mr-2 h-4 w-4" />
            Sign in
          </Button>
          <Button size="lg" variant="outline" onClick={() => setLocation('/login?mode=register')}>
            <UserPlus className="mr-2 h-4 w-4" />
            Create account
          </Button>
        </div>
      </section>
    </main>
  );
}

function CustomerContent() {
  const { data: profile, isLoading } = useProfileInputs();

  if (isLoading) {
    return (
      <Layout>
        <ShellLoadingFallback />
      </Layout>
    );
  }

  if (!profile?.onboardingCompleted) {
    return <Onboarding />;
  }

  return <CustomerRouter />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, '') || ''}>
          <AppRoutes />
          <PendingFinancialChangeLogoutNotice />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
