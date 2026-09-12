import React from "react";
import { ArrowRight, CheckCircle2, CircleDashed, ShieldCheck, TrendingDown, TrendingUp, AlertCircle, Info } from "lucide-react";
import { Link } from "wouter";
import type { NetWorthSnapshot } from "@/lib/storage";
import type { calculateFinancialHealthScore } from "@/lib/financial-metrics";
import { formatCompactINR } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@workspace/wealthone-design-system/components/ui/card";
import { cn } from "@workspace/wealthone-design-system/lib/utils";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { trackEvent } from "@/lib/analytics";
import { Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";

type HealthResult = ReturnType<typeof calculateFinancialHealthScore>;

export function getFinancialHealthHistory(snapshots: NetWorthSnapshot[]) {
  return snapshots
    .map((snapshot) => ({
      month: snapshot.month,
      label: (() => {
        const match = snapshot.month.match(/^(\d{4})-(\d{2})/);
        if (!match) return snapshot.month;
        return new Intl.DateTimeFormat("en", { month: "short", year: "numeric" })
          .format(new Date(Number(match[1]), Number(match[2]) - 1, 1));
      })(),
      score: typeof snapshot.healthScore === "number"
        && Number.isFinite(snapshot.healthScore)
        && snapshot.healthScore >= 0
        && snapshot.healthScore <= 100
        ? snapshot.healthScore
        : null,
    }))
    .sort((left, right) => left.month.localeCompare(right.month))
    .slice(-12);
}

export type CompactFinancialHealthState = "incomplete" | "healthy" | "warning" | "critical";

export const getCompactFinancialHealthState = (result: HealthResult): CompactFinancialHealthState => {
  if (result.status === "insufficient-data") return "incomplete";
  if (result.score >= 80) return "healthy";
  if (result.score >= 50) return "warning";
  return "critical";
};

export const financialHealthActionHref = (action: string) => {
  if (action.includes("emergency reserve") || action.includes("net worth") || action.includes("liabilities")) return "/financial-health";
  if (action.includes("debt")) return "/loans";
  if (action.includes("income")) return "/income";
  if (action.includes("spending")) return "/transactions";
  return "/onboarding";
};

type FinancialHealthActionDestination =
  | "financial_health"
  | "loans"
  | "income"
  | "transactions"
  | "onboarding";
export function getCompactFinancialHealthContent(result: HealthResult) {
  const nextAction = result.actions[0]
    ?? "Add income, spending, assets, and debt to complete your score.";
  const scoreDescription = result.status === "insufficient-data"
    ? "Score incomplete."
    : `Score ${Math.round(result.score)} out of 100.`;
  const statusLabel = result.status === "insufficient-data"
    ? "Complete your financial picture"
    : result.score >= 80
      ? "Your foundations look healthy"
      : result.score >= 50
        ? "Your foundations need attention"
        : "Your foundations need action";

  return {
    nextAction,
    scoreDescription,
    statusLabel,
    accessibleLabel: `Open Financial Health details. ${scoreDescription} Best next step: ${nextAction}`,
  };
}

export function FinancialHealthSummary({
  result,
  snapshots,
  variant = "detailed",
}: {
  result: HealthResult;
  snapshots: NetWorthSnapshot[];
  variant?: "compact" | "detailed";
}) {
  const latestSnapshots = snapshots.slice(-2);
  const netWorthChange = latestSnapshots.length === 2
    ? latestSnapshots[1].netWorth - latestSnapshots[0].netWorth
    : null;
  const healthScoreChange = latestSnapshots.length === 2
    && latestSnapshots[0].healthScore !== undefined
    && latestSnapshots[1].healthScore !== undefined
    ? latestSnapshots[1].healthScore - latestSnapshots[0].healthScore
    : null;
  const compactContent = getCompactFinancialHealthContent(result);
  const compactState = getCompactFinancialHealthState(result);
  const healthHistory = getFinancialHealthHistory(snapshots);
  const { nextAction } = compactContent;
  const nextActionHref = financialHealthActionHref(nextAction);
  const nextActionDestination = financialHealthActionDestination(nextActionHref);
  const displayScore = result.status === "insufficient-data" ? "—" : Math.round(result.score);
  const scoreTone = result.status === "insufficient-data"
    ? "border-muted text-muted-foreground bg-muted/10"
    : "border-border/60 bg-muted/40 text-foreground";

  if (variant === "compact") {
    return (
      <Link
        href="/financial-health"
        className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        aria-label={compactContent.accessibleLabel}
        data-testid="link-financial-health-summary"
        onClick={() => trackEvent("financial_health_summary_opened", { state: compactState })}
      >
        <Card className="overflow-hidden border-border/60 bg-card shadow-sm transition-all group-hover:border-primary/30 group-hover:shadow-md">
          <CardContent
            className="flex items-center gap-3 p-4 sm:gap-4 md:p-5 lg:pt-7"
            data-testid="dashboard-financial-health-content"
          >
            <div className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-[3px] font-sans text-lg font-bold sm:h-14 sm:w-14 sm:text-xl",
              scoreTone,
            )} data-testid="status-health-score">
              {displayScore}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-primary">
                <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                <p className="text-tiny font-semibold uppercase tracking-widest sm:text-xs">Financial Health</p>
              </div>
              <p className="mt-1 font-serif text-base font-semibold leading-tight text-foreground sm:text-lg">{compactContent.statusLabel}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                <span className="font-semibold text-foreground">Next:</span> {nextAction}
              </p>
            </div>
            <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
          </CardContent>
        </Card>
      </Link>
    );
  }

  return (
    <Card className="overflow-hidden border-border/60 bg-card shadow-sm transition-shadow hover:shadow-md" data-testid="card-financial-health">
      <CardHeader className="border-b border-border/40 bg-muted/20 p-4 md:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-1.5 md:gap-2 text-primary mb-1">
              <ShieldCheck className="h-4 w-4 md:h-5 md:w-5" />
              <p className="text-tiny md:text-xs font-semibold uppercase tracking-widest">Financial Health</p>
            </div>
            <CardTitle className="font-serif text-xl md:text-3xl text-foreground">A transparent view of your foundations</CardTitle>
          </div>
          <div className="flex items-center gap-3 md:gap-4 bg-background border border-border/60 rounded-xl md:rounded-2xl p-3 md:p-4 shadow-sm" data-testid="status-health-score">
            <div className={cn(
              "flex h-12 w-12 md:h-16 md:w-16 shrink-0 items-center justify-center rounded-full border-4 font-sans text-xl md:text-2xl font-bold transition-colors",
              scoreTone,
            )}>
              {displayScore}
            </div>
            <div className="text-sm min-w-0">
              <p className="font-bold text-sm md:text-base truncate">
                {result.status === "insufficient-data"
                  ? "Incomplete Profile"
                  : `${Math.round(result.score)} out of 100`}
              </p>
              <p className="text-muted-foreground text-tiny md:text-xs font-medium truncate">
                {result.isComplete ? "100% data coverage" : `${result.availableWeight}% data coverage`}
              </p>
              <div className="mt-1 md:mt-1.5 flex items-center gap-1.5 text-tiny md:text-xs text-muted-foreground whitespace-nowrap" data-testid="status-health-trend">
                {healthScoreChange !== null ? (
                  <>
                    <div className="flex h-3 w-3 items-center justify-center rounded-full md:h-4 md:w-4 bg-muted text-foreground">
                      {healthScoreChange >= 0 ? <TrendingUp className="h-2 w-2 md:h-2.5 md:w-2.5" /> : <TrendingDown className="h-2 w-2 md:h-2.5 md:w-2.5" />}
                    </div>
                    <span>{healthScoreChange >= 0 ? "Up" : "Down"} {Math.abs(healthScoreChange).toFixed(1)} points</span>
                  </>
                ) : netWorthChange === null ? (
                  <span className="text-muted-foreground/80 italic">Needs 2 snapshots for trend</span>
                ) : (
                  <>
                    <div className="flex h-3 w-3 items-center justify-center rounded-full md:h-4 md:w-4 bg-muted text-foreground">
                      {netWorthChange >= 0 ? <TrendingUp className="h-2 w-2 md:h-2.5 md:w-2.5" /> : <TrendingDown className="h-2 w-2 md:h-2.5 md:w-2.5" />}
                    </div>
                    <span>
                      Net worth {netWorthChange >= 0 ? "up" : "down"}{" "}
                      <span className={netWorthChange > 0 ? "text-positive" : netWorthChange < 0 ? "text-negative" : "text-foreground"}>
                        {formatCompactINR(Math.abs(netWorthChange))}
                      </span>
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 md:p-6 space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Health score components">
          {result.components.map((component) => {
            const isMissing = component.score === null;
            const isHealthy = !isMissing && component.score! >= 80;
            const isWarning = !isMissing && component.score! >= 40 && component.score! < 80;

            return (
              <div key={component.key} className={cn(
                "rounded-xl border p-3 md:p-4 transition-colors",
                isMissing ? "border-dashed bg-muted/20 border-border" : "border-border/60 bg-card"
              )} data-testid={`status-health-${component.key}`}>
                <div className="flex items-start justify-between gap-2 mb-2 md:mb-3">
                  <div className="flex items-center gap-1.5 md:gap-2">
                    {isMissing ? (
                      <CircleDashed className="h-3.5 w-3.5 md:h-4 md:w-4 text-muted-foreground" aria-hidden="true" />
                    ) : isHealthy ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary md:h-4 md:w-4" aria-hidden="true" />
                    ) : isWarning ? (
                      <AlertCircle className="h-3.5 w-3.5 text-warning md:h-4 md:w-4" aria-hidden="true" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5 text-muted-foreground md:h-4 md:w-4" aria-hidden="true" />
                    )}
                    <p className="text-xs md:text-sm font-semibold leading-tight">{component.label}</p>
                  </div>
                  <span className={cn(
                    "financial-number text-xs md:text-sm font-bold",
                    isMissing ? "text-muted-foreground" : "text-foreground"
                  )}>{component.score ?? "—"}<span className="text-tiny md:text-tiny text-muted-foreground font-normal">/100</span></span>
                </div>
                
                <div className="h-1 md:h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div className={cn(
                    "h-full rounded-full transition-all duration-500 bg-foreground",
                    isMissing && "bg-transparent",
                  )} style={{ width: `${component.score ?? 0}%` }} />
                </div>
                
                <p className="mt-2 md:mt-3 text-tiny md:text-xs leading-relaxed text-muted-foreground">
                  {component.explanation}
                </p>
                
                <div className="mt-2 md:mt-3 pt-2 md:pt-3 border-t border-border/40 flex justify-between items-center text-tiny md:text-tiny font-medium uppercase tracking-wider text-muted-foreground">
                  <span>Weight: {component.weight}%</span>
                  <span className={cn(!isMissing && "text-foreground font-semibold")}>+{component.weightedPoints} pts</span>
                </div>
              </div>
            );
          })}
        </div>
        {healthHistory.length > 0 && (
          <section className="border-t border-border/40 pt-5" aria-labelledby="health-history-title">
            <div className="mb-4">
              <h3 id="health-history-title" className="font-serif text-lg font-semibold text-foreground">
                Health score history
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Your saved monthly scores for the last 12 snapshots. Earlier snapshots without a score remain unavailable.
              </p>
            </div>

            <div
              className="h-[180px] w-full md:h-[220px]"
              role="img"
              aria-label="Line chart of saved monthly financial health scores. A table with the same data follows."
              data-testid="chart-financial-health-history"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={healthHistory} margin={{ top: 8, right: 8, left: -24, bottom: 4 }}>
                  <XAxis dataKey="label" axisLine={false} tickLine={false} interval="preserveStartEnd" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis domain={[0, 100]} ticks={[0, 50, 100]} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <RechartsTooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const point = payload[0].payload as (typeof healthHistory)[number];
                      return (
                        <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
                          <p className="font-medium text-muted-foreground">{point.label}</p>
                          <p className="mt-1 font-bold text-foreground">
                            {point.score === null ? "Unavailable" : `${point.score.toFixed(1)} out of 100`}
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    connectNulls={false}
                    stroke="hsl(var(--primary))"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: "hsl(var(--background))", strokeWidth: 2 }}
                    activeDot={{ r: 5 }}
                    animationDuration={700}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-4 overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full min-w-[320px] text-xs" data-testid="table-financial-health-history">
                <caption className="sr-only">Saved monthly financial health scores</caption>
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">Month</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Health score</th>
                  </tr>
                </thead>
                <tbody>
                  {healthHistory.map((point) => (
                    <tr key={point.month} className="border-t border-border/40">
                      <th scope="row" className="px-3 py-2 text-left font-medium text-foreground">{point.label}</th>
                      <td className="px-3 py-2 text-right financial-number text-foreground">
                        {point.score === null ? <span className="text-muted-foreground">Unavailable</span> : `${point.score.toFixed(1)} / 100`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </CardContent>
      <CardFooter className="bg-primary/5 px-4 md:px-5 py-3 md:py-4 border-t border-primary/10 pt-[10px]">
        <div className="w-full flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex items-start gap-2.5 md:gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground md:h-8 md:w-8">
              <Info className="h-3.5 w-3.5 md:h-4 md:w-4" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs md:text-sm"><span className="font-semibold text-primary">Best next step:</span> {nextAction}</p>
              <p className="text-tiny md:text-xs text-muted-foreground mt-0.5">
                Missing components contribute zero points and are shown as unavailable.
              </p>
            </div>
          </div>
          <Button asChild size="sm" className="shrink-0 w-full sm:w-auto" data-testid="link-health-next-action">
            <Link
              href={nextActionHref}
              onClick={() => trackEvent("financial_health_action_opened", {
                destination: nextActionDestination,
              })}
            >
              Take action <ArrowRight className="ml-2 h-3.5 w-3.5 md:h-4 md:w-4" />
            </Link>
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

export const financialHealthActionDestination = (
  href: string,
): FinancialHealthActionDestination => {
  switch (href) {
    case "/financial-health":
      return "financial_health";
    case "/loans":
      return "loans";
    case "/income":
      return "income";
    case "/transactions":
      return "transactions";
    default:
      return "onboarding";
  }
};
