import { parseDateOnly, type FinancialGoal } from "./storage.ts";

const safe = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
const monthIndex = (date: Date) => date.getFullYear() * 12 + date.getMonth();

export function inflatedGoalTarget(goal: FinancialGoal, asOf: Date): number {
  const target = parseDateOnly(goal.targetDate);
  if (!Number.isFinite(target.getTime())) return 0;
  const months = Math.max(0, monthIndex(target) - monthIndex(asOf));
  const rate = Math.min(0.25, safe(goal.annualInflationRate) / 100);
  return safe(goal.targetAmount) * Math.pow(1 + rate, months / 12);
}

export function requiredGoalContribution(goal: FinancialGoal, asOf: Date): number {
  const months = Math.max(0, monthIndex(parseDateOnly(goal.targetDate)) - monthIndex(asOf));
  const remaining = Math.max(0, inflatedGoalTarget(goal, asOf) - safe(goal.currentAmount));
  return months > 0 ? remaining / months : remaining;
}

export type GoalStatus = "completed" | "on-track" | "behind" | "overdue";

export function goalStatus(goal: FinancialGoal, asOf: Date): GoalStatus {
  const target = inflatedGoalTarget(goal, asOf);
  if (safe(goal.currentAmount) >= target) return "completed";
  if (parseDateOnly(goal.targetDate) < new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate())) {
    return "overdue";
  }
  return safe(goal.monthlyAllocation) + 0.005 >= requiredGoalContribution(goal, asOf)
    ? "on-track"
    : "behind";
}

export type GoalAllocation = {
  goalId: string;
  requested: number;
  allocated: number;
  shortfall: number;
};

/** Priority order is deterministic; lower priority numbers receive surplus first. */
export function allocateGoalSurplus(goals: FinancialGoal[], availableMonthlySurplus: number) {
  let remaining = safe(availableMonthlySurplus);
  const allocations: GoalAllocation[] = [...goals]
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .map((goal) => {
      const requested = safe(goal.monthlyAllocation);
      const allocated = Math.min(requested, remaining);
      remaining -= allocated;
      return { goalId: goal.id, requested, allocated, shortfall: requested - allocated };
    });
  return {
    available: safe(availableMonthlySurplus),
    committed: allocations.reduce((sum, item) => sum + item.allocated, 0),
    unallocated: remaining,
    overAllocated: allocations.some((item) => item.shortfall > 0),
    allocations,
  };
}

/**
 * Existing over-allocation must be repairable one edit at a time. Only a net
 * increase in the account's requested monthly commitment needs to fit today's
 * available surplus.
 */
export function canSaveGoalAllocation(input: {
  otherCommitted: number;
  previousAllocation?: number;
  nextAllocation: number;
  availableSurplus: number;
}) {
  const otherCommitted = safe(input.otherCommitted);
  const previousTotal = otherCommitted + safe(input.previousAllocation ?? 0);
  const nextTotal = otherCommitted + safe(input.nextAllocation);
  return nextTotal <= previousTotal + 0.005
    || nextTotal <= safe(input.availableSurplus) + 0.005;
}