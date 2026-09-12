import test from "node:test";
import assert from "node:assert/strict";
import { DEPENDENT_STAGES, applyPlannedExpenseOperation, buildScenarioRetirementInputs, calculateStepUpSip, dependentStagesForAge, futureValue, lineItemsToPlannedExpenses, mergeRetirementScenarioInputs, purchasingPower } from "./planning-simulations.ts";

test("inflation starts at the supplied boundary and purchasing power is inverse", () => {
  assert.equal(futureValue(100, 6, 0), 100);
  assert.ok(Math.abs(purchasingPower(futureValue(100, 6, 10), 6, 10) - 100) < 0.001);
});

test("template conversion preserves overrides and calendar timing", () => {
  const [expense] = lineItemsToPlannedExpenses("Plan", [{
    id: "x", name: "Course", category: "Education", amount: 500000,
    yearsFromNow: 2, inflationRate: 9, benchmarkMin: 1, benchmarkMax: 2,
  }], new Date(2026, 8, 8));
  assert.equal(expense.expectedDate, "2028-09-01");
  assert.equal(expense.customInflationRate, 9);
  assert.equal(expense.amount, 500000);
});

test("step-up SIP reports each year and improves corpus over a flat SIP", () => {
  const result = calculateStepUpSip({ monthlyContribution: 10000, annualStepUpPercent: 10, annualReturnPercent: 12, years: 10 });
  assert.equal(result.rows.length, 10);
  assert.ok(result.corpus > result.flatCorpus);
  assert.ok((result.monthsGained ?? 0) > 0);
});

test("what-if inputs are isolated from the frozen saved baseline", () => {
  const baseline = { dateOfBirth: "1990-01-01", targetRetirementAge: 60, lifeExpectancy: 85, generalInflation: 6, salaryGrowth: 8, lifestyleChoice: "Custom" as const, customLifestyleExpense: 80000 };
  const scenario = buildScenarioRetirementInputs(baseline, { retirementAge: 55, contribution: 20000, inflation: 7, spendingChange: 10 });
  assert.equal(baseline.targetRetirementAge, 60);
  assert.equal(baseline.generalInflation, 6);
  assert.equal(scenario.targetRetirementAge, 55);
  assert.ok(Math.abs((scenario.retirementSpendingAdjustmentPercent ?? 0) - 10) < 0.001);
});

test("rebasing a saved spending scenario makes unchanged apply idempotent", () => {
  const baseline = { dateOfBirth: "1990-01-01", targetRetirementAge: 60, lifeExpectancy: 85, generalInflation: 6, salaryGrowth: 8 };
  const first = buildScenarioRetirementInputs(baseline, { retirementAge: 60, contribution: 0, inflation: 6, spendingChange: 10 });
  const second = buildScenarioRetirementInputs(first, { retirementAge: 60, contribution: 0, inflation: 6, spendingChange: 0 });
  assert.ok(Math.abs((first.retirementSpendingAdjustmentPercent ?? 0) - 10) < 0.001);
  assert.ok(Math.abs((second.retirementSpendingAdjustmentPercent ?? 0) - 10) < 0.001);
});

test("spending scenarios preserve reductions and clamp composed boundaries", () => {
  const baseline = { dateOfBirth: "1990-01-01", targetRetirementAge: 60, lifeExpectancy: 85, generalInflation: 6, salaryGrowth: 8 };
  const reduced = buildScenarioRetirementInputs(baseline, { retirementAge: 60, contribution: 0, inflation: 6, spendingChange: -50 });
  assert.ok(Math.abs((reduced.retirementSpendingAdjustmentPercent ?? 0) + 50) < 0.001);

  const highBaseline = { ...baseline, retirementSpendingAdjustmentPercent: 200 };
  const upper = buildScenarioRetirementInputs(highBaseline, { retirementAge: 60, contribution: 0, inflation: 6, spendingChange: 100 });
  assert.equal(upper.retirementSpendingAdjustmentPercent, 300);

  const lowBaseline = { ...baseline, retirementSpendingAdjustmentPercent: -80 };
  const lower = buildScenarioRetirementInputs(lowBaseline, { retirementAge: 60, contribution: 0, inflation: 6, spendingChange: -90 });
  assert.equal(lower.retirementSpendingAdjustmentPercent, -90);
});

test("scenario apply preserves newer unrelated saved retirement assumptions", () => {
  const latest = {
    dateOfBirth: "1990-01-01",
    targetRetirementAge: 60,
    lifeExpectancy: 92,
    generalInflation: 6,
    salaryGrowth: 9,
    lifestyleChoice: "Premium" as const,
    pensionSources: [{ id: "new", name: "New pension", monthlyAmount: 10_000, annualEscalationRate: 4 }],
  };
  const staleScenario = {
    ...latest,
    lifeExpectancy: 85,
    lifestyleChoice: "Basic" as const,
    pensionSources: [],
    targetRetirementAge: 58,
    generalInflation: 7,
    monthlyContributionOverride: 20_000,
    retirementSpendingAdjustmentPercent: 10,
  };
  const merged = mergeRetirementScenarioInputs(latest, staleScenario);
  assert.equal(merged.lifeExpectancy, 92);
  assert.equal(merged.lifestyleChoice, "Premium");
  assert.equal(merged.pensionSources?.[0]?.id, "new");
  assert.equal(merged.targetRetirementAge, 58);
  assert.equal(merged.retirementSpendingAdjustmentPercent, 10);
});

test("planned-expense operations compose against the latest saved list", () => {
  const first = { id: "first", name: "First", category: "Other", amount: 1, expectedDate: "2027-01-01", createdAt: "" };
  const second = { ...first, id: "second", name: "Second" };
  const afterFirstWriter = applyPlannedExpenseOperation([], { type: "append", expenses: [first] });
  const afterSecondWriter = applyPlannedExpenseOperation(afterFirstWriter, { type: "append", expenses: [second] });
  assert.deepEqual(afterSecondWriter.map((expense) => expense.id), ["first", "second"]);
});

test("existing children exclude completed stages instead of charging them today", () => {
  const stages = dependentStagesForAge(10);
  assert.equal(stages.some((stage) => stage.id === "maternity"), false);
  assert.equal(stages.some((stage) => stage.id === "childcare"), false);
  assert.equal(stages.find((stage) => stage.id === "school")?.yearsFromNow, 0);
  assert.ok((stages.find((stage) => stage.id === "school")?.amount ?? 0) < DEPENDENT_STAGES.find((stage) => stage.id === "school")!.amount);
});

test("multi-year dependent stages convert into annual canonical expenses", () => {
  const school = DEPENDENT_STAGES.find((stage) => stage.id === "school")!;
  const expenses = lineItemsToPlannedExpenses("Child", [school], new Date(2026, 8, 8));
  assert.equal(expenses.length, 12);
  assert.equal(expenses[0].amount, school.amount / 12);
  assert.equal(expenses.at(-1)?.expectedDate, "2043-09-01");
});