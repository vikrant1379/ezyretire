import assert from "node:assert/strict";
import test from "node:test";

import { incomeReconciliationForMonth } from "./income-reconciliation.ts";
import type { IncomeReceipt, IncomeSource } from "./storage.ts";

const source: IncomeSource = {
  id: "salary",
  name: "Salary",
  type: "Other",
  frequency: "Monthly",
  amount: 100,
  date: "2020-01-15",
  recurring: true,
  incomeEndMode: "retirement",
  createdAt: "2020-01-01T00:00:00.000Z",
};

const partialReceipt: IncomeReceipt = {
  id: "receipt",
  incomeSourceId: source.id,
  receivedDate: "2025-01-15",
  amount: 70,
  createdAt: "2025-01-15T00:00:00.000Z",
};

test("income reconciliation stops retirement-ended income after the retirement month", () => {
  const planning = {
    profileInputs: { dateOfBirth: "2000-02-10", targetRetirementAge: 60 },
    retirementInputs: { dateOfBirth: "2000-02-10", targetRetirementAge: 25 },
  };

  assert.deepEqual(
    incomeReconciliationForMonth({
      sources: [source],
      receipts: [partialReceipt],
      ...planning,
      asOf: new Date(2025, 0, 1),
    }),
    { month: "2025-01", expected: 100, received: 70, variance: -30 },
  );
  assert.deepEqual(
    incomeReconciliationForMonth({
      sources: [source],
      receipts: [],
      ...planning,
      asOf: new Date(2025, 1, 1),
    }),
    { month: "2025-02", expected: 0, received: 0, variance: 0 },
  );
});