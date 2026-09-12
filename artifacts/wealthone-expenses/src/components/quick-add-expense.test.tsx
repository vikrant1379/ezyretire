import assert from "node:assert/strict";
import test from "node:test";
import {
  createQuickAddExpenseAnalyticsSession,
  createQuickAddExpenseMutationCallbacks,
} from "./quick-add-expense.tsx";

test("opening quick-add starts exactly one analytics session", () => {
  const tracked: unknown[][] = [];
  const session = createQuickAddExpenseAnalyticsSession({
    track: (...args) => tracked.push(args),
  });

  session.open();
  session.open();

  assert.deepEqual(tracked, [["expense_dialog_opened"]]);
});

test("cancelling quick-add emits once with only the EMI-choice-required flag", () => {
  const tracked: unknown[][] = [];
  const session = createQuickAddExpenseAnalyticsSession({
    track: (...args) => tracked.push(args),
  });

  session.open();
  session.requireEmiChoice();
  session.cancel();
  session.cancel();

  assert.deepEqual(tracked, [
    ["expense_dialog_opened"],
    ["expense_dialog_cancelled", { emi_choice_required: true }],
  ]);
});

test("ordinary cancellation allows a fresh quick-add session", () => {
  const tracked: unknown[][] = [];
  const session = createQuickAddExpenseAnalyticsSession({
    track: (...args) => tracked.push(args),
  });

  session.open();
  session.requireEmiChoice();
  session.cancel();
  session.open();
  session.cancel();

  assert.deepEqual(tracked, [
    ["expense_dialog_opened"],
    ["expense_dialog_cancelled", { emi_choice_required: true }],
    ["expense_dialog_opened"],
    ["expense_dialog_cancelled", { emi_choice_required: false }],
  ]);
});

test("a successful quick-add does not emit cancellation and allows a fresh session", () => {
  const tracked: unknown[][] = [];
  const session = createQuickAddExpenseAnalyticsSession({
    track: (...args) => tracked.push(args),
  });
  session.open();
  const callbacks = createQuickAddExpenseMutationCallbacks({
    emiChoiceRequired: false,
    trackSuccess: () => undefined,
    completeSession: session.complete,
    showSuccess: () => undefined,
    closeAndReset: session.cancel,
  });

  callbacks.onSuccess();
  session.open();

  assert.deepEqual(tracked, [
    ["expense_dialog_opened"],
    ["expense_dialog_opened"],
  ]);
});

test("receipt confirmation closes the session without cancellation and resets the next session", () => {
  const tracked: unknown[][] = [];
  const session = createQuickAddExpenseAnalyticsSession({
    track: (...args) => tracked.push(args),
  });

  session.open();
  session.requireEmiChoice();
  session.complete();
  session.open();
  session.cancel();

  assert.deepEqual(tracked, [
    ["expense_dialog_opened"],
    ["expense_dialog_opened"],
    ["expense_dialog_cancelled", { emi_choice_required: false }],
  ]);
});

test("quick-add tracks only coarse create completion after persistence succeeds", () => {
  const calls: Array<{ step: string; args?: unknown[] }> = [];
  const callbacks = createQuickAddExpenseMutationCallbacks({
    emiChoiceRequired: true,
    trackSuccess: (...args) => calls.push({ step: "track", args }),
    showSuccess: () => calls.push({ step: "toast" }),
    closeAndReset: () => calls.push({ step: "reset" }),
  });
  const persistedExpense = {
    id: "private-transaction-id",
    amount: 1234,
    category: "Private category",
    merchant: "Private merchant",
    note: "Private note",
  };

  assert.deepEqual(calls, []);
  callbacks.onSuccess(persistedExpense);

  assert.deepEqual(calls, [
    { step: "track", args: ["create", true] },
    { step: "toast" },
    { step: "reset" },
  ]);
});

test("failed quick-add creates emit no completion", () => {
  const tracked: unknown[][] = [];
  const callbacks = createQuickAddExpenseMutationCallbacks({
    emiChoiceRequired: false,
    trackSuccess: (...args) => tracked.push(args),
    showSuccess: () => assert.fail("failed creates must not show success"),
    closeAndReset: () => assert.fail("failed creates must not reset as successful"),
  });

  assert.equal("onError" in callbacks, false);
  assert.deepEqual(tracked, []);
});