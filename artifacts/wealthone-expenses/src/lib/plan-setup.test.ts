import assert from "node:assert/strict";
import test from "node:test";
import { getPlanSetup, type PlanSetupInput } from "./plan-setup.ts";
import type { Expense, IncomeSource, Investment, Loan } from "./storage.ts";

const emptyInput = (): PlanSetupInput => ({
  incomeSources: [],
  expenses: [],
  budgets: [],
  investments: [],
  loans: [],
});

const salary = (overrides: Partial<IncomeSource> = {}): IncomeSource => ({
  id: "salary",
  name: "Salary",
  type: "Salary",
  frequency: "Monthly",
  amount: 120_000,
  date: "2026-01-01",
  recurring: true,
  createdAt: "2026-01-01",
  ...overrides,
});

const expense = (overrides: Partial<Expense> = {}): Expense => ({
  id: "expense",
  date: "2026-09-01",
  amount: 2_500,
  category: "Food",
  merchant: "Store",
  paymentMethod: "UPI",
  reimbursable: false,
  recurring: false,
  createdAt: "2026-09-01",
  ...overrides,
});

const investment = (overrides: Partial<Investment> = {}): Investment => ({
  id: "fund",
  name: "Index fund",
  assetClass: "Mutual Funds",
  investedAmount: 100_000,
  currentValue: 120_000,
  expectedReturn: 11,
  createdAt: "2026-01-01",
  ...overrides,
});

const loan = (overrides: Partial<Loan> = {}): Loan => ({
  id: "loan",
  type: "Home",
  name: "Home loan",
  sanctionedPrincipal: 5_000_000,
  outstandingPrincipal: 4_200_000,
  annualInterestRate: 8.5,
  interestType: "Floating",
  totalTenureMonths: 240,
  startDate: "2024-01-01",
  emi: 43_000,
  prepayments: 0,
  createdAt: "2024-01-01",
  ...overrides,
});

test("a brand new account cannot project retirement and starts at zero progress", () => {
  const setup = getPlanSetup(emptyInput());

  assert.equal(setup.canProjectRetirement, false);
  assert.equal(setup.completedEssentialSteps, 0);
  assert.equal(setup.completionPercent, 0);
  assert.equal(setup.nextStep?.id, "income");
});

test("income alone is not enough, because a plan needs a cost baseline", () => {
  const setup = getPlanSetup({ ...emptyInput(), incomeSources: [salary()] });

  assert.equal(setup.hasIncome, true);
  assert.equal(setup.hasSpendingBaseline, false);
  assert.equal(setup.canProjectRetirement, false);
  assert.equal(setup.nextStep?.id, "spending");
});

test("either a budget or a real expense counts as the spending baseline", () => {
  const fromBudget = getPlanSetup({
    ...emptyInput(),
    incomeSources: [salary()],
    budgets: [{ category: "Food", monthlyLimit: 20_000 }],
  });
  const fromExpense = getPlanSetup({
    ...emptyInput(),
    incomeSources: [salary()],
    expenses: [expense()],
  });

  assert.equal(fromBudget.canProjectRetirement, true);
  assert.equal(fromExpense.canProjectRetirement, true);
});

test("reimbursable and zero-value entries do not count as real data", () => {
  const setup = getPlanSetup({
    ...emptyInput(),
    incomeSources: [salary({ amount: 0, salaryDetails: undefined })],
    expenses: [expense({ reimbursable: true })],
    budgets: [{ category: "Food", monthlyLimit: 0 }],
    investments: [investment({ investedAmount: 0, currentValue: 0 })],
  });

  assert.equal(setup.hasIncome, false);
  assert.equal(setup.hasSpendingBaseline, false);
  assert.equal(setup.hasInvestments, false);
  assert.equal(setup.canProjectRetirement, false);
});

test("loans are optional, so they never hold back setup progress", () => {
  const withoutLoan = getPlanSetup({
    ...emptyInput(),
    incomeSources: [salary()],
    expenses: [expense()],
    investments: [investment()],
  });

  assert.equal(withoutLoan.completionPercent, 100);
  assert.equal(withoutLoan.nextStep, null);
  assert.equal(withoutLoan.hasLoans, false);

  const withLoan = getPlanSetup({
    ...emptyInput(),
    incomeSources: [salary()],
    expenses: [expense()],
    investments: [investment()],
    loans: [loan()],
  });

  assert.equal(withLoan.hasLoans, true);
  assert.equal(withLoan.completionPercent, 100);
});

test("partial setup reports the next essential step and its progress", () => {
  const setup = getPlanSetup({
    ...emptyInput(),
    incomeSources: [salary()],
    expenses: [expense()],
  });

  assert.equal(setup.completedEssentialSteps, 2);
  assert.equal(setup.completionPercent, 67);
  assert.equal(setup.nextStep?.id, "investments");
  assert.equal(setup.canProjectRetirement, true);
});
