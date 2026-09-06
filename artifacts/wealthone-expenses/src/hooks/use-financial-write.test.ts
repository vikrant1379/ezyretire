import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  ACCOUNT_SWITCH_SAVE_CANCELLED_EVENT,
  accountSwitchSaveDescription,
  carryPendingFinancialChangeNoticeAcrossLogout,
  claimAccountSwitchSaveNotice,
  FINANCIAL_DATA_KEY,
  performFinancialOperation,
  performFinancialWrite,
  trackAccountSwitchSaveCancellation,
} from "./use-financial-write.ts";
import {
  FinancialAccountSwitchError,
  type FinancialData,
} from "../lib/financial-api.ts";

function financialData(account: string): FinancialData {
  return { account } as unknown as FinancialData;
}

function controlledSave() {
  let resolve!: (data: FinancialData) => void;
  let reject!: (error: Error) => void;
  const save = () =>
    new Promise<FinancialData>((resolveSave, rejectSave) => {
      resolve = resolveSave;
      reject = rejectSave;
    });
  return {
    save,
    resolve: (data: FinancialData) => resolve(data),
    reject: (error: Error) => reject(error),
  };
}

test("only account-switch cancellations receive the retry description", () => {
  assert.equal(
    accountSwitchSaveDescription(new FinancialAccountSwitchError()),
    "Your account changed before this could be saved. Switch to the correct account and try again.",
  );
  assert.equal(accountSwitchSaveDescription(new Error("network failed")), undefined);
});

test("account-switch cancellation analytics contain only the coarse save flow", () => {
  const originalWindow = globalThis.window;
  const events: Array<{ name: string; data?: Record<string, unknown> }> = [];
  globalThis.window = {
    umami: {
      track: (name, data) => events.push({ name, data }),
    },
  } as unknown as Window & typeof globalThis;

  try {
    trackAccountSwitchSaveCancellation("financial_write");
    assert.deepEqual(events, [
      {
        name: ACCOUNT_SWITCH_SAVE_CANCELLED_EVENT,
        data: { save_flow: "financial_write" },
      },
    ]);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("analytics failures cannot escape into financial error handling", () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    umami: {
      track: () => {
        throw new Error("analytics unavailable");
      },
    },
  } as unknown as Window & typeof globalThis;

  try {
    assert.doesNotThrow(() =>
      trackAccountSwitchSaveCancellation("financial_operation"),
    );
  } finally {
    globalThis.window = originalWindow;
  }
});

test("simultaneous interrupted writes claim only one retry notice", async () => {
  const client = new QueryClient();
  client.setQueryData(FINANCIAL_DATA_KEY, financialData("first"));
  const firstSave = controlledSave();
  const secondSave = controlledSave();

  const firstPending = performFinancialOperation(client, firstSave.save);
  const secondPending = performFinancialOperation(client, secondSave.save);

  firstSave.reject(new FinancialAccountSwitchError());
  secondSave.reject(new FinancialAccountSwitchError());
  const claims = await Promise.all([
    firstPending.catch(() => claimAccountSwitchSaveNotice(client)),
    secondPending.catch(() => claimAccountSwitchSaveNotice(client)),
  ]);

  assert.deepEqual(claims.sort(), [false, true]);
  client.clear();
});

test("logout reserves the single retry notice for the next account", async () => {
  const originalWindow = globalThis.window;
  const values = new Map<string, string>();
  globalThis.window = {
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  } as unknown as Window & typeof globalThis;

  const client = new QueryClient();
  client.setQueryData(FINANCIAL_DATA_KEY, financialData("first"));
  const controlled = controlledSave();
  const pending = performFinancialOperation(client, controlled.save);

  try {
    assert.equal(carryPendingFinancialChangeNoticeAcrossLogout(client), true);
    controlled.reject(new FinancialAccountSwitchError());
    const claimedByInterruptedWrite = await pending.catch(() =>
      claimAccountSwitchSaveNotice(client),
    );
    assert.equal(claimedByInterruptedWrite, false);
  } finally {
    client.clear();
    globalThis.window = originalWindow;
  }
});

test("an old direct operation cannot repopulate a replaced account cache", async () => {
  const client = new QueryClient();
  const firstAccount = financialData("first");
  const secondAccount = financialData("second");
  client.setQueryData(FINANCIAL_DATA_KEY, firstAccount);
  const controlled = controlledSave();

  const pending = performFinancialOperation(client, controlled.save);
  client.removeQueries({ queryKey: FINANCIAL_DATA_KEY });
  client.setQueryData(FINANCIAL_DATA_KEY, secondAccount);
  controlled.resolve(financialData("saved-first"));
  await pending;

  assert.equal(client.getQueryData(FINANCIAL_DATA_KEY), secondAccount);
  client.clear();
});

test("an old direct operation cannot repopulate a cleared account cache", async () => {
  const client = new QueryClient();
  client.setQueryData(FINANCIAL_DATA_KEY, financialData("first"));
  const controlled = controlledSave();

  const pending = performFinancialOperation(client, controlled.save);
  client.removeQueries({ queryKey: FINANCIAL_DATA_KEY });
  controlled.resolve(financialData("saved-first"));
  await pending;

  assert.equal(client.getQueryData(FINANCIAL_DATA_KEY), undefined);
  client.clear();
});

test("an old direct-operation failure cannot alter a replaced account cache", async () => {
  const client = new QueryClient();
  const secondAccount = financialData("second");
  client.setQueryData(FINANCIAL_DATA_KEY, financialData("first"));
  const controlled = controlledSave();

  const pending = performFinancialOperation(client, controlled.save);
  client.removeQueries({ queryKey: FINANCIAL_DATA_KEY });
  client.setQueryData(FINANCIAL_DATA_KEY, secondAccount);
  controlled.reject(new Error("first account save failed"));

  await assert.rejects(pending, /first account save failed/);
  assert.equal(client.getQueryData(FINANCIAL_DATA_KEY), secondAccount);
  client.clear();
});

test("a direct operation still publishes when its starting cache is current", async () => {
  const client = new QueryClient();
  client.setQueryData(FINANCIAL_DATA_KEY, financialData("first"));
  const controlled = controlledSave();
  const saved = financialData("saved-first");

  const pending = performFinancialOperation(client, controlled.save);
  controlled.resolve(saved);
  await pending;

  assert.deepEqual(client.getQueryData(FINANCIAL_DATA_KEY), saved);
  client.clear();
});

test("overlapping saves for one account publish their results in completion order", async () => {
  const client = new QueryClient();
  client.setQueryData(FINANCIAL_DATA_KEY, financialData("first"));
  const olderSave = controlledSave();
  const newerSave = controlledSave();
  const olderSaved = financialData("older-saved");
  const newerSaved = financialData("newer-saved");

  const olderPending = performFinancialWrite(
    client,
    (current) => current,
    olderSave.save,
  );
  const newerPending = performFinancialWrite(
    client,
    (current) => current,
    newerSave.save,
  );

  olderSave.resolve(olderSaved);
  await olderPending;
  assert.deepEqual(client.getQueryData(FINANCIAL_DATA_KEY), olderSaved);

  newerSave.resolve(newerSaved);
  await newerPending;
  assert.deepEqual(client.getQueryData(FINANCIAL_DATA_KEY), newerSaved);
  client.clear();
});