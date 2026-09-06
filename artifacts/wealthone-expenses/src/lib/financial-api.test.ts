import assert from "node:assert/strict";
import test from "node:test";
import {
  FinancialAccountSwitchError,
  isFinancialAccountSwitchError,
  activateFinancialDataAccount,
  clearFinancialData,
  fetchFinancialData,
  updateFinancialData,
  type FinancialData,
} from "./financial-api.ts";

type FakeServer = {
  document: Record<string, unknown>;
  reads: number;
  writes: number;
};

/**
 * Stands in for the API: it keeps one document, the way the real endpoint
 * replaces the whole document on every write.
 */
function installFakeServer(latencyMs = 5): FakeServer {
  const server: FakeServer = {
    document: { incomeSources: [], expenses: [], budgets: [], investments: [], loans: [] },
    reads: 0,
    writes: 0,
  };

  globalThis.fetch = (async (_path: string, init?: RequestInit) => {
    const isWrite = init?.method === "PUT";
    if (isWrite) {
      server.writes += 1;
      server.document = JSON.parse(String(init?.body)) as Record<string, unknown>;
    } else {
      server.reads += 1;
    }
    const snapshot = server.document;
    await new Promise((resolve) => setTimeout(resolve, latencyMs));
    return {
      ok: true,
      status: 200,
      json: async () => snapshot,
    } as Response;
  }) as typeof fetch;

  return server;
}

const addIncome = (name: string) => (current: FinancialData) => ({
  ...current,
  incomeSources: [
    ...current.incomeSources,
    { id: name, name, type: "Salary", frequency: "Monthly", amount: 1000, date: "2026-09-01", recurring: true, createdAt: "2026-09-01T00:00:00.000Z" },
  ] as FinancialData["incomeSources"],
});

test("two saves fired at once do not duplicate or drop an entry", async () => {
  const server = installFakeServer();
  await fetchFinancialData();

  // The double click: both writes start before either has finished.
  const [first, second] = await Promise.all([
    updateFinancialData(addIncome("salary")),
    updateFinancialData(addIncome("bonus")),
  ]);

  assert.equal(first.incomeSources.length, 1);
  assert.equal(second.incomeSources.length, 2);
  assert.deepEqual(
    (server.document.incomeSources as { name: string }[]).map((source) => source.name),
    ["salary", "bonus"],
  );
});

test("submitting the same entry twice stores it twice, never more", async () => {
  const server = installFakeServer();
  await fetchFinancialData();

  await Promise.all([
    updateFinancialData(addIncome("salary")),
    updateFinancialData(addIncome("salary")),
  ]);

  assert.equal((server.document.incomeSources as unknown[]).length, 2);
});

test("a write reuses the document it already knows instead of re-reading it", async () => {
  const server = installFakeServer();
  await fetchFinancialData();
  const readsAfterLoad = server.reads;

  await updateFinancialData(addIncome("salary"));
  await updateFinancialData(addIncome("bonus"));

  assert.equal(server.writes, 2);
  assert.equal(server.reads, readsAfterLoad, "writes should not trigger extra reads");
});

test("a failed write does not stall the writes queued behind it", async () => {
  const server = installFakeServer();
  await fetchFinancialData();

  const failing = updateFinancialData(() => {
    throw new Error("validation failed");
  });
  const following = updateFinancialData(addIncome("salary"));

  await assert.rejects(failing, /validation failed/);
  await following;
  assert.equal((server.document.incomeSources as unknown[]).length, 1);
});

test("an empty successful response reports a clear retryable error", async () => {
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected end of JSON input");
    },
  })) as typeof fetch;

  await assert.rejects(
    fetchFinancialData(),
    /The server returned an empty or invalid financial data response\. Please try again\./,
  );
});

test("a same-account refetch does not interrupt queued saves", async () => {
  const server = installFakeServer(20);
  activateFinancialDataAccount("same-account");
  await fetchFinancialData();

  const firstSave = updateFinancialData(addIncome("salary"));
  const secondSave = updateFinancialData(addIncome("bonus"));
  await fetchFinancialData();
  await Promise.all([firstSave, secondSave]);

  assert.deepEqual(
    (server.document.incomeSources as { name: string }[]).map(({ name }) => name),
    ["salary", "bonus"],
  );
});

test("an account switch isolates a new save from work queued for the prior account", async () => {
  let activeAccount = "first";
  let releaseFirstWrite!: () => void;
  const firstWriteBlocked = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve;
  });
  const documents: Record<string, Record<string, unknown>> = {
    first: { incomeSources: [], expenses: [], budgets: [], investments: [], loans: [] },
    second: { incomeSources: [], expenses: [], budgets: [], investments: [], loans: [] },
  };
  let firstWriteStarted!: () => void;
  const firstWriteHasStarted = new Promise<void>((resolve) => {
    firstWriteStarted = resolve;
  });

  globalThis.fetch = (async (_path: string, init?: RequestInit) => {
    const accountAtRequestStart = activeAccount;
    if (init?.method === "PUT") {
      if (accountAtRequestStart === "first") {
        firstWriteStarted();
        await firstWriteBlocked;
      }
      documents[accountAtRequestStart] = JSON.parse(String(init.body)) as Record<string, unknown>;
    }
    return {
      ok: true,
      status: 200,
      json: async () => documents[accountAtRequestStart],
    } as Response;
  }) as typeof fetch;

  activateFinancialDataAccount("first");
  await fetchFinancialData();
  const firstSave = updateFinancialData(addIncome("first salary"));
  const staleQueuedSave = updateFinancialData(addIncome("stale bonus"));
  await firstWriteHasStarted;

  activeAccount = "second";
  activateFinancialDataAccount("second");
  await fetchFinancialData();
  const secondSave = updateFinancialData(addIncome("second salary"));
  const firstSaveRejected = assert.rejects(
    firstSave,
    (error) => error instanceof FinancialAccountSwitchError && isFinancialAccountSwitchError(error),
  );
  const staleQueuedSaveRejected = assert.rejects(
    staleQueuedSave,
    (error) => error instanceof FinancialAccountSwitchError && isFinancialAccountSwitchError(error),
  );
  releaseFirstWrite();

  await Promise.all([firstSaveRejected, staleQueuedSaveRejected, secondSave]);

  assert.deepEqual(
    (documents.first.incomeSources as { name: string }[]).map(({ name }) => name),
    ["first salary"],
  );
  assert.deepEqual(
    (documents.second.incomeSources as { name: string }[]).map(({ name }) => name),
    ["second salary"],
  );
});

test("an account switch during an initial read prevents the stale write from starting", async () => {
  let activeAccount = "first";
  let releaseFirstRead!: () => void;
  const firstReadBlocked = new Promise<void>((resolve) => {
    releaseFirstRead = resolve;
  });
  let firstReadStarted!: () => void;
  const firstReadHasStarted = new Promise<void>((resolve) => {
    firstReadStarted = resolve;
  });
  const writes = { first: 0, second: 0 };
  const documents: Record<string, Record<string, unknown>> = {
    first: { incomeSources: [], expenses: [], budgets: [], investments: [], loans: [] },
    second: { incomeSources: [], expenses: [], budgets: [], investments: [], loans: [] },
  };

  globalThis.fetch = (async (_path: string, init?: RequestInit) => {
    const accountAtRequestStart = activeAccount as keyof typeof writes;
    if (init?.method === "PUT") {
      writes[accountAtRequestStart] += 1;
      documents[accountAtRequestStart] = JSON.parse(String(init.body)) as Record<string, unknown>;
    } else if (accountAtRequestStart === "first") {
      firstReadStarted();
      await firstReadBlocked;
    }
    return {
      ok: true,
      status: 200,
      json: async () => documents[accountAtRequestStart],
    } as Response;
  }) as typeof fetch;

  activateFinancialDataAccount("first-without-cache");
  const staleSave = updateFinancialData(addIncome("stale salary"));
  await firstReadHasStarted;

  activeAccount = "second";
  activateFinancialDataAccount("second-after-read");
  releaseFirstRead();

  await assert.rejects(staleSave, FinancialAccountSwitchError);
  assert.deepEqual(writes, { first: 0, second: 0 });

  await updateFinancialData(addIncome("second salary"));
  assert.deepEqual(writes, { first: 0, second: 1 });
  assert.deepEqual(
    (documents.second.incomeSources as { name: string }[]).map(({ name }) => name),
    ["second salary"],
  );
});

test("an account switch rejects an in-flight clear without changing the new account", async () => {
  let activeAccount: "first" | "second" = "first";
  let clearStarted!: () => void;
  const clearHasStarted = new Promise<void>((resolve) => {
    clearStarted = resolve;
  });
  let releaseClear!: () => void;
  const clearBlocked = new Promise<void>((resolve) => {
    releaseClear = resolve;
  });
  const documents = {
    first: { incomeSources: [{ name: "first salary" }], expenses: [], budgets: [], investments: [], loans: [] },
    second: { incomeSources: [{ name: "second salary" }], expenses: [], budgets: [], investments: [], loans: [] },
  };

  globalThis.fetch = (async (_path: string, init?: RequestInit) => {
    const accountAtRequestStart = activeAccount;
    if (init?.method === "DELETE") {
      clearStarted();
      await clearBlocked;
      documents[accountAtRequestStart] = {
        incomeSources: [],
        expenses: [],
        budgets: [],
        investments: [],
        loans: [],
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => documents[accountAtRequestStart],
    } as Response;
  }) as typeof fetch;

  activateFinancialDataAccount("first-before-clear");
  const pendingClear = clearFinancialData();
  await clearHasStarted;

  activeAccount = "second";
  activateFinancialDataAccount("second-during-clear");
  releaseClear();

  await assert.rejects(pendingClear, FinancialAccountSwitchError);
  assert.deepEqual(
    documents.second.incomeSources.map(({ name }) => name),
    ["second salary"],
  );
});

test("broker import batches remain identifiable after save and reload", async () => {
  installFakeServer();
  await fetchFinancialData();

  await updateFinancialData((current) => ({
    ...current,
    investments: [{
      id: "investment-1",
      name: "Equity account",
      assetClass: "Direct Equity",
      investedAmount: 1000,
      currentValue: 1200,
      expectedReturn: 10,
      createdAt: "2026-09-05T09:00:00.000Z",
      disposals: [{
        id: "sale-1",
        name: "TCS",
        importBatchId: "batch-123",
        importedAt: "2026-09-05T10:00:00.000Z",
      }],
    }],
  }));

  const reloaded = await fetchFinancialData();
  assert.equal(reloaded.investments[0].disposals?.[0].importBatchId, "batch-123");
  assert.equal(
    reloaded.investments[0].disposals?.[0].importedAt,
    "2026-09-05T10:00:00.000Z",
  );
});
