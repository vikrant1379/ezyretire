import assert from "node:assert/strict";
import test from "node:test";
import { createExpenseEditMutationCallbacks } from "./edit-expense-dialog.tsx";

test("editing tracks completion only after persistence reports success", () => {
  const calls: Array<{ step: string; args?: unknown[] }> = [];
  const callbacks = createExpenseEditMutationCallbacks({
    trackSuccess: (...args) => calls.push({ step: "track", args }),
    showSuccess: () => calls.push({ step: "toast" }),
    closeDialog: () => calls.push({ step: "close" }),
  });

  assert.deepEqual(calls, []);

  callbacks.onSuccess();

  assert.deepEqual(calls, [
    { step: "track", args: ["edit"] },
    { step: "toast" },
    { step: "close" },
  ]);
});

test("failed editing has no completion callback or transaction analytics payload", () => {
  const tracked: unknown[][] = [];
  const callbacks = createExpenseEditMutationCallbacks({
    trackSuccess: (...args) => tracked.push(args),
    showSuccess: () => assert.fail("failed edits must not show success"),
    closeDialog: () => assert.fail("failed edits must not close as successful"),
  });

  assert.equal("onError" in callbacks, false);
  assert.deepEqual(tracked, []);
});