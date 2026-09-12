import assert from "node:assert/strict";
import test from "node:test";
import type { ReactElement } from "react";
import {
  BackupDownloadButton,
  CompletePlanDownloadButton,
  createExpenseImportMutationCallbacks,
  runBackupDownload,
  runCompletePlanDownload,
  restoreBackupText,
} from "./data-manager.tsx";
import type { FinancialData } from "../lib/financial-api.ts";

test("authoritative backup restore exposes exact receipt inclusion and omission semantics", async () => {
  const base = {
    investments: [],
    incomeSources: [],
    retirementInputs: {},
    profileInputs: {},
  };
  const deletedReceipt = { id: "deleted-receipt", date: "2026-01-01", amount: 20, category: "Food", merchant: "Cafe", paymentMethod: "Other", reimbursable: false, recurring: false, createdAt: "2026-01-01T00:00:00.000Z" };
  const withReceipt = JSON.stringify({ formatVersion: 2, data: { ...base, expenses: [deletedReceipt], incomeReceipts: [] } });
  const restoredWithReceipt = await restoreBackupText(withReceipt, async (backup) => backup);
  assert.equal(restoredWithReceipt.expenses[0]?.id, "deleted-receipt");

  const beforeReceipt = JSON.stringify({ formatVersion: 2, data: { ...base, expenses: [], incomeReceipts: [] } });
  const restoredBeforeReceipt = await restoreBackupText(beforeReceipt, async (backup) => backup);
  assert.equal(restoredBeforeReceipt.expenses.some((expense) => expense.id === "later-receipt"), false);
  assert.equal(restoredBeforeReceipt.expenses.length, 0);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("imports track one coarse completion only when persistence adds a transaction", () => {
  const tracked: unknown[][] = [];
  const successes: unknown[] = [];
  const callbacks = createExpenseImportMutationCallbacks({
    trackSuccess: (...args) => tracked.push(args),
    onSuccess: (result) => successes.push(result),
    onError: () => assert.fail("successful import must not report an error"),
  });
  const persistedResult = {
    added: [{ id: "private-id", merchant: "Private merchant", note: "Private note" }],
    duplicateCount: 2,
  };

  assert.deepEqual(tracked, []);
  callbacks.onSuccess(persistedResult);

  assert.deepEqual(tracked, [["import"]]);
  assert.deepEqual(successes, [persistedResult]);
});

test("duplicate-only and failed imports emit no completion", () => {
  const tracked: unknown[][] = [];
  let errorCount = 0;
  const callbacks = createExpenseImportMutationCallbacks({
    trackSuccess: (...args) => tracked.push(args),
    onSuccess: () => undefined,
    onError: () => {
      errorCount += 1;
    },
  });

  callbacks.onSuccess({ added: [], duplicateCount: 3 });
  callbacks.onError();

  assert.deepEqual(tracked, []);
  assert.equal(errorCount, 1);
});

test("desktop and mobile backup actions share loading and click wiring", () => {
  const onDownload = () => undefined;
  const desktop = BackupDownloadButton({
    exporting: true,
    onDownload,
  }) as ReactElement<Record<string, any>>;
  const mobile = BackupDownloadButton({
    mobile: true,
    exporting: true,
    onDownload,
  }) as ReactElement<Record<string, any>>;

  for (const action of [desktop, mobile]) {
    assert.equal(action.props.disabled, true);
    assert.equal(action.props.onClick, onDownload);
    assert.equal(action.props.children[1], "Preparing backup...");
  }
  assert.equal(desktop.props.variant, "outline");
  assert.equal(mobile.props.variant, "ghost");
});

test("backup action fetches current data before serialization and completes the browser download", async () => {
  const calls: string[] = [];
  const financialData = { account: "current" } as unknown as FinancialData;
  const link = {
    href: "",
    download: "",
    click: () => calls.push("click"),
  };

  await runBackupDownload({ current: false }, () => undefined, {
    fetchData: async () => {
      calls.push("fetch");
      return financialData;
    },
    serialize: (received) => {
      assert.equal(received, financialData);
      calls.push("serialize");
      return '{"backup":true}';
    },
    createObjectUrl: (blob) => {
      assert.equal(blob.type, "application/json");
      calls.push("create-url");
      return "blob:backup";
    },
    createLink: () => {
      calls.push("create-link");
      return link;
    },
    getDate: () => new Date("2026-09-08T12:00:00.000Z"),
    revokeObjectUrl: (url) => {
      assert.equal(url, "blob:backup");
      calls.push("revoke-url");
    },
    showError: () => assert.fail("success must not show an error"),
  });

  assert.equal(link.href, "blob:backup");
  assert.equal(link.download, "ezyRetire_Backup_2026-09-08.json");
  assert.deepEqual(calls, [
    "fetch",
    "serialize",
    "create-url",
    "create-link",
    "click",
    "revoke-url",
  ]);
});

for (const failure of ["fetch", "download"] as const) {
  test(`${failure} failures show the destructive backup export toast`, async () => {
    const toasts: Array<Record<string, unknown>> = [];
    const revoked: string[] = [];
    const loadingStates: boolean[] = [];

    await runBackupDownload(
      { current: false },
      (exporting) => loadingStates.push(exporting),
      {
      fetchData: async () => {
        if (failure === "fetch") throw new Error("fetch failed");
        return { account: "current" } as unknown as FinancialData;
      },
      serialize: () => "{}",
      createObjectUrl: () => "blob:backup",
      createLink: () => ({
        href: "",
        download: "",
        click: () => {
          throw new Error("download failed");
        },
      }),
      getDate: () => new Date("2026-09-08T12:00:00.000Z"),
      revokeObjectUrl: (url) => revoked.push(url),
      showError: () => toasts.push({
        title: "Export failed",
        variant: "destructive",
      }),
      },
    );

    assert.deepEqual(toasts, [{
      title: "Export failed",
      variant: "destructive",
    }]);
    assert.deepEqual(revoked, failure === "download" ? ["blob:backup"] : []);
    assert.deepEqual(loadingStates, [true, false]);
  });
}

test("backup action blocks repeated requests while preparation is pending", async () => {
  const pendingFetch = deferred<FinancialData>();
  let fetchCount = 0;
  const loadingStates: boolean[] = [];
  const inProgress = { current: false };
  const dependencies = {
    fetchData: () => {
      fetchCount += 1;
      return pendingFetch.promise;
    },
    serialize: () => "{}",
    createObjectUrl: () => "blob:backup",
    createLink: () => ({
      href: "",
      download: "",
      click: () => undefined,
    }),
    getDate: () => new Date("2026-09-08T12:00:00.000Z"),
    revokeObjectUrl: () => undefined,
    showError: () => assert.fail("success must not show an error"),
  };

  const first = runBackupDownload(
    inProgress,
    (exporting) => loadingStates.push(exporting),
    dependencies,
  );
  const second = runBackupDownload(
    inProgress,
    (exporting) => loadingStates.push(exporting),
    dependencies,
  );
  assert.equal(fetchCount, 1);
  assert.deepEqual(loadingStates, [true]);

  pendingFetch.resolve({ account: "current" } as unknown as FinancialData);
  await Promise.all([first, second]);

  assert.equal(inProgress.current, false);
  assert.deepEqual(loadingStates, [true, false]);
});

test("desktop and mobile complete-plan actions share loading and click wiring", () => {
  const onDownload = () => undefined;
  const desktop = CompletePlanDownloadButton({
    exporting: true,
    onDownload,
  }) as ReactElement<Record<string, any>>;
  const mobile = CompletePlanDownloadButton({
    mobile: true,
    exporting: true,
    onDownload,
  }) as ReactElement<Record<string, any>>;

  for (const action of [desktop, mobile]) {
    assert.equal(action.props.disabled, true);
    assert.equal(action.props.onClick, onDownload);
    assert.equal(action.props.children[1], "Preparing plan...");
  }
  assert.equal(desktop.props.variant, "outline");
  assert.equal(mobile.props.variant, "ghost");
});

test("complete-plan action fetches current data before building and downloading", async () => {
  const calls: string[] = [];
  const financialData = { account: "current" } as unknown as FinancialData;
  const sheets = [{ name: "Plan", columns: [], rows: [{}] }];

  await runCompletePlanDownload(
    { current: false },
    (exporting) => calls.push(`loading:${exporting}`),
    {
      fetchData: async () => {
        calls.push("fetch");
        return financialData;
      },
      buildSheets: (received) => {
        assert.equal(received, financialData);
        calls.push("build");
        return sheets;
      },
      downloadWorkbook: (received, slug) => {
        assert.equal(received, sheets);
        assert.equal(slug, "complete_financial_plan");
        calls.push("download");
        return "complete_financial_plan.xlsx";
      },
      showError: () => assert.fail("success must not show an error"),
    },
  );

  assert.deepEqual(calls, [
    "loading:true",
    "fetch",
    "build",
    "download",
    "loading:false",
  ]);
});

test("complete-plan action blocks repeated requests while preparation is pending", async () => {
  const pendingFetch = deferred<FinancialData>();
  let fetchCount = 0;
  const inProgress = { current: false };
  const dependencies = {
    fetchData: () => {
      fetchCount += 1;
      return pendingFetch.promise;
    },
    buildSheets: () => [{ name: "Plan", columns: [], rows: [{}] }],
    downloadWorkbook: () => "complete_financial_plan.xlsx",
    showError: () => assert.fail("success must not show an error"),
  };

  const first = runCompletePlanDownload(inProgress, () => undefined, dependencies);
  const second = runCompletePlanDownload(inProgress, () => undefined, dependencies);
  assert.equal(fetchCount, 1);

  pendingFetch.resolve({ account: "current" } as unknown as FinancialData);
  await Promise.all([first, second]);
});

for (const failure of ["fetch", "workbook"] as const) {
  test(`${failure} failures show the destructive complete-plan error toast`, async () => {
    const toasts: Array<Record<string, unknown>> = [];
    const financialData = { account: "current" } as unknown as FinancialData;

    await runCompletePlanDownload(
      { current: false },
      () => undefined,
      {
        fetchData: async () => {
          if (failure === "fetch") throw new Error("fetch failed");
          return financialData;
        },
        buildSheets: () => {
          if (failure === "workbook") throw new Error("workbook failed");
          return [];
        },
        downloadWorkbook: () => "complete_financial_plan.xlsx",
        showError: () =>
          toasts.push({
            title: "Excel download failed",
            description:
              "We couldn't create the complete financial plan. Please try again.",
            variant: "destructive",
          }),
      },
    );

    assert.deepEqual(toasts, [
      {
        title: "Excel download failed",
        description:
          "We couldn't create the complete financial plan. Please try again.",
        variant: "destructive",
      },
    ]);
  });
}