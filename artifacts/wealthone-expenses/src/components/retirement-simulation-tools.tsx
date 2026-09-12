import { useMemo, useState } from "react";
import { ArrowRightLeft, ChevronDown, Info, TrendingUp } from "lucide-react";
import { calculateRetirementProjection, type RetirementProjectionArgs } from "@/lib/retirement-projection";
import { buildScenarioRetirementInputs, calculateStepUpSip, purchasingPower } from "@/lib/planning-simulations";
import { calculatePlanningTimeline, type RetirementInputs } from "@/lib/storage";
import { cn, formatINR } from "@/lib/utils";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/wealthone-design-system/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/wealthone-design-system/components/ui/collapsible";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Label } from "@workspace/wealthone-design-system/components/ui/label";

type Projection = ReturnType<typeof calculateRetirementProjection>;
const scenarioFrom = (inputs: RetirementInputs, returnRate: number) => ({
  retirementAge: inputs.targetRetirementAge,
  contribution: inputs.monthlyContributionOverride ?? 0,
  inflation: inputs.generalInflation,
  returnRate: Math.round(returnRate * 10) / 10,
  spendingChange: 0,
});

export function RetirementSimulationTools({
  baselineInputs,
  baselineMetrics,
  projectionData,
  onApply,
  applyBlockedReason,
}: {
  baselineInputs: RetirementInputs;
  baselineMetrics: Projection;
  projectionData: Omit<RetirementProjectionArgs, "assumptions">;
  onApply: (inputs: RetirementInputs) => Promise<RetirementInputs>;
  applyBlockedReason?: string;
}) {
  const [whatIfOpen, setWhatIfOpen] = useState(false);
  const [inflationOpen, setInflationOpen] = useState(false);
  const [sipOpen, setSipOpen] = useState(false);
  const [experimentBaseline, setExperimentBaseline] = useState(baselineInputs);
  const [applying, setApplying] = useState(false);
  const [scenario, setScenario] = useState(() =>
    scenarioFrom(baselineInputs, baselineMetrics.averageExpectedReturn * 100));
  const [inflationAmount, setInflationAmount] = useState(100000);
  const [inflationYears, setInflationYears] = useState(10);
  const [sip, setSip] = useState({
    monthly: Math.max(1000, baselineInputs.monthlyContributionOverride || 10000),
    stepUp: 10,
    returnRate: Math.round(baselineMetrics.averageExpectedReturn * 1000) / 10,
    years: Math.max(1, Math.round(baselineMetrics.monthsToRetirement / 12)),
  });

  const frozenBaselineMetrics = useMemo(() => calculateRetirementProjection({
    ...projectionData,
    assumptions: experimentBaseline,
  }), [experimentBaseline, projectionData]);
  const scenarioInputs = useMemo<RetirementInputs>(() => buildScenarioRetirementInputs(
    experimentBaseline,
    scenario,
  ), [experimentBaseline, scenario]);
  const scenarioIsValid = calculatePlanningTimeline(scenarioInputs).isValid;
  const scenarioMetrics = useMemo(() => calculateRetirementProjection({
    ...projectionData,
    portfolioReturnOverride: scenario.returnRate,
    assumptions: scenarioInputs,
  }), [projectionData, scenario.returnRate, scenarioInputs]);
  const savedBaselineChanged = JSON.stringify(baselineInputs) !== JSON.stringify(experimentBaseline);
  const sipResult = useMemo(() => calculateStepUpSip({
    monthlyContribution: sip.monthly,
    annualStepUpPercent: sip.stepUp,
    annualReturnPercent: sip.returnRate,
    years: sip.years,
  }), [sip]);
  const resetScenario = () => {
    setExperimentBaseline(baselineInputs);
    setScenario(scenarioFrom(baselineInputs, baselineMetrics.averageExpectedReturn * 100));
  };
  const applyScenario = async () => {
    setApplying(true);
    try {
      const savedInputs = await onApply(scenarioInputs);
      const newlySavedMetrics = calculateRetirementProjection({
        ...projectionData,
        assumptions: savedInputs,
      });
      setExperimentBaseline(savedInputs);
      setScenario(scenarioFrom(savedInputs, newlySavedMetrics.averageExpectedReturn * 100));
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
      <Collapsible open={whatIfOpen} onOpenChange={setWhatIfOpen} className="h-full">
        <Card className="flex h-full flex-col border-secondary/60 bg-secondary/10 shadow-sm transition-all duration-300 dark:border-secondary/50 dark:bg-secondary/10">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 font-serif text-lg text-secondary">
              <ArrowRightLeft className="h-5 w-5 opacity-70" /> Retirement What-If
            </CardTitle>
            <CardDescription className="text-secondary/70 dark:text-secondary/60 text-xs">
              Explore changes without touching your saved plan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 flex-1">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-background/80 p-3 border border-secondary/30">
                <p className="text-tiny uppercase tracking-wider text-muted-foreground font-semibold">Saved Baseline</p>
                <p className="font-semibold text-foreground mt-0.5">{formatINR(frozenBaselineMetrics.projectedCorpus)}</p>
                <p className="text-xs text-muted-foreground">at age {experimentBaseline.targetRetirementAge}</p>
              </div>
              <div className="rounded-lg border border-secondary/50 bg-secondary/10 p-3 dark:border-secondary/50 dark:bg-secondary/10">
                <p className="text-tiny uppercase tracking-wider text-secondary font-semibold">What-If</p>
                <p className="font-semibold text-secondary mt-0.5">{formatINR(scenarioMetrics.projectedCorpus)}</p>
                <p className="text-xs text-secondary/80 dark:text-secondary/80">at age {scenario.retirementAge}</p>
              </div>
            </div>
            <CollapsibleTrigger asChild>
              <Button className="w-full bg-background border-secondary/30 text-secondary hover:bg-secondary hover:text-secondary dark:border-secondary/30 dark:text-secondary dark:bg-secondary dark:hover:bg-secondary" variant="outline" size="sm">
                {whatIfOpen ? "Hide inputs" : "Compare a scenario"}
                <ChevronDown className={cn("ml-2 h-4 w-4 transition-transform", whatIfOpen && "rotate-180")} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="what-if-retirement-age" className="text-tiny uppercase tracking-wider text-muted-foreground font-semibold">Retirement age</Label>
                  <Input id="what-if-retirement-age" type="number" min="18" max="100" value={scenario.retirementAge} onChange={(e) => setScenario({ ...scenario, retirementAge: Number(e.target.value) })} className="h-8 text-xs bg-background" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="what-if-sip" className="text-tiny uppercase tracking-wider text-muted-foreground font-semibold">Extra SIP /mo</Label>
                  <Input id="what-if-sip" type="number" min="0" value={scenario.contribution} onChange={(e) => setScenario({ ...scenario, contribution: Number(e.target.value) })} className="h-8 text-xs bg-background" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="what-if-inflation" className="text-tiny uppercase tracking-wider text-muted-foreground font-semibold">Inflation %</Label>
                  <Input id="what-if-inflation" type="number" min="0" max="25" step="0.1" value={scenario.inflation} onChange={(e) => setScenario({ ...scenario, inflation: Number(e.target.value) })} className="h-8 text-xs bg-background" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="what-if-return" className="text-tiny uppercase tracking-wider text-muted-foreground font-semibold">Return %</Label>
                  <Input id="what-if-return" type="number" min="0" max="50" step="0.1" value={scenario.returnRate} onChange={(e) => setScenario({ ...scenario, returnRate: Number(e.target.value) })} className="h-8 text-xs bg-background" />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="what-if-spending" className="text-tiny uppercase tracking-wider text-muted-foreground font-semibold">Retirement spending change %</Label>
                  <Input id="what-if-spending" type="number" min="-90" max="300" value={scenario.spendingChange} onChange={(e) => setScenario({ ...scenario, spendingChange: Number(e.target.value) })} className="h-8 text-xs bg-background" />
                </div>
              </div>
              <div className="rounded-lg border border-secondary/30 bg-background/80 p-3 text-xs dark:border-secondary/30">
                <p className="flex justify-between text-muted-foreground mb-1">
                  <span>Required Goal</span>
                  <span><strong>{formatINR(frozenBaselineMetrics.requiredCorpus)}</strong> → <strong className="text-foreground">{formatINR(scenarioMetrics.requiredCorpus)}</strong></span>
                </p>
                <p className="flex justify-between text-muted-foreground">
                  <span>Funding</span>
                  <span><strong>{frozenBaselineMetrics.requiredCorpus > 0 ? Math.round(frozenBaselineMetrics.projectedCorpus / frozenBaselineMetrics.requiredCorpus * 100) : 0}%</strong> → <strong className="text-foreground">{scenarioMetrics.requiredCorpus > 0 ? Math.round(scenarioMetrics.projectedCorpus / scenarioMetrics.requiredCorpus * 100) : 0}%</strong></span>
                </p>
              </div>
              {!scenarioIsValid && <p className="text-xs font-medium text-destructive bg-destructive/10 p-2 rounded-md">Retirement age must be at least your current age and no later than life expectancy.</p>}
              {scenarioMetrics.affordabilityWarning && <p className="text-xs font-medium text-destructive bg-destructive/10 p-2 rounded-md">This additional SIP is above today's available monthly surplus. Reduce it before applying.</p>}
              {savedBaselineChanged && (
                <div className="rounded-lg border border-warning/30 bg-warning p-3 text-xs text-warning dark:bg-warning dark:border-warning/30 dark:text-warning">
                  <p>Your saved plan changed. Rebase before applying.</p>
                  <Button className="mt-2 h-7 text-xs" variant="outline" onClick={resetScenario}>Use latest saved plan</Button>
                </div>
              )}
              {applyBlockedReason && <p className="text-xs font-medium text-destructive bg-destructive/10 p-2 rounded-md">{applyBlockedReason}</p>}
              <p className="flex gap-2 text-tiny text-muted-foreground leading-relaxed">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                Portfolio return is comparison-only. Applying saves retirement age, SIP, inflation and spending; it does not rewrite investment records.
              </p>
              <div className="flex gap-2 pt-2">
                <Button size="sm" className="flex-1 bg-secondary hover:bg-secondary text-white" disabled={applying || savedBaselineChanged || Boolean(applyBlockedReason) || !scenarioIsValid || Boolean(scenarioMetrics.affordabilityWarning)} onClick={applyScenario}>
                  {applying ? "Applying…" : "Apply to Plan"}
                </Button>
                <Button size="sm" variant="ghost" disabled={applying} onClick={resetScenario} className="text-muted-foreground">Discard</Button>
              </div>
            </CollapsibleContent>
          </CardContent>
        </Card>
      </Collapsible>

      <Collapsible open={inflationOpen} onOpenChange={setInflationOpen} className="h-full">
        <Card className="flex h-full flex-col border-warning/60 bg-warning-background shadow-sm transition-all duration-300 dark:border-warning/50 dark:bg-warning-background">
          <CardHeader className="pb-4">
            <CardTitle className="font-serif text-lg text-warning">Purchasing Power</CardTitle>
            <CardDescription className="text-warning text-xs">See what the same amount buys later.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 flex-1">
            <div className="rounded-lg bg-background/80 p-4 border border-warning/30 text-center">
              <p className="text-xs text-muted-foreground mb-1">{formatINR(inflationAmount)} after {inflationYears} yrs @ {scenario.inflation}% inflation</p>
              <p className="financial-number text-3xl font-serif font-medium text-warning">{formatINR(purchasingPower(inflationAmount, scenario.inflation, inflationYears))}</p>
              <p className="text-tiny uppercase tracking-wider font-semibold text-muted-foreground mt-2">In Today's Value</p>
            </div>
            <CollapsibleTrigger asChild>
              <Button className="w-full bg-background border-warning/30 text-warning hover:bg-warning hover:text-warning dark:border-warning/30 dark:text-warning dark:bg-warning dark:hover:bg-warning" variant="outline" size="sm">
                {inflationOpen ? "Hide calculator" : "Change the numbers"}
                <ChevronDown className={cn("ml-2 h-4 w-4 transition-transform", inflationOpen && "rotate-180")} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="inflation-future-amount" className="text-tiny uppercase tracking-wider text-muted-foreground font-semibold">Future Amount</Label>
                  <Input id="inflation-future-amount" type="number" min="0" value={inflationAmount} onChange={(e) => setInflationAmount(Number(e.target.value))} className="h-8 text-xs bg-background" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inflation-years" className="text-tiny uppercase tracking-wider text-muted-foreground font-semibold">Years from now</Label>
                  <Input id="inflation-years" type="number" min="0" max="60" value={inflationYears} onChange={(e) => setInflationYears(Number(e.target.value))} className="h-8 text-xs bg-background" />
                </div>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-warning-background dark:bg-warning-background" role="img" aria-label={`${formatINR(inflationAmount)} in ${inflationYears} years has the purchasing power of ${formatINR(purchasingPower(inflationAmount, scenario.inflation, inflationYears))} today`}>
                <div className="h-full bg-warning rounded-full" style={{ width: `${Math.min(100, purchasingPower(inflationAmount, scenario.inflation, inflationYears) / Math.max(1, inflationAmount) * 100)}%` }} />
              </div>
            </CollapsibleContent>
          </CardContent>
        </Card>
      </Collapsible>

      <Collapsible open={sipOpen} onOpenChange={setSipOpen} className="h-full">
        <Card className="flex h-full flex-col border-positive/60 bg-positive-background shadow-sm transition-all duration-300 dark:border-positive/50 dark:bg-positive-background">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 font-serif text-lg text-positive">
              <TrendingUp className="h-5 w-5 opacity-70" /> SIP Step-Up
            </CardTitle>
            <CardDescription className="text-positive text-xs">Increase contributions yearly.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 flex-1">
            <div className="rounded-lg bg-background/80 p-3 border border-positive/30">
              <p className="text-tiny uppercase tracking-wider text-muted-foreground font-semibold">Expected Corpus</p>
              <p className="financial-number text-2xl font-serif text-positive font-medium mt-1">{formatINR(sipResult.corpus)}</p>
              <p className="text-tiny leading-snug text-positive mt-1">
                {sipResult.monthsGained === null ? "A flat SIP does not reach this corpus" : sipResult.monthsGained > 0 ? `${sipResult.monthsGained} months sooner than a flat SIP` : "Same timeline as a flat SIP"}
              </p>
            </div>
            <CollapsibleTrigger asChild>
              <Button className="w-full bg-background border-positive/30 text-positive hover:bg-positive hover:text-positive dark:border-positive/30 dark:text-positive dark:bg-positive dark:hover:bg-positive" variant="outline" size="sm">
                {sipOpen ? "Hide yearly plan" : "Plan a step-up"}
                <ChevronDown className={cn("ml-2 h-4 w-4 transition-transform", sipOpen && "rotate-180")} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sip-start" className="text-tiny uppercase tracking-wider text-muted-foreground font-semibold">Starting SIP /mo</Label>
                  <Input id="sip-start" type="number" min="0" value={sip.monthly} onChange={(e) => setSip({ ...sip, monthly: Number(e.target.value) })} className="h-8 text-xs bg-background" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sip-step-up" className="text-tiny uppercase tracking-wider text-muted-foreground font-semibold">Annual Step-up %</Label>
                  <Input id="sip-step-up" type="number" min="0" max="100" value={sip.stepUp} onChange={(e) => setSip({ ...sip, stepUp: Number(e.target.value) })} className="h-8 text-xs bg-background" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sip-return" className="text-tiny uppercase tracking-wider text-muted-foreground font-semibold">Return %</Label>
                  <Input id="sip-return" type="number" min="0" max="50" step="0.1" value={sip.returnRate} onChange={(e) => setSip({ ...sip, returnRate: Number(e.target.value) })} className="h-8 text-xs bg-background" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sip-years" className="text-tiny uppercase tracking-wider text-muted-foreground font-semibold">Years</Label>
                  <Input id="sip-years" type="number" min="1" max="60" value={sip.years} onChange={(e) => setSip({ ...sip, years: Number(e.target.value) })} className="h-8 text-xs bg-background" />
                </div>
              </div>
              <div className="max-h-48 overflow-auto rounded-lg border border-border/50 bg-background custom-scrollbar">
                <table className="w-full text-left text-tiny">
                  <caption className="sr-only">Yearly stepped SIP contributions and closing corpus</caption>
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm border-b border-border/50">
                    <tr>
                      <th className="p-2 font-medium">Yr</th>
                      <th className="p-2 font-medium">Monthly</th>
                      <th className="p-2 font-medium text-right">Corpus</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sipResult.rows.map((row) => (
                      <tr key={row.year} className="border-b border-border/30 last:border-0 hover:bg-muted/30">
                        <td className="p-2 text-muted-foreground">{row.year}</td>
                        <td className="p-2">{formatINR(row.monthlyContribution)}</td>
                        <td className="p-2 text-right text-positive font-medium">{formatINR(row.closingCorpus)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleContent>
          </CardContent>
        </Card>
      </Collapsible>
    </>
  );
}
