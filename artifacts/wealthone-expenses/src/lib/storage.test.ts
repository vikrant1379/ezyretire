import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDateOnly,
  budgetTotalForMonth,
  budgetMonthlyEquivalent,
  effectiveBudgetWindowAmount,
  hasEffectiveBudgetPlan,
  isCurrentLoan,
  loanMonthlyPayment,
  isLoanStarted,
  normalizeInvestmentContributionSchedule,
  normalizeInvestmentDisposals,
  normalizeIncomeSchedule,
  normalizeBudgets,
  normalizeMonthlyReports,
  nextYearlyBudgetOccurrence,
  validateBudgetSchedule,
  parseDateOnly,
  plannedExpenseInflatedValue,
  storage,
  type IncomeSource,
  type Loan,
} from "./storage.ts";

test("monthly report normalization preserves retirement forecast for reports rendering", () => {
  const ids = ["income-vs-expected", "expenses-vs-budget-category", "savings-amount-rate", "portfolio-value-returns-change", "net-worth-change", "retirement-date-movement", "health-score-change", "top-next-month-actions"];
  const reports = normalizeMonthlyReports([{
    id: "r1", month: "2026-01", generatedAt: "2026-02-01T00:00:00.000Z",
    sections: ids.map((id) => ({ id, title: id, metrics: { value: 1 }, metricFormats: { value: "number" }, actions: [] })),
    retirementForecast: {
      projectedRetirementMonth: "2048-06", projectedRetirementAge: 62, asOfDate: "2026-01-31",
      assumptions: { targetRetirementAge: 62, lifeExpectancy: 85, generalInflation: 6, salaryGrowth: 8, monthlyContribution: 50000, monthlySpending: 100000, portfolioValue: 1000000, expectedReturn: 10 },
      drivers: ["steady contributions"],
    },
  }]);
  assert.equal(reports[0]?.retirementForecast?.projectedRetirementMonth, "2048-06");
  assert.equal(reports[0]?.retirementForecast?.projectedRetirementAge, 62);
});

test("all expense frequencies normalize to monthly equivalents and scheduled months", () => {
  const quarterly = { id: "q", monthlyLimit: 12_000, cadence: "quarterly" as const, startDate: "2026-01-01", endMode: "lifelong" as const };
  const halfYearly = { ...quarterly, id: "h", monthlyLimit: 60_000, cadence: "half-yearly" as const };
  const oneTime = { ...quarterly, id: "o", monthlyLimit: 90_000, cadence: "one-time" as const };
  assert.equal(budgetMonthlyEquivalent(quarterly), 4_000);
  assert.equal(budgetMonthlyEquivalent(halfYearly), 10_000);
  assert.equal(effectiveBudgetWindowAmount(quarterly, new Date(2026, 3, 1)), 12_000);
  assert.equal(effectiveBudgetWindowAmount(quarterly, new Date(2026, 4, 1)), 0);
  assert.equal(effectiveBudgetWindowAmount(halfYearly, new Date(2026, 6, 1)), 60_000);
  assert.equal(effectiveBudgetWindowAmount(oneTime, new Date(2026, 0, 1)), 90_000);
  assert.equal(effectiveBudgetWindowAmount(oneTime, new Date(2026, 1, 1)), 0);
});

test("planned expenses use category or custom inflation", () => {
  const expense = { id: "goal", name: "Degree", category: "Education", amount: 100_000, expectedDate: "2027-01-01", createdAt: "2026-01-01" };
  assert.equal(Math.round(plannedExpenseInflatedValue(expense, new Date(2026, 0, 1))), 108_000);
  assert.equal(Math.round(plannedExpenseInflatedValue({ ...expense, customInflationRate: 10 }, new Date(2026, 0, 1))), 110_000);
});

test("loan monthly burden uses outstanding principal for interest-only repayments", () => {
  const base = {
    sanctionedPrincipal: 1_000_000,
    outstandingPrincipal: 600_000,
    annualInterestRate: 12,
    emi: 25_000,
  };
  assert.equal(loanMonthlyPayment({ ...base, repaymentType: "emi" }), 25_000);
  assert.equal(loanMonthlyPayment({ ...base, repaymentType: "bullet" }), 0);
  assert.equal(
    loanMonthlyPayment({ ...base, repaymentType: "interest-only-plus-bullet" }),
    6_000,
  );
});
import { calculateIncomeMetrics } from "./financial-metrics.ts";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

test("legacy disposal records retain identity and only valid recorded tax facts", () => {
  const normalized = normalizeInvestmentDisposals([
    {
      purchaseDate: "2024-02-29T00:00:00.000Z",
      saleDate: "not-a-date",
      costBasis: "1000",
      proceeds: -1,
      assetType: " Listed Equity ",
      eligibleExemption: "unknown",
      indexedCostBasis: "1250",
      grandfatheredValue: -5,
    },
  ], "holding-1");

  assert.deepEqual(normalized, [{
    id: "holding-1-disposal-1",
    name: "Disposal 1",
    purchaseDate: "2024-02-29",
    costBasis: 1000,
    assetType: "Listed Equity",
    indexedCostBasis: 1250,
  }]);
});

test("broker import batch metadata survives investment disposal normalization", () => {
  const normalized = normalizeInvestmentDisposals([{
    id: "sale-1",
    name: "TCS",
    importBatchId: "batch-123",
    importedAt: "2026-09-05T10:00:00.000Z",
  }]);

  assert.equal(normalized[0].importBatchId, "batch-123");
  assert.equal(normalized[0].importedAt, "2026-09-05T10:00:00.000Z");
});

const local = new MemoryStorage();
Object.assign(globalThis, { localStorage: local });

const keys = [
  "ezyretire_expenses",
  "ezyretire_budgets",
  "ezyretire_income",
  "ezyretire_investments",
  "ezyretire_loans",
  "ezyretire_retirement",
  "ezyretire_profile",
  "wealthone_expenses",
  "wealthone_budgets",
  "wealthone_income",
  "wealthone_investments",
  "wealthone_loans",
  "wealthone_retirement",
  "wealthone_profile",
];

test("local date-only formatting preserves an Indian calendar selection", () => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = "Asia/Kolkata";
  try {
    const selected = new Date(2026, 9, 1);
    const stored = formatDateOnly(selected);
    assert.equal(stored, "2026-10-01");
    assert.equal(formatDateOnly(parseDateOnly(stored)), "2026-10-01");
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});

test("financial storage getters recover from malformed and wrong-shaped JSON", () => {
  const getters = [
    ["ezyretire_expenses", () => storage.getExpenses(), []],
    ["ezyretire_budgets", () => storage.getBudgets(), []],
    ["ezyretire_income", () => storage.getIncomeSources(), []],
    ["ezyretire_investments", () => storage.getInvestments(), []],
    ["ezyretire_loans", () => storage.getLoans(), []],
  ] as const;

  getters.forEach(([key, get, expected]) => {
    local.setItem(key, "{broken");
    assert.doesNotThrow(get);
    assert.deepEqual(get(), expected);
    local.setItem(key, JSON.stringify({ not: "an array" }));
    assert.doesNotThrow(get);
    assert.deepEqual(get(), expected);
  });

  local.setItem("ezyretire_retirement", "{broken");
  local.setItem("ezyretire_profile", "[]");
  assert.doesNotThrow(() => storage.getRetirementInputs());
  assert.doesNotThrow(() => storage.getProfileInputs());
  assert.equal(typeof storage.getRetirementInputs().dateOfBirth, "string");
  assert.equal(typeof storage.getProfileInputs().dateOfBirth, "string");
});

test("legacy WealthOne browser data migrates non-destructively to ezyRetire keys", () => {
  keys.forEach((key) => local.removeItem(key));
  const legacyExpenses = [{
    id: "legacy-expense",
    date: "2026-09-01T00:00:00.000Z",
    amount: 500,
    category: "Living",
    merchant: "Grocer",
    paymentMethod: "UPI",
    reimbursable: false,
    recurring: false,
    createdAt: "2026-09-01T00:00:00.000Z",
  }];
  const legacyProfile = {
    fullName: "Returning user",
    dateOfBirth: "1990-05-06",
    targetRetirementAge: 60,
    lifeExpectancy: 85,
    riskPreference: "Balanced",
    onboardingCompleted: true,
  };
  local.setItem("wealthone_expenses", JSON.stringify(legacyExpenses));
  local.setItem("wealthone_profile", JSON.stringify(legacyProfile));

  assert.deepEqual(storage.getExpenses(), legacyExpenses);
  assert.equal(storage.getProfileInputs().fullName, "Returning user");
  assert.equal(local.getItem("ezyretire_expenses"), JSON.stringify(legacyExpenses));
  assert.equal(local.getItem("ezyretire_profile"), JSON.stringify(legacyProfile));
  assert.equal(local.getItem("wealthone_expenses"), JSON.stringify(legacyExpenses));
  assert.equal(local.getItem("wealthone_profile"), JSON.stringify(legacyProfile));

  local.setItem("ezyretire_expenses", JSON.stringify([]));
  assert.deepEqual(storage.getExpenses(), []);
});

test("legacy monthly budgets migrate deterministically to lifelong windows", () => {
  const migrated = normalizeBudgets([{ category: "Living", monthlyLimit: 25_000 }]);
  assert.deepEqual(migrated, [{
    category: "Living",
    monthlyLimit: 25_000,
    windows: [{ id: "legacy", monthlyLimit: 25_000, cadence: "monthly", endMode: "lifelong" }],
  }]);
  assert.deepEqual(normalizeBudgets(migrated), migrated);
});

test("budget window boundaries are inclusive and overlaps add", () => {
  const budgets = normalizeBudgets([{
    category: "Living",
    monthlyLimit: 0,
    windows: [
      { id: "base", monthlyLimit: 10_000, startDate: "2026-01-31", endMode: "custom", endDate: "2026-03-01" },
      { id: "extra", monthlyLimit: 2_500, startDate: "2026-03-31", endMode: "lifelong" },
    ],
  }]);
  assert.equal(budgetTotalForMonth(budgets, new Date(2025, 11, 1)), 0);
  assert.equal(budgetTotalForMonth(budgets, new Date(2026, 0, 1)), 10_000);
  assert.equal(budgetTotalForMonth(budgets, new Date(2026, 2, 15)), 12_500);
  assert.equal(budgetTotalForMonth(budgets, new Date(2026, 3, 1)), 2_500);
});

test("budget inflation is independently anchored to each window start", () => {
  const budgets = normalizeBudgets([{
    category: "Living",
    monthlyLimit: 0,
    windows: [
      { id: "old", monthlyLimit: 10_000, startDate: "2025-04-01", endMode: "lifelong" },
      { id: "new", monthlyLimit: 5_000, startDate: "2026-10-01", endMode: "lifelong" },
    ],
  }]);
  assert.equal(budgetTotalForMonth(budgets, new Date(2026, 3, 1), 10), 11_000);
  assert.equal(budgetTotalForMonth(budgets, new Date(2026, 9, 1), 10), 16_000);
  assert.equal(budgetTotalForMonth(budgets, new Date(2027, 9, 1), 10), 17_600);
});

test("yearly budgets apply once in their due month and preserve inclusive boundaries", () => {
  const budgets = normalizeBudgets([{
    category: "Insurance",
    monthlyLimit: 0,
    windows: [{
      id: "premium",
      monthlyLimit: 120_000,
      cadence: "yearly",
      annualMonth: 2,
      startDate: "2026-04-01",
      endMode: "custom",
      endDate: "2029-03-01",
    }],
  }]);
  assert.equal(budgetTotalForMonth(budgets, new Date(2026, 2, 1)), 0);
  assert.equal(budgetTotalForMonth(budgets, new Date(2027, 1, 1)), 0);
  assert.equal(budgetTotalForMonth(budgets, new Date(2027, 2, 1)), 120_000);
  assert.equal(budgetTotalForMonth(budgets, new Date(2029, 2, 1)), 120_000);
  assert.equal(budgetTotalForMonth(budgets, new Date(2030, 2, 1)), 0);
});

test("yearly budgets inflate on schedule anniversaries and find their next occurrence", () => {
  const [budget] = normalizeBudgets([{
    category: "Insurance",
    monthlyLimit: 0,
    windows: [{
      id: "premium",
      monthlyLimit: 100_000,
      cadence: "yearly",
      annualMonth: 0,
      startDate: "2026-07-01",
      endMode: "lifelong",
    }],
  }]);
  const window = budget.windows![0];
  assert.equal(budgetTotalForMonth([budget], new Date(2027, 0, 1), 10), 100_000);
  assert.ok(Math.abs(budgetTotalForMonth([budget], new Date(2028, 0, 1), 10) - 110_000) < 0.01);
  assert.deepEqual(nextYearlyBudgetOccurrence(window, new Date(2027, 1, 1)), new Date(2028, 0, 1));
});

test("incomplete yearly schedules are rejected instead of becoming monthly", () => {
  const yearly = {
    category: "Insurance",
    monthlyLimit: 0,
    windows: [{
      id: "premium",
      monthlyLimit: 50_000,
      cadence: "yearly" as const,
      endMode: "lifelong" as const,
    }],
  };
  assert.match(validateBudgetSchedule([yearly])[0], /needs the month/);
  const normalized = normalizeBudgets([yearly]);
  assert.equal(normalized[0].windows?.[0].cadence, "yearly");
  assert.equal(budgetTotalForMonth(normalized, new Date(2027, 0, 1)), 0);
});

test("retirement-ended budget windows preserve notes and stop before retirement month", () => {
  const budgets = normalizeBudgets([{
    category: "Housing",
    monthlyLimit: 20_000,
    windows: [{
      id: "rent",
      monthlyLimit: 20_000,
      startDate: "2026-01-01",
      endMode: "retirement",
      note: "Rent before moving to the retirement home",
    }],
  }]);
  assert.equal(budgets[0].windows?.[0].endMode, "retirement");
  assert.equal(budgets[0].windows?.[0].note, "Rent before moving to the retirement home");
  const retirementDate = new Date(2040, 4, 1);
  assert.equal(budgetTotalForMonth(budgets, new Date(2040, 3, 1), 0, new Date(2026, 0, 1), retirementDate), 20_000);
  assert.equal(budgetTotalForMonth(budgets, new Date(2040, 4, 1), 0, new Date(2026, 0, 1), retirementDate), 0);
});

test("invalid ranges are excluded and a real future plan prevents actuals fallback", () => {
  const budgets = normalizeBudgets([{
    category: "Living",
    monthlyLimit: 0,
    windows: [
      { id: "bad-date", monthlyLimit: 99_000, startDate: "2026-02-30", endMode: "lifelong" },
      { id: "backwards", monthlyLimit: 99_000, startDate: "2027-01-01", endMode: "custom", endDate: "2026-12-01" },
      { id: "future", monthlyLimit: 20_000, startDate: "2028-01-01", endMode: "lifelong" },
    ],
  }]);
  assert.equal(budgets[0].windows?.length, 1);
  assert.equal(hasEffectiveBudgetPlan(budgets), true);
  assert.equal(budgetTotalForMonth(budgets, new Date(2027, 0, 1)), 0);
});

test("valid legacy retirement profile migration is preserved", () => {
  keys.forEach((key) => local.removeItem(key));
  local.setItem("wealthone_retirement", JSON.stringify({
    dateOfBirth: "1985-04-12",
    targetRetirementAge: 58,
    lifeExpectancy: 91,
    generalInflation: 5,
  }));

  const profile = storage.getProfileInputs();
  assert.equal(profile.dateOfBirth, "1985-04-12");
  assert.equal(profile.targetRetirementAge, 58);
  assert.equal(profile.lifeExpectancy, 91);
});

test("legacy investments receive a start-now, retirement-end contribution schedule", () => {
  const normalized = normalizeInvestmentContributionSchedule({
    id: "investment",
    name: "Index fund",
    assetClass: "Mutual Funds",
    investedAmount: 100,
    currentValue: 100,
    expectedReturn: 10,
    createdAt: "2026-01-01T00:00:00.000Z",
  }, new Date(2026, 4, 10));

  assert.equal(normalized.contributionStartDate, "2026-05-10");
  assert.equal(normalized.contributionEndMode, "retirement");
  assert.equal(normalized.contributionEndDate, undefined);
});

test("legacy and invalid income schedules safely default to retirement", () => {
  const source = {
    id: "income",
    name: "Salary",
    type: "Other" as const,
    frequency: "Monthly" as const,
    amount: 100,
    date: "2026-01-01",
    recurring: true,
    createdAt: "2026-01-01",
  };
  assert.deepEqual(normalizeIncomeSchedule(source).incomeEndMode, "retirement");
  assert.deepEqual(normalizeIncomeSchedule({
    ...source,
    incomeEndMode: "custom",
    incomeEndDate: "not-a-date",
  }).incomeEndMode, "retirement");
  const custom = normalizeIncomeSchedule({
    ...source,
    incomeEndMode: "custom",
    incomeEndDate: "2027-05-31T00:00:00.000Z",
  });
  assert.equal(custom.incomeEndMode, "custom");
  assert.equal(custom.incomeEndDate, "2027-05-31");
});

test("income recurrence is normalized from frequency and legacy annual one-offs are preserved", () => {
  const source = {
    id: "income",
    name: "Fund",
    type: "Bonus" as const,
    amount: 100,
    date: "2026-11-01",
    createdAt: "2026-01-01",
  };
  assert.deepEqual(
    normalizeIncomeSchedule({ ...source, frequency: "Monthly", recurring: false }).recurring,
    true,
  );
  assert.deepEqual(
    normalizeIncomeSchedule({ ...source, frequency: "Annual", recurring: true }).recurring,
    true,
  );
  const legacy = normalizeIncomeSchedule({
    ...source,
    frequency: "Annual",
    recurring: false,
    annualGrowthRate: 10,
    incomeEndMode: "custom",
    incomeEndDate: "2030-01-01",
  });
  assert.equal(legacy.frequency, "One-time");
  assert.equal(legacy.recurring, false);
  assert.equal(legacy.annualGrowthRate, undefined);
  assert.equal(legacy.incomeEndDate, undefined);
});

test("legacy annual salary migrates once to monthly payroll and preserves monthly net and PF", () => {
  const legacy = {
    id: "legacy-salary",
    name: "Salary",
    type: "Salary" as const,
    frequency: "Annual" as const,
    amount: 120_000,
    date: "2020-04-01",
    recurring: true,
    incomeEndMode: "custom" as const,
    incomeEndDate: "2030-04-01",
    salaryDetails: {
      grossCTC: 1_200_000,
      basicPay: 720_000,
      hra: 240_000,
      allowances: 240_000,
      employeePF: 72_000,
      professionalTax: 2_400,
      tds: 120_000,
      otherDeductions: 0,
    },
    createdAt: "2020-01-01",
  };
  const migrated = normalizeIncomeSchedule(legacy);
  const repeat = normalizeIncomeSchedule(migrated);

  assert.equal(migrated.frequency, "Monthly");
  assert.equal(migrated.recurring, true);
  assert.equal(migrated.amount, 10_000);
  assert.equal(migrated.salaryDetails?.grossCTC, 1_200_000);
  assert.equal(migrated.salaryDetails?.basicPay, 60_000);
  assert.equal(migrated.salaryDetails?.employeePF, 6_000);
  assert.equal(migrated.salaryDetails?.grossCTCMode, "manual");
  assert.equal(migrated.salaryDetails?.tdsMode, "manual");
  assert.equal(migrated.incomeEndMode, "custom");
  assert.equal(migrated.incomeEndDate, "2030-04-01");
  assert.equal(calculateIncomeMetrics(migrated).monthlyNet, 83_800);
  assert.deepEqual(repeat, migrated);
});

test("salary tax and input intent metadata survives normalization without changing cash flow", () => {
  const source: IncomeSource = {
    id: "salary-tax-metadata",
    name: "Salary",
    type: "Salary",
    frequency: "Monthly",
    amount: 100_000,
    date: "2025-04-01",
    recurring: true,
    salaryDetails: {
      grossCTC: 1_500_000,
      grossCTCMode: "automatic",
      basicPay: 60_000,
      hra: 25_000,
      allowances: 20_000,
      employeePF: 7_200,
      professionalTax: 200,
      tds: 12_345,
      tdsMode: "automatic",
      taxRegime: "new",
      financialYear: "2025-26",
      taxRuleVersion: "india-fy2025-26-v1",
      otherDeductions: 500,
    },
    createdAt: "2025-04-01T00:00:00.000Z",
  };

  const normalized = normalizeIncomeSchedule(source);
  assert.deepEqual(normalized.salaryDetails, source.salaryDetails);
  assert.equal(calculateIncomeMetrics(normalized).monthlyNet, calculateIncomeMetrics(source).monthlyNet);
  assert.deepEqual(normalizeIncomeSchedule(normalized), normalized);
});

test("future loans are retained but not active in current EMI calculations", () => {
  const loan: Loan = {
    id: "future-loan",
    type: "Home",
    name: "Planned home loan",
    sanctionedPrincipal: 1_000_000,
    outstandingPrincipal: 1_000_000,
    annualInterestRate: 8,
    interestType: "Floating",
    totalTenureMonths: 240,
    startDate: "2026-06-01",
    emi: 10_000,
    prepayments: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const asOf = new Date(2026, 4, 10);

  assert.equal(isLoanStarted(loan, asOf), false);
  assert.equal(isCurrentLoan(loan, asOf), false);
  assert.equal(isCurrentLoan(loan, new Date(2026, 5, 1)), true);
});