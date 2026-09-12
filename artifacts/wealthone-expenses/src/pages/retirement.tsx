import { useState, useMemo, useEffect, useRef } from "react";
import { useApplyRetirementScenario, useRetirementInputs, useUpdateRetirementInputs } from "@/hooks/use-retirement";
import { useInvestments } from "@/hooks/use-investments";
import { useIncomeSources } from "@/hooks/use-income";
import { useExpenses } from "@/hooks/use-expenses";
import { useBudgets } from "@/hooks/use-budgets";
import { useLoans } from "@/hooks/use-loans";
import { calculateRetirementProjection, calculateRetirementReadiness } from "@/lib/retirement-projection";
import { getPlanSetup } from "@/lib/plan-setup";
import { PlanSetupPanel } from "@/components/plan-setup-panel";
import { formatINR } from "@/lib/utils";
import { cn } from "@workspace/wealthone-design-system/lib/utils";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/wealthone-design-system/components/ui/card";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Label } from "@workspace/wealthone-design-system/components/ui/label";
import { Separator } from "@workspace/wealthone-design-system/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/wealthone-design-system/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/wealthone-design-system/components/ui/popover";
import { Info, AlertTriangle, CheckCircle2, ChevronDown, TrendingUp, Settings2, Wallet, Plus, Trash2 } from "lucide-react";
import { calculatePlanningTimeline } from "@/lib/storage";
import { Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine, ComposedChart, Line } from "recharts";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { format } from "date-fns";
import { usePageLoadingState } from "@/components/layout";
import { QueryErrorState } from "@/components/query-error-state";
import { usePlannedExpenses } from "@/hooks/use-planned-expenses";
import { useFinancialHealthData } from "@/hooks/use-financial-health";
import { RetirementLifestyleEditor } from "@/components/retirement-lifestyle-editor";
import type { PensionSource, RetirementLifestyle } from "@/lib/storage";
import { RetirementSimulationTools } from "@/components/retirement-simulation-tools";
import { trackEvent } from "@/lib/analytics";
import {
  getLifestylePreviewDimensions,
  getPlannerOpenDimensions,
  getRetirementPlanDimensions,
} from "@/lib/retirement-analytics";

import { formatChartAmount, formatMobileChartAmount } from "@/lib/retirement-chart-format";
type TimelineChartPoint = Record<string, number> & {
  age: number;
  year: number;
};

export default function Retirement() {
  const inputsQuery = useRetirementInputs();
  const investmentsQuery = useInvestments();
  const incomesQuery = useIncomeSources();
  const expensesQuery = useExpenses();
  const budgetsQuery = useBudgets();
  const loansQuery = useLoans();
  const plannedExpensesQuery = usePlannedExpenses();
  const financialHealthQuery = useFinancialHealthData();
  const { data: inputs, isLoading: loadingInputs } = inputsQuery;
  const { data: investments = [], isLoading: loadingInv } = investmentsQuery;
  const { data: incomes = [], isLoading: loadingInc } = incomesQuery;
  const { data: expenses = [], isLoading: loadingExp } = expensesQuery;
  const { data: budgets = [], isLoading: loadingBudgets } = budgetsQuery;
  const { data: loans = [], isLoading: loadingLoans } = loansQuery;
  const { data: plannedExpenses = [], isLoading: loadingPlannedExpenses } = plannedExpensesQuery;
  const updateInputs = useUpdateRetirementInputs();
  const applyScenario = useApplyRetirementScenario();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const setPageLoading = usePageLoadingState();

  const [localInputs, setLocalInputs] = useState({
    targetRetirementAge: 55,
    lifeExpectancy: 85,
    generalInflation: 6,
    salaryGrowth: 8,
    monthlyContributionOverride: 0,
    investSurplus: false,
    lifestyleChoice: "Comfortable" as RetirementLifestyle,
    customLifestyleExpense: 0,
    retirementSpendingAdjustmentPercent: 0,
    pensionSources: [] as PensionSource[],
  });

  const [isPlannerOpen, setIsPlannerOpen] = useState(false);
  const plannerOpened = useRef(false);
  const [chartView, setChartView] = useState<"corpus" | "lifestyle">("corpus");
  const isRetirementLoading = loadingInputs || loadingInv || loadingInc || loadingExp || loadingBudgets || loadingLoans || loadingPlannedExpenses || financialHealthQuery.isLoading;

  useEffect(() => {
    setPageLoading(isRetirementLoading);
    return () => setPageLoading(false);
  }, [isRetirementLoading, setPageLoading]);

  useEffect(() => {
    if (inputs) {
      setLocalInputs({
        targetRetirementAge: inputs.targetRetirementAge,
        lifeExpectancy: inputs.lifeExpectancy,
        generalInflation: inputs.generalInflation,
        salaryGrowth: inputs.salaryGrowth,
        monthlyContributionOverride: inputs.monthlyContributionOverride || 0,
        investSurplus: false,
        lifestyleChoice: inputs.lifestyleChoice ?? "Comfortable",
        customLifestyleExpense: inputs.customLifestyleExpense ?? 0,
        retirementSpendingAdjustmentPercent: inputs.retirementSpendingAdjustmentPercent ?? 0,
        pensionSources: inputs.pensionSources ?? [],
      });
    }
  }, [inputs]);

  const hasUnsavedChanges = Boolean(inputs) && (
    localInputs.targetRetirementAge !== inputs!.targetRetirementAge
    || localInputs.lifeExpectancy !== inputs!.lifeExpectancy
    || localInputs.generalInflation !== inputs!.generalInflation
    || localInputs.salaryGrowth !== inputs!.salaryGrowth
    || localInputs.monthlyContributionOverride !== (inputs!.monthlyContributionOverride || 0)
    || localInputs.lifestyleChoice !== (inputs!.lifestyleChoice ?? "Comfortable")
    || localInputs.customLifestyleExpense !== (inputs!.customLifestyleExpense ?? 0)
    || localInputs.retirementSpendingAdjustmentPercent !== (inputs!.retirementSpendingAdjustmentPercent ?? 0)
    || JSON.stringify(localInputs.pensionSources) !== JSON.stringify(inputs!.pensionSources ?? [])
  );

  const handleSave = () => {
    if (!inputs) return;
    const timelineCheck = calculatePlanningTimeline({
      dateOfBirth: inputs.dateOfBirth,
      targetRetirementAge: localInputs.targetRetirementAge,
      lifeExpectancy: localInputs.lifeExpectancy,
    });
    if (!timelineCheck.isValid) {
      toast({
        title: "Check your retirement ages",
        description: "Retirement age cannot be below your current age, and life expectancy must be at or above retirement age.",
        variant: "destructive",
      });
      return;
    }
    if (metrics.affordabilityWarning) {
      toast({
        title: "Additional SIP is not affordable",
        description: "Reduce the additional SIP to the available monthly surplus before saving this plan.",
        variant: "destructive",
      });
      return;
    }
    updateInputs.mutate({
      ...inputs,
      ...localInputs,
    }, {
      onSuccess: () => {
        trackEvent("retirement_plan_saved", getRetirementPlanDimensions({
          lifestyle: localInputs.lifestyleChoice,
          targetRetirementAge: localInputs.targetRetirementAge,
          lifeExpectancy: localInputs.lifeExpectancy,
          pensionSourceCount: localInputs.pensionSources.filter(
            (pension) => Math.max(0, Number(pension.monthlyAmount) || 0) > 0,
          ).length,
          monthlyContributionOverride: localInputs.monthlyContributionOverride,
          plannerOpened: plannerOpened.current,
          fundingPercentage: corpusFundingPercentage,
        }));
        toast({ title: "Retirement plan updated" });
      }
    });
  };

  const metrics = useMemo(() => calculateRetirementProjection({
    expenses,
    budgets,
    incomes,
    investments,
    loans,
    plannedExpenses,
    emergencyFund: financialHealthQuery.data?.emergencyFund,
    assumptions: {
      ...localInputs,
      dateOfBirth: inputs?.dateOfBirth || "",
    },
  }), [localInputs, inputs?.dateOfBirth, investments, incomes, expenses, budgets, loans, plannedExpenses, financialHealthQuery.data?.emergencyFund]);

  const timelineChartData = useMemo<TimelineChartPoint[]>(() => {
    const currentYear = new Date().getFullYear();
    return metrics.chartData.map((point) => {
      const values = point as Record<string, number>;
      return {
        ...values,
        age: Number(values.age),
        year: currentYear + Math.round(Number(values.age) - metrics.currentAge),
      };
    });
  }, [metrics.chartData, metrics.currentAge]);

  const readiness = useMemo(() => calculateRetirementReadiness({
    expenses,
    budgets,
    incomes,
    investments,
    loans,
    plannedExpenses,
    emergencyFund: financialHealthQuery.data?.emergencyFund,
    assumptions: {
      ...localInputs,
      dateOfBirth: inputs?.dateOfBirth || "",
    },
  }), [localInputs, inputs?.dateOfBirth, investments, incomes, expenses, budgets, loans, plannedExpenses, financialHealthQuery.data?.emergencyFund]);

  const chartMargin = isMobile
    ? { top: 8, right: 8, bottom: 4, left: 4 }
    : { top: 20, right: 20, bottom: 20, left: 0 };
  const ageTicks = isMobile
    ? [...new Set([0, 1, 2, 3].map((index) =>
      timelineChartData[Math.round(index * (timelineChartData.length - 1) / 3)]?.age,
    ).filter((age): age is number => age !== undefined))]
    : undefined;
  const xAxisProps = {
    tick: { fontSize: 12, fill: "hsl(var(--muted-foreground))" },
    tickMargin: isMobile ? 4 : 12,
    height: isMobile ? 22 : 30,
    ticks: ageTicks,
    interval: isMobile ? "preserveStartEnd" as const : "preserveEnd" as const,
  };
  const yAxisProps = {
    tickFormatter: isMobile ? formatMobileChartAmount : formatChartAmount,
    tick: { fontSize: isMobile ? 10 : 12, fill: "hsl(var(--muted-foreground))" },
    tickMargin: isMobile ? 4 : 6,
    width: isMobile ? 40 : 60,
  };
  const retirementLabelPosition = isMobile
    && localInputs.targetRetirementAge - metrics.currentAge
      < (localInputs.lifeExpectancy - metrics.currentAge) * 0.35
    ? "insideTopLeft" : "insideTopRight";

  const setup = useMemo(
    () => getPlanSetup({ incomeSources: incomes, expenses, budgets, investments, loans }),
    [incomes, expenses, budgets, investments, loans],
  );

  const selectedTakeHomeInvestment = Math.round(localInputs.monthlyContributionOverride);
  const fullSurplusAmount = Math.round(metrics.unallocatedSurplus);
  const isUsingFullSurplus = fullSurplusAmount > 0 && selectedTakeHomeInvestment === fullSurplusAmount;

  const corpusFundingPercentage = metrics.requiredCorpus > 0
    ? Math.round((metrics.projectedCorpus / metrics.requiredCorpus) * 100)
    : 0;
  const effectivePensionSources = localInputs.pensionSources.filter(
    (pension) => Math.max(0, Number(pension.monthlyAmount) || 0) > 0,
  );
  const pensionStartAges = metrics.milestones.effectivePensionStartAges;

  const handleLifestyleChange = (lifestyleChoice: RetirementLifestyle) => {
    setLocalInputs((previous) => ({ ...previous, lifestyleChoice }));
    trackEvent("retirement_lifestyle_previewed", getLifestylePreviewDimensions(lifestyleChoice));
  };

  const handlePlannerOpenChange = (open: boolean) => {
    setIsPlannerOpen(open);
    if (!open) return;

    plannerOpened.current = true;
    trackEvent(
      "retirement_planner_opened",
      getPlannerOpenDimensions(localInputs.lifestyleChoice, effectivePensionSources.length),
    );
  };

  const roiBreakdown = useMemo(() => {
    const holdings = investments.map((investment) => ({
      id: investment.id,
      name: investment.name,
      currentValue: Math.max(0, Number(investment.currentValue) || 0),
      expectedReturn: Math.max(0, Number(investment.expectedReturn) || 0),
    }));
    const totalValue = holdings.reduce((sum, holding) => sum + holding.currentValue, 0);

    if (totalValue > 0) {
      return {
        method: "current-value weighted" as const,
        totalValue,
        entries: holdings.map((holding) => {
          const weight = holding.currentValue / totalValue;
          return { ...holding, weight, roiContribution: weight * holding.expectedReturn };
        }),
      };
    }

    if (holdings.length > 0) {
      return {
        method: "equal weighted" as const,
        totalValue,
        entries: holdings.map((holding) => ({
          ...holding,
          weight: 1 / holdings.length,
          roiContribution: holding.expectedReturn / holdings.length,
        })),
      };
    }

    return { method: "default" as const, totalValue, entries: [] };
  }, [investments]);

  if (isRetirementLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-100px)]">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-10 w-10 bg-primary/20 rounded-full mb-4 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-primary opacity-50" />
          </div>
          <p className="text-muted-foreground font-medium">Calculating your future...</p>
        </div>
      </div>
    );
  }

  if ([inputsQuery, investmentsQuery, incomesQuery, expensesQuery, budgetsQuery, loansQuery, plannedExpensesQuery, financialHealthQuery].some((query) => query.isError)) {
    return <QueryErrorState onRetry={() => inputsQuery.refetch()} />;
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const point = payload[0]?.payload;
      const monthlyLifestyleExpense = point?.["Monthly Lifestyle Expense"];
      const includesLifestyleExpense = payload.some(
        (item: any) => item.dataKey === "Monthly Lifestyle Expense",
      );
      return (
        <div data-testid="retirement-chart-tooltip" className={cn("space-y-1 rounded-lg border border-border/80 bg-background/95 backdrop-blur-sm p-3 text-xs shadow-xl", isMobile ? "w-full" : "p-4 text-sm")}>
          <p className="font-serif text-foreground mb-3 border-b border-border/50 pb-2">
            Age {point?.age} · {point?.year}
          </p>
          {payload.map((p: any) => (
            <div key={p.dataKey} className={cn("flex items-center justify-between py-0.5", isMobile ? "gap-2" : "gap-6")}>
              <span className="text-muted-foreground font-medium" style={{ color: p.color }}>{p.name}</span>
              <span className="min-w-0 break-words text-right font-semibold text-foreground financial-number">
                {formatINR(p.value)}
                {p.dataKey === "Monthly Lifestyle Expense" ? "/mo" : ""}
              </span>
            </div>
          ))}
          {!includesLifestyleExpense && Number.isFinite(monthlyLifestyleExpense) && (
            <div className={cn("flex items-center justify-between border-t border-border/50 pt-2 mt-2", isMobile ? "gap-2" : "gap-6")}>
              <span className="font-medium text-muted-foreground">Monthly Lifestyle</span>
              <span className="min-w-0 break-words text-right font-semibold text-foreground financial-number">{formatINR(monthlyLifestyleExpense)}/mo</span>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-500 pb-8 md:pb-12 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-serif text-primary tracking-tight">Retirement Projection</h1>
          <p className="text-sm md:text-base text-muted-foreground mt-2 font-medium">
            Visualize your future wealth and fine-tune your lifestyle goals.
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={!hasUnsavedChanges || Boolean(metrics.affordabilityWarning)}
          className={cn(
            "shadow-sm transition-all duration-300 font-semibold px-6",
            hasUnsavedChanges ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-muted text-muted-foreground opacity-70"
          )}
        >
          {hasUnsavedChanges ? "Save Projection Plan" : "Plan Saved"}
        </Button>
      </div>

      {!setup.canProjectRetirement ? (
        <div className="space-y-5">
          <RetirementLifestyleEditor
            lifestyle={localInputs.lifestyleChoice}
            customExpense={localInputs.customLifestyleExpense}
            comfortableExpense={metrics.livingCostBaseline}
            configured={Boolean(inputs?.lifestyleChoice)}
            onLifestyleChange={handleLifestyleChange}
            onCustomExpenseChange={(customLifestyleExpense) => setLocalInputs((previous) => ({ ...previous, customLifestyleExpense }))}
          />
          <PlanSetupPanel setup={setup} targetAge={localInputs.targetRetirementAge} />
        </div>
      ) : (
        <>
          {/* HERO SECTION */}
          <div className="grid grid-cols-1 gap-5 lg:gap-6 xl:grid-cols-3" data-testid="retirement-main-results">
            {/* KPI Cards */}
            <div className="col-span-1 flex flex-col gap-5 lg:gap-6">
              <Card className="bg-card border border-border/60 overflow-hidden relative shadow-md" aria-live="polite">
                <div className="absolute -top-4 -right-4 p-4 opacity-10 pointer-events-none text-muted-foreground">
                  <TrendingUp className="w-40 h-40" />
                </div>
                <CardContent className="p-6 md:p-8 relative z-10 flex flex-col justify-center h-full min-h-[220px]">
                  <p className="text-muted-foreground text-tiny font-semibold uppercase tracking-widest">Projected Corpus</p>
                  <p
                    className="text-4xl md:text-5xl font-serif mt-2 font-medium financial-number tracking-tight"
                    data-testid="result-projected-corpus"
                  >
                    {formatINR(metrics.projectedCorpus)}
                  </p>

                  <div className="mt-8 space-y-2">
                    <div className="flex justify-between gap-4 text-sm">
                      <span className="font-medium text-muted-foreground">Required corpus</span>
                      <span className="font-semibold financial-number" data-testid="result-required-corpus">
                        {formatINR(metrics.requiredCorpus)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4 text-sm">
                      <span className="font-medium text-muted-foreground">Expense at retirement</span>
                      <span className="font-semibold financial-number" data-testid="result-retirement-expense">
                        {formatINR(metrics.expenseAtRetirement)}/mo
                      </span>
                    </div>
                    {effectivePensionSources.length > 0 && (
                      <div className="flex justify-between gap-4 text-sm">
                        <span className="font-medium text-muted-foreground">Pensions scheduled</span>
                        <span className="text-right font-semibold">
                          {effectivePensionSources.length} {effectivePensionSources.length === 1 ? "source" : "sources"}
                          {" · "}
                          {pensionStartAges.length === 1 ? "age" : "ages"} {pensionStartAges.join(", ")}
                        </span>
                      </div>
                    )}
                    <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-muted-foreground transition-all duration-1000"
                        style={{ width: `${Math.min(100, corpusFundingPercentage)}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground text-right font-semibold tracking-wide">{corpusFundingPercentage}% FUNDED</p>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-2 gap-5 lg:gap-6 flex-1">
                <Card className="border-border/60 shadow-sm bg-card transition-all hover:border-primary/30 min-h-[160px]">
                  <CardContent className="p-4 md:p-6 flex flex-col justify-center items-center text-center h-full">
                    <span className="text-xl md:text-2xl font-serif text-foreground financial-number text-balance">
                      {metrics.monthsToRetirement === 0
                        ? "Retirement reached"
                        : [
                            Math.floor(metrics.monthsToRetirement / 12) > 0
                              ? `${Math.floor(metrics.monthsToRetirement / 12)}y`
                              : "",
                            metrics.monthsToRetirement % 12 > 0
                              ? `${metrics.monthsToRetirement % 12}m`
                              : "",
                          ].filter(Boolean).join(" ")}
                    </span>
                    <span className="text-tiny text-muted-foreground uppercase tracking-wider mt-2 font-bold">Time to retirement</span>
                  </CardContent>
                </Card>
                <Card className="border-border/60 shadow-sm bg-card transition-all hover:border-primary/30 min-h-[160px]">
                  <CardContent className="p-4 md:p-6 flex flex-col justify-center items-center text-center h-full">
                     <div className="w-10 h-10 rounded-full flex items-center justify-center mb-2 shadow-inner bg-muted text-muted-foreground">
                       {metrics.cashFlowFeasible ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                    </div>
                    <span className="text-tiny text-muted-foreground uppercase tracking-wider font-bold text-balance">
                      {metrics.monthsToRetirement === 0 ? 'Pre-retirement cash flow' : metrics.cashFlowFeasible ? 'No monthly cash gap' : 'First monthly cash gap'}
                    </span>
                    {metrics.firstCashFlowShortfall && (
                      <p className="mt-2 text-sm">
                        <strong className="financial-number text-negative">{formatINR(metrics.firstCashFlowShortfall.deficit)}</strong>
                        <span className="text-muted-foreground"> in {format(metrics.firstCashFlowShortfall.date, "MMM yyyy")}</span>
                      </p>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground text-balance">
                      {metrics.monthsToRetirement === 0
                        ? "Not applicable once retirement is reached."
                        : metrics.cashFlowFeasible
                          ? "Projected income covers expenses, EMIs and planned contributions before retirement."
                          : "Income falls below expenses, EMIs and planned contributions before retirement."}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Chart */}
            <Card
              className="col-span-1 flex min-h-[350px] h-full flex-col overflow-hidden border-border/60 bg-card shadow-sm xl:col-span-2"
              data-testid="retirement-projection-chart"
              aria-label={`Retirement projection chart. Required corpus ${formatINR(metrics.requiredCorpus)} and retirement expense ${formatINR(metrics.expenseAtRetirement)} per month.`}
              aria-describedby="retirement-milestone-summary"
            >
              <CardHeader className="py-3 px-5 border-b border-border/40 bg-muted/20">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <CardTitle className="text-lg font-serif">Wealth Trajectory</CardTitle>
                  <div
                    className="flex rounded-md border border-border/50 bg-background p-1 text-tiny font-semibold tracking-wide shadow-inner"
                    role="tablist"
                    aria-label="Retirement chart view"
                  >
                    <button
                      type="button"
                      className={cn("px-4 py-1.5 rounded transition-all", chartView === "corpus" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                      onClick={() => setChartView("corpus")}
                      role="tab"
                      aria-selected={chartView === "corpus"}
                      aria-controls="retirement-chart-panel"
                    >
                      CORPUS
                    </button>
                    <button
                      type="button"
                      className={cn("px-4 py-1.5 rounded transition-all", chartView === "lifestyle" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                      onClick={() => setChartView("lifestyle")}
                      role="tab"
                      aria-selected={chartView === "lifestyle"}
                      aria-controls="retirement-chart-panel"
                    >
                      LIFESTYLE
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent
                id="retirement-chart-panel"
                className={cn("retirement-projection-chart flex flex-1 flex-col p-0", isMobile ? "mt-2 min-h-[330px]" : "mt-4 min-h-[350px]")}
                role="tabpanel"
                aria-label={chartView === "corpus" ? "Retirement corpus projection" : "Retirement lifestyle projection"}
              >
                <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 pb-2 text-tiny text-muted-foreground" data-testid="retirement-chart-legend">
                  {chartView === "corpus" ? (
                    <>
                      <span>Base corpus</span>
                      <span>Optimistic (+2%)</span>
                      <span>Pessimistic (-2%)</span>
                      <span>Corpus needed</span>
                    </>
                  ) : (
                    <>
                      <span>Lifestyle expense</span>
                      <span>Pension income</span>
                      <span>Net retirement outflow</span>
                    </>
                  )}
                </div>
                <div className="min-h-[300px] flex-1" style={isMobile ? { touchAction: "pan-y" } : undefined}>
                  <ResponsiveContainer width="100%" height="100%">
                    {chartView === "corpus" ? (
                    <ComposedChart data={timelineChartData} margin={chartMargin}>
                      <defs>
                        <linearGradient id="colorCorpus" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.5} />
                      <XAxis dataKey="age" {...xAxisProps} tickLine={false} axisLine={false} minTickGap={30} />
                      <YAxis {...yAxisProps} tickLine={false} axisLine={false} />
                      <RechartsTooltip content={<CustomTooltip />} isAnimationActive={!isMobile} position={isMobile ? { x: 8, y: 32 } : undefined} wrapperStyle={isMobile ? { width: "calc(100% - 16px)" } : undefined} cursor={{ stroke: 'hsl(var(--primary))', strokeWidth: 1, strokeDasharray: '4 4' }} />
                      <Area type="monotone" dataKey="Base Scenario" name="Base corpus" stroke="hsl(var(--primary))" strokeWidth={3} fillOpacity={1} fill="url(#colorCorpus)" activeDot={{ r: 6, fill: 'hsl(var(--primary))', stroke: 'hsl(var(--background))', strokeWidth: 2 }} isAnimationActive={false} />
                      <Line type="monotone" dataKey="Optimistic (+2% ret)" name="Optimistic corpus" stroke="hsl(var(--optimistic-corpus))" strokeWidth={2} dot={false} strokeDasharray="5 5" isAnimationActive={false} />
                      <Line type="monotone" dataKey="Pessimistic (-2% ret)" name="Pessimistic corpus" stroke="hsl(var(--chart-4))" strokeWidth={2} dot={false} strokeDasharray="5 5" isAnimationActive={false} />
                      <Line type="monotone" dataKey="Lifestyle Corpus Needed" name="Corpus needed" stroke="hsl(var(--chart-5))" strokeWidth={2.5} dot={false} strokeDasharray="8 4" isAnimationActive={false} />
                      {metrics.requiredCorpus > 0 && (
                        <ReferenceLine y={metrics.requiredCorpus} stroke={isMobile ? 'hsl(var(--muted-foreground))' : 'hsl(var(--destructive))'} strokeDasharray="3 3" strokeOpacity={0.7} label={{ position: 'insideTopLeft', value: 'Required', fill: isMobile ? 'hsl(var(--foreground))' : 'hsl(var(--destructive))', fontSize: 11, fontWeight: 600 }} />
                      )}
                      <ReferenceLine x={localInputs.targetRetirementAge} stroke={isMobile ? 'hsl(var(--muted-foreground))' : 'hsl(var(--accent))'} strokeDasharray="4 4" strokeWidth={1.5} label={{ position: retirementLabelPosition, value: 'Retirement', fill: isMobile ? 'hsl(var(--foreground))' : 'hsl(var(--accent))', fontSize: 11, fontWeight: 600 }} />
                    </ComposedChart>
                  ) : (
                    <ComposedChart data={timelineChartData} margin={chartMargin}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.5} />
                      <XAxis dataKey="age" {...xAxisProps} tickLine={false} axisLine={false} minTickGap={30} />
                      <YAxis {...yAxisProps} tickLine={false} axisLine={false} />
                      <RechartsTooltip content={<CustomTooltip />} isAnimationActive={!isMobile} position={isMobile ? { x: 8, y: 32 } : undefined} wrapperStyle={isMobile ? { width: "calc(100% - 16px)" } : undefined} cursor={{ stroke: 'hsl(var(--primary))', strokeWidth: 1, strokeDasharray: '4 4' }} />
                      <Line type="stepAfter" dataKey="Monthly Lifestyle Expense" name="Lifestyle expense" stroke="hsl(var(--chart-5))" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                      <Line type="stepAfter" dataKey="Monthly Pension Income" name="Pension income" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} strokeDasharray="5 5" isAnimationActive={false} />
                      <Line type="stepAfter" dataKey="Net Retirement Outflow" name="Net retirement outflow" stroke="hsl(var(--destructive))" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                      <ReferenceLine x={localInputs.targetRetirementAge} stroke={isMobile ? 'hsl(var(--muted-foreground))' : 'hsl(var(--accent))'} strokeDasharray="4 4" strokeWidth={1.5} label={{ position: retirementLabelPosition, value: 'Retirement', fill: isMobile ? 'hsl(var(--foreground))' : 'hsl(var(--accent))', fontSize: 11, fontWeight: 600 }} />
                    </ComposedChart>
                    )}
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
          <section
            id="retirement-milestone-summary"
            className="sr-only"
            data-testid="retirement-milestone-summary"
            aria-labelledby="retirement-milestone-summary-title"
          >
            <h2 id="retirement-milestone-summary-title">Retirement projection milestones</h2>
            <dl>
              <div>
                <dt>At retirement age {metrics.milestones.retirementAge}, projected corpus</dt>
                <dd>{formatINR(metrics.milestones.projectedCorpusAtRetirement)}</dd>
              </div>
              <div>
                <dt>Required corpus at retirement</dt>
                <dd>{formatINR(metrics.milestones.requiredCorpusAtRetirement)}</dd>
              </div>
              <div>
                <dt>Projected corpus depletion</dt>
                <dd>
                  {metrics.milestones.depletionAge === null
                    ? `Not projected through life expectancy age ${localInputs.lifeExpectancy}`
                    : `Age ${metrics.milestones.depletionAge}`}
                </dd>
              </div>
              <div>
                <dt>Effective pension start ages</dt>
                <dd>
                  {pensionStartAges.length > 0
                    ? pensionStartAges.join(", ")
                    : "No pension income affects this forecast"}
                </dd>
              </div>
            </dl>
          </section>

          {/* LIFESTYLE EDITOR */}
          <RetirementLifestyleEditor
            lifestyle={localInputs.lifestyleChoice}
            customExpense={localInputs.customLifestyleExpense}
            comfortableExpense={metrics.livingCostBaseline}
            configured={Boolean(inputs?.lifestyleChoice)}
            onLifestyleChange={handleLifestyleChange}
            onCustomExpenseChange={(customLifestyleExpense) => setLocalInputs((previous) => ({ ...previous, customLifestyleExpense }))}
          />

          {/* SECONDARY PLANNER AREA */}
          <Collapsible
            open={isPlannerOpen}
            onOpenChange={handlePlannerOpenChange}
            className="space-y-6 border-t border-border/40 pt-8"
            data-testid="retirement-detailed-planner"
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="font-serif text-2xl text-foreground">Detailed planner</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pensions, assumptions, what-if comparisons, purchasing power and SIP step-ups.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {effectivePensionSources.length > 0
                    ? `${effectivePensionSources.length} pension ${effectivePensionSources.length === 1 ? "source is" : "sources are"} modeled separately from the later of its configured start age or retirement.`
                    : "No pension income currently affects this forecast."}
                  {" "}
                  Current assumptions: retirement at {localInputs.targetRetirementAge}, {localInputs.generalInflation}% inflation.
                </p>
              </div>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="outline" className="shrink-0" aria-label={isPlannerOpen ? "Close detailed planner" : "Open detailed planner"}>
                  {isPlannerOpen ? "Close planner" : "Open detailed planner"}
                  <ChevronDown className={cn("ml-2 h-4 w-4 transition-transform", isPlannerOpen && "rotate-180")} />
                </Button>
              </CollapsibleTrigger>
            </div>

            <CollapsibleContent>
              <div className="mb-5 grid gap-4 md:grid-cols-2">
                <Card className="border-border/60 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="font-serif text-base">Retirement outlook</CardTitle>
                    <CardDescription>What the current plan may support.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Target age</p>
                      <p className="font-semibold">{readiness.targetAge}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Current plan supports</p>
                      <p className="font-semibold">
                        {readiness.currentPlanRetirementAge === null
                          ? "Not yet funded"
                          : `Age ${readiness.currentPlanRetirementAge}`}
                      </p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-border/60 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="font-serif text-base">Connected monthly plan</CardTitle>
                    <CardDescription>The cash flow feeding this projection.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Net income</p>
                       <p className="font-semibold financial-number text-positive">{formatINR(metrics.netMonthlyIncome)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Modeled contribution</p>
                       <p className="font-semibold financial-number text-positive">{formatINR(metrics.modeledMonthlyContribution)}</p>
                    </div>
                     <div>
                       <p className="text-xs text-muted-foreground">Current commitments</p>
                        <p className="font-semibold financial-number text-positive">{formatINR(metrics.currentSipCommitments)}</p>
                     </div>
                     <div>
                       <p className="text-xs text-muted-foreground">Remaining surplus</p>
                       <p className={cn("font-semibold financial-number", metrics.unallocatedSurplus > 0 ? "text-warning" : metrics.unallocatedSurplus < 0 ? "text-negative" : "text-foreground")}>{formatINR(metrics.unallocatedSurplus)}</p>
                     </div>
                  </CardContent>
                </Card>
              </div>
               {(metrics.gap > 0 || metrics.depletionAge || metrics.firstCashFlowShortfall) && (
                 <Card className="mb-5 border-border bg-muted/40 shadow-sm" data-testid="retirement-action-guidance">
                   <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 font-serif text-base text-muted-foreground">
                       <AlertTriangle className="h-4 w-4" />
                       Actionable shortfall guidance
                     </CardTitle>
                   </CardHeader>
                   <CardContent className="space-y-2 text-sm text-muted-foreground">
                     {metrics.gap > 0 && (
                       <p>
                         {metrics.monthsToRetirement === 0
                            ? <>Lump sum needed today: <strong className="text-negative">{formatINR(metrics.requiredLumpSumToday)}</strong>.</>
                            : <>Extra SIP needed from today: <strong className="text-negative">{formatINR(metrics.extraSipRequired)}/month</strong>.</>}
                       </p>
                     )}
                     {metrics.depletionAge && (
                       <p>At the current pace, the retirement corpus may deplete around age <strong>{metrics.depletionAge}</strong>.</p>
                     )}
                     {metrics.firstCashFlowShortfall && (
                       <p role="alert">
                         The first projected cash-flow shortfall is <strong className="text-negative">{formatINR(metrics.firstCashFlowShortfall.deficit)}</strong> in{" "}
                         <strong>{format(metrics.firstCashFlowShortfall.date, "MMM yyyy")}</strong>.
                       </p>
                     )}
                   </CardContent>
                 </Card>
               )}
              <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2 lg:gap-6 xl:grid-cols-3">

              {/* 1. Core Assumptions */}
              <Card className="border-border/60 shadow-sm bg-card flex flex-col xl:row-span-2">
                <CardHeader className="py-4 border-b border-border/40 bg-muted/20">
                  <CardTitle className="text-base font-serif flex items-center gap-2">
                     <Settings2 className="w-4 h-4 text-primary" />
                     Core Assumptions
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-5 space-y-6 flex-1">
                   <div className="grid grid-cols-2 gap-4">
                     <div className="space-y-1.5">
                        <Label htmlFor="retirement-target-age" className="text-tiny uppercase tracking-wider text-muted-foreground font-semibold">Target Age</Label>
                       <Input
                          id="retirement-target-age"
                         data-testid="input-retirement-age"
                         type="number" min="18" max="100"
                         value={localInputs.targetRetirementAge}
                         onChange={(e) => setLocalInputs(p => ({ ...p, targetRetirementAge: Number(e.target.value)}))}
                         className="h-9 font-medium shadow-sm bg-background"
                       />
                     </div>
                     <div className="space-y-1.5">
                        <Label htmlFor="retirement-life-expectancy" className="text-tiny uppercase tracking-wider text-muted-foreground font-semibold">Life Expectancy</Label>
                       <Input
                          id="retirement-life-expectancy"
                         data-testid="input-life-expectancy"
                         type="number" min="40" max="125"
                         value={localInputs.lifeExpectancy}
                         onChange={(e) => setLocalInputs(p => ({ ...p, lifeExpectancy: Number(e.target.value)}))}
                         className="h-9 font-medium shadow-sm bg-background"
                       />
                     </div>
                   </div>
                   <div className="space-y-1.5">
                        <Label htmlFor="retirement-inflation-rate" className="text-tiny uppercase tracking-wider text-muted-foreground font-semibold flex justify-between">
                         Inflation Rate
                         <span className="text-foreground">{localInputs.generalInflation}%</span>
                       </Label>
                       <Input
                          id="retirement-inflation-rate"
                         type="number" step="0.1"
                         value={localInputs.generalInflation}
                         onChange={(e) => setLocalInputs(p => ({ ...p, generalInflation: Number(e.target.value)}))}
                         className="h-9 text-primary font-medium shadow-sm bg-background"
                       />
                   </div>

                   <Separator />

                   <div className="space-y-4">
                     <h4 className="text-tiny uppercase tracking-wider text-foreground font-bold">Additional Investments</h4>

                     {metrics.unallocatedSurplus > 0 && (
                       <div className="rounded-lg border border-border bg-muted/40 p-3">
                         <div className="flex items-center justify-between gap-2">
                           <p className="text-tiny font-medium text-muted-foreground">
                              Surplus: <span className="text-sm font-bold ml-1 text-warning">+{formatINR(metrics.unallocatedSurplus)}</span><span className="opacity-70">/mo</span>
                           </p>
                           <Button
                             type="button"
                             variant="outline"
                             size="sm"
                             onClick={() => setLocalInputs(p => ({ ...p, monthlyContributionOverride: isUsingFullSurplus ? 0 : fullSurplusAmount, investSurplus: false }))}
                              className="h-7 px-3 text-tiny border-border text-foreground hover:bg-muted shrink-0"
                           >
                             {isUsingFullSurplus ? "Remove" : "Use All"}
                           </Button>
                         </div>
                       </div>
                     )}

                     <div className="space-y-2">
                       <div className="flex items-center justify-between">
                          <Label htmlFor="retirement-extra-sip" className="text-tiny uppercase tracking-wider text-muted-foreground font-semibold">Extra SIP (₹/mo)</Label>
                         <Popover>
                           <PopoverTrigger asChild>
                             <button type="button" className="text-tiny text-muted-foreground hover:text-foreground font-medium flex items-center gap-1 bg-muted/40 px-2 py-0.5 rounded-full border border-border/50 transition-colors">
                               <TrendingUp className="w-3 h-3" />
                               {(metrics.averageExpectedReturn * 100).toFixed(1)}% ROI
                             </button>
                           </PopoverTrigger>
                           <PopoverContent align="end" className="w-[320px] p-4 space-y-3">
                              <p className="text-sm font-semibold">Projected SIP Return: {(metrics.averageExpectedReturn * 100).toFixed(2)}% p.a.</p>
                              <p className="text-xs text-muted-foreground">Blended from your current investments.</p>
                           </PopoverContent>
                         </Popover>
                       </div>
                       <Input
                          id="retirement-extra-sip"
                         type="number"
                         min="0"
                         step="1"
                         value={selectedTakeHomeInvestment}
                         onChange={(e) => setLocalInputs(p => ({ ...p, monthlyContributionOverride: Math.round(Number(e.target.value)), investSurplus: false }))}
                         className={cn(
                           "h-9 font-medium shadow-sm bg-background text-secondary",
                           metrics.affordabilityWarning && "border-warning/30 focus-visible:ring-warning",
                         )}
                       />
                       {metrics.affordabilityWarning && (
                         <div className="flex items-start gap-1.5 p-2 bg-warning-background rounded border border-warning/30 dark:border-warning/30 mt-2 text-tiny text-warning">
                           <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                           <p className="leading-tight">{metrics.affordabilityWarning}</p>
                         </div>
                       )}
                     </div>
                   </div>
                </CardContent>
              </Card>

              {/* 2. Pensions */}
              <Card className="border-border/60 shadow-sm bg-card flex flex-col xl:row-span-2">
                <CardHeader className="py-4 border-b border-border/40 bg-muted/20">
                  <CardTitle className="text-base font-serif flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-primary" />
                      <span>Pensions</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLocalInputs(p => ({ ...p, pensionSources: [...p.pensionSources, { id: crypto.randomUUID(), name: "", monthlyAmount: 0, startAge: localInputs.targetRetirementAge, annualEscalationRate: 0 }] }))}
                      className="h-7 text-xs px-2.5 bg-background shadow-sm"
                      data-testid="button-add-pension"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0 flex-1 overflow-y-auto max-h-[500px] custom-scrollbar bg-muted/5">
                  {localInputs.pensionSources.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full min-h-[250px] text-center text-muted-foreground p-6">
                      <div className="w-12 h-12 rounded-full bg-background border border-border/50 flex items-center justify-center mb-3 shadow-sm">
                        <Wallet className="w-5 h-5 opacity-40" />
                      </div>
                      <p className="text-sm font-medium text-foreground">No pensions added</p>
                      <p className="text-xs mt-1.5 max-w-[200px] leading-relaxed">Add guaranteed income like government pensions or EPF annuities.</p>
                    </div>
                  ) : (
                    <div className="p-4 space-y-4">
                      {localInputs.pensionSources.map((pension, index) => {
                         const update = (patch: Partial<PensionSource>) =>
                           setLocalInputs(p => ({ ...p, pensionSources: p.pensionSources.map(item => item.id === pension.id ? { ...item, ...patch } : item) }));
                         return (
                           <div key={pension.id} className="relative rounded-xl border border-border/70 bg-background p-4 shadow-sm group hover:border-primary/40 transition-colors" data-testid={`row-pension-${pension.id}`}>
                              <Button
                                type="button" size="icon" variant="ghost"
                                className="absolute right-2 top-2 h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                onClick={() => setLocalInputs(p => ({ ...p, pensionSources: p.pensionSources.filter(item => item.id !== pension.id) }))}
                                data-testid={`button-remove-pension-${pension.id}`}
                                 aria-label={`Remove ${pension.name || `pension ${index + 1}`}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                              <div className="space-y-3.5 pr-6">
                                <div className="space-y-1.5">
                                   <Label htmlFor={`pension-name-${pension.id}`} className="text-tiny uppercase tracking-wider text-muted-foreground font-semibold">Source Name</Label>
                                     <Input id={`pension-name-${pension.id}`} value={pension.name} onChange={e => update({name: e.target.value})} className="h-8 text-xs shadow-none bg-muted/30 focus:bg-background" data-testid={`input-pension-name-${pension.id}`} placeholder="e.g. EPF Pension" />
                                </div>
                                <div className="space-y-1.5">
                                   <Label htmlFor={`pension-amount-${pension.id}`} className="text-tiny uppercase tracking-wider text-muted-foreground font-semibold">Monthly Amount (Today's ₹)</Label>
                                  <div className="relative">
                                    <span className="absolute inset-y-0 left-2.5 flex items-center text-muted-foreground font-medium text-xs pointer-events-none">₹</span>
                                     <Input id={`pension-amount-${pension.id}`} type="number" min={0} value={pension.monthlyAmount} onChange={e => update({monthlyAmount: Math.max(0, Number(e.target.value) || 0)})} className="h-8 text-xs shadow-none pl-6 font-medium bg-muted/30 focus:bg-background" data-testid={`input-pension-amount-${pension.id}`} />
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1.5">
                                     <Label htmlFor={`pension-start-age-${pension.id}`} className="text-tiny uppercase tracking-wider text-muted-foreground font-semibold">Starts At Age</Label>
                                     <Input id={`pension-start-age-${pension.id}`} type="number" min={18} max={120} value={pension.startAge ?? localInputs.targetRetirementAge} onChange={e => update({startAge: Number(e.target.value) || localInputs.targetRetirementAge})} className="h-8 text-xs shadow-none bg-muted/30 focus:bg-background" data-testid={`input-pension-age-${pension.id}`} />
                                     {(pension.startAge ?? localInputs.targetRetirementAge) < localInputs.targetRetirementAge && (
                                       <p className="text-tiny leading-tight text-muted-foreground">
                                         Takes effect at retirement age {localInputs.targetRetirementAge}.
                                       </p>
                                     )}
                                  </div>
                                  <div className="space-y-1.5">
                                     <Label htmlFor={`pension-escalation-${pension.id}`} className="text-tiny uppercase tracking-wider text-muted-foreground font-semibold">Escalation %</Label>
                                     <Input id={`pension-escalation-${pension.id}`} type="number" min={0} max={50} step="0.1" value={pension.annualEscalationRate} onChange={e => update({annualEscalationRate: Math.max(0, Number(e.target.value) || 0)})} className="h-8 text-xs shadow-none bg-muted/30 focus:bg-background" data-testid={`input-pension-escalation-${pension.id}`} />
                                  </div>
                                </div>
                              </div>
                           </div>
                         );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 3,4,5. Simulation Tools */}
              {inputs && (
                <RetirementSimulationTools
                  baselineInputs={inputs}
                  baselineMetrics={calculateRetirementProjection({
                    expenses,
                    budgets,
                    incomes,
                    investments,
                    loans,
                    plannedExpenses,
                    emergencyFund: financialHealthQuery.data?.emergencyFund,
                    assumptions: inputs,
                  })}
                  projectionData={{
                    expenses,
                    budgets,
                    incomes,
                    investments,
                    loans,
                    plannedExpenses,
                    emergencyFund: financialHealthQuery.data?.emergencyFund,
                  }}
                  onApply={async (nextInputs) => {
                    const savedInputs = await applyScenario.mutateAsync(nextInputs);
                    toast({ title: "What-if applied to your saved plan" });
                    return savedInputs;
                  }}
                  applyBlockedReason={hasUnsavedChanges
                    ? "Save or discard unsaved changes before applying a scenario."
                    : undefined}
                />
              )}

              </div>
            </CollapsibleContent>
          </Collapsible>
        </>
      )}
    </div>
  );
}
