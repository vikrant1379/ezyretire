import assert from "node:assert/strict";
import test from "node:test";
import type { ReactElement, ReactNode } from "react";
import { calculateFinancialHealthScore } from "../lib/financial-metrics.ts";
import {
  FinancialHealthSummary,
  financialHealthActionDestination,
  financialHealthActionHref,
  getCompactFinancialHealthContent,
  getCompactFinancialHealthState,
  getFinancialHealthHistory,
} from "./financial-health-summary.tsx";

function findElementByTestId(node: ReactNode, testId: string): ReactElement<Record<string, unknown>> | null {
  if (!node || typeof node !== "object" || !("props" in node)) return null;

  const element = node as ReactElement<Record<string, unknown>>;
  if (element.props["data-testid"] === testId) return element;

  const children = element.props.children;
  const childNodes = Array.isArray(children) ? children : [children];
  for (const child of childNodes) {
    const match = findElementByTestId(child as ReactNode, testId);
    if (match) return match;
  }

  return null;
}

test("compact financial health entry links the entire surface to details with an accessible incomplete state", () => {
  const result = calculateFinancialHealthScore({});
  const content = getCompactFinancialHealthContent(result);
  const entry = FinancialHealthSummary({
    result,
    snapshots: [],
    variant: "compact",
  }) as ReactElement<Record<string, unknown>>;

  assert.equal(entry.props.href, "/financial-health");
  assert.equal(entry.props["data-testid"], "link-financial-health-summary");
  assert.equal(entry.props["aria-label"], content.accessibleLabel);
  assert.match(content.accessibleLabel, /Score incomplete/);
  assert.match(content.accessibleLabel, /Best next step/);
  assert.equal(content.statusLabel, "Complete your financial picture");
  assert.equal(getCompactFinancialHealthState(result), "incomplete");
});

test("compact financial health content preserves healthy, warning, and critical score states", () => {
  const healthy = calculateFinancialHealthScore({
    monthlyNetIncome: 100,
    monthlyEssentialExpenses: 80,
    monthlyDebtPayments: 20,
    monthlySavings: 20,
    emergencyReserve: 480,
    emergencyTargetMonths: 6,
    totalAssets: 100,
    totalLiabilities: 20,
  });
  const warning = calculateFinancialHealthScore({
    monthlyNetIncome: 100,
    monthlyEssentialExpenses: 90,
    monthlyDebtPayments: 20,
    monthlySavings: 10,
    emergencyReserve: 270,
    emergencyTargetMonths: 6,
    totalAssets: 100,
    totalLiabilities: 20,
  });

  assert.equal(getCompactFinancialHealthContent(healthy).statusLabel, "Your foundations look healthy");
  assert.equal(getCompactFinancialHealthContent(warning).statusLabel, "Your foundations need attention");
  assert.equal(getCompactFinancialHealthState(healthy), "healthy");
  assert.equal(getCompactFinancialHealthState(warning), "warning");

  const critical = calculateFinancialHealthScore({
    monthlyNetIncome: 100,
    monthlyEssentialExpenses: 100,
    monthlyDebtPayments: 100,
    monthlySavings: 0,
    emergencyReserve: 0,
    emergencyTargetMonths: 6,
    totalAssets: 100,
    totalLiabilities: 100,
  });
  assert.equal(getCompactFinancialHealthContent(critical).statusLabel, "Your foundations need action");
  assert.match(getCompactFinancialHealthContent(critical).accessibleLabel, /Score 0 out of 100/);
  assert.equal(getCompactFinancialHealthState(critical), "critical");
});

test("compact financial health activation tracks only its coarse state", () => {
  const result = calculateFinancialHealthScore({});
  const events: Array<{ name: string; data?: Record<string, string | number | boolean> }> = [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    umami: {
      track(name, data) {
        events.push({ name, data });
      },
    },
  } as Window & typeof globalThis;

  try {
    const entry = FinancialHealthSummary({
      result,
      snapshots: [],
      variant: "compact",
    }) as ReactElement<{ onClick(): void }>;

    entry.props.onClick();
    assert.deepEqual(events, [{
      name: "financial_health_summary_opened",
      data: { state: "incomplete" },
    }]);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("detailed next actions keep their established destinations", () => {
  assert.equal(financialHealthActionHref("Direct a monthly contribution to your emergency reserve."), "/financial-health");
  assert.equal(financialHealthActionHref("Reduce monthly debt payments, prioritizing costly debt."), "/loans");
  assert.equal(financialHealthActionHref("Increase recurring net income."), "/income");
  assert.equal(financialHealthActionHref("Reduce essential spending."), "/transactions");
  assert.equal(financialHealthActionDestination("/financial-health"), "financial_health");
  assert.equal(financialHealthActionDestination("/loans"), "loans");
  assert.equal(financialHealthActionDestination("/income"), "income");
  assert.equal(financialHealthActionDestination("/transactions"), "transactions");
  assert.equal(financialHealthActionDestination("/unexpected"), "onboarding");
});

test("health history preserves missing scores as unavailable and orders the latest 12 months", () => {
  const snapshots = Array.from({ length: 13 }, (_, index) => ({
    month: `${2025 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`,
    assets: 100,
    liabilities: 20,
    netWorth: 80,
    ...(index === 5 ? {} : { healthScore: index }),
  })).reverse();

  const history = getFinancialHealthHistory(snapshots);

  assert.equal(history.length, 12);
  assert.equal(history[0].month, "2025-02");
  assert.equal(history.at(-1)?.month, "2026-01");
  assert.equal(history.find((point) => point.month === "2025-06")?.score, null);
  assert.equal(history.find((point) => point.month === "2025-07")?.score, 6);
});

test("detailed next-step activation tracks only its coarse destination", () => {
  const result = calculateFinancialHealthScore({});
  const events: Array<{ name: string; data?: Record<string, string | number | boolean> }> = [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    umami: {
      track(name, data) {
        events.push({ name, data });
      },
    },
  } as Window & typeof globalThis;

  try {
    const summary = FinancialHealthSummary({
      result,
      snapshots: [],
      variant: "detailed",
    });
    const button = findElementByTestId(summary, "link-health-next-action");
    const link = button?.props.children as ReactElement<{ onClick(): void }>;

    assert.ok(link);
    link.props.onClick();
    assert.deepEqual(events, [{
      name: "financial_health_action_opened",
      data: { destination: "onboarding" },
    }]);
  } finally {
    globalThis.window = previousWindow;
  }
});