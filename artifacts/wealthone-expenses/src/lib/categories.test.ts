import assert from "node:assert/strict";
import test from "node:test";
import { getBudgetCategories } from "./category-policy.ts";
import type { Budget, Expense } from "./storage.ts";

const budget = (category: string): Budget => ({ category, monthlyLimit: 1000, windows: [] });
const expense = (category: string): Expense => ({
  id: "expense-1",
  date: "2026-09-01",
  amount: 100,
  category,
  merchant: "",
  paymentMethod: "",
  reimbursable: false,
  recurring: false,
  createdAt: "2026-09-01T00:00:00.000Z",
});

test("archived planning categories stay hidden without historical expenses", () => {
  assert.equal(getBudgetCategories([], [], ["Pet care"]).includes("Pet care"), false);
});

test("archived planning categories stay hidden while historical expenses remain unchanged", () => {
  const expenses = [expense("Pet care")];
  const categories = getBudgetCategories([budget("Pet care")], expenses, ["Pet care"]);

  assert.equal(categories.includes("Pet care"), false);
  assert.equal(expenses[0].category, "Pet care");
});

test("core categories cannot be hidden by archived preferences", () => {
  assert.equal(getBudgetCategories([], [], ["Housing"]).includes("Housing"), true);
});