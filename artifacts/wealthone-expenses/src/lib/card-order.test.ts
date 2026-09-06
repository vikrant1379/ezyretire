import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCustomOrder,
  defaultUiPreferences,
  dropId,
  moveItem,
  normalizeUiPreferences,
  pendingSortAfterConfirmation,
  prependId,
  sortInvestments,
  sortIncomeSources,
  sortLoans,
} from "./card-order.ts";
import type { IncomeSource, Investment, Loan } from "./storage.ts";

test("keeps a pending sort through stale confirmations and releases it when saved", () => {
  const pending = { by: "monthly", direction: "desc" } as const;

  assert.deepEqual(
    pendingSortAfterConfirmation(
      pending,
      { by: "manual", direction: "desc" },
    ),
    pending,
  );
  assert.equal(
    pendingSortAfterConfirmation(
      pending,
      { by: "monthly", direction: "desc" },
    ),
    null,
  );
});

const investment = (id: string, extras: Partial<Investment> = {}): Investment => ({
  id,
  name: id,
  assetClass: "Other",
  investedAmount: 0,
  currentValue: 0,
  expectedReturn: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...extras,
});

const loan = (id: string, extras: Partial<Loan> = {}): Loan => ({
  id,
  type: "Other",
  name: id,
  sanctionedPrincipal: 0,
  outstandingPrincipal: 0,
  annualInterestRate: 0,
  interestType: "Fixed",
  totalTenureMonths: 12,
  startDate: "2026-01-01",
  emi: 0,
  prepayments: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...extras,
});

const income = (id: string, extras: Partial<IncomeSource> = {}): IncomeSource => ({
  id,
  name: id,
  type: "Other",
  frequency: "Monthly",
  amount: 0,
  date: "2026-01-01",
  recurring: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...extras,
});

test("drops unknown preference keys and invalid sort values", () => {
  const normalized = normalizeUiPreferences({
    hack: true,
    investmentOrder: ["a", 2, "a", " b ", ""],
    loanOrder: null,
    incomeOrder: ["salary", "salary", 3],
    investmentSort: { by: "password", direction: "sideways" },
    loanSort: { by: "emi", direction: "asc" },
    incomeSort: { by: "annual", direction: "asc" },
  });

  assert.deepEqual(normalized.investmentOrder, ["a", "b"]);
  assert.deepEqual(normalized.loanOrder, []);
  assert.deepEqual(normalized.incomeOrder, ["salary"]);
  assert.deepEqual(normalized.investmentSort, { by: "manual", direction: "desc" });
  assert.deepEqual(normalized.loanSort, { by: "emi", direction: "asc" });
  assert.deepEqual(normalized.incomeSort, { by: "annual", direction: "asc" });
});

test("places new items first and ignores deleted ids", () => {
  const items = [
    investment("old", { createdAt: "2026-01-01T00:00:00.000Z" }),
    investment("fresh", { createdAt: "2026-03-01T00:00:00.000Z" }),
    investment("older", { createdAt: "2025-12-01T00:00:00.000Z" }),
  ];

  assert.deepEqual(
    applyCustomOrder(items, ["gone", "older", "old"]).map((item) => item.id),
    ["fresh", "older", "old"],
  );
});

test("sorts investments by gain and projected value with a stable tie-break", () => {
  const items = [
    investment("a", { investedAmount: 100, currentValue: 150, expectedReturn: 10, createdAt: "2026-01-02T00:00:00.000Z" }),
    investment("b", { investedAmount: 100, currentValue: 150, expectedReturn: 8, createdAt: "2026-01-01T00:00:00.000Z" }),
    investment("c", { investedAmount: 50, currentValue: 40, expectedReturn: 12, createdAt: "2026-01-03T00:00:00.000Z" }),
  ];
  const order = ["a", "b", "c"];

  assert.deepEqual(
    sortInvestments(items, {
      investmentOrder: order,
      loanOrder: [],
      investmentSort: { by: "gain", direction: "desc" },
      loanSort: { by: "manual", direction: "desc" },
    }, 0).map((item) => item.id),
    ["a", "b", "c"],
  );

  assert.deepEqual(
    sortInvestments(items, {
      investmentOrder: order,
      loanOrder: [],
      investmentSort: { by: "projected", direction: "desc" },
      loanSort: { by: "manual", direction: "desc" },
    }, 10).map((item) => item.id),
    ["a", "b", "c"],
  );
});

test("projected investment sorting uses contribution schedule context", () => {
  const items = [
    investment("steady", {
      monthlyContribution: 100,
      contributionStartDate: "2026-09-02",
      contributionEndMode: "retirement",
    }),
    investment("late", {
      monthlyContribution: 1_000,
      contributionStartDate: "2027-08-01",
      contributionEndMode: "retirement",
    }),
  ];
  const preferences = {
    ...defaultUiPreferences(),
    investmentOrder: ["steady", "late"],
    investmentSort: { by: "projected" as const, direction: "desc" as const },
  };
  assert.deepEqual(
    sortInvestments(items, preferences, 1, {
      asOf: new Date(2026, 8, 2),
      monthsToRetirement: 12,
    }).map((item) => item.id),
    ["steady", "late"],
  );
});

test("sorts loans by remaining time and future interest", () => {
  const items = [
    loan("short", { outstandingPrincipal: 12000, emi: 2000, annualInterestRate: 0 }),
    loan("long", { outstandingPrincipal: 24000, emi: 2000, annualInterestRate: 0 }),
    loan("costly", {
      outstandingPrincipal: 100000,
      emi: 2000,
      annualInterestRate: 12,
    }),
  ];
  const preferences = {
    investmentOrder: [] as string[],
    loanOrder: ["short", "long", "costly"],
    investmentSort: { by: "manual" as const, direction: "desc" as const },
    loanSort: { by: "remaining" as const, direction: "asc" as const },
  };

  assert.deepEqual(
    sortLoans(items, preferences).map((item) => item.id),
    ["short", "long", "costly"],
  );

  assert.equal(
    sortLoans(items, { ...preferences, loanSort: { by: "interest", direction: "desc" } })[0].id,
    "costly",
  );
});

test("sorts income sources by monthly net, annual gross, and growth", () => {
  const items = [
    income("salary", {
      type: "Salary",
      amount: 0,
      annualGrowthRate: 8,
      salaryDetails: {
        grossCTC: 1200000,
        basicPay: 60000,
        hra: 25000,
        allowances: 15000,
        employeePF: 5000,
        professionalTax: 200,
        tds: 10000,
        otherDeductions: 0,
      },
    }),
    income("rent", { amount: 50000, annualGrowthRate: 5 }),
    income("bonus", { frequency: "Annual", amount: 900000, annualGrowthRate: 0 }),
  ];
  const preferences = {
    ...defaultUiPreferences(),
    incomeOrder: ["salary", "rent", "bonus"],
  };

  assert.deepEqual(
    sortIncomeSources(items, {
      ...preferences,
      incomeSort: { by: "monthly", direction: "desc" },
    }).map((item) => item.id),
    ["salary", "rent", "bonus"],
  );
  assert.deepEqual(
    sortIncomeSources(items, {
      ...preferences,
      incomeSort: { by: "annual", direction: "desc" },
    }).map((item) => item.id),
    ["salary", "bonus", "rent"],
  );
  assert.equal(
    sortIncomeSources(items, {
      ...preferences,
      incomeSort: { by: "growth", direction: "desc" },
    })[0].id,
    "salary",
  );
});

test("drag reorder and id bookkeeping", () => {
  assert.deepEqual(moveItem(["a", "b", "c"], "c", "a"), ["c", "a", "b"]);
  assert.deepEqual(prependId(["b", "a"], "c"), ["c", "b", "a"]);
  assert.deepEqual(dropId(["c", "b", "a"], "b"), ["c", "a"]);
});
