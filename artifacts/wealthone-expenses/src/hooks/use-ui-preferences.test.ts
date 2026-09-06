import assert from "node:assert/strict";
import test from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import {
  claimAccountSwitchSaveNotice,
  FINANCIAL_DATA_KEY,
  performFinancialOperation,
} from "./use-financial-write.ts";
import { uiPreferenceMutationOptions } from "./use-ui-preferences.ts";
import {
  defaultUiPreferences,
  type UiPreferences,
} from "../lib/card-order.ts";
import {
  FinancialAccountSwitchError,
  fetchFinancialData,
  updateFinancialData,
  type FinancialData,
} from "../lib/financial-api.ts";

type DeferredSave = {
  reject: (error: Error) => void;
  resolve: (data: FinancialData) => void;
  saved: FinancialData;
};

function financialData(preferences: UiPreferences): FinancialData {
  return { uiPreferences: preferences } as FinancialData;
}

function createControlledSaves(initial: FinancialData) {
  const saves: DeferredSave[] = [];
  const savePreferences = (
    updater: (current: FinancialData) => FinancialData,
  ): Promise<FinancialData> =>
    new Promise((resolve, reject) => {
      saves.push({ resolve, reject, saved: updater(initial) });
    });

  return { savePreferences, saves };
}

function preferences(client: QueryClient): UiPreferences {
  const cached = client.getQueryData<FinancialData>(FINANCIAL_DATA_KEY);
  assert.ok(cached);
  return cached.uiPreferences;
}

async function nextMutationTurn() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await nextMutationTurn();
  }
  assert.fail("Timed out waiting for controlled persistence");
}

async function runOverlappingWrites(
  completionOrder: "older-first" | "newer-first",
) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const initial = financialData(defaultUiPreferences());
  client.setQueryData(FINANCIAL_DATA_KEY, initial);
  const { savePreferences, saves } = createControlledSaves(initial);
  const mutation = new MutationObserver(
    client,
    uiPreferenceMutationOptions(client, savePreferences),
  );

  const olderPatch: Partial<UiPreferences> = {
    investmentSort: { by: "current", direction: "desc" },
  };
  const newerPatch: Partial<UiPreferences> = {
    investmentSort: { by: "projected", direction: "asc" },
  };

  const olderResult = mutation.mutate(olderPatch).catch(() => undefined);
  await nextMutationTurn();
  const newerResult = mutation.mutate(newerPatch).catch(() => undefined);
  await nextMutationTurn();

  assert.equal(saves.length, 2);
  assert.deepEqual(preferences(client).investmentSort, newerPatch.investmentSort);

  if (completionOrder === "older-first") {
    saves[0].reject(new Error("older save failed"));
    await olderResult;
    assert.deepEqual(preferences(client).investmentSort, newerPatch.investmentSort);

    saves[1].resolve(saves[1].saved);
    await newerResult;
    assert.deepEqual(preferences(client).investmentSort, newerPatch.investmentSort);
  } else {
    saves[1].reject(new Error("newer save failed"));
    await newerResult;
    assert.deepEqual(preferences(client).investmentSort, olderPatch.investmentSort);

    saves[0].resolve(saves[0].saved);
    await olderResult;
    assert.deepEqual(preferences(client).investmentSort, olderPatch.investmentSort);
  }

  client.clear();
}

test("older failure cannot replace a newer successful sorting choice", async () => {
  await runOverlappingWrites("older-first");
});

test("an older late failure cannot replace or warn after a newer save succeeds", async () => {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const initial = financialData(defaultUiPreferences());
  client.setQueryData(FINANCIAL_DATA_KEY, initial);
  const { savePreferences, saves } = createControlledSaves(initial);
  const descriptions: string[] = [];
  const mutation = new MutationObserver(
    client,
    uiPreferenceMutationOptions(
      client,
      savePreferences,
      (description) => descriptions.push(description),
    ),
  );
  const olderPatch: Partial<UiPreferences> = {
    investmentSort: { by: "current", direction: "desc" },
  };
  const newerPatch: Partial<UiPreferences> = {
    investmentSort: { by: "projected", direction: "asc" },
  };

  const olderResult = mutation.mutate(olderPatch).catch(() => undefined);
  await nextMutationTurn();
  const newerResult = mutation.mutate(newerPatch);
  await nextMutationTurn();

  assert.equal(saves.length, 2);
  saves[1].resolve(saves[1].saved);
  await newerResult;
  assert.deepEqual(preferences(client).investmentSort, newerPatch.investmentSort);

  saves[0].reject(new FinancialAccountSwitchError());
  await olderResult;

  assert.deepEqual(preferences(client).investmentSort, newerPatch.investmentSort);
  assert.deepEqual(descriptions, []);
  client.clear();
});

test("preference writes report account-switch cancellation but not ordinary failures", async () => {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const initial = financialData(defaultUiPreferences());
  client.setQueryData(FINANCIAL_DATA_KEY, initial);
  const descriptions: string[] = [];
  let failure: Error = new Error("network failed");
  const mutation = new MutationObserver(
    client,
    uiPreferenceMutationOptions(
      client,
      async () => {
        throw failure;
      },
      (description) => descriptions.push(description),
    ),
  );

  await assert.rejects(
    mutation.mutate({ investmentSort: { by: "current", direction: "desc" } }),
    /network failed/,
  );
  assert.deepEqual(descriptions, []);

  failure = new FinancialAccountSwitchError();
  await assert.rejects(
    mutation.mutate({ investmentSort: { by: "projected", direction: "asc" } }),
    FinancialAccountSwitchError,
  );
  assert.deepEqual(descriptions, [
    "Your account changed before this could be saved. Switch to the correct account and try again.",
  ]);
  client.clear();
});

test("interrupted financial and preference changes share one retry notice", async () => {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const firstAccount = {
    ...financialData(defaultUiPreferences()),
    account: "first",
  } as FinancialData;
  const secondAccountPreferences: UiPreferences = {
    ...defaultUiPreferences(),
    loanSort: { by: "interest", direction: "asc" },
  };
  const secondAccount = {
    ...financialData(secondAccountPreferences),
    account: "second",
  } as FinancialData;
  client.setQueryData(FINANCIAL_DATA_KEY, firstAccount);

  let rejectFinancial!: (error: Error) => void;
  const financialPending = performFinancialOperation(
    client,
    () =>
      new Promise<FinancialData>((_resolve, reject) => {
        rejectFinancial = reject;
      }),
  ).catch((error) => {
    if (
      error instanceof FinancialAccountSwitchError &&
      claimAccountSwitchSaveNotice(client)
    ) {
      notices.push("retry");
    }
  });

  const { savePreferences, saves } = createControlledSaves(firstAccount);
  const notices: string[] = [];
  const mutation = new MutationObserver(
    client,
    uiPreferenceMutationOptions(client, savePreferences, () => {
      notices.push("retry");
    }),
  );
  const preferencePending = mutation
    .mutate({ investmentSort: { by: "current", direction: "desc" } })
    .then(() => notices.push("success"))
    .catch(() => undefined);
  await nextMutationTurn();
  assert.equal(saves.length, 1);

  client.removeQueries({ queryKey: FINANCIAL_DATA_KEY });
  client.setQueryData(FINANCIAL_DATA_KEY, secondAccount);
  rejectFinancial(new FinancialAccountSwitchError());
  saves[0].reject(new FinancialAccountSwitchError());
  await Promise.all([financialPending, preferencePending]);

  assert.equal(client.getQueryData(FINANCIAL_DATA_KEY), secondAccount);
  assert.deepEqual(preferences(client), secondAccountPreferences);
  assert.deepEqual(notices, ["retry"]);
  client.clear();
});

test("older success cannot replace the rollback from a newer failure", async () => {
  await runOverlappingWrites("newer-first");
});

test("a pending write cannot publish after the active account cache is replaced", async () => {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const firstAccount = financialData(defaultUiPreferences());
  client.setQueryData(FINANCIAL_DATA_KEY, firstAccount);
  const { savePreferences, saves } = createControlledSaves(firstAccount);
  const mutation = new MutationObserver(
    client,
    uiPreferenceMutationOptions(client, savePreferences),
  );
  const firstAccountPatch: Partial<UiPreferences> = {
    investmentSort: { by: "current", direction: "desc" },
  };
  const secondAccountPreferences: UiPreferences = {
    ...defaultUiPreferences(),
    investmentSort: { by: "projected", direction: "asc" },
  };

  const oldResult = mutation.mutate(firstAccountPatch);
  await nextMutationTurn();
  assert.equal(saves.length, 1);

  client.removeQueries({ queryKey: FINANCIAL_DATA_KEY });
  client.setQueryData(
    FINANCIAL_DATA_KEY,
    financialData(secondAccountPreferences),
  );

  saves[0].resolve(saves[0].saved);
  await oldResult;

  assert.deepEqual(
    preferences(client),
    secondAccountPreferences,
    "the completed write from the signed-out account must not publish",
  );
  client.clear();
});

test("a pending write cannot roll back after the active account cache is replaced", async () => {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const firstAccount = financialData(defaultUiPreferences());
  client.setQueryData(FINANCIAL_DATA_KEY, firstAccount);
  const { savePreferences, saves } = createControlledSaves(firstAccount);
  const mutation = new MutationObserver(
    client,
    uiPreferenceMutationOptions(client, savePreferences),
  );
  const secondAccountPreferences: UiPreferences = {
    ...defaultUiPreferences(),
    loanSort: { by: "interest", direction: "asc" },
  };

  const oldResult = mutation
    .mutate({ investmentSort: { by: "current", direction: "desc" } })
    .catch(() => undefined);
  await nextMutationTurn();
  assert.equal(saves.length, 1);

  client.removeQueries({ queryKey: FINANCIAL_DATA_KEY });
  client.setQueryData(
    FINANCIAL_DATA_KEY,
    financialData(secondAccountPreferences),
  );

  saves[0].reject(new Error("signed-out account save failed"));
  await oldResult;

  assert.deepEqual(
    preferences(client),
    secondAccountPreferences,
    "the failed write from the signed-out account must not roll back",
  );
  client.clear();
});

test("three overlapping saves keep the newest valid sorting choice", async () => {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const initial = financialData(defaultUiPreferences());
  client.setQueryData(FINANCIAL_DATA_KEY, initial);
  const { savePreferences, saves } = createControlledSaves(initial);
  const mutation = new MutationObserver(
    client,
    uiPreferenceMutationOptions(client, savePreferences),
  );

  const oldestPatch: Partial<UiPreferences> = {
    investmentSort: { by: "invested", direction: "desc" },
  };
  const middlePatch: Partial<UiPreferences> = {
    investmentSort: { by: "current", direction: "desc" },
  };
  const newestPatch: Partial<UiPreferences> = {
    investmentSort: { by: "projected", direction: "asc" },
  };

  const oldestResult = mutation.mutate(oldestPatch).catch(() => undefined);
  await nextMutationTurn();
  const middleResult = mutation.mutate(middlePatch).catch(() => undefined);
  await nextMutationTurn();
  const newestResult = mutation.mutate(newestPatch).catch(() => undefined);
  await nextMutationTurn();

  assert.equal(saves.length, 3);
  assert.deepEqual(preferences(client).investmentSort, newestPatch.investmentSort);

  saves[1].resolve(saves[1].saved);
  await middleResult;
  assert.deepEqual(preferences(client).investmentSort, newestPatch.investmentSort);

  saves[0].reject(new Error("oldest save failed"));
  await oldestResult;
  assert.deepEqual(preferences(client).investmentSort, newestPatch.investmentSort);

  saves[2].reject(new Error("newest save failed"));
  await newestResult;
  assert.deepEqual(preferences(client).investmentSort, middlePatch.investmentSort);

  client.clear();
});

test("background refetch cannot replace rapid pending preference changes", async () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const initial = financialData(defaultUiPreferences());
  client.setQueryData(FINANCIAL_DATA_KEY, initial);
  const { savePreferences, saves } = createControlledSaves(initial);
  const mutation = new MutationObserver(
    client,
    uiPreferenceMutationOptions(client, savePreferences),
  );
  let resolveRefetch!: (data: FinancialData) => void;
  const refetch = client.fetchQuery({
    queryKey: FINANCIAL_DATA_KEY,
    queryFn: () =>
      new Promise<FinancialData>((resolve) => {
        resolveRefetch = resolve;
      }),
  });
  await nextMutationTurn();

  const oldestPatch: Partial<UiPreferences> = {
    investmentSort: { by: "invested", direction: "desc" },
  };
  const middlePatch: Partial<UiPreferences> = {
    investmentSort: { by: "current", direction: "desc" },
  };
  const newestPatch: Partial<UiPreferences> = {
    investmentSort: { by: "projected", direction: "asc" },
  };

  const oldestResult = mutation.mutate(oldestPatch).catch(() => undefined);
  await nextMutationTurn();
  const middleResult = mutation.mutate(middlePatch).catch(() => undefined);
  await nextMutationTurn();
  const newestResult = mutation.mutate(newestPatch).catch(() => undefined);
  await nextMutationTurn();

  assert.equal(saves.length, 3);
  assert.deepEqual(preferences(client).investmentSort, newestPatch.investmentSort);

  resolveRefetch(initial);
  await refetch;
  assert.deepEqual(
    preferences(client).investmentSort,
    newestPatch.investmentSort,
    "a canceled stale refetch must not publish over the newest optimistic choice",
  );

  saves[1].resolve(saves[1].saved);
  await middleResult;
  assert.deepEqual(preferences(client).investmentSort, newestPatch.investmentSort);

  saves[0].reject(new Error("oldest save failed"));
  await oldestResult;
  assert.deepEqual(preferences(client).investmentSort, newestPatch.investmentSort);

  saves[2].reject(new Error("newest save failed"));
  await newestResult;
  assert.deepEqual(preferences(client).investmentSort, middlePatch.investmentSort);

  client.clear();
});

test("rapid changes to different preferences survive queued whole-document writes", async () => {
  const originalFetch = globalThis.fetch;
  const initial = financialData(defaultUiPreferences());
  const writes: Array<{
    body: FinancialData;
    resolve: (response: Response) => void;
  }> = [];

  globalThis.fetch = (async (_path: string, init?: RequestInit) => {
    if (init?.method !== "PUT") {
      return {
        ok: true,
        status: 200,
        json: async () => initial,
      } as Response;
    }

    const body = JSON.parse(String(init.body)) as FinancialData;
    return await new Promise<Response>((resolve) => {
      writes.push({ body, resolve });
    });
  }) as typeof fetch;

  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });

  try {
    const loaded = await fetchFinancialData();
    client.setQueryData(FINANCIAL_DATA_KEY, loaded);
    const mutation = new MutationObserver(
      client,
      uiPreferenceMutationOptions(client, updateFinancialData),
    );
    const investmentPatch: Partial<UiPreferences> = {
      investmentSort: { by: "current", direction: "desc" },
    };
    const loanPatch: Partial<UiPreferences> = {
      loanSort: { by: "interest", direction: "asc" },
    };
    let firstCompleted = false;
    let secondCompleted = false;

    const firstResult = mutation.mutate(investmentPatch).then(() => {
      firstCompleted = true;
    });
    await waitFor(() => writes.length === 1);
    const secondResult = mutation.mutate(loanPatch).then(() => {
      secondCompleted = true;
    });
    await nextMutationTurn();

    assert.equal(writes.length, 1, "the second whole-document write must remain queued");
    assert.deepEqual(preferences(client).investmentSort, investmentPatch.investmentSort);
    assert.deepEqual(preferences(client).loanSort, loanPatch.loanSort);

    writes[0].resolve({
      ok: true,
      status: 200,
      json: async () => writes[0].body,
    } as Response);
    await firstResult;
    await waitFor(() => writes.length === 2);

    assert.equal(firstCompleted, true);
    assert.equal(secondCompleted, false, "the queued request must not complete with the first");
    assert.deepEqual(writes[1].body.uiPreferences.investmentSort, investmentPatch.investmentSort);
    assert.deepEqual(writes[1].body.uiPreferences.loanSort, loanPatch.loanSort);

    writes[1].resolve({
      ok: true,
      status: 200,
      json: async () => writes[1].body,
    } as Response);
    await secondResult;

    assert.equal(secondCompleted, true);
    assert.deepEqual(preferences(client).investmentSort, investmentPatch.investmentSort);
    assert.deepEqual(preferences(client).loanSort, loanPatch.loanSort);
    assert.deepEqual(writes[1].body.uiPreferences, preferences(client));
  } finally {
    client.clear();
    globalThis.fetch = originalFetch;
  }
});