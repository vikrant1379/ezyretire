import assert from "node:assert/strict";
import test from "node:test";
import { calendarViews, dateInTimeZone, generateFinancialCalendar } from "./financial-calendar.ts";
import {
  allocateGoalSurplus,
  canSaveGoalAllocation,
  goalStatus,
  inflatedGoalTarget,
  requiredGoalContribution,
} from "./goals.ts";
import { generateMonthlyReport } from "./monthly-report.ts";
import { decideNotifications } from "./notifications.ts";
import { calculateActualMonthlyAverage } from "./retirement-projection.ts";
import {
  defaultNotificationPreferences,
  normalizeGoals,
  normalizeMonthlyReports,
  normalizeNotificationItems,
  normalizeNotificationPreferences,
  normalizeReminders,
  formatDateOnly,
  type FinancialGoal,
  type IncomeSource,
  type NotificationPreferences,
} from "./storage.ts";

const goal = (overrides: Partial<FinancialGoal> = {}): FinancialGoal => ({
  id: "home",
  name: "Home",
  targetAmount: 120_000,
  currentAmount: 12_000,
  targetDate: "2025-12-01",
  priority: 1,
  annualInflationRate: 12,
  monthlyAllocation: 10_000,
  createdAt: "2024-12-01T00:00:00.000Z",
  ...overrides,
});

test("goal inflation, contribution, status, and priority allocation are deterministic", () => {
  const asOf = new Date(2024, 11, 15);
  assert.equal(inflatedGoalTarget(goal(), asOf), 134_400);
  assert.equal(requiredGoalContribution(goal(), asOf), 10_200);
  assert.equal(goalStatus(goal(), asOf), "behind");
  assert.equal(goalStatus(goal({ monthlyAllocation: 10_200 }), asOf), "on-track");
  assert.equal(goalStatus(goal({ currentAmount: 134_400 }), asOf), "completed");
  assert.equal(goalStatus(goal({ targetDate: "2024-11-01" }), asOf), "overdue");

  const result = allocateGoalSurplus([
    goal({ id: "later", priority: 2, monthlyAllocation: 7_000 }),
    goal({ id: "first", priority: 1, monthlyAllocation: 8_000 }),
  ], 10_000);
  assert.deepEqual(result.allocations.map((item) => [item.goalId, item.allocated]), [
    ["first", 8_000], ["later", 2_000],
  ]);
  assert.equal(result.committed, 10_000);
  assert.equal(result.overAllocated, true);
});

test("over-allocated goals can be repaired incrementally without allowing commitment growth", () => {
  assert.equal(canSaveGoalAllocation({
    otherCommitted: 20_000,
    previousAllocation: 10_000,
    nextAllocation: 0,
    availableSurplus: 5_000,
  }), true);
  assert.equal(canSaveGoalAllocation({
    otherCommitted: 20_000,
    previousAllocation: 10_000,
    nextAllocation: 10_000,
    availableSurplus: 5_000,
  }), true);
  assert.equal(canSaveGoalAllocation({
    otherCommitted: 20_000,
    previousAllocation: 10_000,
    nextAllocation: 10_001,
    availableSurplus: 5_000,
  }), false);
});

test("normalizers reject malformed domain data and are idempotent", () => {
  const goals = normalizeGoals([
    { name: "  Home ", targetAmount: "100", targetDate: "2027-02-28" },
    { name: "Bad", targetAmount: -1, targetDate: "not-a-date" },
  ]);
  assert.equal(goals.length, 1);
  assert.equal(goals[0].name, "Home");
  assert.deepEqual(normalizeGoals(goals), goals);
  const reminders = normalizeReminders([
    { title: " Rent ", date: "2025-01-31", recurrence: "monthly" },
    { title: "", date: "2025-01-01" },
  ]);
  assert.equal(reminders.length, 1);
  assert.deepEqual(normalizeReminders(reminders), reminders);
});

test("calendar clamps month-end recurrence and unifies sources without duplicate ids", () => {
  const income = {
    id: "salary", name: "Salary", type: "Salary", frequency: "Monthly", amount: 1_000,
    date: "2025-01-31", recurring: true, createdAt: "2025-01-01T00:00:00Z",
  } as IncomeSource;
  const events = generateFinancialCalendar({
    from: "2025-01-01",
    through: "2025-03-31",
    incomes: [income, income],
    plannedExpenses: [{
      id: "trip", name: "Trip", category: "Travel", amount: 500,
      expectedDate: "2025-02-15", createdAt: "2025-01-01T00:00:00Z",
    }],
    reminders: [{
      id: "rent", title: "Rent", date: "2025-01-31", recurrence: "monthly",
      enabled: true, createdAt: "2025-01-01T00:00:00Z",
    }],
  });
  assert.deepEqual(
    events.filter((event) => event.kind === "income").map((event) => event.date),
    ["2025-01-31", "2025-02-28", "2025-03-31"],
  );
  assert.equal(new Set(events.map((event) => event.id)).size, events.length);
  assert.equal(events.filter((event) => event.kind === "planned-expense").length, 1);
});

test("calendar honors annual budget due month and never treats generated history as unpaid", () => {
  const events = generateFinancialCalendar({
    from: "2025-01-01",
    through: "2025-06-30",
    budgets: [{
      category: "Insurance",
      monthlyLimit: 12_000,
      windows: [{
        id: "annual-cover",
        monthlyLimit: 12_000,
        startDate: "2025-01-01",
        cadence: "yearly",
        annualMonth: 5,
        endMode: "lifelong",
      }],
    }],
  });
  assert.deepEqual(events.filter((event) => event.kind === "budget").map((event) => event.date), ["2025-06-01"]);
  assert.deepEqual(
    calendarViews([
      ...events,
      { id: "tax-old", sourceId: "tax-old", kind: "tax", title: "Tax", date: "2025-03-15" },
    ], new Date("2025-07-01T12:00:00Z"), "UTC").overdue,
    [],
  );
});

test("calendar stops retirement schedules and models bullet principal at maturity", () => {
  const events = generateFinancialCalendar({
    from: "2025-01-01",
    through: "2025-05-31",
    asOf: new Date(2025, 0, 1, 12),
    retirementDate: "2025-03-01",
    incomes: [{
      id: "salary", name: "Salary", type: "Salary", frequency: "Monthly", amount: 1_000,
      date: "2025-01-01", recurring: true, incomeEndMode: "retirement",
      createdAt: "2025-01-01",
    }],
    investments: [{
      id: "sip", name: "SIP", assetClass: "Mutual Funds", investedAmount: 0,
      currentValue: 0, monthlyContribution: 100, contributionStartDate: "2025-01-01",
      contributionEndMode: "retirement", expectedReturn: 8, createdAt: "2025-01-01",
    }],
    loans: [{
      id: "bullet", type: "Other", name: "Bullet", sanctionedPrincipal: 12_000,
      outstandingPrincipal: 12_000, annualInterestRate: 12, interestType: "Fixed",
      totalTenureMonths: 3, startDate: "2025-01-01", emi: 0, repaymentType: "bullet",
      prepayments: 0, createdAt: "2025-01-01",
    }],
  });
  assert.deepEqual(events.filter((event) => event.kind === "income").map((event) => event.date), [
    "2025-01-01", "2025-02-01", "2025-03-01",
  ]);
  assert.deepEqual(events.filter((event) => event.kind === "investment").map((event) => event.date), [
    "2025-01-01", "2025-02-01", "2025-03-01",
  ]);
  const loans = events.filter((event) => event.kind === "loan");
  assert.equal(loans.length, 1);
  assert.equal(loans[0].date, "2025-03-01");
  assert.equal(loans[0].amount, 12_360);
});

test("calendar omits paid loans and extends EMI dates from current payoff state", () => {
  const events = generateFinancialCalendar({
    from: "2025-01-28",
    through: "2025-03-31",
    asOf: new Date(2025, 0, 28, 12),
    loans: [
      {
        id: "paid", name: "Paid", type: "Other", sanctionedPrincipal: 12_000,
        outstandingPrincipal: 0, annualInterestRate: 0, interestType: "Fixed",
        totalTenureMonths: 12, startDate: "2020-01-01", emi: 1_000,
        repaymentType: "emi", prepayments: 0, createdAt: "2020-01-01",
      },
      {
        id: "extended", name: "Extended", type: "Other", sanctionedPrincipal: 12_000,
        outstandingPrincipal: 12_000, annualInterestRate: 0, interestType: "Fixed",
        totalTenureMonths: 12, startDate: "2020-01-01", emi: 1_000,
        repaymentType: "emi", prepayments: 0, createdAt: "2020-01-01",
      },
    ],
  });
  assert.deepEqual(events.filter((event) => event.sourceId === "paid"), []);
  assert.deepEqual(events.filter((event) => event.sourceId === "extended").map((event) => event.date), [
    "2025-02-01", "2025-03-01",
  ]);
});

test("calendar salary events use take-home components when the placeholder amount is zero", () => {
  const [event] = generateFinancialCalendar({
    from: "2025-03-01",
    through: "2025-03-31",
    incomes: [{
      id: "salary", name: "Salary", type: "Salary", frequency: "Monthly",
      recurring: true, amount: 0, date: "2025-03-01", createdAt: "2025-03-01",
      salaryDetails: {
        grossCTC: 1_200_000, basicPay: 100_000, hra: 0, allowances: 0,
        employeePF: 20_000, professionalTax: 0, tds: 0, otherDeductions: 0,
      },
    }],
  });
  assert.equal(event.kind, "income");
  assert.equal(event.amount, 80_000);
});

test("goal affordability averages recurring expense history by observed month", () => {
  const asOf = new Date(2025, 8, 8, 12);
  const expenses = Array.from({ length: 6 }, (_, index) => ({
    id: `rent-${index}`,
    amount: 20_000,
    category: "Housing",
    merchant: "Landlord",
    paymentMethod: "Transfer",
    recurring: true,
    date: formatDateOnly(new Date(2025, 2 + index, 10)),
    createdAt: "2025-03-10T00:00:00.000Z",
  }));
  const baseline = calculateActualMonthlyAverage(expenses, asOf);
  assert.equal(baseline.average, 20_000);
  assert.equal(100_000 - baseline.average, 80_000);
});

test("timezone day boundaries drive today, upcoming, overdue and month views", () => {
  const instant = new Date("2025-01-01T00:30:00.000Z");
  assert.equal(dateInTimeZone(instant, "Pacific/Honolulu"), "2024-12-31");
  assert.equal(dateInTimeZone(instant, "Asia/Kolkata"), "2025-01-01");
  const events = ["2024-12-30", "2024-12-31", "2025-01-01"].map((date) => ({
    id: date, sourceId: date, kind: "reminder" as const, title: date, date,
  }));
  const views = calendarViews(events, instant, "Pacific/Honolulu", 2);
  assert.deepEqual(views.overdue.map((event) => event.date), ["2024-12-30"]);
  assert.deepEqual(views.today.map((event) => event.date), ["2024-12-31"]);
  assert.deepEqual(views.upcoming.map((event) => event.date), ["2025-01-01"]);
  assert.equal(views.month.length, 2);
});

test("notification policy emits seven useful rules once and honors disabled types", () => {
  const preferences = {
    ...defaultNotificationPreferences(),
    timeZone: "UTC",
    push: true,
    quietHours: { start: "22:00", end: "07:00" },
  };
  const now = new Date("2025-04-01T12:00:00.000Z");
  const facts = {
    month: "2025-04", spent: 110, budget: 100,
    goals: [goal({ monthlyAllocation: 0, targetDate: "2025-12-01" })],
    events: [{ id: "tax-event", sourceId: "tax", kind: "reminder" as const, title: "Payment", date: "2025-04-02" }],
    portfolioMilestonePercent: 51,
    retirementContribution: 1,
    retirementContributionNeeded: 2,
    taxDueDate: "2025-04-10",
    anomalousExpense: { id: "expense-1", amount: 999 },
  };
  const first = decideNotifications(facts, preferences, [], now);
  assert.deepEqual(new Set(first.map((item) => item.type)), new Set([
    "budget", "goal", "upcoming", "milestone", "retirement", "tax", "anomaly",
  ]));
  assert.ok(first.every((item) => item.channels.join(",") === "in-app,push"));
  assert.equal(decideNotifications(facts, preferences, first, now).length, 0);
  const duplicatedEvent = { ...facts, events: [facts.events[0], facts.events[0]] };
  assert.equal(decideNotifications(duplicatedEvent, preferences, [], now)
    .filter((item) => item.type === "upcoming").length, 1);
  const disabled = {
    ...preferences, types: { ...preferences.types, budget: false },
  } as NotificationPreferences;
  assert.equal(decideNotifications(facts, disabled, [], now).some((item) => item.type === "budget"), false);
});

test("quiet hours spanning midnight defer delivery to local quiet-hour end", () => {
  const preferences = {
    ...defaultNotificationPreferences(), timeZone: "UTC",
    quietHours: { start: "22:00", end: "07:00" },
  };
  const facts = { month: "2025-04", spent: 2, budget: 1, goals: [], events: [] };
  const late = decideNotifications(facts, preferences, [], new Date("2025-04-01T23:30:00Z"))[0];
  assert.equal(late.deliverAfter, "2025-04-02T07:00:00.000Z");
  const early = decideNotifications(facts, preferences, [], new Date("2025-04-02T06:59:00Z"))[0];
  assert.equal(early.deliverAfter, "2025-04-02T07:00:00.000Z");
  const daytime = decideNotifications(facts, preferences, [], new Date("2025-04-02T07:00:00Z"))[0];
  assert.equal(daytime.deliverAfter, "2025-04-02T07:00:00.000Z");
});

test("quiet-hour delivery follows wall time across both daylight-saving boundaries", () => {
  const preferences = {
    ...defaultNotificationPreferences(), timeZone: "America/New_York",
    quietHours: { start: "22:00", end: "07:00" },
  };
  const facts = { month: "2025-03", spent: 2, budget: 1, goals: [], events: [] };
  const spring = decideNotifications(facts, preferences, [], new Date("2025-03-09T06:30:00Z"))[0];
  assert.equal(spring.deliverAfter, "2025-03-09T11:00:00.000Z");
  const fall = decideNotifications(
    { ...facts, month: "2025-11" },
    preferences,
    [],
    new Date("2025-11-02T05:30:00Z"),
  )[0];
  assert.equal(fall.deliverAfter, "2025-11-02T12:00:00.000Z");
});

test("notification normalization deduplicates decisions and repairs timezone preferences", () => {
  const preferences = normalizeNotificationPreferences({ timeZone: "Not/AZone", digestDay: 99 });
  assert.equal(preferences.timeZone, "UTC");
  assert.equal(preferences.digestDay, 6);
  const item = {
    id: "one", dedupeKey: "budget:2025-01", type: "budget", title: "Budget", message: "Over",
    createdAt: "2025-01-01T00:00:00Z", deliverAfter: "2025-01-01T00:00:00Z", channels: ["in-app"],
  };
  assert.equal(normalizeNotificationItems([item, { ...item, id: "two" }]).length, 1);
});

test("monthly report is reproducible and has exactly the eight required sections", () => {
  const facts = {
    month: "2025-03", actualIncome: 100, expectedIncome: 90, actualExpenses: 80,
    expenseBudget: 90, expenseCategoryCount: 4, savingsAmount: 20, savingsRatePercent: 20,
    portfolioValue: 300, portfolioReturnChange: 10, portfolioReturnPercent: 3.4,
    netWorth: 300, netWorthChange: 15, retirementDateMovementMonths: -2,
    healthScore: 72, healthScoreChange: 5,
    nextMonthActions: ["Fund emergency reserve.", "Pay loan early.", "Review subscriptions.", "Ignored fourth."],
  };
  const first = generateMonthlyReport(facts, "2025-04-01T00:00:00.000Z");
  const second = generateMonthlyReport(facts, "2025-04-01T00:00:00.000Z");
  assert.deepEqual(first, second);
  assert.equal(first.sections.length, 8);
  assert.equal(new Set(first.sections.map((section) => section.id)).size, 8);
  assert.deepEqual(first.sections.map((section) => section.id), [
    "income-vs-expected", "expenses-vs-budget-category", "savings-amount-rate",
    "portfolio-value-returns-change", "net-worth-change", "retirement-date-movement",
    "health-score-change", "top-next-month-actions",
  ]);
  assert.equal(first.sections.find((section) => section.id === "savings-amount-rate")?.metricFormats.rate, "percent");
  assert.equal(first.sections.find((section) => section.id === "expenses-vs-budget-category")?.metricFormats.categoryCount, "count");
  assert.equal(first.sections.find((section) => section.id === "top-next-month-actions")?.actions.length, 3);
  assert.deepEqual(normalizeMonthlyReports([first, first]), [first]);
  assert.throws(() => generateMonthlyReport({ ...facts, month: "March" }, first.generatedAt));
});