import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyMonthlyReportDeliveryFailure,
  evaluatePlanning,
  evaluatePlanningForAccount,
  claimPlanningPage,
  quietUntil,
  processMonthlyReport,
  mergeMonthEndForecast,
  reportFor,
  rules,
  scheduledRetirementContributionFacts,
  selectPushableNotifications,
  shouldSendMonthlyReportEmail,
} from "./planning-jobs.js";
import { MonthlyReportAttachmentTooLargeError } from "./monthly-report-email.js";
import { loadFinancialData, updatePlanningFeatures } from "./finance-store.js";
import {
  accountDeletionRequestsTable,
  db,
  planningSchedulerStateTable,
  userProfilesTable,
  usersTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  accountHash,
  acquireAccountWriteFence,
} from "./account-compliance.js";

const monthlySectionIds = [
  "income-vs-expected", "expenses-vs-budget-category", "savings-amount-rate",
  "portfolio-value-returns-change", "net-worth-change", "retirement-date-movement",
  "health-score-change", "top-next-month-actions",
] as const;

test("scheduled quiet hours follow the configured wall-clock boundary", () => {
  const deferred = quietUntil(new Date("2025-03-09T06:30:00Z"), {
    timeZone: "America/New_York",
    quietHours: { start: "22:00", end: "07:00" },
  } as never);
  assert.equal(deferred.toISOString(), "2025-03-09T11:00:00.000Z");
});

test("scheduled planning claims only a bounded batch before its deadline", {
  timeout: 15_000,
}, async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const ids = Array.from({ length: 12 }, (_, index) => `planning-bound-${suffix}-${index}`);
  await db.insert(usersTable).values(ids.map((id) => ({
    id,
    email: `${id}@example.test`,
    updatedAt: new Date("2000-01-01T00:00:00.000Z"),
  })));
  let tick = 0;
  try {
    const result = await evaluatePlanning(undefined, {
      limit: 10,
      budgetMs: 1,
      now: () => tick++ === 0 ? 0 : 2,
    });
    assert.equal(result.claimed, 10);
    assert.equal(result.evaluated, 0);
    assert.equal(result.deadlineReached, true);
  } finally {
    for (const id of ids) await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

test("planning fairness cursor rotates deterministically without touching user updatedAt", {
  timeout: 15_000,
}, async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const ids = [
    `000-planning-cursor-${suffix}-a`,
    `000-planning-cursor-${suffix}-b`,
    `000-planning-cursor-${suffix}-c`,
  ];
  const unchanged = new Date("2001-02-03T04:05:06.000Z");
  await db.insert(usersTable).values(ids.map((id) => ({
    id, email: `${id}@example.test`, updatedAt: unchanged,
  })));
  await db.insert(planningSchedulerStateTable).values({
    id: "global", cursorUserId: `000-planning-cursor-${suffix}-0`,
  }).onConflictDoUpdate({
    target: planningSchedulerStateTable.id,
    set: { cursorUserId: `000-planning-cursor-${suffix}-0` },
  });
  try {
    const first = await claimPlanningPage(2);
    assert.deepEqual(first.map((user) => user.id), ids.slice(0, 2));
    const second = await claimPlanningPage(2);
    assert.equal(second[0]?.id, ids[2]);
    const rows = await db.select().from(usersTable)
      .where(sql`${usersTable.id} in (${ids[0]}, ${ids[1]}, ${ids[2]})`);
    assert.ok(rows.every((row) => row.updatedAt.getTime() === unchanged.getTime()));
  } finally {
    await db.delete(usersTable).where(sql`${usersTable.id} in (${ids[0]}, ${ids[1]}, ${ids[2]})`);
  }
});

test("scheduled evaluation produces all seven controllable rule types", () => {
  const data = {
    budgets: [{ category: "Living", monthlyLimit: 100, windows: [{ id: "living", startDate: "2025-01-01", monthlyLimit: 100, cadence: "monthly", endMode: "lifelong" }] }],
    expenses: [
      { id: "large", date: "2025-03-02", amount: 20_000 },
      { id: "small-1", date: "2025-03-01", amount: 100 },
      { id: "small-2", date: "2025-03-01", amount: 100 },
    ],
    investments: [{ currentValue: 1_000, investedAmount: 1_000, monthlyContribution: 0 }],
    profileInputs: { dateOfBirth: "1990-03-05" },
    retirementInputs: {
      targetRetirementAge: 60,
      lifeExpectancy: 85,
      generalInflation: 6,
      monthlyContributionOverride: 100,
    },
    goals: [{
      id: "goal", name: "Home", targetDate: "2025-03-15", currentAmount: 0, targetAmount: 100, monthlyAllocation: 0,
    }],
    reminders: [{ id: "reminder", title: "Bill", date: "2025-01-08", recurrence: "monthly", enabled: true }],
    incomeSources: [],
    loans: [],
    plannedExpenses: [],
  };
  const evaluated = rules(data as never, "2025-03-05", new Date("2025-03-05T12:00:00Z"));
  assert.deepEqual(new Set(evaluated.map((item) => item.type)), new Set([
    "budget", "retirement", "goal", "upcoming", "milestone", "tax", "anomaly",
  ]));
  assert.ok(evaluated.some((item) => item.key === "upcoming:reminder:reminder:2025-03-08"));
});

test("scheduled retirement alerts use the modeled extra SIP gap when override is zero", () => {
  const data = {
    profileInputs: { dateOfBirth: "1990-09-02" },
    retirementInputs: {
      targetRetirementAge: 60,
      lifeExpectancy: 85,
      generalInflation: 6,
      monthlyContributionOverride: 0,
    },
    budgets: [{ category: "Living", monthlyLimit: 50_000 }],
    investments: [{
      currentValue: 500_000,
      investedAmount: 500_000,
      monthlyContribution: 1_000,
      expectedReturn: 10,
    }],
    expenses: [], goals: [], reminders: [], loans: [], plannedExpenses: [], incomeSources: [],
  };
  const facts = scheduledRetirementContributionFacts(data as never, "2026-09-02");
  assert.equal(facts?.retirementContribution, 1_000);
  assert.ok((facts?.extraSipRequired ?? 0) > 0);
  assert.ok(rules(data as never, "2026-09-02", new Date("2026-09-02T12:00:00Z"))
    .some((item) => item.key === "retirement:2026-09"));
  const funded = {
    ...data,
    investments: [{ ...data.investments[0], currentValue: 100_000_000 }],
  };
  assert.equal(rules(funded as never, "2026-09-02", new Date("2026-09-02T12:00:00Z"))
    .some((item) => item.key === "retirement:2026-09"), false);
});

test("scheduled retirement facts honor future budgets, SIP endings, planned costs, and loans", () => {
  const base = {
    profileInputs: { dateOfBirth: "1990-09-02" },
    retirementInputs: {
      targetRetirementAge: 60,
      lifeExpectancy: 85,
      generalInflation: 6,
      monthlyContributionOverride: 0,
    },
    budgets: [{
      category: "Living",
      monthlyLimit: 0,
      windows: [{
        id: "retirement-budget",
        startDate: "2050-09-01",
        monthlyLimit: 50_000,
        cadence: "monthly",
        endMode: "lifelong",
      }],
    }],
    investments: [], expenses: [], goals: [], reminders: [], loans: [],
    plannedExpenses: [], incomeSources: [],
  };
  const futureBudget = scheduledRetirementContributionFacts(base as never, "2026-09-02");
  assert.ok(Math.abs((futureBudget?.extraSipRequired ?? 0) - 7_765.926881055364) < 0.01);
  assert.ok(rules(base as never, "2026-09-02", new Date("2026-09-02T12:00:00Z"))
    .some((item) => item.key === "retirement:2026-09"));

  const endingSip = scheduledRetirementContributionFacts({
    ...base,
    investments: [{
      id: "sip", currentValue: 0, investedAmount: 0,
      monthlyContribution: 10_000, expectedReturn: 10,
      contributionStartDate: "2020-01-01",
      contributionEndMode: "custom",
      contributionEndDate: "2030-09-01",
    }],
  } as never, "2026-09-02");
  const lifelongSip = scheduledRetirementContributionFacts({
    ...base,
    investments: [{
      id: "sip", currentValue: 0, investedAmount: 0,
      monthlyContribution: 10_000, expectedReturn: 10,
      contributionStartDate: "2020-01-01",
      contributionEndMode: "retirement",
    }],
  } as never, "2026-09-02");
  assert.ok((endingSip?.extraSipRequired ?? 0) > (lifelongSip?.extraSipRequired ?? 0));

  const plannedCost = scheduledRetirementContributionFacts({
    ...base,
    investments: [{
      id: "sip", currentValue: 0, investedAmount: 0,
      monthlyContribution: 10_000, expectedReturn: 10,
      contributionStartDate: "2020-01-01",
      contributionEndMode: "retirement",
    }],
    plannedExpenses: [{
      id: "education", name: "Education", amount: 1_000_000,
      category: "Education", expectedDate: "2045-09-01", customInflationRate: 0,
      createdAt: "2026-09-02",
    }],
  } as never, "2026-09-02");
  assert.ok((plannedCost?.extraSipRequired ?? 0) > (lifelongSip?.extraSipRequired ?? 0));

  const loanCost = scheduledRetirementContributionFacts({
    ...base,
    loans: [{
      id: "loan", name: "Retirement loan", type: "Home",
      sanctionedPrincipal: 6_000_000, outstandingPrincipal: 0,
      annualInterestRate: 0, totalTenureMonths: 60,
      startDate: "2049-09-01", emi: 100_000,
    }],
  } as never, "2026-09-02");
  assert.ok((loanCost?.extraSipRequired ?? 0) > (futureBudget?.extraSipRequired ?? 0));
});

test("scheduled goal status matches inflated client contribution math", () => {
  const evaluated = rules({
    goals: [{
      id: "home", name: "Home", targetAmount: 120_000, currentAmount: 12_000,
      targetDate: "2025-12-01", annualInflationRate: 12, monthlyAllocation: 10_000,
    }],
    budgets: [], expenses: [], investments: [], loans: [], reminders: [],
    plannedExpenses: [], incomeSources: [], retirementInputs: { monthlyContributionOverride: 0 },
  } as never, "2024-12-15", new Date("2024-12-15T12:00:00Z"));
  assert.ok(evaluated.some((item) => item.key === "goal:home"));
});

test("future annual budgets do not alert before their start date", () => {
  const evaluated = rules({
    goals: [], expenses: [], investments: [], loans: [], reminders: [],
    plannedExpenses: [], incomeSources: [], retirementInputs: { monthlyContributionOverride: 0 },
    budgets: [{
      category: "Annual",
      windows: [{
        id: "future", startDate: "2027-01-01", cadence: "yearly",
        annualMonth: 2, monthlyLimit: 9_000, endMode: "lifelong",
      }],
    }],
  } as never, "2025-03-01", new Date("2025-03-01T12:00:00Z"));
  assert.equal(evaluated.some((item) => item.key.includes("budget:future")), false);
});

test("scheduled events stop at retirement and bullet loans alert only at maturity", () => {
  const data = {
    profileInputs: { dateOfBirth: "2000-03-10", targetRetirementAge: 25 },
    retirementInputs: { targetRetirementAge: 25, monthlyContributionOverride: 0 },
    incomeSources: [{
      id: "income", name: "Income", date: "2025-01-01", recurring: true,
      frequency: "Monthly", incomeEndMode: "retirement",
    }],
    investments: [{
      id: "sip", name: "SIP", monthlyContribution: 100,
      contributionStartDate: "2025-01-01", contributionEndMode: "retirement",
    }],
    loans: [{
      id: "bullet", name: "Bullet", startDate: "2025-01-01",
      totalTenureMonths: 3, repaymentType: "bullet", sanctionedPrincipal: 12_000,
      outstandingPrincipal: 12_000, annualInterestRate: 12, emi: 0,
    }],
    budgets: [], expenses: [], goals: [], reminders: [], plannedExpenses: [],
  };
  const beforeRetirement = rules(data as never, "2025-02-26", new Date("2025-02-26T12:00:00Z"));
  assert.ok(beforeRetirement.some((item) => item.key === "upcoming:loan:bullet:2025-03-01"));
  const afterRetirement = rules(data as never, "2025-04-01", new Date("2025-04-01T12:00:00Z"));
  assert.equal(afterRetirement.some((item) => item.key.includes("income:income")), false);
  assert.equal(afterRetirement.some((item) => item.key.includes("investment:sip")), false);
});

test("scheduled loan alerts omit paid balances and retain payments beyond original tenure", () => {
  const evaluated = rules({
    profileInputs: {},
    retirementInputs: { monthlyContributionOverride: 0 },
    incomeSources: [], investments: [], budgets: [], expenses: [], goals: [],
    reminders: [], plannedExpenses: [],
    loans: [
      {
        id: "paid", name: "Paid", startDate: "2020-01-01", totalTenureMonths: 12,
        repaymentType: "emi", sanctionedPrincipal: 12_000, outstandingPrincipal: 0,
        annualInterestRate: 0, emi: 1_000,
      },
      {
        id: "extended", name: "Extended", startDate: "2020-01-01", totalTenureMonths: 12,
        repaymentType: "emi", sanctionedPrincipal: 12_000, outstandingPrincipal: 12_000,
        annualInterestRate: 0, emi: 1_000,
      },
    ],
  } as never, "2025-01-28", new Date("2025-01-28T12:00:00Z"));
  assert.ok(evaluated.some((item) => item.key === "upcoming:loan:extended:2025-02-01"));
  assert.equal(evaluated.some((item) => item.key.includes("loan:paid")), false);
});

test("automatic report is month-scoped, category-aware, historical, and has three actions", () => {
  const data = {
    expenses: [
      { date: "2025-03-03", amount: 150, category: "Living" },
      { date: "2025-02-03", amount: 999, category: "Living" },
    ],
    incomeSources: [
      { recurring: true, frequency: "Monthly", amount: 500, date: "2025-03-01", incomeEndMode: "custom", incomeEndDate: "2025-03-31" },
      { recurring: false, frequency: "One-time", amount: 10_000, date: "2025-03-15" },
    ],
    incomeReceipts: [
      { receivedDate: "2025-03-04", amount: 400 },
      { receivedDate: "2025-03-18", amount: 300 },
      { receivedDate: "2025-02-04", amount: 500 },
    ],
    budgets: [{
      category: "Living",
      monthlyLimit: 14_000,
      windows: [
        { id: "active", monthlyLimit: 100, startDate: "2025-01-01", cadence: "monthly", endMode: "lifelong" },
        { id: "future", monthlyLimit: 9_000, startDate: "2025-04-01", cadence: "monthly", endMode: "lifelong" },
      ],
    }],
    investments: [{ currentValue: 1_200, investedAmount: 1_000 }],
    netWorthSnapshots: [
      { month: "2025-02", netWorth: 800, healthScore: 60 },
      { month: "2025-03", netWorth: 1_000, healthScore: 70 },
    ],
    monthlyReports: [{
      id: "monthly-report-2025-02", month: "2025-02", generatedAt: "2025-03-01T00:00:00Z",
      sections: [
        { id: "portfolio-value-returns-change", metrics: { value: 1_100, invested: 1_000 }, metricFormats: {}, actions: [] },
        { id: "retirement-date-movement", metrics: { targetAgeMonths: 648 }, metricFormats: {}, actions: [] },
      ],
    }],
    profileInputs: { targetRetirementAge: 55 },
    retirementInputs: { targetRetirementAge: 55 },
  };
  const report = reportFor(data as never, "2025-03", {
    generatedAt: new Date("2025-04-01T00:05:00Z"),
    captureLivePortfolio: true,
    captureLiveRetirementTarget: true,
  });
  assert.equal(report.sections.length, 8);
  assert.equal(report.sections[0].metrics.actual, 700);
  assert.equal(report.sections[0].metrics.expected, 10_500);
  assert.equal(report.sections[0].metrics.variance, -9_800);
  assert.equal(report.sections[1].metrics.actual, 150);
  assert.equal(report.sections[1].metrics.categoriesOverBudget, 1);
  assert.equal((report.sections[3].metrics as Record<string, number>).returnChange, 100);
  assert.equal((report.sections[4].metrics as Record<string, number>).change, 200);
  assert.equal((report.sections[6].metrics as Record<string, number>).change, 10);
  assert.equal(report.sections[7].actions.length, 3);
  assert.equal(reportFor(data as never, "2025-02").sections[0].metrics.actual, 500);
});

test("month-end reports preserve a reproducible retirement forecast and explain its largest changes", () => {
  const priorForecast = {
    modelVersion: 1,
    projectedRetirementMonth: "2050-06",
    projectedRetirementAge: 60,
    asOfDate: "2025-02-28",
    assumptions: {
      targetRetirementAge: 55,
      lifeExpectancy: 85,
      generalInflation: 5,
      salaryGrowth: 8,
      monthlyContribution: 5_000,
      monthlySpending: 30_000,
      portfolioValue: 1_000_000,
      investedPrincipal: 1_000_000,
      portfolioReturnAmount: 0,
      expectedReturn: 10,
    },
    projectionInputs: {
      expenses: [],
      budgets: [{
        category: "Living",
        monthlyLimit: 40_000,
        windows: [{
          id: "living", monthlyLimit: 40_000, startDate: "2020-01-01",
          cadence: "monthly", endMode: "lifelong",
        }],
      }],
      incomes: [{
        id: "salary", type: "Salary", amount: 100_000, recurring: true,
        frequency: "Monthly", date: "2020-01-01", incomeEndMode: "retirement",
      }],
      investments: [{
        id: "fund", currentValue: 1_000_000, investedAmount: 1_000_000,
        monthlyContribution: 5_000, expectedReturn: 10,
        contributionStartDate: "2020-01-01", contributionEndMode: "retirement",
      }],
      loans: [],
      plannedExpenses: [],
      emergencyFund: { targetMonths: 6, reserveBalance: 300_000, monthlyContribution: 0 },
      assumptions: {
        dateOfBirth: "1990-06-15", targetRetirementAge: 55, lifeExpectancy: 85,
        generalInflation: 5, salaryGrowth: 8, monthlyContributionOverride: 5_000,
        investSurplus: false, pensionSources: [],
      },
    },
    drivers: [],
  };
  const data = {
    expenses: [],
    budgets: [{
      category: "Living",
      monthlyLimit: 40_000,
      windows: [{
        id: "living",
        monthlyLimit: 40_000,
        startDate: "2020-01-01",
        cadence: "monthly",
        endMode: "lifelong",
      }],
    }],
    incomeSources: [{
      id: "salary",
      type: "Salary",
      amount: 100_000,
      recurring: true,
      frequency: "Monthly",
      date: "2020-01-01",
      incomeEndMode: "retirement",
    }],
    investments: [{
      id: "fund",
      currentValue: 10_000_000,
      investedAmount: 8_000_000,
      monthlyContribution: 20_000,
      expectedReturn: 12,
      contributionStartDate: "2020-01-01",
      contributionEndMode: "retirement",
    }],
    loans: [],
    plannedExpenses: [],
    netWorthSnapshots: [],
    emergencyFund: { targetMonths: 6, reserveBalance: 300_000, monthlyContribution: 0 },
    profileInputs: { dateOfBirth: "1990-06-15", targetRetirementAge: 55 },
    retirementInputs: {
      dateOfBirth: "1990-06-15",
      targetRetirementAge: 55,
      lifeExpectancy: 85,
      generalInflation: 6,
      salaryGrowth: 8,
      monthlyContributionOverride: 20_000,
      investSurplus: false,
      pensionSources: [],
    },
    monthlyReports: [{
      id: "monthly-report-2025-02",
      month: "2025-02",
      generatedAt: "2025-03-01T00:00:00Z",
      retirementForecast: priorForecast,
      sections: [{
        id: "retirement-date-movement",
        metrics: { targetAgeMonths: 660 },
        metricFormats: { targetAgeMonths: "number" },
        actions: [],
      }],
    }],
  };

  const first = reportFor(data as never, "2025-03", {
    generatedAt: new Date("2025-04-01T00:05:00Z"),
    captureLivePortfolio: true,
    captureLiveRetirementTarget: true,
    captureLiveRetirementForecast: true,
  });
  const second = reportFor(data as never, "2025-03", {
    generatedAt: new Date("2025-04-01T00:05:00Z"),
    captureLivePortfolio: true,
    captureLiveRetirementTarget: true,
    captureLiveRetirementForecast: true,
  });

  assert.deepEqual(first, second);
  assert.equal(first.retirementForecast?.asOfDate, "2025-03-31");
  assert.ok((first.retirementForecast?.assumptions.monthlyContribution ?? 0) >= 40_000);
  assert.ok((first.retirementForecast?.assumptions.monthlySpending ?? 0) >= 40_000);
  assert.equal(first.retirementForecast?.modelVersion, 1);
  assert.ok(
    (first.retirementForecast?.projectedRetirementMonth ?? "9999-12") >= "2025-03",
    "an immediate retirement forecast cannot precede its snapshot month",
  );
  assert.deepEqual(first.retirementForecast?.projectionInputs?.investments, data.investments);
  assert.ok(first.retirementForecast?.drivers.some((driver) => driver.includes("Contributions and invested principal")));
  assert.ok(first.retirementForecast?.drivers.some((driver) => driver.includes("Portfolio returns")));
  const section = first.sections.find((item) => item.id === "retirement-date-movement");
  assert.deepEqual(section?.actions, first.retirementForecast?.drivers);
  assert.equal(typeof section?.metrics.movementMonths, "number");
});

test("salary expiry is attributed to income-linked retirement contributions", () => {
  const data = {
    expenses: [],
    budgets: [{
      category: "Living",
      monthlyLimit: 20_000,
      windows: [{
        id: "living",
        monthlyLimit: 20_000,
        startDate: "2020-01-01",
        cadence: "monthly",
        endMode: "lifelong",
      }],
    }],
    incomeSources: [{
      id: "salary",
      type: "Salary",
      amount: 100_000,
      recurring: true,
      frequency: "Monthly",
      date: "2020-01-01",
      incomeEndMode: "retirement",
      salaryDetails: {
        grossCTC: 120_000,
        basicPay: 100_000,
        hra: 0,
        allowances: 20_000,
        employeePF: 10_000,
        professionalTax: 0,
        tds: 10_000,
        otherDeductions: 0,
      },
    }] as Array<Record<string, unknown>>,
    investments: [{
      id: "linked-pf",
      currentValue: 1_000_000,
      investedAmount: 1_000_000,
      monthlyContribution: 10_000,
      expectedReturn: 10,
      linkedIncomeSourceId: "salary",
      autoManagedContribution: true,
      contributionStartDate: "2020-01-01",
      contributionEndMode: "retirement",
    }],
    loans: [],
    plannedExpenses: [],
    netWorthSnapshots: [],
    emergencyFund: { targetMonths: 6, reserveBalance: 300_000, monthlyContribution: 0 },
    profileInputs: { dateOfBirth: "1990-06-15", targetRetirementAge: 60 },
    retirementInputs: {
      dateOfBirth: "1990-06-15",
      targetRetirementAge: 60,
      lifeExpectancy: 85,
      generalInflation: 6,
      salaryGrowth: 8,
      monthlyContributionOverride: 0,
      investSurplus: false,
      pensionSources: [],
    },
    monthlyReports: [] as Array<Record<string, unknown>>,
  };
  const forecastOptions = {
    captureLivePortfolio: true,
    captureLiveRetirementTarget: true,
    captureLiveRetirementForecast: true,
  };
  const prior = reportFor(data as never, "2025-02", forecastOptions);
  data.monthlyReports = [prior];
  data.incomeSources[0] = {
    ...data.incomeSources[0],
    incomeEndMode: "custom",
    incomeEndDate: "2025-03-01",
  };

  const current = reportFor(data as never, "2025-03", forecastOptions);

  assert.notEqual(
    current.retirementForecast?.projectedRetirementMonth,
    prior.retirementForecast?.projectedRetirementMonth,
  );
  assert.ok(
    current.retirementForecast?.drivers.some((driver) =>
      driver.includes("Contributions and invested principal")),
  );
  assert.ok(
    !current.retirementForecast?.drivers.some((driver) =>
      driver.includes("No material modeled")),
  );
});

test("a server forecast narrowly enriches a pre-seeded report without rewriting its historical facts", () => {
  const legacy = {
    id: "monthly-report-2025-03",
    month: "2025-03",
    generatedAt: "2025-04-01T00:00:00.000Z",
    sections: monthlySectionIds.map((id) => ({
      id,
      title: id,
      metrics: { preserved: 1 },
      metricFormats: { preserved: "number" },
      actions: [],
    })),
  };
  const generated = {
    ...legacy,
    retirementForecast: {
      modelVersion: 1,
      projectedRetirementMonth: "2045-06",
      projectedRetirementAge: 55,
      asOfDate: "2025-03-31",
      assumptions: {
        targetRetirementAge: 55, lifeExpectancy: 85, generalInflation: 6,
        salaryGrowth: 8, monthlyContribution: 20_000, monthlySpending: 40_000,
        portfolioValue: 1_000_000, investedPrincipal: 900_000,
        portfolioReturnAmount: 100_000, expectedReturn: 12,
      },
      drivers: ["First forecast."],
    },
    sections: legacy.sections.map((section) => section.id === "retirement-date-movement"
      ? { ...section, metrics: { movementMonths: 2 }, actions: ["Explained."] }
      : { ...section, metrics: { rewritten: 999 } }),
  };

  const enriched = mergeMonthEndForecast(legacy as never, generated as never);
  assert.deepEqual(enriched?.retirementForecast, generated.retirementForecast);
  assert.deepEqual(
    enriched?.sections.find((section) => section.id === "income-vs-expected"),
    legacy.sections[0],
  );
  assert.deepEqual(
    enriched?.sections.find((section) => section.id === "retirement-date-movement"),
    generated.sections.find((section) => section.id === "retirement-date-movement"),
  );
});

test("catch-up reports leave unmeasured balances unavailable and returns account for contributions", () => {
  const noMeasurements = reportFor({
    expenses: [], incomeSources: [], budgets: [],
    investments: [{ currentValue: 500_000, investedAmount: 500_000 }],
    netWorthSnapshots: [],
    monthlyReports: [{
      id: "monthly-report-2025-02", month: "2025-02", generatedAt: "2025-03-01T00:00:00Z",
      sections: [{
        id: "retirement-date-movement",
        metrics: { targetAgeMonths: 600 }, metricFormats: {}, actions: [],
      }],
    }],
    profileInputs: { targetRetirementAge: 55 }, retirementInputs: { targetRetirementAge: 55 },
  } as never, "2025-03", {
    generatedAt: new Date("2025-04-08T12:00:00Z"),
    captureLivePortfolio: false,
  });
  const portfolio = noMeasurements.sections[3];
  const netWorth = noMeasurements.sections[4];
  const health = noMeasurements.sections[6];
  const retirement = noMeasurements.sections[5];
  assert.deepEqual(portfolio.metrics, {});
  assert.ok((portfolio.unavailableMetrics ?? []).includes("value"));
  assert.deepEqual(netWorth.metrics, {});
  assert.ok((netWorth.unavailableMetrics ?? []).includes("value"));
  assert.deepEqual(health.metrics, {});
  assert.ok((health.unavailableMetrics ?? []).includes("score"));
  assert.deepEqual(retirement.metrics, {});
  assert.ok((retirement.unavailableMetrics ?? []).includes("targetAgeMonths"));

  const measured = reportFor({
    expenses: [], incomeSources: [], budgets: [],
    investments: [{ currentValue: 1_200, investedAmount: 1_100 }],
    netWorthSnapshots: [],
    monthlyReports: [{
      id: "monthly-report-2025-02", month: "2025-02", generatedAt: "2025-03-01T00:00:00Z",
      sections: [{
        id: "portfolio-value-returns-change",
        metrics: { value: 1_100, invested: 1_000 }, metricFormats: {}, actions: [],
      }],
    }],
    profileInputs: {}, retirementInputs: {},
  } as never, "2025-03", {
    generatedAt: new Date("2025-04-01T00:05:00Z"),
    captureLivePortfolio: true,
  });
  assert.equal((measured.sections[3].metrics as Record<string, number>).returnChange, 0);
});

test("automatic report uses salary take-home components for expected income", () => {
  const report = reportFor({
    expenses: [{ id: "expense", date: "2025-03-03", amount: 50_000, category: "Living" }],
    incomeSources: [{
      id: "salary", name: "Salary", type: "Salary", frequency: "Monthly",
      recurring: true, amount: 0, date: "2025-01-01",
      salaryDetails: {
        basicPay: 100_000, hra: 0, allowances: 0, employeePF: 20_000,
        professionalTax: 0, tds: 0, otherDeductions: 0,
      },
    }],
    incomeReceipts: [{ receivedDate: "2025-03-03", amount: 70_000 }],
    budgets: [], investments: [], netWorthSnapshots: [], monthlyReports: [],
    profileInputs: {}, retirementInputs: {},
  } as never, "2025-03");
  assert.equal(report.sections[0].metrics.expected, 80_000);
  assert.equal(report.sections[0].metrics.actual, 70_000);
  assert.equal(report.sections[0].metrics.variance, -10_000);
  assert.equal(report.sections[2].metrics.amount, 20_000);
});

test("automatic report honors occurrence-level retirement and custom income cutoffs", () => {
  const data = {
    expenses: [],
    incomeSources: [
      {
        id: "salary",
        name: "Salary",
        type: "Other",
        frequency: "Monthly",
        recurring: true,
        amount: 100,
        date: "2020-01-15",
        incomeEndMode: "retirement",
      },
      {
        id: "rent",
        name: "Rent",
        type: "Rental",
        frequency: "Monthly",
        recurring: true,
        amount: 50,
        date: "2020-01-15",
        incomeEndMode: "custom",
        incomeEndDate: "2025-02-10",
      },
    ],
    incomeReceipts: [],
    budgets: [],
    investments: [],
    netWorthSnapshots: [],
    monthlyReports: [],
    profileInputs: { dateOfBirth: "2000-02-10" },
    retirementInputs: { targetRetirementAge: 25 },
  } as never;

  assert.equal(reportFor(data, "2025-01").sections[0].metrics.expected, 150);
  assert.equal(reportFor(data, "2025-02").sections[0].metrics.expected, 0);
});

test("delivery selection rechecks master, channel, type, dismissal, and prior delivery state", () => {
  const now = new Date("2025-03-02T12:00:00Z");
  const prefs = {
    enabled: true,
    push: true,
    monthlyReportEmail: true,
    types: { budget: true, goal: false },
  };
  const notice = (overrides: Record<string, unknown> = {}) => ({
    id: crypto.randomUUID(),
    type: "budget",
    title: "Budget",
    message: "Review spending",
    deliverAfter: "2025-03-02T11:00:00Z",
    channels: ["push"],
    ...overrides,
  });
  assert.equal(selectPushableNotifications([
    notice(),
    notice({ type: "goal" }),
    notice({ dismissedAt: now.toISOString() }),
    notice({ pushDeliveredAt: now.toISOString() }),
    notice({ channels: ["in-app"] }),
  ] as never, prefs as never, now).length, 1);
  assert.equal(selectPushableNotifications([notice()] as never, { ...prefs, enabled: false } as never, now).length, 0);
  assert.equal(selectPushableNotifications([notice()] as never, {
    ...prefs,
    timeZone: "UTC",
    quietHours: { start: "22:00", end: "07:00" },
  } as never, new Date("2025-03-02T23:00:00Z")).length, 0);
  assert.equal(shouldSendMonthlyReportEmail(prefs as never, "person@example.test"), true);
  assert.equal(shouldSendMonthlyReportEmail({ ...prefs, enabled: false } as never, "person@example.test"), false);
});

test("monthly report persists before email and retries delivery without blocking", async () => {
  const operations: string[] = [];
  const failed = await processMonthlyReport({
    persisted: false,
    emailDelivered: false,
    shouldEmail: true,
    persist: async () => { operations.push("persist"); },
    send: async () => { operations.push("send"); throw new Error("provider unavailable"); },
    markEmailDelivered: async () => { operations.push("mark"); },
    markEmailFailed: async (category) => { operations.push(`fail:${category}`); },
  });
  assert.deepEqual(operations, ["persist", "send", "fail:temporary"]);
  assert.equal(failed.emailDelivered, false);
  assert.equal(failed.deliveryFailure, "temporary");

  operations.length = 0;
  const retried = await processMonthlyReport({
    persisted: true,
    emailDelivered: false,
    shouldEmail: true,
    persist: async () => { operations.push("persist"); },
    clearEmailFailure: async () => { operations.push("clear"); },
    send: async () => { operations.push("send"); },
    markEmailDelivered: async () => { operations.push("mark"); },
    markEmailFailed: async (category) => { operations.push(`fail:${category}`); },
  });
  assert.deepEqual(operations, ["clear", "send", "mark"]);
  assert.equal(retried.emailDelivered, true);
  assert.equal(retried.deliveryFailure, undefined);
});

test("monthly report delivery failures use safe categories", () => {
  assert.equal(
    classifyMonthlyReportDeliveryFailure(new MonthlyReportAttachmentTooLargeError(19, 18)),
    "report_too_large",
  );
  assert.equal(
    classifyMonthlyReportDeliveryFailure(new Error("Monthly report email is not configured")),
    "email_unavailable",
  );
  assert.equal(
    classifyMonthlyReportDeliveryFailure(new Error("sensitive provider response")),
    "temporary",
  );
});

test("a successful send is not recorded as failed when its delivery marker cannot be saved", async () => {
  const operations: string[] = [];
  const result = await processMonthlyReport({
    persisted: true,
    emailDelivered: false,
    shouldEmail: true,
    persist: async () => { operations.push("persist"); },
    clearEmailFailure: async () => { operations.push("clear"); },
    send: async () => { operations.push("send"); },
    markEmailDelivered: async () => {
      operations.push("mark");
      throw new Error("database unavailable");
    },
    markEmailFailed: async (category) => { operations.push(`fail:${category}`); },
  });
  assert.deepEqual(operations, ["clear", "send", "mark"]);
  assert.deepEqual(result, { emailDelivered: true, deliveryStatusPending: true });
});

test("successful monthly report retry clears the persisted failure", async () => {
  const unique = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  const userId = `planning-report-failure-${unique}`;
  const [user] = await db.insert(usersTable).values({
    id: userId,
    email: `${unique}@example.test`,
  }).returning();

  try {
    const failedAt = "2025-04-01T12:00:00.000Z";
    const failed = await updatePlanningFeatures(user, {
      monthlyReportEmailFailure: {
        month: "2025-03",
        category: "temporary",
        failedAt,
      },
    });
    assert.deepEqual(failed.monthlyReportEmailFailures["2025-03"], {
      category: "temporary",
      failedAt,
    });

    const recovered = await updatePlanningFeatures(user, {
      monthlyReportEmailDeliveredMonth: "2025-03",
    });
    assert.equal(recovered.monthlyReportEmailFailures["2025-03"], undefined);
    assert.equal(
      (await loadFinancialData(user)).monthlyReportEmailFailures["2025-03"],
      undefined,
    );
  } finally {
    await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, userId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("cooling-off accounts receive no scheduled planning mutation or delivery work", async () => {
  const unique = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  const userId = `planning-cooling-${unique}`;
  const requestId = `planning-cooling-request-${unique}`;
  const [user] = await db.insert(usersTable).values({
    id: userId,
    email: `${unique}@example.test`,
  }).returning();
  await db.insert(userProfilesTable).values({
    userId,
    planningData: {
      notificationPreferences: {
        enabled: true,
        inApp: true,
        push: true,
        monthlyReportEmail: true,
        weeklyDigest: true,
        digestDay: 1,
        timeZone: "UTC",
        quietHours: { start: "00:00", end: "00:00" },
        types: {
          budget: true, retirement: true, goal: true, upcoming: true,
          milestone: true, tax: true, anomaly: true,
        },
      },
      notificationState: [],
      monthlyReportSnapshots: [],
    },
  });
  await db.insert(accountDeletionRequestsTable).values({
    id: requestId,
    userId,
    accountHash: accountHash(userId),
    status: "cooling_off",
    scheduledFor: new Date(Date.now() + 60_000),
    retainedUntil: new Date(Date.now() + 120_000),
  });
  const [before] = await db.select({ planningData: userProfilesTable.planningData })
    .from(userProfilesTable).where(eq(userProfilesTable.userId, userId));

  try {
    const result = await evaluatePlanningForAccount(
      user,
      new Date("2025-04-01T12:00:00Z"),
    );
    const [after] = await db.select({ planningData: userProfilesTable.planningData })
      .from(userProfilesTable).where(eq(userProfilesTable.userId, userId));
    assert.equal("skipped" in result, true);
    assert.deepEqual(after?.planningData, before?.planningData);
  } finally {
    await db.delete(accountDeletionRequestsTable)
      .where(eq(accountDeletionRequestsTable.id, requestId));
    await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, userId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("queued planning rechecks deletion under its account fence and other accounts still evaluate", async () => {
  const unique = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  const blockedId = `planning-fence-blocked-${unique}`;
  const otherId = `planning-fence-other-${unique}`;
  const requestId = `planning-fence-request-${unique}`;
  const [blocked, other] = await db.insert(usersTable).values([
    { id: blockedId, email: `blocked-${unique}@example.test` },
    { id: otherId, email: `other-${unique}@example.test` },
  ]).returning();
  const release = await acquireAccountWriteFence(blockedId);

  try {
    const blockedEvaluation = evaluatePlanningForAccount(
      blocked,
      new Date("2025-04-01T12:00:00Z"),
    );
    await db.insert(accountDeletionRequestsTable).values({
      id: requestId,
      userId: blockedId,
      accountHash: accountHash(blockedId),
      status: "cooling_off",
      scheduledFor: new Date(Date.now() + 60_000),
      retainedUntil: new Date(Date.now() + 120_000),
    });
    const otherEvaluation = evaluatePlanningForAccount(
      other,
      new Date("2025-04-01T12:00:00Z"),
    );
    await release();

    const [blockedResult, otherResult] = await Promise.all([
      blockedEvaluation,
      otherEvaluation,
    ]);
    assert.equal("skipped" in blockedResult, true);
    assert.equal("skipped" in otherResult, false);
    assert.equal((await db.select().from(userProfilesTable)
      .where(eq(userProfilesTable.userId, blockedId))).length, 0);
    assert.equal((await db.select().from(userProfilesTable)
      .where(eq(userProfilesTable.userId, otherId))).length, 1);
  } finally {
    await release();
    await db.delete(accountDeletionRequestsTable)
      .where(eq(accountDeletionRequestsTable.id, requestId));
    await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, blockedId));
    await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, otherId));
    await db.delete(usersTable).where(eq(usersTable.id, blockedId));
    await db.delete(usersTable).where(eq(usersTable.id, otherId));
  }
});