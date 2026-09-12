import assert from "node:assert/strict";
import test from "node:test";
import { trackExpenseSaveSucceeded } from "./expense-analytics.ts";

test("transaction completion analytics sends only coarse allowlisted dimensions", () => {
  const calls: Array<{ name: string; data?: Record<string, string | number | boolean> }> = [];
  const previousWindow = globalThis.window;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      umami: {
        track(name: string, data?: Record<string, string | number | boolean>) {
          calls.push({ name, data });
        },
      },
    },
  });

  try {
    trackExpenseSaveSucceeded("create", true);
    trackExpenseSaveSucceeded("edit");
    trackExpenseSaveSucceeded("import");
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
    });
  }

  assert.deepEqual(calls, [
    {
      name: "expense_save_succeeded",
      data: { operation: "create", emi_choice_required: true },
    },
    {
      name: "expense_save_succeeded",
      data: { operation: "edit", emi_choice_required: false },
    },
    {
      name: "expense_save_succeeded",
      data: { operation: "import", emi_choice_required: false },
    },
  ]);
});