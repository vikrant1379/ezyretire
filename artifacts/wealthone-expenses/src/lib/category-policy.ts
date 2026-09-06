import type { Budget, Expense } from "./storage.ts";

export const CORE_CATEGORIES = [
  "Food & Dining",
  "Transportation",
  "Shopping",
  "Entertainment",
  "Housing",
  "Utilities",
  "Health & Wellness",
  "Travel",
  "Education",
  "Miscellaneous",
];

export const OPTIONAL_CATEGORIES = [
  "Home maintenance",
  "Insurance",
  "Family & caregiving",
  "Domestic help",
  "Taxes & fees",
];

export function isCoreCategory(category: string) {
  return CORE_CATEGORIES.includes(category);
}

export function isCustomPlanningCategory(category: string) {
  return !CORE_CATEGORIES.includes(category) && !OPTIONAL_CATEGORIES.includes(category);
}

export function getBudgetCategories(
  budgets: Budget[],
  expenses: Expense[],
  archivedPlanningCategories: string[],
) {
  const archived = new Set(archivedPlanningCategories);
  const categories = new Set(CORE_CATEGORIES);
  budgets.forEach((budget) => {
    if (budget.category && !archived.has(budget.category)) categories.add(budget.category);
  });
  expenses.forEach((expense) => {
    if (expense.category && !archived.has(expense.category)) categories.add(expense.category);
  });
  return Array.from(categories);
}