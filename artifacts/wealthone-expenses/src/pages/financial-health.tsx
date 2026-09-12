import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Landmark, PiggyBank, Plus, ShieldCheck, Wallet, Info, TrendingUp, AlertTriangle } from "lucide-react";
import { useInvestments } from "@/hooks/use-investments";
import { useLoans } from "@/hooks/use-loans";
import { useIncomeSources, calculateIncomeMetrics } from "@/hooks/use-income";
import { useExpenses } from "@/hooks/use-expenses";
import { useBudgets } from "@/hooks/use-budgets";
import { calculateEmergencyFundMetrics, calculateFinancialHealthScore, calculateNetWorth } from "@/lib/financial-metrics";
import { calculateActualMonthlyAverage } from "@/lib/retirement-projection";
import { budgetTotalForMonth, hasEffectiveBudgetPlan, loanMonthlyPayment } from "@/lib/storage";
import { formatCompactINR, formatINR } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/wealthone-design-system/components/ui/card";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Label } from "@workspace/wealthone-design-system/components/ui/label";
import { QueryErrorState } from "@/components/query-error-state";
import { useFinancialHealthData, useSaveNetWorthSnapshot, useUpdateEmergencyFund } from "@/hooks/use-financial-health";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import { cn } from "@workspace/wealthone-design-system/lib/utils";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, Cell, ReferenceLine } from "recharts";
import { format } from "date-fns";
import { FinancialHealthSummary } from "@/components/financial-health-summary";
import { financialHealthCompletionCallbacks } from "@/lib/financial-health-analytics";

export default function FinancialHealth() {
  const investmentsQuery = useInvestments();
  const loansQuery = useLoans();
  const incomesQuery = useIncomeSources();
  const expensesQuery = useExpenses();
  const budgetsQuery = useBudgets();
  const healthDataQuery = useFinancialHealthData();
  const updateEmergency = useUpdateEmergencyFund();
  const saveSnapshot = useSaveNetWorthSnapshot();
  const { toast } = useToast();

  const [targetMonths, setTargetMonths] = useState<number | null>(null);
  const [reserveBalance, setReserveBalance] = useState<number | null>(null);
  const [monthlyContribution, setMonthlyContribution] = useState<number | null>(null);

  const { data: investments = [] } = investmentsQuery;
  const { data: loans = [] } = loansQuery;
  const { data: incomes = [] } = incomesQuery;
  const { data: expenses = [] } = expensesQuery;
  const { data: budgets = [] } = budgetsQuery;
  const target = targetMonths ?? healthDataQuery.data?.emergencyFund.targetMonths ?? 6;
  const reserve = reserveBalance ?? healthDataQuery.data?.emergencyFund.reserveBalance ?? 0;
  const contribution = monthlyContribution ?? healthDataQuery.data?.emergencyFund.monthlyContribution ?? 0;
  
  const loading = [investmentsQuery, loansQuery, incomesQuery, expensesQuery, budgetsQuery, healthDataQuery]
    .some((query) => query.isLoading);
  const failed = [investmentsQuery, loansQuery, incomesQuery, expensesQuery, budgetsQuery, healthDataQuery]
    .some((query) => query.isError);

  const metrics = useMemo(() => {
    const netWorth = calculateNetWorth({ investments, loans, cashBalance: reserve });
    const asOf = new Date();
    const actualSpending = calculateActualMonthlyAverage(expenses, asOf, loans);
    const monthlyNeeds = hasEffectiveBudgetPlan(budgets)
      ? budgetTotalForMonth(budgets, asOf)
      : actualSpending.average;
    const emergency = calculateEmergencyFundMetrics({
      reserveBalance: reserve,
      monthlyEssentialExpenses: monthlyNeeds,
      targetMonths: target,
      monthlyContribution: contribution,
      asOf,
    });
    const monthlyIncome = incomes.reduce(
      (sum, income) => sum + calculateIncomeMetrics(income).monthlyNet,
      0,
    );
    const monthlyDebtPayments = loans.reduce((sum, loan) => sum + loanMonthlyPayment(loan), 0);
    const health = calculateFinancialHealthScore({
      monthlyNetIncome: incomes.length > 0 ? monthlyIncome : undefined,
      monthlyEssentialExpenses: monthlyNeeds > 0 ? monthlyNeeds : undefined,
      monthlyDebtPayments,
      monthlySavings: incomes.length > 0 ? Math.max(0, monthlyIncome - monthlyNeeds - monthlyDebtPayments) : undefined,
      emergencyReserve: reserve,
      emergencyTargetMonths: target,
      totalAssets: investments.length > 0 || reserve > 0 ? netWorth.totalAssets : undefined,
      totalLiabilities: loans.length > 0 ? netWorth.totalLiabilities : undefined,
    });
    return {
      ...netWorth,
      monthlyNeeds,
      spendingMethod: hasEffectiveBudgetPlan(budgets)
        ? "current budget schedule"
        : actualSpending.method,
      emergency,
      health,
    };
  }, [budgets, contribution, expenses, incomes, investments, loans, reserve, target]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground" role="status">
        <div className="flex flex-col items-center gap-3">
           <div className="h-8 w-8 animate-pulse rounded-full bg-primary/20"></div>
           <p className="text-sm font-medium">Building your financial health view…</p>
        </div>
      </div>
    );
  }
  if (failed) return <QueryErrorState onRetry={() => investmentsQuery.refetch()} />;
  const hasPosition = investments.length > 0 || loans.length > 0 || reserve > 0;

  return (
    <div className="space-y-6 pb-10 md:space-y-8 animate-in fade-in duration-500">
      <div className="max-w-3xl">
        <h1 className="font-serif text-3xl tracking-tight text-foreground md:text-4xl">Financial Health</h1>
        <p className="mt-2 md:mt-3 text-sm md:text-base text-muted-foreground leading-relaxed">
          Review your score, understand each factor, and strengthen your net worth and emergency reserve.
        </p>
      </div>

      <FinancialHealthSummary
        result={metrics.health}
        snapshots={healthDataQuery.data?.netWorthSnapshots ?? []}
      />

      {!hasPosition ? (
        <Card className="border-dashed bg-muted/10 border-2">
          <CardContent className="flex flex-col items-center p-8 md:p-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary mb-5 md:mb-6">
              <Wallet className="h-8 w-8" />
            </div>
            <h2 className="font-serif text-xl md:text-2xl font-medium">Build your first net-worth baseline</h2>
            <p className="mt-2 md:mt-3 max-w-lg text-sm text-muted-foreground leading-relaxed">
              Add your investments and liabilities to calculate your net worth. We keep assets and debt visibly separate, so a partial picture is never presented as complete.
            </p>
            <div className="mt-6 md:mt-8 flex flex-col sm:flex-row justify-center gap-3 w-full sm:w-auto">
              <Button asChild size="lg" className="px-6" data-testid="link-add-assets">
                <Link href="/investments"><Plus className="mr-2 h-4 w-4" /> Add assets</Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="px-6 bg-transparent" data-testid="link-add-liabilities">
                <Link href="/loans">Add liabilities</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              { label: "Assets", value: metrics.totalAssets, icon: PiggyBank, trend: "up" },
              { label: "Liabilities", value: metrics.totalLiabilities, icon: Landmark, trend: "down" },
              { label: "Net worth", value: metrics.netWorth, icon: Wallet, trend: metrics.netWorth >= 0 ? "up" : "down" },
            ].map(({ label, value, icon: Icon }) => (
              <Card key={label} className="border-border/60 shadow-sm overflow-hidden transition-all hover:border-border hover:shadow-md">
                <CardContent className="p-4 pt-[10px] md:p-5 md:pt-[10px]" data-testid="financial-health-metric-content">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <Icon className="h-4 w-4" /> {label}
                    </div>
                  </div>
                  <p className={cn(
                    "mt-3 financial-number text-2xl md:text-3xl font-bold tracking-tight",
                    label === "Assets" && value > 0
                      ? "text-positive"
                      : label === "Liabilities" && value > 0
                        ? "text-negative"
                        : label === "Net worth" && value < 0
                          ? "text-negative"
                          : "text-foreground"
                  )} data-testid={`text-${label.toLowerCase().replace(" ", "-")}`} title={formatINR(value)}>
                    {formatCompactINR(value)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="border-border/60 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="font-serif text-xl">Composition & Trend</CardTitle>
              <CardDescription>Assets and liabilities shown on the same scale, tracked monthly.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-8 md:space-y-10">
              {/* Composition Bar */}
              <div>
                <div
                  className="space-y-4 md:space-y-5"
                  role="img"
                  aria-label={`Assets ${formatINR(metrics.totalAssets)}; liabilities ${formatINR(metrics.totalLiabilities)}; net worth ${formatINR(metrics.netWorth)}`}
                >
                  {[
                    { label: "Assets", value: metrics.totalAssets, className: "bg-positive", pattern: "pattern-boxes text-positive/20" },
                    { label: "Liabilities", value: metrics.totalLiabilities, className: "bg-negative", pattern: "pattern-diagonal-lines text-negative/20" },
                  ].map((entry) => {
                    const percentage = Math.max(2, (entry.value / Math.max(metrics.totalAssets, metrics.totalLiabilities, 1)) * 100);
                    return (
                      <div key={entry.label} className="group">
                        <div className="mb-1.5 flex justify-between text-sm items-end">
                          <span className="font-medium text-foreground">{entry.label}</span>
                          <span className={cn(
                            "financial-number",
                            entry.value > 0
                              ? entry.label === "Assets" ? "text-positive" : "text-negative"
                              : "text-foreground",
                          )}>{formatINR(entry.value)}</span>
                        </div>
                        <div className="h-3 md:h-4 w-full rounded-full bg-muted/60 overflow-hidden">
                          <div 
                            className={cn("h-full transition-all duration-1000 ease-out", entry.className)} 
                            style={{ width: `${percentage}%` }} 
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  {[
                    { title: "Asset composition", entries: Object.entries(metrics.assetComposition), empty: "No assets recorded" },
                    { title: "Liability composition", entries: Object.entries(metrics.liabilityComposition), empty: "No liabilities recorded" },
                  ].map((section) => (
                    <div key={section.title} className="rounded-xl border border-border/60 bg-muted/10 p-3 md:p-4">
                      <table className="w-full text-xs md:text-sm">
                        <caption className="mb-2 text-left font-semibold text-foreground">{section.title}</caption>
                        <tbody>
                          {section.entries.length > 0 ? section.entries.map(([category, value]) => (
                            <tr key={category} className="border-t border-border/40 first:border-0">
                              <th scope="row" className="py-2 text-left font-medium text-muted-foreground">{category}</th>
                              <td className={cn(
                                "py-2 text-right financial-number",
                                value > 0
                                  ? section.title === "Asset composition" ? "text-positive" : "text-negative"
                                  : "text-foreground",
                              )}>{formatINR(value)}</td>
                            </tr>
                          )) : (
                            <tr><td className="py-2 text-muted-foreground">{section.empty}</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </div>

              {/* Trend Chart */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold">Historical Net Worth</h3>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={saveSnapshot.isPending}
                    onClick={() => saveSnapshot.mutate({
                      month: format(new Date(), "yyyy-MM"),
                      assets: metrics.totalAssets,
                      liabilities: metrics.totalLiabilities,
                      netWorth: metrics.netWorth,
                      healthScore: metrics.health.score,
                    }, financialHealthCompletionCallbacks("financial_health", "snapshot_saved", () => {
                        toast({ title: "Monthly snapshot saved successfully." });
                    }))}
                    data-testid="button-save-net-worth-snapshot"
                    className="h-8 text-xs font-medium"
                  >
                    {saveSnapshot.isPending ? "Saving…" : "Save snapshot"}
                  </Button>
                </div>
                
                {healthDataQuery.data?.netWorthSnapshots.length ? (
                  <div className="h-[200px] md:h-[240px] w-full" aria-label="Net worth snapshot trend">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={healthDataQuery.data.netWorthSnapshots.slice(-12)} margin={{ top: 10, right: 0, left: 0, bottom: 0 }} barGap={8}>
                        <XAxis 
                          dataKey="month" 
                          tickFormatter={(val) => val.slice(5)} 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} 
                          dy={10} 
                        />
                        <YAxis hide domain={['auto', 'auto']} />
                        <RechartsTooltip
                          cursor={{ fill: "hsl(var(--muted)/0.4)", radius: 4 }}
                          content={({ active, payload, label }) => {
                            if (active && payload && payload.length) {
                              const val = payload[0].value as number;
                              return (
                                <div className="rounded-lg border border-border bg-card p-2 md:p-3 shadow-lg">
                                  <div className="font-medium text-muted-foreground text-tiny md:text-xs mb-1 md:mb-1.5">{label}</div>
                                  <div className={cn(
                                    "financial-number text-sm md:text-base font-bold",
                                    val > 0 ? "text-positive" : val < 0 ? "text-negative" : "text-foreground",
                                  )}>
                                    {formatINR(val)}
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <ReferenceLine y={0} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                        <Bar dataKey="netWorth" radius={[4, 4, 0, 0]} maxBarSize={48} animationDuration={1000}>
                          {healthDataQuery.data.netWorthSnapshots.slice(-12).map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.netWorth >= 0 ? "hsl(var(--primary)/0.9)" : "hsl(var(--destructive)/0.9)"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <table className="sr-only">
                      <caption className="text-left font-semibold">Trend data</caption>
                      <tbody>
                        {healthDataQuery.data.netWorthSnapshots.slice(-12).map((snapshot) => (
                          <tr key={snapshot.month}>
                            <th className="py-1 text-left font-normal">{snapshot.month}</th>
                            <td className="text-right">{formatINR(snapshot.netWorth)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="flex h-[180px] md:h-[200px] flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 text-center p-4">
                    <TrendingUp className="h-8 w-8 text-muted-foreground/30 mb-3" />
                    <p className="text-sm font-medium text-foreground">No history yet</p>
                    <p className="mt-1 max-w-[250px] text-xs text-muted-foreground">Save your first snapshot to start tracking your net worth trend.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="border-border/60 shadow-sm overflow-hidden bg-card">
        <div className="grid md:grid-cols-[1fr_340px] lg:grid-cols-[1fr_380px] divide-y md:divide-y-0 md:divide-x border-border/40">
          <div className="p-5 md:p-8 flex flex-col">
            <div className="flex items-center gap-2 text-primary mb-2">
              <ShieldCheck className="h-5 w-5" />
              <h2 className="font-serif text-xl font-medium">Emergency reserve</h2>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-lg mb-6 md:mb-8">
              Your reserve is the liquid balance you enter here. It stays strictly separate from long-term investments.
            </p>
            
            <div className="flex-1 flex flex-col justify-center">
              <div className="space-y-1">
                <p className="text-tiny md:text-xs font-medium text-muted-foreground uppercase tracking-wider">Months of living covered</p>
                <div className="flex items-baseline gap-3">
                  <p className="financial-number text-4xl md:text-5xl font-bold tracking-tight text-foreground" data-testid="text-months-covered">
                    {metrics.emergency.monthsCovered === null ? "—" : metrics.emergency.monthsCovered.toFixed(1)}
                  </p>
                  <span className="text-xs md:text-sm text-muted-foreground font-medium pb-1">/ {target} target</span>
                </div>
              </div>

              <div className="mt-6 md:mt-8 space-y-3 md:space-y-4">
                <div className="flex items-start gap-3 text-xs md:text-sm">
                  <div className="mt-0.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  <p>
                    <span className="font-medium text-foreground">{formatINR(metrics.emergency.reserveBalance)}</span> liquid reserve entered
                  </p>
                </div>
                <div className="flex items-start gap-3 text-xs md:text-sm">
                  <div className="mt-0.5 w-1.5 h-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                  <p>
                    {metrics.monthlyNeeds ? (
                      <><span className="font-medium text-foreground">{formatINR(metrics.monthlyNeeds)}/mo</span> essential expenses (based on {metrics.spendingMethod})</>
                    ) : "Add a budget or living expenses to calculate coverage"}
                  </p>
                </div>
              </div>

              {metrics.emergency.dataAvailable && (
                <div className={cn(
                  "mt-6 md:mt-8 flex items-start gap-3 rounded-xl p-3 md:p-4 text-xs md:text-sm leading-relaxed border",
                  metrics.emergency.shortfall > 0 
                    ? "bg-warning-background border-warning/30 text-warning dark:bg-warning-background dark:border-warning/30 dark:text-warning"
                    : "bg-positive-background border-positive/30 text-positive dark:bg-positive-background dark:border-positive/30 dark:text-positive"
                )}>
                  {metrics.emergency.shortfall > 0 ? (
                    <AlertTriangle className="h-4 w-4 md:h-5 md:w-5 shrink-0 text-warning mt-0.5" />
                  ) : (
                    <ShieldCheck className="h-4 w-4 md:h-5 md:w-5 shrink-0 text-positive mt-0.5" />
                  )}
                  <div>
                    {metrics.emergency.shortfall > 0 ? (
                      <>
                        <p className="font-semibold mb-1 text-warning">Shortfall: <span className="text-negative">{formatINR(metrics.emergency.shortfall)}</span></p>
                        <p>At your current contribution rate, you will hit your target in <strong>{metrics.emergency.monthsToTarget === null ? "—" : `${metrics.emergency.monthsToTarget} months`}</strong>.</p>
                      </>
                    ) : (
                      <>
                        <p className="font-semibold mb-1 text-positive">Target fully funded</p>
                        <p>Keep this reserve highly accessible in a savings account or liquid fund. Direct all future surplus to investments.</p>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-6 md:mt-8 pt-5 md:pt-6 border-t border-border/40 flex items-start gap-2">
              <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />
              <p className="text-tiny md:text-xs leading-relaxed text-muted-foreground">
                Audit note: Planned reserve contributions reduce your current investable surplus until the target is met. Reserve cash is part of your net worth, but never added to retirement corpus projections.
              </p>
            </div>
          </div>
          
          <div className="bg-muted/10 p-5 md:p-8 flex flex-col">
            <h3 className="text-sm font-semibold mb-5 md:mb-6 flex items-center gap-2 text-foreground">
               Configure Reserve
            </h3>
            <div className="space-y-4 md:space-y-5 flex-1">
              <div className="space-y-2">
                <Label htmlFor="reserve-target" className="text-tiny md:text-xs uppercase tracking-wider text-muted-foreground">Target months</Label>
                <div className="relative">
                  <Input 
                    id="reserve-target" 
                    type="number" 
                    min={1} 
                    max={24} 
                    value={target} 
                    onChange={(event) => setTargetMonths(Math.min(24, Math.max(1, Number(event.target.value) || 1)))} 
                    data-testid="input-reserve-target" 
                    className="pl-3 pr-16 bg-card"
                  />
                  <span className="absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground pointer-events-none">
                    months
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reserve-balance" className="text-tiny md:text-xs uppercase tracking-wider text-muted-foreground">Current balance</Label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-3 flex items-center text-muted-foreground pointer-events-none">₹</span>
                  <Input 
                    id="reserve-balance" 
                    type="number" 
                    min={0} 
                    value={reserve} 
                    onChange={(event) => setReserveBalance(Math.max(0, Number(event.target.value) || 0))} 
                    data-testid="input-reserve-balance" 
                    className="pl-8 bg-card"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reserve-contribution" className="text-tiny md:text-xs uppercase tracking-wider text-muted-foreground">Monthly contribution</Label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-3 flex items-center text-muted-foreground pointer-events-none">₹</span>
                  <Input 
                    id="reserve-contribution" 
                    type="number" 
                    min={0} 
                    value={contribution} 
                    onChange={(event) => setMonthlyContribution(Math.max(0, Number(event.target.value) || 0))} 
                    data-testid="input-reserve-contribution" 
                    className="pl-8 bg-card"
                  />
                </div>
                <p className="text-tiny md:text-tiny text-muted-foreground leading-tight pt-1">Amount allocated each month until target is reached.</p>
              </div>
            </div>
            
            <div className="mt-6 md:mt-8 pt-4 border-t border-border/40">
              <Button
                className="w-full shadow-sm"
                disabled={updateEmergency.isPending || (target === healthDataQuery.data?.emergencyFund.targetMonths && reserve === healthDataQuery.data?.emergencyFund.reserveBalance && contribution === healthDataQuery.data?.emergencyFund.monthlyContribution)}
                onClick={() => updateEmergency.mutate({
                  targetMonths: target,
                  reserveBalance: reserve,
                  monthlyContribution: contribution,
                }, financialHealthCompletionCallbacks("financial_health", "emergency_fund_saved", () => {
                    setTargetMonths(null);
                    setReserveBalance(null);
                    setMonthlyContribution(null);
                    toast({ title: "Emergency target updated successfully." });
                }))}
                data-testid="button-save-reserve-target"
              >
                {updateEmergency.isPending ? "Saving…" : "Save configuration"}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
