import assert from "node:assert/strict";
import test from "node:test";
import {
  getLifestylePreviewDimensions,
  getPlannerOpenDimensions,
  getRetirementPlanDimensions,
} from "./retirement-analytics.ts";

test("lifestyle previews contain only the selected category", () => {
  assert.deepEqual(getLifestylePreviewDimensions("Premium"), {
    lifestyle: "premium",
  });
});

test("planner opens contain only aggregate plan dimensions", () => {
  assert.deepEqual(getPlannerOpenDimensions("Custom", 2), {
    lifestyle: "custom",
    pension_source_count: 2,
  });
});

test("saved plans exclude pension names and other free-form content", () => {
  const dimensions = getRetirementPlanDimensions({
    lifestyle: "Comfortable",
    targetRetirementAge: 58,
    lifeExpectancy: 88,
    pensionSourceCount: 2,
    monthlyContributionOverride: 15_000,
    plannerOpened: true,
    fundingPercentage: 92,
  });

  assert.deepEqual(Object.keys(dimensions).sort(), [
    "contribution_mode",
    "funding_status",
    "lifestyle",
    "pension_source_count",
    "planner_used",
    "retirement_years",
    "target_retirement_age",
  ]);
  assert.deepEqual(dimensions, {
    lifestyle: "comfortable",
    target_retirement_age: 58,
    retirement_years: 30,
    pension_source_count: 2,
    contribution_mode: "custom",
    planner_used: "yes",
    funding_status: "shortfall",
  });
});