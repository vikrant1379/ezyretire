import type { Expense } from "./storage";

export function isValidTrendExpense(
  expense: Expense,
): boolean {
  const date = new Date(expense.date);
  return Number.isFinite(date.getTime())
    && Number.isFinite(expense.amount)
    && expense.amount > 0
    && typeof expense.category === "string"
    && expense.category.trim().length > 0;
}