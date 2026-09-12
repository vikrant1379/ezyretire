import assert from "node:assert/strict";
import test from "node:test";
import { isValidTrendExpense } from "./trend-data.ts";
import type { Expense } from "./storage.ts";

const expense = {
  id: "expense-1",
  merchant: "Grocer",
  category: "Groceries",
  amount: 500,
  date: "2026-01-15",
  paymentMethod: "UPI",
  createdAt: "2026-01-15T00:00:00.000Z",
} as Expense;

test("trend expenses require finite positive amounts and valid dates", () => {
  assert.equal(isValidTrendExpense(expense), true);
  assert.equal(isValidTrendExpense({ ...expense, amount: Number.NaN }), false);
  assert.equal(isValidTrendExpense({ ...expense, amount: Number.POSITIVE_INFINITY }), false);
  assert.equal(isValidTrendExpense({ ...expense, amount: -1 }), false);
  assert.equal(isValidTrendExpense({ ...expense, date: "not-a-date" }), false);
  assert.equal(isValidTrendExpense({ ...expense, category: " " }), false);
});