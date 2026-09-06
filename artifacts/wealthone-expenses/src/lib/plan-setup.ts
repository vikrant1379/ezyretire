import { finiteNonNegative, recurringMonthlyNetIncome } from "./financial-metrics.ts";
import { hasEffectiveBudgetPlan, type Budget, type Expense, type IncomeSource, type Investment, type Loan } from "./storage.ts";

export type PlanSetupStepId = "income" | "spending" | "investments" | "loans";

export type PlanSetupStep = {
  id: PlanSetupStepId;
  title: string;
  /** What the step gives the user once it is done. */
  unlocks: string;
  action: string;
  href: string;
  done: boolean;
  /** Optional steps never block a projection and never hold back progress. */
  optional: boolean;
};

export type PlanSetupInput = {
  incomeSources: IncomeSource[];
  expenses: Expense[];
  budgets: Budget[];
  investments: Investment[];
  loans: Loan[];
};

export type PlanSetup = {
  steps: PlanSetupStep[];
  essentialSteps: number;
  completedEssentialSteps: number;
  completionPercent: number;
  nextStep: PlanSetupStep | null;
  hasIncome: boolean;
  hasSpendingBaseline: boolean;
  hasInvestments: boolean;
  hasLoans: boolean;
  /**
   * A retirement verdict is only meaningful once we know what the user earns
   * and what their lifestyle costs. Without a cost baseline the required
   * corpus is zero, which would wrongly report every plan as fully funded.
   */
  canProjectRetirement: boolean;
};

export function getPlanSetup({
  incomeSources,
  expenses,
  budgets,
  investments,
  loans,
}: PlanSetupInput): PlanSetup {
  const hasIncome = incomeSources.some(
    (source) => recurringMonthlyNetIncome(source) > 0 || finiteNonNegative(source.amount) > 0,
  );
  const hasBudgets = hasEffectiveBudgetPlan(budgets);
  const hasExpenses = expenses.some(
    (expense) => !expense.reimbursable && finiteNonNegative(expense.amount) > 0,
  );
  const hasSpendingBaseline = hasBudgets || hasExpenses;
  const hasInvestments = investments.some(
    (investment) =>
      finiteNonNegative(investment.currentValue) > 0
      || finiteNonNegative(investment.investedAmount) > 0,
  );
  const hasLoans = loans.length > 0;

  const steps: PlanSetupStep[] = [
    {
      id: "income",
      title: "Add what you earn",
      unlocks: "Your monthly surplus, savings rate and how much you can invest.",
      action: "Add income",
      href: "/income",
      done: hasIncome,
      optional: false,
    },
    {
      id: "spending",
      title: "Set your monthly spending",
      unlocks: "The lifestyle your retirement corpus has to fund for life.",
      action: hasExpenses ? "Set budgets" : "Add spending",
      href: hasExpenses ? "/budgets" : "/transactions",
      done: hasSpendingBaseline,
      optional: false,
    },
    {
      id: "investments",
      title: "Add what you have invested",
      unlocks: "Today's corpus, your blended return and the projected corpus.",
      action: "Add investments",
      href: "/investments",
      done: hasInvestments,
      optional: false,
    },
    {
      id: "loans",
      title: "Add loans and EMIs",
      unlocks: "When each EMI ends and frees up cash for investing.",
      action: "Add a loan",
      href: "/loans",
      done: hasLoans,
      optional: true,
    },
  ];

  const essentials = steps.filter((step) => !step.optional);
  const completedEssentialSteps = essentials.filter((step) => step.done).length;

  return {
    steps,
    essentialSteps: essentials.length,
    completedEssentialSteps,
    completionPercent: Math.round((completedEssentialSteps / essentials.length) * 100),
    nextStep: essentials.find((step) => !step.done) ?? null,
    hasIncome,
    hasSpendingBaseline,
    hasInvestments,
    hasLoans,
    canProjectRetirement: hasIncome && hasSpendingBaseline,
  };
}
