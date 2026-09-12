import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, ArrowRight, Check, LayoutDashboard, SkipForward } from "lucide-react";
import { useProfileInputs } from "@/hooks/use-retirement";
import {
  accountSwitchSaveDescription,
  useFinancialWrite,
} from "@/hooks/use-financial-write";
import { formatDateOnly, PLANNED_EXPENSE_CATEGORY_INFLATION } from "@/lib/storage";
import { financialDataQueryOptions } from "@/lib/query-policy";
import { calculateRetirementProjection } from "@/lib/retirement-projection";
import { formatINR } from "@/lib/utils";
import { trackEvent } from "@/lib/analytics";
import type { FinancialData } from "@/lib/financial-api";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/wealthone-design-system/components/ui/card";
import { Input } from "@workspace/wealthone-design-system/components/ui/input";
import { Label } from "@workspace/wealthone-design-system/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/wealthone-design-system/components/ui/select";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";

const steps = [
  { title: "About you", description: "Your age anchors the first retirement estimate. You can finish later at any time.", optional: false },
  { title: "Income", description: "Optionally add one starter income. Add every other income later from Income.", optional: true },
  { title: "Everyday expenses", description: "Optionally add one starter expense. Add your complete spending plan later from Budgets.", optional: true },
  { title: "Investments", description: "Optionally add one starter investment. Add your complete portfolio later from Investments.", optional: true },
  { title: "Loans", description: "Optionally add one starter loan. Add every other debt later from Loans.", optional: true },
  { title: "Future expenses", description: "Optionally add one starter future cost. Add every other goal later from Budgets.", optional: true },
  { title: "Retirement assumptions", description: "Choose the retirement horizon for your first projection.", optional: false },
  { title: "First estimate", description: "Save this starting estimate—not a complete financial inventory—and refine every input later.", optional: false },
] as const;

type SetupFlowState = "new" | "resumed" | "rerun";
type PersistAction = "back" | "completed" | "skipped";
type SetupProfile = NonNullable<ReturnType<typeof useProfileInputs>["data"]>;

function getInitialStep(profile: SetupProfile) {
  if (profile.onboardingCompleted && !profile.onboardingProgress?.rerunInProgress) return 1;
  return profile.onboardingProgress?.currentStep ?? 1;
}

function getSetupFlowState(profile: SetupProfile): SetupFlowState {
  if (profile.onboardingCompleted) return "rerun";
  const progress = profile.onboardingProgress;
  if (
    progress
    && (
      progress.dismissed
      ||
      progress.currentStep > 1
      || progress.completedSteps.length > 0
      || progress.skippedSteps.length > 0
    )
  ) return "resumed";
  return "new";
}

function upsert<T extends { id: string }>(items: T[], item: T) {
  return items.some((existing) => existing.id === item.id)
    ? items.map((existing) => existing.id === item.id ? item : existing)
    : [...items, item];
}

function withWizardItem(
  current: FinancialData,
  step: number,
  drafts: {
    income: { id: string; name: string; amount: string };
    expensePlan: { id: string; category: string; amount: string; cadence: string; dueDate: string };
    investment: { id: string; name: string; balance: string; contribution: string };
    loan: { id: string; name: string; principal: string; rate: string; tenure: string; repaymentType: string };
    planned: { id: string; name: string; category: string; amount: string; date: string; inflation: string };
  },
): FinancialData {
  if (step === 2 && drafts.income.name.trim() && Number(drafts.income.amount) > 0) {
    return { ...current, incomeSources: upsert(current.incomeSources, { id: drafts.income.id, name: drafts.income.name.trim(), type: "Other", frequency: "Monthly", amount: Number(drafts.income.amount), date: formatDateOnly(new Date()), recurring: true, incomeEndMode: "retirement", createdAt: new Date().toISOString() }) };
  }
  if (step === 3 && drafts.expensePlan.category.trim() && Number(drafts.expensePlan.amount) > 0 && drafts.expensePlan.dueDate) {
    const cadence = drafts.expensePlan.cadence as "monthly" | "quarterly" | "half-yearly" | "yearly" | "one-time";
    return { ...current, budgets: current.budgets.map((budget) => budget.category === drafts.expensePlan.category ? { ...budget, windows: upsert(budget.windows ?? [], { id: drafts.expensePlan.id, monthlyLimit: Number(drafts.expensePlan.amount), cadence, ...(cadence === "yearly" ? { annualMonth: new Date(`${drafts.expensePlan.dueDate}T00:00:00`).getMonth() } : {}), startDate: drafts.expensePlan.dueDate, endMode: "lifelong" }) } : budget).concat(current.budgets.some((budget) => budget.category === drafts.expensePlan.category) ? [] : [{ category: drafts.expensePlan.category, monthlyLimit: 0, windows: [{ id: drafts.expensePlan.id, monthlyLimit: Number(drafts.expensePlan.amount), cadence, ...(cadence === "yearly" ? { annualMonth: new Date(`${drafts.expensePlan.dueDate}T00:00:00`).getMonth() } : {}), startDate: drafts.expensePlan.dueDate, endMode: "lifelong" }] }]) };
  }
  if (step === 4 && drafts.investment.name.trim() && Number(drafts.investment.balance) >= 0) {
    return { ...current, investments: upsert(current.investments, { id: drafts.investment.id, name: drafts.investment.name.trim(), assetClass: "Mutual Funds", investedAmount: Number(drafts.investment.balance), currentValue: Number(drafts.investment.balance), monthlyContribution: Number(drafts.investment.contribution) || 0, expectedReturn: 12, createdAt: new Date().toISOString() }) };
  }
  if (step === 5 && drafts.loan.name.trim() && Number(drafts.loan.principal) > 0) {
    const principal = Number(drafts.loan.principal); const rate = Number(drafts.loan.rate) / 1200; const tenure = Number(drafts.loan.tenure);
    const repaymentType = drafts.loan.repaymentType as "emi" | "bullet" | "interest-only-plus-bullet";
    const emi = repaymentType === "bullet" ? 0 : repaymentType === "interest-only-plus-bullet" ? principal * rate : rate ? principal * rate * Math.pow(1 + rate, tenure) / (Math.pow(1 + rate, tenure) - 1) : principal / tenure;
    return { ...current, loans: upsert(current.loans, { id: drafts.loan.id, type: "Other", name: drafts.loan.name.trim(), sanctionedPrincipal: principal, outstandingPrincipal: principal, annualInterestRate: Number(drafts.loan.rate), interestType: "Fixed", totalTenureMonths: tenure, startDate: formatDateOnly(new Date()), emi: Math.round(emi), repaymentType, prepayments: 0, createdAt: new Date().toISOString() }) };
  }
  if (step === 6 && drafts.planned.name.trim() && Number(drafts.planned.amount) > 0 && drafts.planned.date) {
    return { ...current, plannedExpenses: upsert(current.plannedExpenses, { id: drafts.planned.id, name: drafts.planned.name.trim(), category: drafts.planned.category, amount: Number(drafts.planned.amount), expectedDate: drafts.planned.date, ...(drafts.planned.inflation ? { customInflationRate: Number(drafts.planned.inflation) } : {}), createdAt: new Date().toISOString() }) };
  }
  return current;
}

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const { data: profile, isLoading } = useProfileInputs();
  const write = useFinancialWrite();
  const { toast } = useToast();
  const financialData = useQuery(financialDataQueryOptions());
  const trackedSetupVisit = useRef(false);
  const initializedSetup = useRef(false);
  const setupFlowState = useRef<SetupFlowState | null>(null);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(1);
  const [values, setValues] = useState({
    fullName: "",
    dateOfBirth: "",
    gender: "",
    targetRetirementAge: 55,
    lifeExpectancy: 85,
  });
  const [income, setIncome] = useState({ id: crypto.randomUUID(), name: "", amount: "" });
  const [expensePlan, setExpensePlan] = useState({ id: crypto.randomUUID(), category: "Living", amount: "", cadence: "monthly", dueDate: "" });
  const [investment, setInvestment] = useState({ id: crypto.randomUUID(), name: "", balance: "", contribution: "" });
  const [loan, setLoan] = useState({ id: crypto.randomUUID(), name: "", principal: "", rate: "8", tenure: "120", repaymentType: "emi" });
  const [planned, setPlanned] = useState({ id: crypto.randomUUID(), name: "", category: "Other", amount: "", date: "", inflation: "" });

  useEffect(() => {
    if (!profile || initializedSetup.current) return;
    initializedSetup.current = true;
    setStep(getInitialStep(profile));
    setValues({
      fullName: profile.fullName ?? "",
      dateOfBirth: profile.dateOfBirth ?? "",
      gender: profile.gender ?? "",
      targetRetirementAge: profile.targetRetirementAge,
      lifeExpectancy: profile.lifeExpectancy,
    });
  }, [profile]);

  useEffect(() => {
    if (!profile || trackedSetupVisit.current) return;
    trackedSetupVisit.current = true;
    const flowState = getSetupFlowState(profile);
    setupFlowState.current = flowState;
    if (flowState === "new") return;
    const currentStep = getInitialStep(profile);
    trackEvent(flowState === "resumed" ? "setup_resumed" : "setup_rerun", {
      step_number: currentStep,
      step_name: steps[currentStep - 1].title,
      flow_state: flowState,
    });
  }, [profile]);

  const persist = async (
    nextStep: number,
    action: PersistAction = "completed",
    finish = false,
  ) => {
    if (!profile || saving) return;
    if (action === "completed" && step === 1 && (values.fullName.trim().length < 2 || !values.dateOfBirth || !values.gender)) return;
    if (
      action === "completed"
      &&
      step === 5
      && loan.name.trim()
      && Number(loan.principal) > 0
      && (
        !Number.isFinite(Number(loan.tenure))
        || Number(loan.tenure) < 1
        || Number(loan.tenure) > 1200
        || !Number.isFinite(Number(loan.rate))
        || Number(loan.rate) < 0
        || Number(loan.rate) > 100
      )
    ) return;
    if (action === "completed" && step === 7 && values.lifeExpectancy < values.targetRetirementAge) return;
    setSaving(true);
    const skipped = action === "skipped";
    const flowState = setupFlowState.current ?? getSetupFlowState(profile);
    const previous = profile.onboardingProgress ?? { currentStep: 1, completedSteps: [], skippedSteps: [] };
    const completedSteps = action === "back"
      ? previous.completedSteps
      : skipped
      ? previous.completedSteps
      : [...new Set([...previous.completedSteps, step])];
    const skippedSteps = action === "back"
      ? previous.skippedSteps
      : skipped
      ? [...new Set([...previous.skippedSteps, step])]
      : previous.skippedSteps.filter((item) => item !== step);
    try {
      await write((current) => {
        const persistedData = action === "completed"
          ? withWizardItem(current, step, { income, expensePlan, investment, loan, planned })
          : current;
        return {
          ...persistedData,
          profileInputs: {
            ...current.profileInputs,
            ...(action === "completed" ? {
              ...values,
              fullName: values.fullName.trim(),
              dateOfBirth: values.dateOfBirth,
            } : {}),
            onboardingCompleted: finish || current.profileInputs.onboardingCompleted,
            onboardingProgress: {
              currentStep: nextStep,
              completedSteps,
              skippedSteps,
              firstProjectionSaved: finish || previous.firstProjectionSaved,
              dismissed: previous.dismissed,
              rerunInProgress: finish
                ? false
                : current.profileInputs.onboardingCompleted
                  ? true
                  : previous.rerunInProgress,
            },
          },
          retirementInputs: action === "completed"
            ? {
              ...current.retirementInputs,
              dateOfBirth: values.dateOfBirth,
              targetRetirementAge: values.targetRetirementAge,
              lifeExpectancy: values.lifeExpectancy,
            }
            : current.retirementInputs,
        };
      });
      if (action !== "back") {
        trackEvent(skipped ? "setup_step_skipped" : "setup_step_completed", {
          step_number: step,
          step_name: steps[step - 1].title,
          flow_state: flowState,
        });
      }
      if (finish) {
        trackEvent("first_projection_saved", {
          step_number: step,
          step_name: steps[step - 1].title,
          flow_state: flowState,
        });
      }
      if (finish) setLocation("/");
      else setStep(nextStep);
    } catch (error) {
      if (!accountSwitchSaveDescription(error)) {
        toast({
          title: "Setup step not saved",
          description: "Your previous progress is safe. Please try this step again.",
          variant: "destructive",
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const finishLater = async () => {
    if (!profile || saving) return;
    setSaving(true);
    const previous = profile.onboardingProgress ?? { currentStep: 1, completedSteps: [], skippedSteps: [] };
    try {
      await write((current) => ({
        ...current,
        profileInputs: {
          ...current.profileInputs,
          onboardingProgress: {
            ...previous,
            currentStep: step,
            dismissed: true,
            rerunInProgress: current.profileInputs.onboardingCompleted
              ? true
              : previous.rerunInProgress,
          },
        },
      }));
      setLocation("/");
    } catch (error) {
      if (!accountSwitchSaveDescription(error)) {
        toast({
          title: "Could not leave setup",
          description: "Your saved progress is safe. Please try again.",
          variant: "destructive",
        });
      }
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <div className="flex min-h-screen items-center justify-center">Loading setup…</div>;
  const current = steps[step - 1];
  const summary = financialData.data ? calculateRetirementProjection({
    expenses: financialData.data.expenses,
    budgets: financialData.data.budgets,
    incomes: financialData.data.incomeSources,
    investments: financialData.data.investments,
    loans: financialData.data.loans,
    plannedExpenses: financialData.data.plannedExpenses,
    assumptions: { ...financialData.data.retirementInputs, dateOfBirth: values.dateOfBirth },
  }) : null;

  return (
    <main className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div><h1 className="font-serif text-2xl">Build your first estimate</h1><p className="text-sm text-muted-foreground">Optional quick start · Step {step} of 8</p></div>
          <Button variant="outline" disabled={saving} onClick={finishLater}><LayoutDashboard className="mr-2 h-4 w-4" />Finish later</Button>
        </header>
        <div className="grid grid-cols-8 gap-1" aria-label={`Onboarding progress: step ${step} of 8`}>
          {steps.map((item, index) => <div key={item.title} className={`h-2 rounded ${index < step ? "bg-primary" : "bg-muted"}`} />)}
        </div>
        <Card>
          <CardHeader><CardTitle>{current.title}</CardTitle><CardDescription>{current.description}</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {step === 1 && <>
              <div><Label htmlFor="onboarding-name">Full name</Label><Input id="onboarding-name" value={values.fullName} onChange={(e) => setValues({ ...values, fullName: e.target.value })} /></div>
              <div><Label htmlFor="onboarding-dob">Date of birth</Label><Input id="onboarding-dob" type="date" max={formatDateOnly(new Date())} value={values.dateOfBirth} onChange={(e) => setValues({ ...values, dateOfBirth: e.target.value })} /></div>
              <div><Label>Gender</Label><Select value={values.gender} onValueChange={(gender) => setValues({ ...values, gender })}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{["Male", "Female", "Non-binary", "Prefer not to say"].map((gender) => <SelectItem key={gender} value={gender}>{gender}</SelectItem>)}</SelectContent></Select></div>
            </>}
            {step === 2 && <div className="grid gap-3 sm:grid-cols-2"><div><Label>One starter monthly income (optional)</Label><Input value={income.name} onChange={(e) => setIncome({ ...income, name: e.target.value })} placeholder="Salary" /></div><div><Label>Take-home amount</Label><Input type="number" min="0" value={income.amount} onChange={(e) => setIncome({ ...income, amount: e.target.value })} placeholder="50000" /></div></div>}
            {step === 3 && <div className="grid gap-3 sm:grid-cols-2"><div><Label>One starter expense category (optional)</Label><Input value={expensePlan.category} onChange={(e) => setExpensePlan({ ...expensePlan, category: e.target.value })} /></div><div><Label>Amount per occurrence</Label><Input type="number" min="0" value={expensePlan.amount} onChange={(e) => setExpensePlan({ ...expensePlan, amount: e.target.value })} /></div><div><Label>Frequency</Label><Select value={expensePlan.cadence} onValueChange={(cadence) => setExpensePlan({ ...expensePlan, cadence })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["monthly", "quarterly", "half-yearly", "yearly", "one-time"].map((cadence) => <SelectItem key={cadence} value={cadence}>{cadence === "one-time" ? "Dated one-time" : cadence}</SelectItem>)}</SelectContent></Select></div><div><Label>Due/start date</Label><Input type="date" value={expensePlan.dueDate} onChange={(e) => setExpensePlan({ ...expensePlan, dueDate: e.target.value })} /></div></div>}
            {step === 4 && <div className="grid gap-3 sm:grid-cols-3"><div><Label>One starter investment (optional)</Label><Input value={investment.name} onChange={(e) => setInvestment({ ...investment, name: e.target.value })} placeholder="Mutual funds" /></div><div><Label>Current balance</Label><Input type="number" min="0" value={investment.balance} onChange={(e) => setInvestment({ ...investment, balance: e.target.value })} /></div><div><Label>Monthly contribution</Label><Input type="number" min="0" value={investment.contribution} onChange={(e) => setInvestment({ ...investment, contribution: e.target.value })} /></div></div>}
            {step === 5 && <div className="grid gap-3 sm:grid-cols-2"><div><Label>One starter loan (optional)</Label><Input value={loan.name} onChange={(e) => setLoan({ ...loan, name: e.target.value })} /></div><div><Label>Outstanding principal</Label><Input type="number" min="0" value={loan.principal} onChange={(e) => setLoan({ ...loan, principal: e.target.value })} /></div><div><Label>Interest rate %</Label><Input type="number" min="0" max="100" step="0.01" value={loan.rate} onChange={(e) => setLoan({ ...loan, rate: e.target.value })} /></div><div><Label>Total term (months)</Label><Input type="number" min="1" max="1200" value={loan.tenure} onChange={(e) => setLoan({ ...loan, tenure: e.target.value })} /></div><div><Label>Repayment</Label><Select value={loan.repaymentType} onValueChange={(repaymentType) => setLoan({ ...loan, repaymentType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="emi">EMI</SelectItem><SelectItem value="bullet">Bullet</SelectItem><SelectItem value="interest-only-plus-bullet">Interest-only + bullet</SelectItem></SelectContent></Select></div></div>}
            {step === 6 && <div className="grid gap-3 sm:grid-cols-2"><div><Label>One starter future expense (optional)</Label><Input value={planned.name} onChange={(e) => setPlanned({ ...planned, name: e.target.value })} /></div><div><Label>Amount today</Label><Input type="number" min="0" value={planned.amount} onChange={(e) => setPlanned({ ...planned, amount: e.target.value })} /></div><div><Label>Category</Label><Select value={planned.category} onValueChange={(category) => setPlanned({ ...planned, category })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.keys(PLANNED_EXPENSE_CATEGORY_INFLATION).map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select></div><div><Label>Expected date</Label><Input type="date" value={planned.date} onChange={(e) => setPlanned({ ...planned, date: e.target.value })} /></div><div><Label>Inflation % (default {PLANNED_EXPENSE_CATEGORY_INFLATION[planned.category] ?? 6})</Label><Input type="number" min="0" value={planned.inflation} onChange={(e) => setPlanned({ ...planned, inflation: e.target.value })} placeholder="Optional custom rate" /></div></div>}
            {step === 7 && <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="retirement-age">Retirement age</Label><Input id="retirement-age" type="number" min="18" max="100" value={values.targetRetirementAge} onChange={(e) => setValues({ ...values, targetRetirementAge: Number(e.target.value) })} /></div><div><Label htmlFor="life-expectancy">Life expectancy</Label><Input id="life-expectancy" type="number" min={values.targetRetirementAge} max="125" value={values.lifeExpectancy} onChange={(e) => setValues({ ...values, lifeExpectancy: Number(e.target.value) })} /></div></div>}
            {step === 8 && <div className="rounded-lg border border-primary/20 bg-primary/5 p-5"><p className="font-semibold">Your first estimate is ready.</p>{summary && <dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-muted-foreground">Required corpus</dt><dd className="font-semibold">{formatINR(summary.requiredCorpus)}</dd></div><div><dt className="text-muted-foreground">Projected corpus</dt><dd className={`font-semibold ${summary.projectedCorpus > 0 ? "text-positive" : summary.projectedCorpus < 0 ? "text-negative" : "text-foreground"}`}>{formatINR(summary.projectedCorpus)}</dd></div><div><dt className="text-muted-foreground">Shortfall</dt><dd className={`font-semibold ${summary.gap > 0 ? "text-negative" : "text-foreground"}`}>{formatINR(Math.max(0, summary.gap))}</dd></div><div><dt className="text-muted-foreground">Expense at retirement</dt><dd className="font-semibold">{formatINR(summary.expenseAtRetirement)}/mo</dd></div></dl>}<p className="mt-3 text-sm text-muted-foreground">This is a starting estimate, not your complete financial inventory. Add and refine everything from the dashboard afterward.</p></div>}
            <div className="flex flex-wrap justify-between gap-2 pt-2">
              <Button variant="outline" disabled={step === 1 || saving} onClick={() => persist(step - 1, "back")}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>
              <div className="flex gap-2">
                {current.optional && <Button variant="ghost" disabled={saving} onClick={() => persist(step + 1, "skipped")}><SkipForward className="mr-2 h-4 w-4" />Skip for now</Button>}
                <Button disabled={saving} onClick={() => persist(Math.min(8, step + 1), "completed", step === 8)}>{step === 8 ? <><Check className="mr-2 h-4 w-4" />Save first estimate</> : <>Save & continue<ArrowRight className="ml-2 h-4 w-4" /></>}</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}