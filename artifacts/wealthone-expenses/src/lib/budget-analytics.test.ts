import assert from "node:assert/strict";
import test from "node:test";
import { getBudgetCategoryType, getBudgetPlanDimensions } from "./budget-analytics.ts";

test("classifies categories without exposing their names", () => {
  const core = ["Food & Dining"];
  const optional = ["Insurance"];
  assert.equal(getBudgetCategoryType("Food & Dining", core, optional), "core");
  assert.equal(getBudgetCategoryType("Insurance", core, optional), "optional");
  assert.equal(getBudgetCategoryType("A private household label", core, optional), "custom");
});

test("returns only privacy-safe aggregate plan dimensions", () => {
  const dimensions = getBudgetPlanDimensions("custom", [
    {
      id: "one",
      monthlyLimit: 12_345,
      startDate: "2030-01-01",
      endMode: "retirement",
      note: "private note",
    },
    {
      id: "two",
      monthlyLimit: 67_890,
      startDate: "2030-01-01",
      endMode: "custom",
      endDate: "2040-01-01",
    },
  ], "2045-01-01");

  assert.deepEqual(Object.keys(dimensions).sort(), [
    "category_type",
    "end_mode",
    "future_planning",
    "overlap_present",
    "period_count",
    "warning_present",
  ]);
  assert.deepEqual(dimensions, {
    category_type: "custom",
    end_mode: "mixed",
    period_count: 2,
    overlap_present: true,
    warning_present: true,
    future_planning: true,
  });
});