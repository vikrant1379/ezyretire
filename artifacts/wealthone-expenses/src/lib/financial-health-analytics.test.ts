import assert from "node:assert/strict";
import test from "node:test";
import {
  financialHealthCompletionCallbacks,
  trackFinancialHealthUpdateCompleted,
  type FinancialHealthUpdateDestination,
  type FinancialHealthUpdateOutcome,
} from "./financial-health-analytics.ts";

type CompletionCall = {
  name: string;
  data?: Record<string, string | number | boolean>;
};

function installAnalyticsRecorder(calls: CompletionCall[]): typeof globalThis.window {
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

  return previousWindow;
}

function restoreWindow(previousWindow: typeof globalThis.window): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: previousWindow,
  });
}

async function runMutation(
  save: () => Promise<void>,
  callbacks: { onSuccess: () => void },
): Promise<void> {
  try {
    await save();
    callbacks.onSuccess();
  } catch {
    // Failed mutations do not run TanStack Query's onSuccess callback.
  }
}

test("financial health completion analytics sends only coarse allowlisted dimensions", () => {
  const calls: Array<{ name: string; data?: Record<string, string | number | boolean> }> = [];
  const previousWindow = installAnalyticsRecorder(calls);

  try {
    trackFinancialHealthUpdateCompleted("financial_health", "snapshot_saved");
    trackFinancialHealthUpdateCompleted("loans", "created");
    trackFinancialHealthUpdateCompleted("income", "updated");
  } finally {
    restoreWindow(previousWindow);
  }

  assert.deepEqual(calls, [
    {
      name: "financial_health_update_completed",
      data: { destination: "financial_health", outcome: "snapshot_saved" },
    },
    {
      name: "financial_health_update_completed",
      data: { destination: "loans", outcome: "created" },
    },
    {
      name: "financial_health_update_completed",
      data: { destination: "income", outcome: "updated" },
    },
  ]);
});

const completionCases: Array<{
  name: string;
  destination: FinancialHealthUpdateDestination;
  outcome: FinancialHealthUpdateOutcome;
}> = [
  { name: "snapshot save", destination: "financial_health", outcome: "snapshot_saved" },
  { name: "emergency-fund save", destination: "financial_health", outcome: "emergency_fund_saved" },
  { name: "loan create", destination: "loans", outcome: "created" },
  { name: "loan update", destination: "loans", outcome: "updated" },
  { name: "income-source create", destination: "income", outcome: "created" },
  { name: "income-source update", destination: "income", outcome: "updated" },
];

for (const completionCase of completionCases) {
  test(`${completionCase.name} emits exactly one completion event after success`, async () => {
    const calls: CompletionCall[] = [];
    const previousWindow = installAnalyticsRecorder(calls);
    const callbacks = financialHealthCompletionCallbacks(
      completionCase.destination,
      completionCase.outcome,
    );
    let finishSave: (() => void) | undefined;
    const save = new Promise<void>((resolve) => {
      finishSave = resolve;
    });

    try {
      const mutation = runMutation(() => save, callbacks);
      assert.deepEqual(calls.map(({ data }) => data), []);
      finishSave?.();
      await mutation;
    } finally {
      restoreWindow(previousWindow);
    }

    assert.deepEqual(calls.map(({ data }) => data), [{
      destination: completionCase.destination,
      outcome: completionCase.outcome,
    }]);
  });

  test(`${completionCase.name} emits no completion event after failure`, async () => {
    const calls: CompletionCall[] = [];
    const previousWindow = installAnalyticsRecorder(calls);
    const callbacks = financialHealthCompletionCallbacks(
      completionCase.destination,
      completionCase.outcome,
    );

    try {
      await runMutation(
        () => Promise.reject(new Error("save failed")),
        callbacks,
      );
    } finally {
      restoreWindow(previousWindow);
    }

    assert.deepEqual(calls.map(({ data }) => data), []);
  });
}

test("analytics failures cannot interrupt a completed financial update", () => {
  const previousWindow = globalThis.window;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      umami: {
        track() {
          throw new Error("analytics unavailable");
        },
      },
    },
  });

  try {
    assert.doesNotThrow(() => {
      trackFinancialHealthUpdateCompleted("financial_health", "emergency_fund_saved");
    });
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
    });
  }
});