import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeImportedExpenses,
  parseImportedExpenseDate,
  type ImportedExpense,
} from "./expense-import.ts";
import type { Expense } from "./storage";

const baseExpense: ImportedExpense = {
  date: "2026-09-02T00:00:00.000Z",
  amount: 1250,
  category: "Food & Dining",
  merchant: "Test merchant",
  paymentMethod: "UPI",
  note: "Test row",
  reimbursable: false,
  recurring: false,
  linkedLoanId: "loan-1",
};

test("stable export IDs make repeated imports idempotent", () => {
  const rows: ImportedExpense[] = [
    { ...baseExpense, id: "expense-1", createdAt: "2026-09-02T01:00:00Z" },
    { ...baseExpense, id: "expense-2", createdAt: "2026-09-02T02:00:00Z" },
  ];
  const first = mergeImportedExpenses([], rows, () => "generated");
  const second = mergeImportedExpenses(
    first.expenses,
    rows,
    () => "generated",
  );

  assert.equal(first.added.length, 2);
  assert.equal(second.added.length, 0);
  assert.equal(second.duplicateCount, 2);
  assert.deepEqual(
    second.expenses.map((expense) => expense.id),
    ["expense-1", "expense-2"],
  );
  assert.equal(second.expenses[0].linkedLoanId, "loan-1");
});

test("legacy exports preserve genuine repeated rows but do not re-import them", () => {
  let nextId = 0;
  const rows = [{ ...baseExpense }, { ...baseExpense }];
  const first = mergeImportedExpenses(
    [],
    rows,
    () => `generated-${++nextId}`,
  );
  const second = mergeImportedExpenses(
    first.expenses,
    rows,
    () => `generated-${++nextId}`,
  );

  assert.equal(first.added.length, 2);
  assert.equal(second.added.length, 0);
  assert.equal(second.duplicateCount, 2);
});

test("imported dates support ISO, legacy Indian dates, and reject invalid values", () => {
  assert.equal(
    parseImportedExpenseDate("2026-09-02")?.toISOString().slice(0, 10),
    "2026-09-02",
  );
  assert.equal(
    parseImportedExpenseDate("02/09/2026")?.toISOString().slice(0, 10),
    "2026-09-02",
  );
  assert.equal(parseImportedExpenseDate("31/02/2026"), null);
  assert.equal(parseImportedExpenseDate("not-a-date"), null);
  assert.equal(parseImportedExpenseDate(undefined), null);
});

test("an imported stable ID collision is skipped without replacing local data", () => {
  const local: Expense = {
    ...baseExpense,
    id: "expense-1",
    merchant: "Local merchant",
    createdAt: "2026-09-01T00:00:00.000Z",
  };
  const result = mergeImportedExpenses(
    [local],
    [{ ...baseExpense, id: "expense-1", merchant: "Imported merchant" }],
    () => "generated",
  );

  assert.equal(result.added.length, 0);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.expenses[0].merchant, "Local merchant");
});