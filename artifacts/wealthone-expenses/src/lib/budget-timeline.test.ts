import assert from "node:assert/strict";
import test from "node:test";
import { analyzeBudgetTimeline } from "./budget-timeline.ts";

test("timeline overlap summaries use inclusive final months", () => {
  const analysis = analyzeBudgetTimeline([
    {
      id: "base",
      monthlyLimit: 10_000,
      startDate: "2026-01-01",
      endMode: "lifelong",
    },
    {
      id: "temporary",
      monthlyLimit: 5_000,
      startDate: "2026-03-01",
      endMode: "custom",
      endDate: "2026-04-01",
    },
  ]);

  const overlap = analysis.issues.find((issue) => issue.type === "overlap");
  assert.ok(overlap && overlap.type === "overlap");
  assert.equal(overlap.amount, 15_000);
  assert.equal(overlap.startDate.getMonth(), 2);
  assert.equal(overlap.endDate?.getMonth(), 3);
});

test("timeline gap summaries end the month before the next period", () => {
  const analysis = analyzeBudgetTimeline([
    {
      id: "first",
      monthlyLimit: 10_000,
      startDate: "2026-01-01",
      endMode: "custom",
      endDate: "2026-03-01",
    },
    {
      id: "second",
      monthlyLimit: 12_000,
      startDate: "2026-06-01",
      endMode: "lifelong",
    },
  ]);

  const gap = analysis.issues.find((issue) => issue.type === "gap");
  assert.ok(gap && gap.type === "gap");
  assert.equal(gap.startDate.getMonth(), 3);
  assert.equal(gap.endDate?.getMonth(), 4);
});

test("retirement-ended periods warn until retirement timing is available", () => {
  const analysis = analyzeBudgetTimeline([
    {
      id: "working-home",
      monthlyLimit: 25_000,
      startDate: "2026-01-01",
      endMode: "retirement",
    },
  ]);

  assert.ok(analysis.issues.some(
    (issue) => issue.type === "invalid-date"
      && issue.windowId === "working-home"
      && issue.reason.includes("retirement date"),
  ));
});

test("yearly periods require a due month and stay out of monthly limit stories", () => {
  const invalid = analyzeBudgetTimeline([{
    id: "insurance",
    monthlyLimit: 60_000,
    cadence: "yearly",
    endMode: "lifelong",
  }]);
  assert.ok(invalid.issues.some((issue) =>
    issue.type === "invalid-date" && issue.reason.includes("yearly expense")
  ));

  const valid = analyzeBudgetTimeline([{
    id: "insurance",
    monthlyLimit: 60_000,
    cadence: "yearly",
    annualMonth: 10,
    endMode: "lifelong",
  }]);
  assert.equal(valid.timeline.length, 0);
});