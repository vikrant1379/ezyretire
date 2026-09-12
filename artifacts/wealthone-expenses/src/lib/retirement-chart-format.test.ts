import assert from "node:assert/strict";
import test from "node:test";
import { formatChartAmount } from "./retirement-chart-format.ts";

test("ordinary desktop amounts retain their existing precision and Indian units", () => {
  for (const [value, expected] of [
    [0, "₹0"], [500, "₹500"], [12000, "₹12K"],
    [150000, "₹1.5L"], [25000000, "₹2.5Cr"],
    [-25000000, "₹-2.5Cr"], [9990000000, "₹999.0Cr"],
  ] as const) {
    assert.equal(formatChartAmount(value), expected);
  }
});

test("extreme desktop amounts use bounded labels without losing their sign", () => {
  assert.equal(formatChartAmount(7e11), "₹700B");
  assert.equal(formatChartAmount(-7e11), "₹-700B");
  for (const value of [7e11, 9.99e11, 7e12, 1e15, Number.MAX_VALUE]) {
    for (const sign of [1, -1]) {
      const label = formatChartAmount(value * sign);
      assert.ok(label.length <= 8, label);
      assert.equal(label.includes("-"), sign < 0);
    }
  }
});