import { useMemo, useState } from "react";
import { Baby, CalendarPlus, ChevronDown, Info } from "lucide-react";
import { usePlannedExpenses, useUpdatePlannedExpenses } from "@/hooks/use-planned-expenses";
import { useRetirementInputs } from "@/hooks/use-retirement";
import { useInvestments } from "@/hooks/use-investments";
import { useIncomeSources } from "@/hooks/use-income";
import { useExpenses } from "@/hooks/use-expenses";
import { useBudgets } from "@/hooks/use-budgets";
import { useLoans } from "@/hooks/use-loans";
import { useFinancialHealthData } from "@/hooks/use-financial-health";
import { LIFE_EVENT_TEMPLATES, PLANNING_BENCHMARK_SOURCE, dependentStagesForAge, lineItemsToPlannedExpenses, planningItemFutureCost, planningItemYearlyBreakdown, type PlanningLineItem } from "@/lib/planning-simulations";
import { calculatePlanningTimeline } from "@/lib/storage";
import { calculateRetirementProjection } from "@/lib/retirement-projection";
import { formatINR } from "@/lib/utils";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/wealthone-design-system/components/ui/card";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Label } from "@workspace/wealthone-design-system/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/wealthone-design-system/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/wealthone-design-system/components/ui/collapsible";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";

function EditableLines({ items, onChange }: { items: PlanningLineItem[]; onChange: (items: PlanningLineItem[]) => void }) {
  const update = (index: number, patch: Partial<PlanningLineItem>) =>
    onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  return <div className="space-y-3">
    {items.map((item, index) => <div key={item.id} className="grid gap-2 rounded-lg border bg-background/70 p-3 sm:grid-cols-4">
      <div className="sm:col-span-4"><p className="font-medium">{item.name}</p><p className="text-xs text-muted-foreground">Benchmark {formatINR(item.benchmarkMin)}–{formatINR(item.benchmarkMax)} today</p></div>
      <div><Label htmlFor={`${item.id}-amount`}>Today&apos;s cost</Label><Input id={`${item.id}-amount`} type="number" min="0" value={item.amount} onChange={(event) => update(index, { amount: Number(event.target.value) })} /></div>
      <div><Label htmlFor={`${item.id}-years`}>In years</Label><Input id={`${item.id}-years`} type="number" min="0" max="60" value={item.yearsFromNow} onChange={(event) => update(index, { yearsFromNow: Number(event.target.value) })} /></div>
      <div><Label htmlFor={`${item.id}-inflation`}>Inflation %</Label><Input id={`${item.id}-inflation`} type="number" min="0" max="25" step="0.1" value={item.inflationRate} onChange={(event) => update(index, { inflationRate: Number(event.target.value) })} /></div>
      <div><Label>Future cost</Label><p className="financial-number pt-2 font-semibold">{formatINR(planningItemFutureCost(item))}</p></div>
    </div>)}
  </div>;
}

export function PlanningCostTools() {
  const { data: retirementInputs } = useRetirementInputs();
  const { data: investments = [] } = useInvestments();
  const { data: incomes = [] } = useIncomeSources();
  const { data: ledgerExpenses = [] } = useExpenses();
  const { data: budgets = [] } = useBudgets();
  const { data: loans = [] } = useLoans();
  const { data: plannedExpenses = [] } = usePlannedExpenses();
  const { data: financialHealth } = useFinancialHealthData();
  const save = useUpdatePlannedExpenses();
  const { toast } = useToast();
  const [dependentOpen, setDependentOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [dependentName, setDependentName] = useState("Child plan");
  const [childAge, setChildAge] = useState(-1);
  const [dependentItems, setDependentItems] = useState(() => dependentStagesForAge(-1));
  const [template, setTemplate] = useState(Object.keys(LIFE_EVENT_TEMPLATES)[0]);
  const [templateItems, setTemplateItems] = useState(() => LIFE_EVENT_TEMPLATES[Object.keys(LIFE_EVENT_TEMPLATES)[0]].map((item) => ({ ...item })));
  const dependentTotal = useMemo(() => dependentItems.reduce((sum, item) => sum + planningItemFutureCost(item), 0), [dependentItems]);
  const yearsToRetirement = retirementInputs
    ? calculatePlanningTimeline(retirementInputs).yearsToRetirement
    : 0;
  const dependentRetirementImpact = useMemo(() => planningItemYearlyBreakdown(dependentItems)
    .filter((row) => row.yearsFromNow <= yearsToRetirement)
    .reduce((sum, row) => sum + row.futureCost, 0),
  [dependentItems, yearsToRetirement]);
  const dependentCorpusImpact = useMemo(() => {
    if (!retirementInputs) return 0;
    const projectionData = {
      expenses: ledgerExpenses,
      budgets,
      incomes,
      investments,
      loans,
      emergencyFund: financialHealth?.emergencyFund,
      assumptions: retirementInputs,
    };
    const baseline = calculateRetirementProjection({ ...projectionData, plannedExpenses });
    const withDependent = calculateRetirementProjection({
      ...projectionData,
      plannedExpenses: [
        ...plannedExpenses,
        ...lineItemsToPlannedExpenses(dependentName, dependentItems),
      ],
    });
    return Math.max(0, baseline.projectedCorpus - withDependent.projectedCorpus);
  }, [budgets, dependentItems, dependentName, financialHealth?.emergencyFund, incomes, investments, ledgerExpenses, loans, plannedExpenses, retirementInputs]);
  const updateChildAge = (age: number) => {
    setChildAge(age);
    setDependentItems(dependentStagesForAge(age));
  };

  const persist = (prefix: string, items: PlanningLineItem[]) => {
    const additions = lineItemsToPlannedExpenses(prefix.trim() || prefix, items);
    save.mutate({ type: "append", expenses: additions }, { onSuccess: () => toast({ title: "Plan added to future expenses", description: `${additions.length} dated cost${additions.length === 1 ? "" : "s"} now affect your retirement projection.` }) });
  };

  return <div className="grid gap-4 lg:grid-cols-2">
    <Collapsible open={dependentOpen} onOpenChange={setDependentOpen}>
      <Card className="h-full border-primary/15 bg-primary/[0.025]">
        <CardHeader><CardTitle className="flex items-center gap-2 font-serif"><Baby className="h-5 w-5" />Dependent cost estimator</CardTitle><CardDescription>Model an existing or planned child using editable stage costs.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
             <div className="flex items-end justify-between gap-3"><div><p className="text-xs text-muted-foreground">Inflation-aware lifetime estimate</p><p className="financial-number text-xl font-semibold">{formatINR(dependentTotal)}</p>{retirementInputs && <><p className="text-xs text-muted-foreground">{formatINR(dependentRetirementImpact)} falls before your target retirement</p><p className="text-xs text-muted-foreground">At age {retirementInputs.targetRetirementAge}, this reduces projected corpus by <span className={dependentCorpusImpact > 0 ? "text-negative" : "text-foreground"}>{formatINR(dependentCorpusImpact)}</span></p></>}</div><CollapsibleTrigger asChild><Button variant="outline">{dependentOpen ? "Close" : "Build estimate"}<ChevronDown className="ml-2 h-4 w-4" /></Button></CollapsibleTrigger></div>
          <CollapsibleContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2"><div><Label htmlFor="dependent-name">Child or plan name</Label><Input id="dependent-name" value={dependentName} onChange={(event) => setDependentName(event.target.value)} /></div><div><Label htmlFor="child-age">Current age (-1 if planned next year)</Label><Input id="child-age" type="number" min="-1" max="30" value={childAge} onChange={(event) => updateChildAge(Number(event.target.value))} /></div></div>
            <p className="text-xs text-muted-foreground">Plan one child at a time so each child keeps their own age and timing. After saving, start another estimate for another child.</p>
            <EditableLines items={dependentItems} onChange={setDependentItems} />
            <div className="max-h-60 overflow-auto rounded-lg border bg-background"><table className="w-full text-left text-xs"><caption className="sr-only">Year-by-year dependent cost breakdown</caption><thead className="sticky top-0 bg-muted"><tr><th className="p-2">In year</th><th className="p-2">Stage</th><th className="p-2">Today</th><th className="p-2">Future cost</th></tr></thead><tbody>{planningItemYearlyBreakdown(dependentItems).sort((a, b) => a.yearsFromNow - b.yearsFromNow).map((row) => <tr key={`${row.item.id}-${row.yearIndex}`} className="border-t"><td className="p-2">{row.yearsFromNow === 0 ? "Now" : row.yearsFromNow}</td><td className="p-2">{row.item.name}</td><td className="p-2">{formatINR(row.amount)}</td><td className="p-2">{formatINR(row.futureCost)}</td></tr>)}</tbody></table></div>
            <Button disabled={save.isPending} onClick={() => persist(dependentName, dependentItems)}>Add stages to planned expenses</Button>
          </CollapsibleContent>
        </CardContent>
      </Card>
    </Collapsible>
    <Collapsible open={templateOpen} onOpenChange={setTemplateOpen}>
      <Card className="h-full border-secondary/20 bg-secondary/[0.04]">
        <CardHeader><CardTitle className="flex items-center gap-2 font-serif"><CalendarPlus className="h-5 w-5" />Life-event templates</CardTitle><CardDescription>Start with a benchmark, customize every line, then add only when ready.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3"><div className="flex-1"><Label htmlFor="life-event-template">Template</Label><Select value={template} onValueChange={(value) => { setTemplate(value); setTemplateItems(LIFE_EVENT_TEMPLATES[value].map((item) => ({ ...item }))); }}><SelectTrigger id="life-event-template"><SelectValue /></SelectTrigger><SelectContent>{Object.keys(LIFE_EVENT_TEMPLATES).map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select></div><CollapsibleTrigger asChild><Button variant="outline">{templateOpen ? "Close" : "Customize"}<ChevronDown className="ml-2 h-4 w-4" /></Button></CollapsibleTrigger></div>
          <CollapsibleContent className="space-y-4"><EditableLines items={templateItems} onChange={setTemplateItems} /><Button disabled={save.isPending} onClick={() => persist(template, templateItems)}>Add template to planned expenses</Button></CollapsibleContent>
          <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{PLANNING_BENCHMARK_SOURCE}</p>
        </CardContent>
      </Card>
    </Collapsible>
  </div>;
}