import { useState, useMemo, useEffect } from "react";
import { useRetirementInputs, useUpdateRetirementInputs } from "@/hooks/use-retirement";
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@workspace/wealthone-design-system/components/ui/dialog";
import { Info, AlertTriangle, CheckCircle2, ChevronDown, X } from "lucide-react";
import { calculatePlanningTimeline } from "@/lib/storage";
import { Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine, ComposedChart, Line, Legend } from "recharts";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { Link } from "wouter";
import { format } from "date-fns";
import { usePageLoadingState } from "@/components/layout";

const formatChartAmount = (value: number) => {
  const amount = Math.abs(value);
  if (amount >= 10000000) return `₹${(value / 10000000).toFixed(1)}Cr`;
  if (amount >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(value / 1000).toFixed(0)}K`;
  return `₹${Math.round(value)}`;
};

type TimelineChartPoint = Record<string, number> & {
  age: number;
  year: number;
};

export default function Retirement() {
  const { data: inputs, isLoading: loadingInputs } = useRetirementInputs();
  const { data: investments = [], isLoading: loadingInv } = useInvestments();
  const { data: incomes = [], isLoading: loadingInc } = useIncomeSources();
  const { data: expenses = [], isLoading: loadingExp } = useExpenses();
  const { data: budgets = [], isLoading: loadingBudgets } = useBudgets();
  const { data: loans = [], isLoading: loadingLoans } = useLoans();
  const updateInputs = useUpdateRetirementInputs();
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
  });

  const [isMonthlyPlanOpen, setIsMonthlyPlanOpen] = useState(false);
  const [isReadinessOpen, setIsReadinessOpen] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches,
  );
  const [isChartInfoOpen, setIsChartInfoOpen] = useState(false);
  const [chartView, setChartView] = useState<"corpus" | "lifestyle">("corpus");
  const isRetirementLoading = loadingInputs || loadingInv || loadingInc || loadingExp || loadingBudgets || loadingLoans;

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
      });
    }
  }, [inputs]);

  const hasUnsavedChanges = Boolean(inputs) && (
    localInputs.targetRetirementAge !== inputs!.targetRetirementAge
    || localInputs.lifeExpectancy !== inputs!.lifeExpectancy
    || localInputs.generalInflation !== inputs!.generalInflation
    || localInputs.salaryGrowth !== inputs!.salaryGrowth
    || localInputs.monthlyContributionOverride !== (inputs!.monthlyContributionOverride || 0)
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
    assumptions: {
      ...localInputs,
      dateOfBirth: inputs?.dateOfBirth || "",
    },
  }), [localInputs, inputs?.dateOfBirth, investments, incomes, expenses, budgets, loans]);

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
  const retirementChartPoint = useMemo(
    () => timelineChartData.reduce((closest, point) =>
      Math.abs(Number(point.age) - localInputs.targetRetirementAge)
        < Math.abs(Number(closest.age) - localInputs.targetRetirementAge)
        ? point
        : closest
    , timelineChartData[0]),
    [localInputs.targetRetirementAge, timelineChartData],
  );

  const readiness = useMemo(() => calculateRetirementReadiness({
    expenses,
    budgets,
    incomes,
    investments,
    loans,
    assumptions: {
      ...localInputs,
      dateOfBirth: inputs?.dateOfBirth || "",
    },
  }), [localInputs, inputs?.dateOfBirth, investments, incomes, expenses, budgets, loans]);

  const setup = useMemo(
    () => getPlanSetup({ incomeSources: incomes, expenses, budgets, investments, loans }),
    [incomes, expenses, budgets, investments, loans],
  );

  const selectedTakeHomeInvestment = Math.round(localInputs.monthlyContributionOverride);
  const fullSurplusAmount = Math.round(metrics.unallocatedSurplus);
  const isUsingFullSurplus = fullSurplusAmount > 0 && selectedTakeHomeInvestment === fullSurplusAmount;
  const timeline = calculatePlanningTimeline({
    dateOfBirth: inputs?.dateOfBirth || "",
    targetRetirementAge: localInputs.targetRetirementAge,
    lifeExpectancy: localInputs.lifeExpectancy,
  });
  const targetRetirementYear = new Date().getFullYear()
    + Math.round(localInputs.targetRetirementAge - metrics.currentAge);
  const finalLifestyleExpense = Number(
    metrics.chartData.at(-1)?.["Monthly Lifestyle Expense"] ?? 0,
  );
  const timeToRetirementLabel = metrics.monthsToRetirement === 0
    ? "Less than 1 month"
    : metrics.monthsToRetirement < 12
      ? `${metrics.monthsToRetirement} ${metrics.monthsToRetirement === 1 ? "month" : "months"}`
      : `${(metrics.monthsToRetirement / 12).toFixed(metrics.monthsToRetirement % 12 === 0 ? 0 : 1)} years`;
  const corpusFundingPercentage = metrics.requiredCorpus > 0
    ? Math.round((metrics.projectedCorpus / metrics.requiredCorpus) * 100)
    : 0;
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
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-8 w-8 bg-primary/20 rounded-full mb-4"></div>
          <p className="text-muted-foreground">Calculating your future...</p>
        </div>
      </div>
    );
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const point = payload[0]?.payload;
      const monthlyLifestyleExpense = point?.["Monthly Lifestyle Expense"];
      const includesLifestyleExpense = payload.some(
        (item: any) => item.dataKey === "Monthly Lifestyle Expense",
      );
      return (
        <div className="max-w-[calc(100vw-3rem)] space-y-1 rounded-lg border border-border bg-card p-2.5 text-xs shadow-xl sm:max-w-none sm:p-3 sm:text-sm">
          <p className="font-semibold text-foreground mb-2">
            Age {point?.age} · {point?.year}
          </p>
          {payload.map((p: any) => (
            <div key={p.dataKey} className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground" style={{ color: p.color }}>{p.name}</span>
              <span className="font-medium text-foreground">
                {formatINR(p.value)}
                {p.dataKey === "Monthly Lifestyle Expense" ? "/mo" : ""}
              </span>
            </div>
          ))}
          {!includesLifestyleExpense && Number.isFinite(monthlyLifestyleExpense) && (
            <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-1">
              <span className="text-amber-600">Monthly Lifestyle Expense</span>
              <span className="font-medium text-foreground">{formatINR(monthlyLifestyleExpense)}/mo</span>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-500 pb-8 md:pb-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-serif text-primary">Retirement Projection</h1>
          <p className="text-sm md:text-base text-muted-foreground mt-1">
            Plan your future based on your current wealth and spending.
          </p>
        </div>
        <Button onClick={handleSave} disabled={!hasUnsavedChanges || Boolean(metrics.affordabilityWarning)} className="hidden shadow-sm md:inline-flex">
          {hasUnsavedChanges ? "Save Projection Plan" : "Plan Saved"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 md:gap-6 lg:items-start">
        {/* Left assumptions rail — order-2 on mobile so the chart leads, sticky rail on desktop */}
        <aside className="order-2 hidden lg:order-1 lg:col-span-1 lg:block lg:sticky lg:top-6">
          <Card className="overflow-hidden border-0 bg-white shadow-md">
            <CardHeader className="border-b border-border/60 bg-muted/20 p-5">
              <div className="space-y-1.5">
                <CardTitle className="font-serif text-lg">Retirement assumptions</CardTitle>
                <CardDescription className="text-sm leading-relaxed">
                  Change these values to update your projection instantly, then save your plan.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 p-5 md:space-y-5">
              {/* Timeline assumptions */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Target retirement age</Label>
                  <Input
                    data-testid="input-retirement-age"
                    type="number"
                    min="18"
                    max="100"
                    value={localInputs.targetRetirementAge}
                    onChange={(event) => {
                      setLocalInputs((previous) => ({ ...previous, targetRetirementAge: Number(event.target.value) }));
                    }}
                    className="h-9 font-medium"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Life expectancy</Label>
                  <Input
                    data-testid="input-life-expectancy"
                    type="number"
                    min="40"
                    max="125"
                    value={localInputs.lifeExpectancy}
                    onChange={(event) => {
                      setLocalInputs((previous) => ({ ...previous, lifeExpectancy: Number(event.target.value) }));
                    }}
                    className="h-9 font-medium"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider flex justify-between">
                    Inflation (%)
                    <span className="text-foreground font-medium">{localInputs.generalInflation}%</span>
                  </Label>
                  <Input
                    type="number" step="0.1"
                    value={localInputs.generalInflation}
                    onChange={(e) => { setLocalInputs(p => ({ ...p, generalInflation: Number(e.target.value) })); }}
                    className="h-9 text-blue-600 dark:text-blue-400 font-medium"
                  />
                </div>
              </div>

              <Separator />

              {/* Surplus / additional SIP */}
              <div className="space-y-3">
                {metrics.unallocatedSurplus > 0 && (
                  <>
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-medium text-emerald-800">
                          We still have <span className="text-base font-bold">+{formatINR(metrics.unallocatedSurplus)}/mo</span> as surplus
                        </p>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              aria-label="How the available surplus is calculated"
                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-emerald-700 transition-colors hover:bg-emerald-100 hover:text-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                            >
                              <Info className="h-3.5 w-3.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-[min(300px,calc(100vw-2rem))] p-3 text-xs leading-relaxed">
                            This confirmed surplus uses current income and living-cost values only, after active EMIs and existing SIP commitments. Growth and inflation assumptions do not increase this investable amount.
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setLocalInputs((previous) => ({
                          ...previous,
                          monthlyContributionOverride: isUsingFullSurplus ? 0 : fullSurplusAmount,
                          investSurplus: false,
                        }));
                      }}
                      className="h-8 w-full border-emerald-300 bg-white text-xs text-emerald-800 hover:bg-emerald-50 hover:text-emerald-900"
                    >
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                      {isUsingFullSurplus
                        ? "Remove surplus"
                        : "Use surplus"}
                    </Button>
                  </>
                )}
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Additional SIP from this surplus (₹/mo)</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-label="How the SIP return is calculated"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-[min(360px,calc(100vw-2rem))] space-y-3 p-4">
                      <div>
                        <p className="text-sm font-semibold">Projected SIP return: {(metrics.averageExpectedReturn * 100).toFixed(2)}% p.a.</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          This SIP joins your combined portfolio. Its ROI is the {roiBreakdown.method === "current-value weighted" ? "current-value weighted average" : roiBreakdown.method === "equal weighted" ? "simple average" : "default assumption"} of the expected returns in Investments.
                        </p>
                      </div>
                      {roiBreakdown.entries.length > 0 ? (
                        <div className="space-y-2">
                          {roiBreakdown.entries.map((entry) => (
                            <div key={entry.id} className="rounded-md bg-muted/60 p-2 text-xs">
                              <div className="flex items-center justify-between gap-3">
                                <span className="min-w-0 truncate font-medium">{entry.name}</span>
                                <span className="shrink-0">{entry.expectedReturn.toFixed(2)}% ROI</span>
                              </div>
                              <p className="mt-1 text-muted-foreground">
                                {roiBreakdown.method === "current-value weighted"
                                  ? `${formatINR(entry.currentValue)} ÷ ${formatINR(roiBreakdown.totalValue)} = ${(entry.weight * 100).toFixed(2)}% weight; × ${entry.expectedReturn.toFixed(2)}% ROI = ${entry.roiContribution.toFixed(2)}%`
                                  : `${(entry.weight * 100).toFixed(2)}% weight × ${entry.expectedReturn.toFixed(2)}% ROI = ${entry.roiContribution.toFixed(2)}%`}
                              </p>
                            </div>
                          ))}
                          <div className="flex items-center justify-between border-t pt-2 text-xs font-semibold">
                            <span>Blended expected return</span>
                            <span>{(metrics.averageExpectedReturn * 100).toFixed(2)}% p.a.</span>
                          </div>
                        </div>
                      ) : (
                        <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
                          No investments are recorded yet, so the projection uses the default 12.00% annual return.
                        </p>
                      )}
                      <p className="text-[10px] leading-relaxed text-muted-foreground">
                        Expected returns are planning assumptions, not guaranteed returns. Update an investment’s expected return to change this blended rate.
                      </p>
                    </PopoverContent>
                  </Popover>
                </div>
                <Input
                  type="number"
                  formatWithCommas
                  min="0"
                  step="1"
                  value={selectedTakeHomeInvestment}
                  onChange={(e) => {
                    setLocalInputs((previous) => ({
                      ...previous,
                      monthlyContributionOverride: Math.round(Number(e.target.value)),
                      investSurplus: false,
                    }));
                  }}
                  className={cn(
                    "h-9 text-blue-600 dark:text-blue-400 font-medium",
                    metrics.affordabilityWarning && "border-amber-500 focus-visible:ring-amber-500",
                  )}
                  aria-describedby={metrics.affordabilityWarning ? "surplus-investment-warning" : undefined}
                />
                <p className="text-[10px] text-muted-foreground leading-tight">Existing SIPs and salary-linked PF are already included. Enter any additional amount to preview it; only an affordable amount can be saved.</p>
                {metrics.affordabilityWarning && (
                  <div id="surplus-investment-warning" role="alert" className="flex items-start gap-2 rounded-md bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-800">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{metrics.affordabilityWarning} Reduce the SIP to stay within today’s affordable surplus.</span>
                  </div>
                )}
                {!metrics.cashFlowFeasible && !metrics.affordabilityWarning && metrics.firstCashFlowShortfall && (
                  <div role="alert" className="flex items-start gap-2 rounded-md bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-800">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>While affordable today, this plan creates a future shortfall of {formatINR(metrics.firstCashFlowShortfall.deficit)} in {format(metrics.firstCashFlowShortfall.date, "MMM yyyy")}.</span>
                  </div>
                )}
              </div>

              <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground leading-relaxed flex gap-2">
                <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                <p>Affordability and investment opportunities use current confirmed income and living costs, changing only for recorded schedules. Long-term retirement estimates apply your inflation input and a fixed 8% annual post-retirement return assumption; income growth remains informational only. Not financial advice.</p>
              </div>
            </CardContent>
          </Card>
        </aside>

        {/* Right panel — chart-first */}
        <div className="order-1 flex flex-col gap-6 lg:order-2 lg:col-span-3">
          {!setup.canProjectRetirement ? (
            <PlanSetupPanel setup={setup} targetAge={localInputs.targetRetirementAge} />
          ) : (
          <>
          {/* Top KPI row */}
          <div className="grid grid-cols-3 gap-2 md:gap-4">
            <Card className="border-0 shadow-sm bg-white">
              <CardContent className="flex h-full min-w-0 flex-col gap-1 p-2.5 md:p-5">
                <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground md:text-xs md:tracking-wider">
                  <span className="md:hidden">Expense</span>
                  <span className="hidden md:inline">Expense @ Retirement</span>
                </span>
                <span className="truncate font-sans text-sm font-bold md:text-2xl">
                  <span className="md:hidden">{formatChartAmount(metrics.expenseAtRetirement)}<span className="text-[9px] font-medium">/mo</span></span>
                  <span className="hidden md:inline">{formatINR(metrics.expenseAtRetirement)}/mo</span>
                </span>
                <span className="mt-auto pt-1 text-[9px] leading-tight text-muted-foreground md:hidden">
                  At age {localInputs.targetRetirementAge} · inflated
                </span>
                <span className="mt-1 hidden text-xs text-muted-foreground md:inline">Inflation-adjusted planning estimate</span>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm bg-white">
              <CardContent className="flex h-full min-w-0 flex-col gap-1 p-2.5 md:p-5">
                <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground md:text-xs md:tracking-wider">
                  <span className="md:hidden">Needed</span>
                  <span className="hidden md:inline">Required Corpus</span>
                </span>
                <span className="truncate font-sans text-sm font-bold text-primary md:text-2xl">
                  <span className="md:hidden">{formatChartAmount(metrics.requiredCorpus)}</span>
                  <span className="hidden md:inline">{formatINR(metrics.requiredCorpus)}</span>
                </span>
                <span className="mt-auto pt-1 text-[9px] leading-tight text-muted-foreground md:hidden">
                  Funds {timeline.yearsInRetirement} retirement years
                </span>
                <span className="mt-1 hidden text-xs text-muted-foreground md:inline">To sustain lifestyle till {localInputs.lifeExpectancy}</span>
              </CardContent>
            </Card>

            <Card className={cn("border-0 shadow-sm", metrics.gap > 0 ? "bg-white" : "bg-emerald-50")}>
              <CardContent className="flex h-full min-w-0 flex-col gap-1 p-2.5 md:p-5">
                <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground md:text-xs md:tracking-wider">
                  <span className="md:hidden">Projected</span>
                  <span className="hidden md:inline">Accumulated Corpus</span>
                </span>
                <span className={cn("truncate font-sans text-sm font-bold md:text-2xl", metrics.gap > 0 ? "" : "text-emerald-700")}>
                  <span className="md:hidden">{formatChartAmount(metrics.projectedCorpus)}</span>
                  <span className="hidden md:inline">{formatINR(metrics.projectedCorpus)}</span>
                </span>
                <span className={cn(
                  "mt-auto pt-1 text-[9px] font-semibold leading-tight md:hidden",
                  metrics.gap > 0 ? "text-destructive" : "text-emerald-700",
                )}>
                  {corpusFundingPercentage}% funded
                </span>
                <span className={cn("flex min-w-0 items-center gap-0.5 text-[8px] font-medium md:mt-1 md:gap-1 md:text-xs", metrics.gap > 0 ? "text-destructive" : "text-emerald-600")}>
                  {metrics.gap > 0 ? (
                    <>
                      <AlertTriangle className="h-2.5 w-2.5 shrink-0 md:h-3 md:w-3" />
                      <span className="truncate md:hidden">Short {formatChartAmount(metrics.gap)}</span>
                      <span className="hidden md:inline">Shortfall: {formatINR(metrics.gap)}</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-2.5 w-2.5 shrink-0 md:h-3 md:w-3" />
                      <span className="truncate md:hidden">+{formatChartAmount(Math.abs(metrics.gap))}</span>
                      <span className="hidden md:inline">Surplus: {formatINR(Math.abs(metrics.gap))}</span>
                    </>
                  )}
                </span>
              </CardContent>
            </Card>
          </div>

          {/* The retirement graph — the heart of the app, visible at first glance */}
          <Card className="border-0 shadow-md bg-white">
            <CardHeader className="p-4 pb-2 md:p-6 md:pb-4">
              <div className="w-full">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-1.5">
                  <CardTitle className="font-serif text-base md:whitespace-nowrap md:text-lg">Retirement Projection Timeline</CardTitle>
                <Dialog open={isChartInfoOpen} onOpenChange={setIsChartInfoOpen}>
                  <DialogTrigger asChild>
                    <button
                      type="button"
                      aria-label="Explain the retirement chart lines"
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Info className="h-4 w-4" />
                    </button>
                  </DialogTrigger>
                  <DialogContent
                    className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md gap-0 overflow-y-auto overscroll-contain rounded-xl p-0 [&>button]:hidden"
                  >
                    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-background px-4 py-3">
                      <DialogTitle className="text-left text-sm font-semibold">
                        What each chart line means
                      </DialogTitle>
                      <DialogClose asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 rounded-full"
                          aria-label="Close chart explanation"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </DialogClose>
                    </div>
                    <div className="space-y-3 p-4 pt-3">
                    <DialogDescription className="text-left text-xs leading-relaxed text-muted-foreground">
                       Blue, green, and red show how much you may have. Orange shows how much you would need at that age.
                    </DialogDescription>
                    <div className="space-y-3 text-xs">
                      <div className="grid grid-cols-[40px_1fr] gap-2.5">
                        <span className="mt-2 h-[3px] rounded-full bg-primary" />
                        <div>
                          <p className="font-medium text-foreground">Accumulated Corpus — Base</p>
                          <p className="mt-0.5 leading-relaxed text-muted-foreground">
                             How much your investments are projected to be worth using your planned contributions and expected returns. It grows before retirement, then funds your expenses afterward.
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-[40px_1fr] gap-2.5">
                        <span className="mt-2 h-0 border-t-2 border-dashed border-emerald-500" />
                        <div>
                          <p className="font-medium text-emerald-600">Accumulated Corpus — Optimistic (+2%)</p>
                          <p className="mt-0.5 leading-relaxed text-muted-foreground">
                             How much you may have if annual investment returns are 2 percentage points higher than the base assumption.
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-[40px_1fr] gap-2.5">
                        <span className="mt-2 h-0 border-t-2 border-dashed border-rose-500" />
                        <div>
                          <p className="font-medium text-rose-600">Accumulated Corpus — Pessimistic (-2%)</p>
                          <p className="mt-0.5 leading-relaxed text-muted-foreground">
                             How much you may have if annual investment returns are 2 percentage points lower than the base assumption.
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-[40px_1fr] gap-2.5">
                        <span className="mt-2 h-0 border-t-[3px] border-dashed border-amber-600" />
                        <div>
                          <p className="font-medium text-amber-600">Lifestyle Corpus Needed</p>
                          <p className="mt-0.5 leading-relaxed text-muted-foreground">
                             How much you would need at each age to pay all remaining lifestyle expenses after applying your inflation assumption. This is a planning estimate and total balance, not a monthly expense.
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-[40px_1fr] gap-2.5">
                        <span className="mx-auto h-7 w-0 border-l-2 border-dashed border-primary" />
                        <div>
                          <p className="font-medium text-primary">Retirement marker</p>
                          <p className="mt-0.5 leading-relaxed text-muted-foreground">
                             The age when planned contributions stop and withdrawals for retirement expenses begin.
                          </p>
                        </div>
                      </div>
                    </div>
                    <p className="border-t pt-2 text-[10px] leading-relaxed text-muted-foreground">
                       A scenario line above orange means the plan is funded at that age. These are planning estimates, not guaranteed outcomes.
                    </p>
                    </div>
                  </DialogContent>
                </Dialog>
                  </div>
                <div
                  role="tablist"
                  aria-label="Retirement chart view"
                  className="grid w-full grid-cols-2 rounded-lg border border-border bg-muted/50 p-1 md:inline-flex md:w-auto md:flex-row"
                >
                  <Button
                    type="button"
                    role="tab"
                    aria-selected={chartView === "corpus"}
                    variant={chartView === "corpus" ? "default" : "ghost"}
                    size="sm"
                    className="h-8 min-w-0 flex-1 px-2 py-1 text-[11px] md:h-9 md:flex-none md:whitespace-nowrap md:px-3 md:text-sm"
                    onClick={() => setChartView("corpus")}
                  >
                    <span className="md:hidden">Corpus</span>
                    <span className="hidden md:inline">Corpus Accumulation</span>
                  </Button>
                  <Button
                    type="button"
                    role="tab"
                    aria-selected={chartView === "lifestyle"}
                    variant={chartView === "lifestyle" ? "default" : "ghost"}
                    size="sm"
                    className="h-8 min-w-0 flex-1 px-2 py-1 text-[11px] md:h-9 md:flex-none md:whitespace-nowrap md:px-3 md:text-sm"
                    onClick={() => setChartView("lifestyle")}
                  >
                    <span className="md:hidden">Monthly expense</span>
                    <span className="hidden md:inline">Monthly Lifestyle Expense</span>
                  </Button>
                  </div>
                </div>
                <CardDescription className="mt-2 max-w-3xl text-xs leading-relaxed md:mt-3 md:text-sm">
                  {chartView === "corpus"
                    ? "Compare the corpus you may accumulate with the corpus needed at every age. Above the orange line means funded."
                    : "See the inflation-adjusted monthly lifestyle cost used in the retirement forecast."}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="px-2 pb-4 pt-0 md:px-6 md:pb-6">
              {chartView === "lifestyle" && (
                <div className="mb-3 grid grid-cols-3 gap-2 md:mb-4 md:gap-3">
                  <div className="min-w-0 rounded-xl border border-border/60 bg-muted/30 px-2.5 py-2.5 md:px-4 md:py-3">
                    <p className="truncate text-[9px] font-medium uppercase tracking-wide text-muted-foreground md:text-xs">Today</p>
                    <p className="mt-1 truncate text-sm font-bold text-foreground md:text-lg">
                      <span className="md:hidden">{formatChartAmount(metrics.livingCostBaseline)}<span className="text-[9px] font-medium">/mo</span></span>
                      <span className="hidden md:inline">{formatINR(metrics.livingCostBaseline)}/mo</span>
                    </p>
                  </div>
                  <div className="min-w-0 rounded-xl border border-amber-200 bg-amber-50/60 px-2.5 py-2.5 dark:border-amber-900/60 dark:bg-amber-950/20 md:px-4 md:py-3">
                    <p className="truncate text-[9px] font-medium uppercase tracking-wide text-muted-foreground md:text-xs">
                      <span className="md:hidden">Retire · {targetRetirementYear}</span>
                      <span className="hidden md:inline">At retirement · {targetRetirementYear}</span>
                    </p>
                    <p className="mt-1 truncate text-sm font-bold text-amber-700 dark:text-amber-400 md:text-lg">
                      <span className="md:hidden">{formatChartAmount(metrics.expenseAtRetirement)}<span className="text-[9px] font-medium">/mo</span></span>
                      <span className="hidden md:inline">{formatINR(metrics.expenseAtRetirement)}/mo</span>
                    </p>
                  </div>
                  <div className="min-w-0 rounded-xl border border-border/60 bg-muted/30 px-2.5 py-2.5 md:px-4 md:py-3">
                    <p className="truncate text-[9px] font-medium uppercase tracking-wide text-muted-foreground md:text-xs">
                      Age {localInputs.lifeExpectancy}
                    </p>
                    <p className="mt-1 truncate text-sm font-bold text-foreground md:text-lg">
                      <span className="md:hidden">{formatChartAmount(finalLifestyleExpense)}<span className="text-[9px] font-medium">/mo</span></span>
                      <span className="hidden md:inline">{formatINR(finalLifestyleExpense)}/mo</span>
                    </p>
                  </div>
                </div>
              )}
              {chartView === "corpus" && (
                <div className="-mx-2 flex flex-nowrap items-center justify-start gap-4 overflow-x-auto px-2 pb-3 pt-1 text-[11px] text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:flex-wrap md:justify-center md:px-0 md:pb-4 md:text-xs">
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="h-0.5 w-4 bg-primary rounded-full"></span>
                    <span>Corpus (Base)</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="h-0 border-t-2 border-dashed border-emerald-500 w-4"></span>
                    <span>Corpus (+2%)</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="h-0 border-t-2 border-dashed border-rose-500 w-4"></span>
                    <span>Corpus (-2%)</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="h-0 border-t-[3px] border-dashed border-amber-600 w-4"></span>
                    <span>Corpus Needed</span>
                  </div>
                </div>
              )}

              {chartView === "corpus" && retirementChartPoint && (
                <div className="mb-2 grid grid-cols-2 gap-2 px-1 sm:hidden">
                  <div className="rounded-lg bg-primary/5 px-3 py-2">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Projected at {localInputs.targetRetirementAge}
                    </p>
                    <p className="mt-0.5 truncate text-sm font-bold text-primary">
                      {formatINR(Number(retirementChartPoint["Base Scenario"]) || 0)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-950/20">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Needed at {localInputs.targetRetirementAge}
                    </p>
                    <p className="mt-0.5 truncate text-sm font-bold text-amber-700 dark:text-amber-400">
                      {formatINR(Number(retirementChartPoint["Lifestyle Corpus Needed"]) || 0)}
                    </p>
                  </div>
                </div>
              )}

              <div className={cn("w-full", chartView === "lifestyle" ? "h-[320px] md:h-[410px]" : "h-[350px] min-[480px]:h-[390px] md:h-[500px]")}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={timelineChartData}
                    margin={isMobile
                      ? { top: 12, right: 2, left: -10, bottom: 18 }
                      : { top: 20, right: 12, left: 0, bottom: 22 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey={chartView === "corpus" ? "age" : "year"}
                      tickFormatter={(value) => chartView === "corpus" ? `${value}y` : String(value)}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={{ stroke: "hsl(var(--border))" }}
                      interval={isMobile
                        ? Math.max(0, Math.ceil(timelineChartData.length / 5) - 1)
                        : "preserveStartEnd"}
                      minTickGap={isMobile ? 8 : 16}
                      label={{
                        value: chartView === "corpus" ? "Age" : "Calendar year",
                        position: "insideBottom",
                        offset: -12,
                        fill: "hsl(var(--muted-foreground))",
                        fontSize: isMobile ? 9 : 10,
                      }}
                    />
                    <YAxis
                      yAxisId={chartView}
                      tickFormatter={formatChartAmount}
                      tick={{ fontSize: isMobile ? 9 : 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      tickCount={isMobile ? 5 : undefined}
                      width={isMobile ? 44 : 52}
                    />
                    <RechartsTooltip content={<CustomTooltip />} />
                    <ReferenceLine
                      yAxisId={chartView}
                      x={chartView === "corpus" ? localInputs.targetRetirementAge : targetRetirementYear}
                      stroke="hsl(var(--primary))"
                      strokeDasharray="3 3"
                      label={{
                        position: "insideTopLeft",
                        value: isMobile ? "Retire" : "Retirement",
                        fill: "hsl(var(--primary))",
                        fontSize: isMobile ? 9 : 11,
                        offset: isMobile ? 6 : 10,
                      }}
                    />

                    {chartView === "corpus" && (
                      <Area yAxisId="corpus" type="monotone" dataKey="Base Scenario" name="Accumulated Corpus (Base)" fill="hsl(var(--primary)/0.2)" stroke="hsl(var(--primary))" strokeWidth={isMobile ? 2.5 : 3} />
                    )}
                    {chartView === "corpus" && (
                      <Line yAxisId="corpus" type="monotone" dataKey="Optimistic (+2% ret)" name="Accumulated Corpus (+2%)" stroke="#10b981" strokeWidth={2} dot={false} strokeDasharray="5 5" />
                    )}
                    {chartView === "corpus" && (
                      <Line yAxisId="corpus" type="monotone" dataKey="Pessimistic (-2% ret)" name="Accumulated Corpus (-2%)" stroke="#f43f5e" strokeWidth={2} dot={false} strokeDasharray="5 5" />
                    )}
                    {chartView === "corpus" && (
                      <Line
                        yAxisId="corpus"
                        type="monotone"
                        dataKey="Lifestyle Corpus Needed"
                        name="Corpus Needed"
                        stroke="#d97706"
                        strokeWidth={2.5}
                        dot={false}
                        strokeDasharray="8 4"
                      />
                    )}
                    {chartView === "lifestyle" && (
                      <Area
                        yAxisId="lifestyle"
                        type="monotone"
                        dataKey="Monthly Lifestyle Expense"
                        name="Monthly Lifestyle Expense"
                        fill="#f59e0b"
                        fillOpacity={0.18}
                        stroke="#d97706"
                        strokeWidth={3}
                        dot={false}
                        activeDot={{ r: 5 }}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-3 border-t border-border/70 px-1 pt-4 lg:hidden">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Quick assumptions</h3>
                    <p className="text-[11px] text-muted-foreground">Change a value to update the chart instantly.</p>
                  </div>
                  {hasUnsavedChanges && (
                    <span className="shrink-0 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700">
                      Unsaved
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <Label htmlFor="quick-retirement-age" className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Retire at
                    </Label>
                    <div className="relative">
                      <Input
                        id="quick-retirement-age"
                        type="number"
                        inputMode="numeric"
                        min="18"
                        max="100"
                        value={localInputs.targetRetirementAge}
                        onChange={(event) => setLocalInputs((previous) => ({
                          ...previous,
                          targetRetirementAge: Number(event.target.value),
                        }))}
                        className="h-10 pr-10 font-semibold"
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">age</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="quick-life-expectancy" className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Plan until
                    </Label>
                    <div className="relative">
                      <Input
                        id="quick-life-expectancy"
                        type="number"
                        inputMode="numeric"
                        min="40"
                        max="125"
                        value={localInputs.lifeExpectancy}
                        onChange={(event) => setLocalInputs((previous) => ({
                          ...previous,
                          lifeExpectancy: Number(event.target.value),
                        }))}
                        className="h-10 pr-10 font-semibold"
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">age</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="quick-inflation" className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Inflation
                    </Label>
                    <div className="relative">
                      <Input
                        id="quick-inflation"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        max="30"
                        step="0.1"
                        value={localInputs.generalInflation}
                        onChange={(event) => setLocalInputs((previous) => ({
                          ...previous,
                          generalInflation: Number(event.target.value),
                        }))}
                        className="h-10 pr-8 font-semibold text-blue-600"
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">%</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="quick-additional-sip" className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Extra SIP / mo
                    </Label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-muted-foreground">₹</span>
                      <Input
                        id="quick-additional-sip"
                        type="number"
                        inputMode="numeric"
                        min="0"
                        step="1"
                        value={selectedTakeHomeInvestment}
                        onChange={(event) => setLocalInputs((previous) => ({
                          ...previous,
                          monthlyContributionOverride: Math.round(Number(event.target.value)),
                          investSurplus: false,
                        }))}
                        className={cn(
                          "h-10 pl-7 font-semibold text-blue-600",
                          metrics.affordabilityWarning && "border-amber-500 focus-visible:ring-amber-500",
                        )}
                        aria-describedby={metrics.affordabilityWarning ? "quick-sip-warning" : undefined}
                      />
                    </div>
                  </div>
                </div>

                {metrics.affordabilityWarning && (
                  <p id="quick-sip-warning" role="alert" className="mt-2 text-[11px] leading-relaxed text-amber-700">
                    {metrics.affordabilityWarning}
                  </p>
                )}

                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={!hasUnsavedChanges || Boolean(metrics.affordabilityWarning)}
                  className="mt-3 h-10 w-full shadow-sm"
                >
                  {hasUnsavedChanges ? "Save and keep exploring" : "Plan saved"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {metrics.gap > 0 && (
            <Card className="border border-destructive/20 shadow-sm bg-destructive/5 overflow-hidden relative">
              <div className="absolute top-0 left-0 w-1 h-full bg-destructive"></div>
              <CardContent className="p-6 flex flex-col sm:flex-row items-center justify-between gap-6">
                <div>
                  <h3 className="text-lg font-serif font-semibold text-destructive mb-1">Action Required</h3>
                  <p className="text-sm text-destructive/80">
                    To reach your target corpus of {formatINR(metrics.requiredCorpus)} by age {localInputs.targetRetirementAge}, you need to increase your investments.
                  </p>
                  {metrics.depletionAge && (
                    <p className="text-xs text-destructive mt-2 font-medium flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      At current rate, funds may deplete around age {metrics.depletionAge}.
                    </p>
                  )}
                </div>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-destructive/10 text-center min-w-[200px]">
                  {metrics.monthsToRetirement === 0 ? (
                    <>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Lump Sum Needed</p>
                      <p className="text-2xl font-sans font-bold text-destructive">{formatINR(metrics.requiredLumpSumToday)}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">Retirement starts in less than one month</p>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Extra SIP Needed</p>
                      <p className="text-2xl font-sans font-bold text-destructive">+{formatINR(metrics.extraSipRequired)}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                      <p className="text-[10px] text-muted-foreground mt-1">Starting today</p>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {metrics.gap <= 0 && (
            <Card className="border border-emerald-500/20 shadow-sm bg-emerald-500/5 overflow-hidden relative">
              <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
              <CardContent className="p-6 flex items-center gap-4">
                <div className="h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-lg font-serif font-semibold text-emerald-700 mb-1">On Track!</h3>
                  <p className="text-sm text-emerald-600/80">
                    Your current corpus and SIPs are sufficient to reach your required corpus by age {localInputs.targetRetirementAge}. Keep it up!
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <Collapsible open={isReadinessOpen} onOpenChange={setIsReadinessOpen} asChild>
            <Card className="relative border border-primary/10 bg-gradient-to-r from-primary/[0.04] to-emerald-500/[0.04] shadow-sm">
              <CardHeader className={cn("pr-16", isReadinessOpen ? "pb-3" : "pb-6")}>
                <div className="min-w-0 space-y-1.5 flex-1">
                  <CardTitle className="text-lg font-serif">Your retirement outlook</CardTitle>
                  {!isReadinessOpen && (
                    <div className="mt-2 space-y-2.5">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg border border-primary/10 bg-white/60 px-3 py-2.5">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Until retirement</p>
                          <p data-testid="text-retirement-years-to-retirement" className="mt-0.5 text-base font-bold text-foreground">
                            {timeToRetirementLabel}
                          </p>
                        </div>
                        <div className="rounded-lg border border-primary/10 bg-white/60 px-3 py-2.5">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Retirement span</p>
                          <p data-testid="text-retirement-years-in-retirement" className="mt-0.5 text-base font-bold text-foreground">
                            {timeline.yearsInRetirement} years
                          </p>
                        </div>
                      </div>
                      {readiness.assumptionsValid ? (
                        <div className="divide-y divide-primary/10 rounded-lg border border-primary/10 bg-white/45 px-3 text-sm">
                          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-2 text-xs sm:text-sm">
                            <span className="min-w-0 text-muted-foreground">
                              Current plan{" "}
                              <strong className="text-foreground">
                              {readiness.currentPlanRetirementAge === null ? "not yet funded" : `supports age ${readiness.currentPlanRetirementAge}`}
                              </strong>
                            </span>
                            <span className="whitespace-nowrap text-muted-foreground">
                              Target age{" "}
                              <strong className="text-foreground">{Math.round(readiness.targetAge)}</strong>
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3 py-2">
                            <span className="text-muted-foreground">With full surplus</span>
                            <strong className="text-right text-emerald-700">
                              {readiness.fullSurplusRetirementAge === null ? "Still falls short" : `Could support age ${readiness.fullSurplusRetirementAge}`}
                            </strong>
                          </div>
                        </div>
                      ) : (
                        <p className="rounded-lg border border-primary/10 bg-white/45 px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
                          Correct the date of birth and retirement ages to see your outlook.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </CardHeader>
              <div className="absolute right-4 top-4 md:right-6 md:top-6">
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 rounded-full"
                    aria-label={isReadinessOpen ? "Collapse retirement outlook" : "Expand retirement outlook"}
                  >
                    <ChevronDown className={cn("h-5 w-5 transition-transform duration-200", isReadinessOpen && "rotate-180")} />
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  {readiness.assumptionsValid ? (
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-xl border bg-white/80 p-4">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Your goal</p>
                        <p className="mt-2 text-sm leading-relaxed">
                          You want to retire at age <strong className="text-base text-foreground">{Math.round(readiness.targetAge)}</strong> and fund your lifestyle until age {Math.round(readiness.lifeExpectancy)}.
                        </p>
                      </div>
                      <div className={cn(
                        "rounded-xl border p-4",
                        readiness.targetIsFunded ? "border-emerald-200 bg-emerald-50/80" : "border-amber-200 bg-amber-50/80",
                      )}>
                        <p className={cn(
                          "text-xs font-medium uppercase tracking-wider",
                          readiness.targetIsFunded ? "text-emerald-700" : "text-amber-700",
                        )}>At your current pace</p>
                        <p className="mt-2 text-sm leading-relaxed">
                          {readiness.currentPlanRetirementAge === null ? (
                            <>Your current plan is not projected to fully fund retirement before age {Math.round(readiness.lifeExpectancy)}.</>
                          ) : readiness.currentPlanRetirementAge <= readiness.targetAge ? (
                            <>You are on track for your goal and may be ready by age <strong className="text-base">{readiness.currentPlanRetirementAge}</strong>.</>
                          ) : (
                            <>Your current investments may support retirement around age <strong className="text-base">{readiness.currentPlanRetirementAge}</strong>.</>
                          )}
                        </p>
                        {!readiness.targetIsFunded && (
                          <p className="mt-2 border-t border-amber-200 pt-2 text-xs leading-relaxed text-amber-800">
                            {readiness.monthsToRetirement === 0 ? (
                              <>
                                Retirement starts in less than one month, so a monthly SIP cannot close the gap. You would need about{" "}
                                <strong>{formatINR(readiness.requiredLumpSumTodayAtTarget)} as a lump sum today</strong>, or a later retirement age.
                              </>
                            ) : (
                              <>To retire at {Math.round(readiness.targetAge)}, invest about <strong>{formatINR(readiness.extraSipRequiredAtTarget)}/month more</strong> starting now.</>
                            )}
                          </p>
                        )}
                      </div>
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4">
                        <p className="text-xs font-medium uppercase tracking-wider text-emerald-700">If you invest the surplus</p>
                        <p className="mt-2 text-sm leading-relaxed">
                          {readiness.unallocatedSurplus <= 0 ? (
                            <>There is no remaining monthly surplus available to model as an additional SIP.</>
                          ) : readiness.fullSurplusRetirementAge === null ? (
                            <>Investing your remaining <strong>{formatINR(readiness.unallocatedSurplus)}/month</strong> improves the plan, but does not fully fund retirement before age {Math.round(readiness.lifeExpectancy)}.</>
                          ) : (
                            <>Investing your remaining <strong>{formatINR(readiness.unallocatedSurplus)}/month</strong> could make retirement affordable around age <strong className="text-base text-emerald-800">{readiness.fullSurplusRetirementAge}</strong>.</>
                          )}
                        </p>
                      </div>
                      <div className="mt-4">
                        <Button asChild size="sm" variant="outline">
                          <Link href="/advice">Book consultation</Link>
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>Enter a valid date of birth, target retirement age, and life expectancy to calculate this summary.</span>
                    </div>
                  )}
                  <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                    Ages are planning estimates based on your recorded investments and contributions, expected returns, confirmed current cash flow, loan payoff dates, and your inflation assumption. Income growth is shown only in the informational surplus outlook.
                  </p>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          <Collapsible open={isMonthlyPlanOpen} onOpenChange={setIsMonthlyPlanOpen} asChild>
            <Card className="relative border-0 shadow-sm bg-white">
              <CardHeader className={cn("pr-16", isMonthlyPlanOpen ? "pb-3" : "pb-6")}>
                <div className="space-y-1.5 flex-1 min-w-0">
                  <CardTitle className="text-lg font-serif">Connected monthly plan</CardTitle>
                  <CardDescription className="break-words">
                    Your retirement baseline updates from budgets and non-reimbursable ledger spending.
                  </CardDescription>
                </div>
              </CardHeader>
              <div className="absolute right-4 top-4 md:right-6 md:top-6">
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 rounded-full"
                    aria-label={isMonthlyPlanOpen ? "Collapse connected monthly plan" : "Expand connected monthly plan"}
                  >
                    <ChevronDown className={cn("h-5 w-5 transition-transform duration-200", isMonthlyPlanOpen && "rotate-180")} />
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-sm">
                    <div><p className="text-xs text-muted-foreground">Net income</p><p className="font-semibold">{formatINR(metrics.netMonthlyIncome)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Actual monthly average</p><p className="font-semibold">{formatINR(metrics.actualAverageSpending)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Monthly budget plan</p><p className="font-semibold">{formatINR(metrics.budgetTotal)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Retirement lifestyle plan</p><p className="font-semibold text-primary">{formatINR(metrics.livingCostBaseline)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Active loan EMIs</p><p className="font-semibold">{formatINR(metrics.activeEmi)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Cash surplus before SIPs</p><p className="font-semibold">{formatINR(metrics.availableSurplus)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Salary-linked PF</p><p className="font-semibold">{formatINR(metrics.linkedPFContribution)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Non-linked SIP commitments</p><p className="font-semibold">{formatINR(metrics.nonLinkedSipCommitments)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Remaining surplus</p><p className="font-semibold text-emerald-700">{formatINR(metrics.unallocatedSurplus)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Selected additional SIP</p><p className="font-semibold">{formatINR(metrics.selectedTakeHomeInvestment)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Modeled additional SIP</p><p className="font-semibold">{formatINR(metrics.effectiveTakeHomeInvestment)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Total take-home investment</p><p className="font-semibold">{formatINR(metrics.modeledTakeHomeContribution)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Modeled contribution</p><p className="font-semibold">{formatINR(metrics.modeledMonthlyContribution)}</p></div>
                  </div>
                  <div className="mt-4 pt-3 border-t text-xs text-muted-foreground flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
                    <span>
                      <strong className="text-foreground capitalize">{metrics.baselineDriver}</strong> define the retirement lifestyle.
                      {" "}Cash-flow affordability uses {formatINR(metrics.cashFlowCostBaseline)} (the higher of plan and actuals); actuals use {metrics.actualAverageMethod}.
                    </span>
                    <span>Income sources grow using their individual rates (current weighted rate: {metrics.effectiveIncomeGrowthRate.toFixed(2)}%); EMIs stop at modeled payoff.</span>
                  </div>
                  {metrics.oneTimeIncomeBeforeRetirement > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Future one-time income included once before retirement: {formatINR(metrics.oneTimeIncomeBeforeRetirement)}.
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Loan EMIs come from Loans and should not be entered again as ordinary ledger expenses.
                  </p>
                  {metrics.affordabilityWarning && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>{metrics.affordabilityWarning} The projection caps the modeled additional SIP at today’s affordable surplus.</span>
                    </div>
                  )}
                  {!metrics.assumptionsValid && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/5 p-3 text-xs text-destructive">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>Check date of birth and ages. The estimate has safely clamped invalid age ranges.</span>
                    </div>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
