import {
  calculateTargetRetirementMonth,
  type Budget,
  type BudgetWindow,
  type BudgetWindowEndMode,
  type RetirementInputs,
} from "./storage.ts";

export function getTargetRetirementMonth(inputs: RetirementInputs | undefined): Date | undefined {
  return inputs ? calculateTargetRetirementMonth(inputs) : undefined;
}

export function getRetirementEndDate(inputs: RetirementInputs | undefined): string | undefined {
  const retMonth = getTargetRetirementMonth(inputs);
  if (!retMonth) return undefined;
  
  // Strictly before target retirement month means the end date is the previous month.
  // E.g. target is 2035-05 (May). The last active month is 2035-04 (April).
  // We can just use the last day of the previous month.
  const prevMonth = new Date(retMonth.getFullYear(), retMonth.getMonth(), 0);
  
  const year = prevMonth.getFullYear();
  const month = String(prevMonth.getMonth() + 1).padStart(2, "0");
  const day = String(prevMonth.getDate()).padStart(2, "0");
  
  return `${year}-${month}-${day}`;
}

export type UIBudgetWindowEndMode = BudgetWindowEndMode;
export type UIBudgetWindow = BudgetWindow;
export type UIBudget = Budget;
