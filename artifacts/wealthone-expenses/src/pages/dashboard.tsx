import { useMemo, useState } from "react";
import { format, startOfMonth, endOfMonth, isWithinInterval } from "date-fns";
import { useExpenses } from "@/hooks/use-expenses";
import { useBudgets } from "@/hooks/use-budgets";
import { useIncomeSources, calculateIncomeMetrics } from "@/hooks/use-income";
import { useInvestments } from "@/hooks/use-investments";
import { useLoans } from "@/hooks/use-loans";
import { useRetirementInputs } from "@/hooks/use-retirement";
import { calculateRetirementProjection, calculateRetirementReadiness, remainingLoanMonths } from "@/lib/retirement-projection";
import { isLivingExpense } from "@/lib/storage";
import { getPlanSetup } from "@/lib/plan-setup";
import { CATEGORY_ICON_TONE, getCategoryIcon } from "@/lib/category-visuals";
import { formatCompactINR, formatINR } from "@/lib/utils";
import { cn } from "@workspace/wealthone-design-system/lib/utils";
import { QuickAddExpense } from "@/components/quick-add-expense";
import { PlanSetupNudge, PlanSetupPanel } from "@/components/plan-setup-panel";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/wealthone-design-system/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { Receipt, Wallet, PiggyBank, Landmark, CheckCircle2, AlertTriangle, ArrowRight, TrendingUp, PieChartIcon, ChevronDown } from "lucide-react";
import { Link } from "wouter";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/wealthone-design-system/components/ui/collapsible";

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--secondary))",
  "#10b981",
  "#8b5cf6",
  "#6366f1",
  "#ec4899",
  "#f43f5e",
  "#f59e0b",
];

function ResponsiveCurrency({ value }: { value: number }) {
  return (
    <span className="financial-number" title={formatINR(value)} aria-label={formatINR(value)}>
      <span className="sm:hidden">{formatCompactINR(value)}</span>
      <span className="hidden sm:inline">{formatINR(value)}</span>
    </span>
  );
}

export default function Dashboard() {
  const { data: expenses = [], isLoading: loadingExpenses } = useExpenses();
  const { data: budgets = [], isLoading: loadingBudgets } = useBudgets();
  const { data: sources = [], isLoading: loadingIncome } = useIncomeSources();
  const { data: investments = [], isLoading: loadingInv } = useInvestments();
  const { data: loans = [], isLoading: loadingLoans } = useLoans();
  const { data: retirementInputs, isLoading: loadingRet } = useRetirementInputs();
  const [isOutlookExpanded, setIsOutlookExpanded] = useState(false);
  const [isOverspendExpanded, setIsOverspendExpanded] = useState(true);

  const currentMonthStart = startOfMonth(new Date());
  const currentMonthEnd = endOfMonth(new Date());

  const setup = useMemo(
    () => getPlanSetup({ incomeSources: sources, expenses, budgets, investments, loans }),
    [sources, expenses, budgets, investments, loans],
  );

  const stats = useMemo(() => {
    const currentMonthExpenses = expenses.filter(e => {
      const date = new Date(e.date);
      return Number.isFinite(date.getTime())
        && Number.isFinite(e.amount)
        && e.amount > 0
        && isWithinInterval(date, { start: currentMonthStart, end: currentMonthEnd })
        && isLivingExpense(e, loans);
    });

    const currentTotalOrdinary = currentMonthExpenses.reduce((sum, e) => sum + e.amount, 0);
    const totalBudget = budgets.reduce((sum, b) => sum + (Number.isFinite(b.monthlyLimit) ? Math.max(0, b.monthlyLimit) : 0), 0);

    const currentIncome = sources.reduce((sum, s) => {
      const { monthlyNet } = calculateIncomeMetrics(s);
      return sum + monthlyNet;
    }, 0);

    const activeLoans = loans.filter((loan) => remainingLoanMonths(loan) > 0);
    const totalEMI = activeLoans.reduce(
      (sum, loan) => sum + (Number.isFinite(loan.emi) ? Math.max(0, loan.emi) : 0),
      0,
    );
    const totalOutflow = currentTotalOrdinary + totalEMI;

    const currentSavings = currentIncome - totalOutflow;
    const savingsRate = currentIncome > 0 ? (currentSavings / currentIncome) * 100 : 0;

    const categorySpending = currentMonthExpenses.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + e.amount;
      return acc;
    }, {} as Record<string, number>);

    const pieData = Object.entries(categorySpending)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // Calculate budget health
    let overBudgetCategories = 0;
    let maxOverspendCategory = { name: "", amount: 0 };
    let totalOverspend = 0;
    const overspentCategories: Array<{ name: string; spent: number; budget: number; amount: number }> = [];

    budgets.forEach(b => {
      const spent = categorySpending[b.category] || 0;
      if (spent > b.monthlyLimit) {
        overBudgetCategories++;
        const over = spent - b.monthlyLimit;
        totalOverspend += over;
        overspentCategories.push({
          name: b.category,
          spent,
          budget: b.monthlyLimit,
          amount: over,
        });
        if (over > maxOverspendCategory.amount) {
          maxOverspendCategory = { name: b.category, amount: over };
        }
      }
    });
    overspentCategories.sort((left, right) => right.amount - left.amount);

    // Wealth Stats
    const totalInvestments = investments.reduce((sum, i) => sum + (Number.isFinite(i.currentValue) ? Math.max(0, i.currentValue) : 0), 0);
    const totalInvestedAmount = investments.reduce((sum, i) => sum + (Number.isFinite(i.investedAmount) ? Math.max(0, i.investedAmount) : 0), 0);
    const investmentGain = totalInvestments - totalInvestedAmount;
    const returnPercentage = totalInvestedAmount > 0 ? (investmentGain / totalInvestedAmount) * 100 : 0;
    
    const totalOutstandingLoans = activeLoans.reduce(
      (sum, loan) => sum + (Number.isFinite(loan.outstandingPrincipal) ? Math.max(0, loan.outstandingPrincipal) : 0),
      0,
    );
    const maxRemainingLoanMonths = activeLoans.reduce((max, l) => {
      const remaining = remainingLoanMonths(l);
      return remaining > max ? remaining : max;
    }, 0);

    // Retirement Projection & Readiness
    const savedInputs = retirementInputs || {
      dateOfBirth: "1990-01-01",
      targetRetirementAge: 60,
      lifeExpectancy: 85,
      generalInflation: 6,
      salaryGrowth: 8,
      monthlyContributionOverride: 0,
      investSurplus: false
    };
    // The additional SIP saved on the retirement page is a planning scenario.
    // The dashboard reflects current reality until that amount is recorded as
    // an actual monthly investment commitment.
    const dashboardInputs = {
      ...savedInputs,
      monthlyContributionOverride: 0,
      investSurplus: false,
    };

    const projectionArgs = {
      expenses,
      budgets,
      incomes: sources,
      investments,
      loans,
      assumptions: dashboardInputs,
    };

    const projection = calculateRetirementProjection(projectionArgs);
    const readiness = calculateRetirementReadiness(projectionArgs);

    const requiredSavingsRate = currentIncome > 0
      ? ((projection.modeledTakeHomeContribution + projection.extraSipRequired) / currentIncome) * 100
      : 0;

    return {
      currentTotalOrdinary,
      totalOutflow,
      currentIncome,
      currentSavings,
      savingsRate,
      requiredSavingsRate,
      pieData,
      recentExpenses: currentMonthExpenses.slice(0, 5),
      totalInvestments,
      investmentGain,
      returnPercentage,
      totalOutstandingLoans,
      totalEMI,
      maxRemainingLoanMonths,
      budgetHealth: {
        totalCategories: budgets.length,
        withinBudget: budgets.length - overBudgetCategories,
        totalOverspend,
        maxOverspendCategory,
        overspentCategories,
      },
      projection,
      readiness,
    };
  }, [expenses, budgets, sources, investments, loans, retirementInputs]);

  if (loadingExpenses || loadingBudgets || loadingIncome || loadingInv || loadingLoans || loadingRet) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-8 w-8 bg-primary/20 rounded-full mb-4"></div>
          <p className="text-muted-foreground">Loading your insights...</p>
        </div>
      </div>
    );
  }

  const { projection, readiness } = stats;
  const roundedUnallocatedSurplus = Math.round(readiness.unallocatedSurplus);
  const roundedExtraSipRequired = Math.round(projection.extraSipRequired);
  const canFundTargetFromAvailableSurplus = !readiness.targetIsFunded
    && roundedExtraSipRequired > 0
    && roundedUnallocatedSurplus >= roundedExtraSipRequired;
  const additionalCashFlowNeeded = Math.max(0, roundedExtraSipRequired - roundedUnallocatedSurplus);

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-500 pb-8 md:pb-12">
      {/* Row 0: One retirement verdict. Supporting cards below avoid repeating it. */}
      {!setup.canProjectRetirement ? (
        <PlanSetupPanel setup={setup} targetAge={projection.targetAge} />
      ) : (
      <div className="w-full overflow-hidden rounded-xl border border-border shadow-sm md:rounded-2xl">
        {!isOutlookExpanded && (
          <div
            className={cn(
              "relative w-full p-4 pr-12 text-left md:hidden",
              readiness.targetIsFunded
                ? "bg-gradient-to-r from-emerald-500/[0.05] to-primary/[0.03]"
                : canFundTargetFromAvailableSurplus
                  ? "bg-gradient-to-r from-amber-500/[0.06] to-primary/[0.03]"
                  : "bg-gradient-to-r from-rose-500/[0.05] to-primary/[0.03]",
            )}
          >
            <h2 className="pr-10 font-serif text-lg font-semibold text-foreground">
              Your retirement outlook
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {readiness.targetIsFunded ? (
                <>
                  Current plan <strong className="text-foreground">supports age {readiness.currentPlanRetirementAge ?? projection.targetAge}</strong>
                  <span className="mx-1.5 text-border">•</span>
                  Target age <strong className="text-foreground">{projection.targetAge}</strong>
                </>
              ) : canFundTargetFromAvailableSurplus ? (
                <>
                  Target age <strong className="text-foreground">{projection.targetAge}</strong>
                  <span className="mx-1.5 text-border">•</span>
                  Invest <strong className="financial-number text-amber-700 dark:text-amber-400" title={`${formatINR(projection.extraSipRequired)}/mo`}>{formatCompactINR(roundedExtraSipRequired)}/mo</strong> to close the gap
                </>
              ) : (
                <>
                  Target age <strong className="text-foreground">{projection.targetAge}</strong>
                  <span className="mx-1.5 text-border">•</span>
                  <strong className="text-rose-700 dark:text-rose-400">Financial action needed</strong>
                </>
              )}
            </p>
            <div className="absolute right-3 top-3 z-10">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
                onClick={() => setIsOutlookExpanded(true)}
                aria-expanded="false"
                aria-label="Show retirement outlook details"
              >
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          </div>
        )}
        <div className={cn("relative", !isOutlookExpanded && "hidden md:block")}>
          <div className="absolute right-3 top-3 z-10 md:hidden">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => setIsOutlookExpanded(false)}
              aria-label="Collapse retirement outlook"
            >
              <ChevronDown className="h-4 w-4 rotate-180" />
            </Button>
          </div>
        {readiness.targetIsFunded ? (
          <div className="relative bg-emerald-50/50 p-5 md:p-8 dark:bg-emerald-950/20">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 md:gap-5">
              <div className="h-12 w-12 md:h-14 md:w-14 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-6 w-6 md:h-7 md:w-7" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 pr-10">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-emerald-800 opacity-90 dark:text-emerald-400 md:text-sm">
                    Your retirement outlook
                  </h2>
                </div>
                <p className="text-2xl md:text-4xl font-serif text-emerald-950 dark:text-emerald-300 leading-tight">
                  At your current earning and investment pace, you can retire at age {readiness.currentPlanRetirementAge ?? projection.targetAge}.
                </p>
                <p className="mt-2 md:mt-3 text-xs md:text-sm font-medium text-emerald-800/80 dark:text-emerald-400/90">
                  {readiness.currentPlanRetirementAge && readiness.currentPlanRetirementAge < projection.targetAge
                    ? `${projection.targetAge - readiness.currentPlanRetirementAge} years earlier than your target age of ${projection.targetAge}.`
                    : `You are on track for your target retirement age of ${projection.targetAge}.`
                  }
                </p>
              </div>
            </div>
          </div>
        ) : canFundTargetFromAvailableSurplus ? (
          <div className="relative bg-amber-50/60 p-5 md:p-8 dark:bg-amber-950/20">
            <div className="flex flex-col items-start gap-4 md:gap-5 sm:flex-row sm:items-center">
              <div className="flex h-12 w-12 md:h-14 md:w-14 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400">
                <PiggyBank className="h-6 w-6 md:h-7 md:w-7" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 pr-10">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-amber-800 opacity-90 dark:text-amber-400 md:text-sm">
                    Your retirement outlook · Investment action needed
                  </h2>
                </div>
                <p className="text-2xl font-serif leading-tight text-amber-950 dark:text-amber-200 md:text-4xl">
                  Your target retirement age of {projection.targetAge} is within reach.
                </p>
                <p className="mt-2 md:mt-3 text-xs md:text-sm font-medium text-amber-900/80 dark:text-amber-300/90">
                  Invest <span className="financial-number" title={`${formatINR(projection.extraSipRequired)}/month`}>{formatCompactINR(roundedExtraSipRequired)}/month</span> from your available{" "}
                  <span className="financial-number" title={`${formatINR(readiness.unallocatedSurplus)}/month`}>{formatCompactINR(roundedUnallocatedSurplus)}/month</span> surplus to close the gap.
                  {readiness.currentPlanRetirementAge
                    ? ` Without that change, your current plan supports retirement at age ${readiness.currentPlanRetirementAge}.`
                    : ""}
                </p>
                {readiness.fullSurplusRetirementAge
                  && (!readiness.currentPlanRetirementAge || readiness.fullSurplusRetirementAge < readiness.currentPlanRetirementAge) && (
                  <p className="mt-2 text-xs italic leading-relaxed text-amber-800/70 dark:text-amber-400/75">
                    Note: If you invest your full available surplus each month, your plan could support retirement as early as age {readiness.fullSurplusRetirementAge}.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="relative bg-rose-50/50 p-5 md:p-8 dark:bg-rose-950/20">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 md:gap-5">
              <div className="h-12 w-12 md:h-14 md:w-14 rounded-full bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-6 w-6 md:h-7 md:w-7" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 pr-10">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-rose-800 opacity-90 dark:text-rose-400 md:text-sm">
                    Your retirement outlook · Financial action needed
                  </h2>
                </div>
                <p className="text-2xl md:text-4xl font-serif text-rose-950 dark:text-rose-300 leading-tight">
                  {readiness.currentPlanRetirementAge
                    ? `At your current pace, you can retire at age ${readiness.currentPlanRetirementAge}—later than your target age of ${projection.targetAge}.`
                    : `At your current pace, your retirement corpus will not last through age ${projection.lifeExpectancy}.`
                  }
                </p>
                <p className="mt-2 md:mt-3 text-xs md:text-sm font-medium text-rose-800 dark:text-rose-400">
                  To reach age {projection.targetAge}, you need to invest{" "}
                  <span className="financial-number" title={`${formatINR(projection.extraSipRequired)}/month`}>{formatCompactINR(roundedExtraSipRequired)}/month</span>.
                  {additionalCashFlowNeeded > 0
                    ? ` Your available surplus is not enough—you would need to free up or generate at least ${formatINR(additionalCashFlowNeeded)} more per month first.`
                    : ""}
                </p>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
      )}

      {setup.canProjectRetirement && setup.nextStep && <PlanSetupNudge setup={setup} />}

      {/* Row 1: The Flow */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <Link href="/income" className="block h-full outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-xl">
          <Card className="min-w-0 border-0 shadow-sm bg-card cursor-pointer hover:shadow-md transition-shadow h-full group">
            <CardContent className="space-y-3 p-4 md:p-5">
              <div className="space-y-1">
                <CardDescription className="font-medium text-[10px] uppercase tracking-wider transition-colors group-hover:text-primary md:text-xs">Monthly Income</CardDescription>
                <CardTitle className={cn("w-full text-lg font-sans font-bold sm:text-xl xl:text-2xl", setup.hasIncome ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground/40")}>
                  {setup.hasIncome ? <ResponsiveCurrency value={stats.currentIncome} /> : "—"}
                </CardTitle>
              </div>
              <div className="flex items-center text-xs md:text-sm text-muted-foreground">
                {setup.hasIncome ? "Net take-home" : (
                  <span className="text-primary font-medium inline-flex items-center text-xs md:text-sm">
                    Add your salary <ArrowRight className="h-3 w-3 md:h-3.5 md:w-3.5 ml-1" />
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/transactions" className="block h-full outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-xl">
          <Card className="min-w-0 border-0 shadow-sm bg-card cursor-pointer hover:shadow-md transition-shadow h-full group">
            <CardContent className="space-y-3 p-4 md:p-5">
              <div className="space-y-1">
                <CardDescription className="font-medium text-[10px] uppercase tracking-wider transition-colors group-hover:text-primary md:text-xs">Monthly Outflow</CardDescription>
                <CardTitle className={cn("w-full text-lg font-sans font-bold sm:text-xl xl:text-2xl", !setup.hasSpendingBaseline && !setup.hasLoans && "text-muted-foreground/40")}>
                  {setup.hasSpendingBaseline || setup.hasLoans ? <ResponsiveCurrency value={stats.totalOutflow} /> : "—"}
                </CardTitle>
              </div>
              <div className="flex items-center text-xs md:text-sm text-muted-foreground">
                {setup.hasSpendingBaseline || setup.hasLoans ? "Expenses + EMIs" : (
                  <span className="text-primary font-medium inline-flex items-center text-xs md:text-sm">
                    Log what you spend <ArrowRight className="h-3 w-3 md:h-3.5 md:w-3.5 ml-1" />
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/income" className="block h-full outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-xl">
          <Card className="min-w-0 border-0 shadow-sm bg-card cursor-pointer hover:shadow-md transition-shadow h-full group">
            <CardContent className="space-y-3 p-4 md:p-5">
              <div className="space-y-1">
                <CardDescription className="font-medium text-[10px] uppercase tracking-wider transition-colors group-hover:text-primary md:text-xs">Monthly Savings</CardDescription>
                <CardTitle className={cn("w-full text-lg font-sans font-bold sm:text-xl xl:text-2xl", setup.canProjectRetirement ? "text-primary" : "text-muted-foreground/40")}>
                  {setup.canProjectRetirement ? <ResponsiveCurrency value={stats.currentSavings} /> : "—"}
                </CardTitle>
              </div>
              <div className="flex items-center text-xs md:text-sm text-muted-foreground truncate">
                {setup.canProjectRetirement
                  ? "Income - Outflow"
                  : "Needs income & spending"}
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/income" className="block h-full outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-xl">
          <Card className="border-0 shadow-sm bg-card cursor-pointer hover:shadow-md transition-shadow h-full group relative overflow-hidden">
            <div className={cn("absolute inset-0 opacity-[0.03] transition-opacity group-hover:opacity-[0.05]", stats.savingsRate >= stats.requiredSavingsRate ? "bg-emerald-500" : "bg-primary")}></div>
            <CardContent className="relative z-10 space-y-3 p-4 md:p-5">
              <div className="space-y-1">
                <CardDescription className="font-medium text-[10px] uppercase tracking-wider transition-colors group-hover:text-primary md:text-xs">Savings Rate</CardDescription>
                <CardTitle className={cn(
                  "financial-number w-full text-lg font-sans font-bold sm:text-xl xl:text-2xl",
                  !setup.canProjectRetirement
                    ? "text-muted-foreground/40"
                    : stats.savingsRate >= stats.requiredSavingsRate ? "text-emerald-700 dark:text-emerald-400" : "text-primary",
                )}>
                  {setup.canProjectRetirement ? `${stats.savingsRate.toFixed(1)}%` : "—"}
                </CardTitle>
              </div>
              <div className="flex items-center text-xs md:text-sm text-muted-foreground truncate">
                {setup.canProjectRetirement
                  ? <>Target:<span className="financial-number"> {stats.requiredSavingsRate.toFixed(1)}%</span></>
                  : "Needs more info"}
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Row 2: Long-term position. The surplus card exists only when actionable. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        <Link href="/investments" className="block h-full outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-xl">
          <Card className="border-0 shadow-sm bg-card cursor-pointer hover:shadow-md transition-shadow h-full flex flex-col justify-between">
            <CardContent className="p-3 md:p-5">
              <CardDescription className="mb-2 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide md:mb-3 md:gap-1.5 md:text-xs md:font-medium md:tracking-wider">
                <TrendingUp className="h-3.5 w-3.5 text-primary md:h-4 md:w-4" /> Investments
              </CardDescription>
              {setup.hasInvestments ? (
                <>
                  <CardTitle className="mb-1 font-sans text-lg font-bold md:mb-2 md:text-2xl"><ResponsiveCurrency value={stats.totalInvestments} /></CardTitle>
                  <p className="truncate text-[11px] text-muted-foreground md:text-sm">
                    Gain: <span className={cn("financial-number font-medium", stats.investmentGain >= 0 ? "text-emerald-600" : "text-destructive")} title={formatINR(stats.investmentGain)}>{stats.investmentGain >= 0 ? "+" : ""}{formatCompactINR(stats.investmentGain)}</span>
                  </p>
                  <p className="mt-0.5 text-[9px] text-muted-foreground opacity-80 md:mt-1 md:text-xs">
                    <span className="financial-number">{stats.returnPercentage.toFixed(1)}%</span> absolute return
                  </p>
                </>
              ) : (
                <>
                  <CardTitle className="text-xl md:text-2xl font-sans font-bold mb-1 md:mb-2 text-muted-foreground/40">—</CardTitle>
                  <p className="text-xs md:text-sm text-muted-foreground">
                    EPF, PPF, mutual funds, FDs, gold — every rupee already working for you counts here.
                  </p>
                  <p className="mt-2 text-xs md:text-sm font-medium text-primary inline-flex items-center">
                    Add your first holding <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </Link>

        <Link href="/loans" className="block h-full outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-xl">
          <Card className="border-0 shadow-sm bg-card cursor-pointer hover:shadow-md transition-shadow h-full flex flex-col justify-between">
            <CardContent className="p-3 md:p-5">
              <CardDescription className="mb-2 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide md:mb-3 md:gap-1.5 md:text-xs md:font-medium md:tracking-wider">
                <Landmark className="h-3.5 w-3.5 text-destructive md:h-4 md:w-4" /> Outstanding Debt
              </CardDescription>
              {setup.hasLoans ? (
                <>
                  <CardTitle className="mb-1 font-sans text-lg font-bold text-destructive md:mb-2 md:text-2xl"><ResponsiveCurrency value={stats.totalOutstandingLoans} /></CardTitle>
                  <p className="truncate text-[11px] text-muted-foreground md:text-sm">
                    EMIs: <span className="financial-number" title={`${formatINR(stats.totalEMI)}/mo`}>{formatCompactINR(stats.totalEMI)}/mo</span>
                  </p>
                  <p className="mt-0.5 text-[9px] text-muted-foreground opacity-80 md:mt-1 md:text-xs">
                    <span className="financial-number">{Math.floor(stats.maxRemainingLoanMonths / 12)} yrs</span>{" "}
                    <span className="financial-number">{Math.round(stats.maxRemainingLoanMonths % 12)} mo</span> left
                  </p>
                </>
              ) : (
                <>
                  <CardTitle className="text-xl md:text-2xl font-sans font-bold mb-1 md:mb-2 text-emerald-700 dark:text-emerald-400">Debt free</CardTitle>
                  <p className="text-xs md:text-sm text-muted-foreground">
                    Nothing tracked yet. Add a home, car or education loan and we will show the month each EMI ends.
                  </p>
                  <p className="mt-2 text-xs md:text-sm font-medium text-primary inline-flex items-center">
                    Add a loan <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </Link>

        <Link href="/investments" className="col-span-2 block h-full rounded-xl outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 md:col-span-1" data-testid="dashboard-available-to-invest-link">
          <Card className="border border-emerald-200/70 bg-emerald-50/50 shadow-sm cursor-pointer hover:shadow-md transition-shadow h-full flex flex-col justify-between group dark:border-emerald-900/60 dark:bg-emerald-950/20">
            <CardContent className="p-3 md:p-5">
              <CardDescription className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 md:mb-4 md:text-xs md:font-medium md:tracking-wider">
                <PiggyBank className="h-4 w-4" /> Available to Invest
              </CardDescription>
              <div className="grid grid-cols-2 gap-3 md:block md:space-y-4">
                <div data-testid="dashboard-monthly-surplus">
                  <p className="text-[10px] md:text-xs text-emerald-800/70 dark:text-emerald-400/80 font-medium mb-0.5">Monthly Surplus</p>
                  <p className="font-sans text-lg font-bold leading-none text-emerald-800 dark:text-emerald-300 md:text-2xl">
                    <span className="financial-number" title={`${formatINR(readiness.unallocatedSurplus)}/mo`}>{formatCompactINR(readiness.unallocatedSurplus)}<span className="text-xs md:text-sm font-normal text-emerald-700/80 dark:text-emerald-400/80">/mo</span></span>
                  </p>
                </div>
                <div className="border-l border-emerald-200/70 pl-3 dark:border-emerald-900/60 md:border-l-0 md:pl-0" data-testid="dashboard-lump-sum">
                  <p className="text-[10px] md:text-xs text-emerald-800/70 dark:text-emerald-400/80 font-medium mb-0.5">Lump-Sum Available</p>
                  <p className="font-sans text-lg font-bold leading-none text-emerald-800 dark:text-emerald-300 md:text-xl">
                    <ResponsiveCurrency value={projection.lumpSumAvailable} />
                  </p>
                </div>
              </div>
              <p className="mt-2 inline-flex items-center text-[11px] font-medium text-emerald-700 dark:text-emerald-400 md:mt-4 md:text-xs">
                Put this surplus to work <ArrowRight className="h-3.5 w-3.5 ml-1 transition-transform group-hover:translate-x-0.5" />
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Row 3: Expense Intelligence */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card className="border-0 shadow-sm bg-card flex flex-col">
          <CardHeader className="p-4 pb-2 md:p-6 md:pb-4">
            <CardTitle className="text-base md:text-lg font-serif">Spending by Category</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col items-center justify-center gap-2 p-4 pt-0 md:flex-row md:gap-6 md:p-6 md:pt-0">
            {stats.pieData.length > 0 ? (
              <>
                <div className="h-[152px] w-[152px] shrink-0 md:h-[180px] md:w-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={stats.pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={75}
                        paddingAngle={2}
                        dataKey="value"
                        stroke="none"
                      >
                        {stats.pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip 
                        formatter={(value: number) => formatINR(value)}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mx-auto mt-1 w-full max-w-[19rem] flex-1 divide-y divide-border/60 rounded-xl border border-border/60 bg-muted/20 px-3 md:mx-0 md:mt-0 md:max-w-none md:space-y-3 md:divide-y-0 md:rounded-none md:border-0 md:bg-transparent md:px-0">
                  {stats.pieData.slice(0, 5).map((entry, index) => {
                    const percentage = (entry.value / stats.currentTotalOrdinary) * 100;
                    return (
                      <div key={entry.name} className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 py-2.5 md:min-h-0 md:py-0">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div
                            className="h-2.5 w-2.5 shrink-0 rounded-full md:h-3 md:w-3"
                            style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                          />
                          <span className="truncate text-sm font-medium md:max-w-[140px]" title={entry.name}>{entry.name}</span>
                        </div>
                        <span className="financial-number text-right text-sm font-semibold">{formatINR(entry.value)}</span>
                        <span className="financial-number min-w-11 text-right text-[11px] text-muted-foreground md:text-xs">{percentage.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="w-full py-8 flex flex-col items-center justify-center text-center px-4">
                <PieChartIcon className="h-10 w-10 mb-3 text-primary/25" />
                <p className="font-medium text-foreground">Nothing spent this month, as far as we know</p>
                <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
                  Add a few expenses and this becomes the honest picture of where your salary actually goes.
                </p>
                <div className="mt-4">
                  <QuickAddExpense />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-card flex flex-col">
          <CardHeader className="p-4 md:p-6 md:pb-4">
            <CardTitle className="text-base md:text-lg font-serif">Budget Health</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col p-4 pt-0 md:p-6 md:pt-0">
            {stats.budgetHealth.totalCategories === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
                <PieChartIcon className="mb-3 h-10 w-10 text-primary/25" />
                <p className="font-medium text-foreground">No budgets set yet</p>
                <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
                  A budget is the monthly lifestyle your retirement corpus has to pay for. Set one and
                  every projection here gets sharper.
                </p>
                <Button asChild size="sm" className="mt-4 shadow-sm">
                  <Link href="/budgets">
                    Set your budgets
                    <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ) : (
            <div className="flex flex-1 flex-col justify-start space-y-3">
              {stats.budgetHealth.totalOverspend > 0 ? (
                <Collapsible open={isOverspendExpanded} onOpenChange={setIsOverspendExpanded}>
                  <div className="overflow-hidden rounded-lg border border-destructive/15 bg-destructive/[0.04]">
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left transition-colors hover:bg-destructive/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-destructive/30"
                        aria-label={`${isOverspendExpanded ? "Collapse" : "Expand"} over-budget categories`}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-destructive">
                              {formatINR(stats.budgetHealth.totalOverspend)} over budget
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {stats.budgetHealth.overspentCategories.length} categor{stats.budgetHealth.overspentCategories.length === 1 ? "y" : "ies"} exceeded
                            </span>
                          </span>
                        </span>
                        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOverspendExpanded && "rotate-180")} />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="max-h-44 divide-y divide-destructive/10 overflow-y-auto border-t border-destructive/10">
                        {stats.budgetHealth.overspentCategories.map((category) => (
                          <div key={category.name} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                            <div className="min-w-0">
                              <p className="truncate font-medium text-foreground">{category.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatINR(category.spent)} spent · {formatINR(category.budget)} budget
                              </p>
                            </div>
                            <span className="shrink-0 font-semibold text-destructive">
                              +{formatINR(category.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              ) : stats.currentTotalOrdinary > 0 ? (
                <div className="text-sm bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 p-4 rounded-lg flex items-start gap-2 border border-emerald-100 dark:border-emerald-800/50">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                  <p>You are keeping your spending under control this month. Excellent work.</p>
                </div>
              ) : (
                <div className="text-sm bg-muted/40 text-muted-foreground p-4 rounded-lg flex items-start gap-2 border border-border/50">
                  <Receipt className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                  <p>Your budgets are ready. Log this month's spending to see how you are tracking against them.</p>
                </div>
              )}
            </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <div>
        <Card className="border-0 shadow-sm bg-card">
          <CardHeader className="pb-2">
            <div className="flex w-full items-center justify-between gap-3">
              <CardTitle className="min-w-0 font-serif text-lg">Recent Transactions</CardTitle>
              <Link
                href="/transactions"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                View all
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {stats.recentExpenses.length > 0 ? (
              <div className="space-y-1">
                {stats.recentExpenses.map((expense) => {
                  const CategoryIcon = getCategoryIcon(expense.category);
                  return (
                    <div key={expense.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50 gap-2">
                      <div className="flex items-center gap-3 md:gap-4 min-w-0">
                        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", CATEGORY_ICON_TONE)}>
                          <CategoryIcon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{expense.merchant}</p>
                          <p className="text-xs text-muted-foreground truncate">{expense.category} • {format(new Date(expense.date), "dd MMM")}</p>
                        </div>
                      </div>
                      <div className="font-semibold font-sans shrink-0">
                        {formatINR(expense.amount)}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="w-full py-12 flex flex-col items-center justify-center px-4 text-center">
                <Wallet className="h-12 w-12 mb-3 text-primary/25" />
                <p className="font-medium text-foreground">Your ledger starts with one entry</p>
                <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
                  Log today's chai, fuel or rent. Three months of entries and we can tell you the
                  monthly number your retirement has to cover.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
