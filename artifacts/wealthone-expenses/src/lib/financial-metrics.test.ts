import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateEmergencyFundMetrics,
  calculateFinancialHealthScore,
  calculateNetWorth,
  EMERGENCY_FUND_TIMELINE_MONTH_LIMIT,
  lifestyleMonthlyExpense,
  lifestylePresetOptions,
  upsertMonthlyNetWorthSnapshot,
} from "./financial-metrics.ts";

test("net worth uses current assets and outstanding liabilities with auditable composition", () => {
  const result = calculateNetWorth({
    investments: [
      { id: "mf", name: "Index fund", assetClass: "Mutual Funds", currentValue: 300_000 },
      { id: "fd", name: "Deposit", assetClass: "Fixed Deposit", currentValue: 100_000 },
      { id: "bad", name: "Bad import", assetClass: "Other", currentValue: Number.NaN },
    ],
    loans: [{ id: "home", name: "Home loan", type: "Home", outstandingPrincipal: 250_000 }],
    cashBalance: 50_000,
  });
  assert.equal(result.totalAssets, 450_000);
  assert.equal(result.totalLiabilities, 250_000);
  assert.equal(result.netWorth, 200_000);
  assert.deepEqual(result.assetComposition, {
    Cash: 50_000,
    "Fixed Deposit": 100_000,
    "Mutual Funds": 300_000,
    Other: 0,
  });
});

test("monthly snapshots replace the same month, derive net worth, and stay sorted", () => {
  const updated = upsertMonthlyNetWorthSnapshot([
    { month: "2026-02", assets: 20, liabilities: 5, netWorth: 999 },
    { month: "2026-01", assets: 10, liabilities: 2, netWorth: 8 },
  ], { month: "2026-02-28", assets: 30, liabilities: 4, netWorth: -1 });
  assert.deepEqual(updated.map((item) => item.month), ["2026-01", "2026-02"]);
  assert.deepEqual(updated[1], { month: "2026-02", assets: 30, liabilities: 4, netWorth: 26 });
  assert.throws(
    () => upsertMonthlyNetWorthSnapshot([], { month: "2026-13", assets: 1, liabilities: 0, netWorth: 1 }),
    /valid YYYY-MM/,
  );
});

test("emergency metrics expose coverage, shortfall, and a capped contribution timeline", () => {
  const result = calculateEmergencyFundMetrics({
    reserveBalance: 10_000,
    monthlyEssentialExpenses: 5_000,
    targetMonths: 3,
    monthlyContribution: 2_000,
    asOf: new Date(2026, 0, 15),
  });
  assert.equal(result.monthsCovered, 2);
  assert.equal(result.targetAmount, 15_000);
  assert.equal(result.shortfall, 5_000);
  assert.equal(result.monthsToTarget, 3);
  assert.deepEqual(result.timeline, [
    { month: "2026-02", contribution: 2_000, projectedBalance: 12_000 },
    { month: "2026-03", contribution: 2_000, projectedBalance: 14_000 },
    { month: "2026-04", contribution: 1_000, projectedBalance: 15_000 },
  ]);

  const unknown = calculateEmergencyFundMetrics({ reserveBalance: 1_000, monthlyEssentialExpenses: 0 });

  const impractical = calculateEmergencyFundMetrics({
    reserveBalance: 0,
    monthlyEssentialExpenses: 50_000,
    targetMonths: 6,
    monthlyContribution: 0.01,
    asOf: new Date(2026, 0, 1),
  });
  assert.equal(unknown.monthsCovered, null);
  assert.equal(unknown.dataAvailable, false);
});

test("emergency timelines stay bounded for tiny contributions and large targets", () => {
  const tinyContribution = calculateEmergencyFundMetrics({
    monthlyEssentialExpenses: 50_000,
    targetMonths: 6,
    monthlyContribution: 0.01,
    asOf: new Date(2026, 0, 15),
  });
  assert.equal(tinyContribution.monthsToTarget, 30_000_000);
  assert.equal(tinyContribution.timeline.length, EMERGENCY_FUND_TIMELINE_MONTH_LIMIT);
  assert.equal(tinyContribution.timelineTruncated, true);
  assert.equal(tinyContribution.monthsToTargetCapped, false);

  const arithmeticOverflow = calculateEmergencyFundMetrics({
    monthlyEssentialExpenses: Number.MAX_VALUE,
    targetMonths: 24,
    monthlyContribution: Number.MIN_VALUE,
  });
  assert.equal(arithmeticOverflow.monthsToTarget, Number.MAX_SAFE_INTEGER);
  assert.equal(arithmeticOverflow.monthsToTargetCapped, true);
  assert.equal(arithmeticOverflow.timeline.length, EMERGENCY_FUND_TIMELINE_MONTH_LIMIT);
});

test("health score is weighted, bounded, and makes missing data explicit", () => {
  const complete = calculateFinancialHealthScore({
    monthlyNetIncome: 100_000,
    monthlyEssentialExpenses: 80_000,
    monthlyDebtPayments: 20_000,
    monthlySavings: 20_000,
    emergencyReserve: 480_000,
    emergencyTargetMonths: 6,
    totalAssets: 1_000_000,
    totalLiabilities: 0,
  });
  assert.equal(complete.score, 100);
  assert.equal(complete.availableWeight, 100);
  assert.equal(complete.isComplete, true);
  assert.deepEqual(complete.actions, []);

  const partial = calculateFinancialHealthScore({
    monthlyNetIncome: 100_000,
    monthlyEssentialExpenses: 90_000,
  });
  assert.equal(partial.score, 12.5);
  assert.equal(partial.availableWeight, 25);
  assert.equal(partial.status, "partial");
  assert.equal(partial.components.find((item) => item.key === "savingsRate")?.score, null);
  assert.ok(partial.actions.some((action) => action.includes("Add data")));

  const empty = calculateFinancialHealthScore({});
  assert.equal(empty.score, 0);
  assert.equal(empty.status, "insufficient-data");
  assert.equal(empty.missingWeight, 100);
});

test("lifestyle helpers apply named multipliers and keep custom amounts explicit", () => {
  assert.equal(lifestyleMonthlyExpense("Basic", 40_000), 30_000);
  assert.equal(lifestyleMonthlyExpense("Comfortable", 40_000), 40_000);
  assert.equal(lifestyleMonthlyExpense("Premium", 40_000), 60_000);
  assert.equal(lifestyleMonthlyExpense("Custom", 40_000, 52_000), 52_000);
  assert.deepEqual(
    lifestylePresetOptions(40_000).map(({ value, monthlyExpense }) => ({ value, monthlyExpense })),
    [
      { value: "Basic", monthlyExpense: 30_000 },
      { value: "Comfortable", monthlyExpense: 40_000 },
      { value: "Premium", monthlyExpense: 60_000 },
    ],
  );
});
