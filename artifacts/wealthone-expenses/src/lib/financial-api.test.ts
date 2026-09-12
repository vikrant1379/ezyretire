import assert from "node:assert/strict";
import test from "node:test";
import {
  FinancialAccountSwitchError,
  StaleFinancialReplacementError,
  UncertainExternalFinancialMutationError,
  isFinancialAccountSwitchError,
  activateFinancialDataAccount,
  clearFinancialData,
  deleteFinancialExpense,
  emailMonthlyReport,
  enqueueExternalFinancialMutation,
  fetchFinancialData,
  saveFinancialData,
  restoreFinancialData,
  saveMonthlyReport,
  updateFinancialData,
  updateFinancialHealthPlanning,
  updateRetirementPlanning,
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
    const isWrite = init?.method === "PUT" && _path.endsWith("/financial-data");
    if (isWrite) {
      server.writes += 1;
      server.document = JSON.parse(String(init?.body)) as Record<string, unknown>;
    } else if (init?.method === "PATCH" || init?.method === "PUT") {
      server.writes += 1;
      const update = JSON.parse(String(init.body)) as Record<string, unknown>;
      if (_path.endsWith("/health")) {
        const nextSnapshot = update.netWorthSnapshot as Record<string, unknown> | undefined;
        const existing = Array.isArray(server.document.netWorthSnapshots)
          ? server.document.netWorthSnapshots as Array<Record<string, unknown>>
          : [];
        server.document = {
          ...server.document,
          ...(update.emergencyFund ? { emergencyFund: update.emergencyFund } : {}),
          ...(nextSnapshot ? {
            netWorthSnapshots: [
              ...existing.filter((item) => item.month !== nextSnapshot.month),
              nextSnapshot,
            ],
          } : {}),
        };
      } else {
        server.document = { ...server.document, retirementInputs: update };
      }
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

test("provider-confirmed report email with pending bookkeeping remains a successful client result", async () => {
  activateFinancialDataAccount("report-email-pending");
  globalThis.fetch = (async () => new Response(JSON.stringify({
    incomeSources: [],
    expenses: [],
    budgets: [],
    investments: [],
    loans: [],
    monthlyReportEmailFailures: {},
    monthlyReportEmailStatusPendingMonths: ["2026-01"],
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;

  const result = await emailMonthlyReport("report-1");
  assert.deepEqual(result.monthlyReportEmailFailures, {});
  assert.deepEqual(result.monthlyReportEmailStatusPendingMonths, ["2026-01"]);
});

test("monthly report email stays queued ahead of a following financial update", async () => {
  activateFinancialDataAccount("report-email-queue");
  let document: Record<string, unknown> = {
    incomeSources: [],
    expenses: [],
    budgets: [],
    investments: [],
    loans: [],
  };
  const order: string[] = [];
  let releaseEmail!: () => void;
  let markEmailStarted!: () => void;
  const emailGate = new Promise<void>((resolve) => { releaseEmail = resolve; });
  const emailStarted = new Promise<void>((resolve) => { markEmailStarted = resolve; });
  globalThis.fetch = (async (path: string, init?: RequestInit) => {
    if (init?.method === "POST" && path.includes("/monthly-reports/")) {
      order.push("email:start");
      markEmailStarted();
      await emailGate;
      order.push("email:end");
      document = {
        ...document,
        monthlyReportEmailFailures: {},
        monthlyReportEmailStatusPendingMonths: ["2026-01"],
      };
      return new Response(JSON.stringify(document), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (init?.method === "PUT") {
      order.push("save");
      document = JSON.parse(String(init.body)) as Record<string, unknown>;
    }
    return new Response(JSON.stringify(document), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  await fetchFinancialData();
  const email = emailMonthlyReport("report-1");
  await emailStarted;
  const followingSave = updateFinancialData((current) => ({
    ...current,
    uiPreferences: { ...current.uiPreferences, dashboardTourDismissed: true },
  }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(order, ["email:start"]);
  releaseEmail();
  const [, saved] = await Promise.all([email, followingSave]);
  assert.deepEqual(order, ["email:start", "email:end", "save"]);
  assert.equal(saved.uiPreferences.dashboardTourDismissed, true);
  assert.deepEqual(saved.monthlyReportEmailStatusPendingMonths, ["2026-01"]);
});

const addIncome = (name: string) => (current: FinancialData) => ({
  ...current,
  incomeSources: [
    ...current.incomeSources,
    { id: name, name, type: "Salary", frequency: "Monthly", amount: 1000, date: "2026-09-01", recurring: true, createdAt: "2026-09-01T00:00:00.000Z" },
  ] as FinancialData["incomeSources"],
});

const reportSectionIds = [
  "income-vs-expected",
  "expenses-vs-budget-category",
  "savings-amount-rate",
  "portfolio-value-returns-change",
  "net-worth-change",
  "retirement-date-movement",
  "health-score-change",
  "top-next-month-actions",
] as const;

function monthlyReport(
  id: string,
  expenses: FinancialData["expenses"] = [],
): FinancialData["monthlyReports"][number] {
  return {
    id,
    month: id.endsWith("2") ? "2026-02" : "2026-01",
    generatedAt: "2026-02-01T00:00:00.000Z",
    sections: reportSectionIds.map((sectionId) => ({
      id: sectionId,
      title: sectionId,
      metrics: { value: 1 },
      metricFormats: { value: "number" as const },
      actions: ["Review this section"],
    })),
    retirementForecast: {
      modelVersion: 2,
      projectedRetirementMonth: "2050-01",
      projectedRetirementAge: 60,
      asOfDate: "2026-02-01",
      assumptions: {
        targetRetirementAge: 60,
        lifeExpectancy: 85,
        generalInflation: 6,
        salaryGrowth: 8,
        monthlyContribution: 20_000,
        monthlySpending: 50_000,
        portfolioValue: 1_000_000,
        expectedReturn: 10,
      },
      projectionInputs: {
        expenses,
        budgets: [],
        incomes: [],
        investments: [],
        loans: [],
        plannedExpenses: [],
        emergencyFund: { targetMonths: 6, reserveBalance: 100_000, monthlyContribution: 5_000 },
        assumptions: {
          dateOfBirth: "1990-01-01",
          targetRetirementAge: 60,
          lifeExpectancy: 85,
          generalInflation: 6,
          salaryGrowth: 8,
          monthlyContributionOverride: 0,
          investSurplus: false,
        },
      },
      drivers: ["Savings rate"],
    },
  };
}

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

test("ordinary PUT omits server-owned reports without mutating a realistic document", async () => {
  const expenses = Array.from({ length: 200 }, (_, index) => ({
    id: `expense-${index}`,
    date: "2026-01-15",
    amount: 100 + index,
    category: "Food",
    merchant: `Merchant ${index}`,
    paymentMethod: "Credit Card",
    note: `Reviewed household purchase ${index} ${"detail ".repeat(30)}`,
    reimbursable: false,
    recurring: false,
    createdAt: "2026-01-15T12:00:00.000Z",
  })) as FinancialData["expenses"];
  const reports = [monthlyReport("report-1", expenses), monthlyReport("report-2", expenses)];
  const putBodies: string[] = [];
  const initial = {
    incomeSources: [],
    expenses: [],
    budgets: [],
    investments: [],
    loans: [],
    monthlyReports: reports,
  };
  globalThis.fetch = (async (_input, init) => {
    if (init?.method === "PUT") {
      const putBody = String(init.body);
      putBodies.push(putBody);
      return new Response(JSON.stringify({
        ...(JSON.parse(putBody) as Record<string, unknown>),
        monthlyReports: reports,
      }));
    }
    return new Response(JSON.stringify(initial));
  }) as typeof fetch;
  activateFinancialDataAccount("put-size-with-reports");
  const loaded = await fetchFinancialData();
  const caller = { ...loaded, expenses, monthlyReports: reports };
  const callerBefore = structuredClone(caller);
  const saved = await saveFinancialData(caller);
  const updated = await updateFinancialData(addIncome("transport-update"));
  const transports = putBodies.map((body) => JSON.parse(body) as Record<string, unknown>);

  assert.equal(transports.every((transport) => !("monthlyReports" in transport)), true);
  assert.equal(putBodies.every((body) => Buffer.byteLength(body, "utf8") < 100 * 1024), true);
  assert.equal(saved.monthlyReports.length, 2);
  assert.equal(updated.monthlyReports.length, 2);
  assert.equal(saved.monthlyReports[0]?.retirementForecast?.projectionInputs?.expenses.length, 200);
  assert.deepEqual(caller, callerBefore);
});

test("monthly-report POST omits its server-owned forecast without mutating the report", async () => {
  const report = monthlyReport("report-1", [{
    id: "projection-expense",
    date: "2026-01-01",
    amount: 50,
    category: "Food",
    merchant: "Cafe",
    paymentMethod: "Other",
    reimbursable: false,
    recurring: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  }]);
  const before = structuredClone(report);
  let posted: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input, init) => {
    posted = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      incomeSources: [],
      expenses: [],
      budgets: [],
      investments: [],
      loans: [],
      monthlyReports: [report],
    }));
  }) as typeof fetch;
  activateFinancialDataAccount("monthly-report-transport");
  await saveMonthlyReport(report);

  assert.equal("retirementForecast" in (posted ?? {}), false);
  assert.equal(posted?.id, report.id);
  assert.equal(posted?.month, report.month);
  assert.deepEqual(posted?.sections, report.sections);
  assert.deepEqual(report, before);
});

test("expense deletion uses the owner-scoped DELETE and publishes its canonical response without PUT", async () => {
  const calls: Array<{ path: string; method: string }> = [];
  const before = { incomeSources: [], expenses: [{ id: "expense/a" }], budgets: [], investments: [], loans: [] };
  const after = { ...before, expenses: [], incomeSources: [{ id: "canonical-income", name: "Salary", type: "Salary", frequency: "Monthly", amount: 10, date: "2026-01-01", recurring: true, createdAt: "2026-01-01T00:00:00.000Z" }] };
  globalThis.fetch = (async (input, init) => {
    const method = init?.method ?? "GET";
    calls.push({ path: String(input), method });
    return new Response(JSON.stringify(method === "DELETE" ? after : before), { status: 200 });
  }) as typeof fetch;
  activateFinancialDataAccount("delete-expense-contract");
  await fetchFinancialData();
  const saved = await deleteFinancialExpense("expense/a");
  assert.equal(saved.expenses.length, 0);
  assert.equal(saved.incomeSources[0]?.id, "canonical-income");
  assert.deepEqual(calls.find((call) => call.method === "DELETE"), {
    path: "/api/financial-data/expenses/expense%2Fa",
    method: "DELETE",
  });
  assert.equal(calls.some((call) => call.method === "PUT"), false);
});

test("a lost committed expense DELETE reconciles before a queued updater can PUT", async () => {
  const order: string[] = [];
  let document = {
    incomeSources: [],
    expenses: [{ id: "deleted-row" }],
    budgets: [],
    investments: [],
    loans: [],
  } as Record<string, unknown>;
  globalThis.fetch = (async (_input, init) => {
    const method = init?.method ?? "GET";
    order.push(method);
    if (method === "DELETE") {
      document = { ...document, expenses: [] };
      throw new Error("response lost");
    }
    if (method === "PUT") document = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify(document));
  }) as typeof fetch;
  activateFinancialDataAccount("lost-delete-queued-update");
  await fetchFinancialData();

  const deletion = deleteFinancialExpense("deleted-row");
  const update = updateFinancialData(addIncome("after-delete"));
  const error = await deletion.catch((caught) => caught);
  assert.ok(error instanceof UncertainExternalFinancialMutationError);
  assert.equal(error.reconciledData?.expenses.length, 0);
  const saved = await update;

  assert.deepEqual(order, ["GET", "DELETE", "GET", "PUT"]);
  assert.equal(saved.expenses.length, 0);
  assert.equal((document.expenses as unknown[]).length, 0);
});

test("an immediate retry after a lost DELETE retains canonical deletion on retry error", async () => {
  const methods: string[] = [];
  let deleted = false;
  const canonical = () => ({
    incomeSources: [],
    expenses: deleted ? [] : [{ id: "retry-row" }],
    budgets: [],
    investments: [],
    loans: [],
  });
  globalThis.fetch = (async (_input, init) => {
    const method = init?.method ?? "GET";
    methods.push(method);
    if (method === "DELETE") {
      if (!deleted) {
        deleted = true;
        throw new Error("first response lost");
      }
      throw new Error("already deleted");
    }
    return new Response(JSON.stringify(canonical()));
  }) as typeof fetch;
  activateFinancialDataAccount("lost-delete-immediate-retry");
  await fetchFinancialData();

  const first = deleteFinancialExpense("retry-row");
  const retry = deleteFinancialExpense("retry-row");
  const [firstError, retryError] = await Promise.all([
    first.catch((error) => error),
    retry.catch((error) => error),
  ]);

  assert.ok(firstError instanceof UncertainExternalFinancialMutationError);
  assert.equal(firstError.reconciledData?.expenses.length, 0);
  assert.ok(retryError instanceof UncertainExternalFinancialMutationError);
  assert.equal(retryError.reconciledData?.expenses.length, 0);
  assert.equal(methods.includes("PUT"), false);
});

test("failed DELETE reconciliation blocks a following updater until canonical GET succeeds", async () => {
  const order: string[] = [];
  let document = {
    incomeSources: [],
    expenses: [{ id: "blocked-row" }],
    budgets: [],
    investments: [],
    loans: [],
  } as Record<string, unknown>;
  let failReconciliation = true;
  globalThis.fetch = (async (_input, init) => {
    const method = init?.method ?? "GET";
    order.push(method);
    if (method === "DELETE") {
      document = { ...document, expenses: [] };
      throw new Error("response lost");
    }
    if (method === "GET" && order.includes("DELETE") && failReconciliation) {
      failReconciliation = false;
      throw new Error("reconciliation unavailable");
    }
    if (method === "PUT") document = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify(document));
  }) as typeof fetch;
  activateFinancialDataAccount("failed-delete-reconciliation");
  await fetchFinancialData();

  const deletion = deleteFinancialExpense("blocked-row");
  const update = updateFinancialData(addIncome("after-retry"));
  const error = await deletion.catch((caught) => caught);
  assert.ok(error instanceof UncertainExternalFinancialMutationError);
  assert.equal(error.reconciledData, null);
  const saved = await update;

  assert.deepEqual(order, ["GET", "DELETE", "GET", "GET", "PUT"]);
  assert.equal(saved.expenses.length, 0);
});

test("a lost committed clear response reconciles before later writes", async () => {
  const order: string[] = [];
  let document = {
    incomeSources: [],
    expenses: [{ id: "cleared-row" }],
    budgets: [],
    investments: [],
    loans: [],
  } as Record<string, unknown>;
  globalThis.fetch = (async (_input, init) => {
    const method = init?.method ?? "GET";
    order.push(method);
    if (method === "DELETE") {
      document = { incomeSources: [], expenses: [], budgets: [], investments: [], loans: [] };
      throw new Error("clear response lost");
    }
    if (method === "PUT") document = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify(document));
  }) as typeof fetch;
  activateFinancialDataAccount("lost-clear");
  await fetchFinancialData();

  const clearing = clearFinancialData();
  const update = updateFinancialData(addIncome("after-clear"));
  const error = await clearing.catch((caught) => caught);
  assert.ok(error instanceof UncertainExternalFinancialMutationError);
  assert.equal(error.reconciledData?.expenses.length, 0);
  const saved = await update;

  assert.deepEqual(order, ["GET", "DELETE", "GET", "PUT"]);
  assert.equal(saved.expenses.length, 0);
});

test("authoritative backup restore uses POST restore, never PUT, and publishes the canonical response", async () => {
  const calls: Array<{ path: string; method: string }> = [];
  const backupReport = monthlyReport("report-1");
  const backup = { incomeSources: [], expenses: [{ id: "backup-expense" }], budgets: [], investments: [], loans: [], monthlyReports: [backupReport] } as unknown as FinancialData;
  const canonical = { ...backup, expenses: [{ id: "canonical-restored-expense", date: "2026-01-01", amount: 7, category: "Other", merchant: "Store", paymentMethod: "Other", reimbursable: false, recurring: false, createdAt: "2026-01-01T00:00:00.000Z" }] };
  let restoreBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (input, init) => {
    calls.push({ path: String(input), method: init?.method ?? "GET" });
    if (init?.method === "POST") restoreBody = JSON.parse(String(init.body)) as Record<string, unknown>;
    return new Response(JSON.stringify(canonical));
  }) as typeof fetch;
  activateFinancialDataAccount("restore-contract");
  const restored = await restoreFinancialData(backup);
  assert.equal(restored.expenses[0]?.id, "canonical-restored-expense");
  assert.deepEqual(restoreBody?.monthlyReports, [backupReport]);
  assert.deepEqual(calls[0], { path: "/api/financial-data/restore", method: "POST" });
  assert.equal(calls.some((call) => call.method === "PUT"), false);
});

test("large restore stages exact bytes before sending only a small restore reference", async () => {
  const backup = {
    incomeSources: [],
    expenses: [],
    budgets: [],
    investments: [],
    loans: [],
    profileInputs: { fullName: "₹".repeat(1_600_000) },
  } as unknown as FinancialData;
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const canonical = { incomeSources: [], expenses: [], budgets: [], investments: [], loans: [] };
  globalThis.fetch = (async (input, init) => {
    const path = String(input);
    calls.push({ path, init });
    if (path.endsWith("/restore-uploads/request-url")) {
      return new Response(JSON.stringify({
        uploadURL: "https://storage.example/restore",
        objectPath: "private/account/restore.json",
      }));
    }
    if (path === "https://storage.example/restore") return new Response(null, { status: 200 });
    return new Response(JSON.stringify(canonical));
  }) as typeof fetch;
  activateFinancialDataAccount("large-restore-contract");

  await restoreFinancialData(backup);

  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(({ path, init }) => [path, init?.method]), [
    ["/api/financial-data/restore-uploads/request-url", "POST"],
    ["https://storage.example/restore", "PUT"],
    ["/api/financial-data/restore", "POST"],
  ]);
  const serialized = JSON.stringify(backup);
  const size = Buffer.byteLength(serialized, "utf8");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    size,
    contentType: "application/json",
  });
  assert.equal(calls[1]?.init?.body, serialized);
  assert.equal(calls[1]?.init?.credentials, "omit");
  assert.deepEqual(JSON.parse(String(calls[2]?.init?.body)), {
    restoreUpload: { objectPath: "private/account/restore.json", size },
  });
  assert.ok(String(calls[2]?.init?.body).length < 200);
  assert.notEqual(calls[2]?.init?.body, serialized);
});

test("large restore upload failure prevents the canonical restore POST", async () => {
  const backup = {
    incomeSources: [],
    expenses: [],
    budgets: [],
    investments: [],
    loans: [],
    profileInputs: { fullName: "x".repeat(4_600_000) },
  } as unknown as FinancialData;
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    const path = String(input);
    calls.push(path);
    if (path.endsWith("/request-url")) {
      return new Response(JSON.stringify({
        uploadURL: "https://storage.example/failed",
        objectPath: "private/account/failed.json",
      }));
    }
    if (path === "https://storage.example/failed") return new Response(null, { status: 503 });
    return new Response(JSON.stringify({}));
  }) as typeof fetch;
  activateFinancialDataAccount("failed-large-restore");

  await assert.rejects(restoreFinancialData(backup), /backup upload did not complete/i);
  assert.equal(calls.includes("/api/financial-data/restore"), false);
});

test("account switches after a restore URL or upload prevent every later dispatch", async () => {
  const backup = {
    incomeSources: [],
    expenses: [],
    budgets: [],
    investments: [],
    loans: [],
    profileInputs: { fullName: "x".repeat(4_600_000) },
  } as unknown as FinancialData;

  for (const boundary of ["url", "put"] as const) {
    const calls: string[] = [];
    globalThis.fetch = (async (input) => {
      const path = String(input);
      calls.push(path);
      if (path.endsWith("/request-url")) {
        if (boundary === "url") activateFinancialDataAccount(`switched-after-url-${boundary}`);
        return new Response(JSON.stringify({
          uploadURL: "https://storage.example/account-switch",
          objectPath: "private/account/switch.json",
        }));
      }
      if (path === "https://storage.example/account-switch") {
        activateFinancialDataAccount(`switched-after-put-${boundary}`);
        return new Response(null, { status: 200 });
      }
      return new Response(JSON.stringify({}));
    }) as typeof fetch;
    activateFinancialDataAccount(`large-restore-${boundary}`);

    await assert.rejects(restoreFinancialData(backup), FinancialAccountSwitchError);
    assert.equal(calls.includes("/api/financial-data/restore"), false);
    assert.equal(
      calls.includes("https://storage.example/account-switch"),
      boundary === "put",
    );
  }
});

test("account switching prevents restore dispatch and stale canonical publication", async () => {
  let postCalls = 0;
  globalThis.fetch = (async (_input, init) => {
    if (init?.method === "POST") postCalls += 1;
    return new Response(JSON.stringify({ incomeSources: [], expenses: [], budgets: [], investments: [], loans: [] }));
  }) as typeof fetch;
  activateFinancialDataAccount("restore-boundary-first");
  await fetchFinancialData();
  const backup = { incomeSources: [], expenses: [], budgets: [], investments: [], loans: [] } as unknown as FinancialData;
  const blocked = restoreFinancialData(backup);
  activateFinancialDataAccount("restore-boundary-second");
  await assert.rejects(blocked, FinancialAccountSwitchError);
  assert.equal(postCalls, 0);

  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const hasStarted = new Promise<void>((resolve) => { started = resolve; });
  globalThis.fetch = (async (_input, init) => {
    if (init?.method === "POST") { started(); await gate; }
    return new Response(JSON.stringify({ incomeSources: [], expenses: [{ id: "stale-restored" }], budgets: [], investments: [], loans: [] }));
  }) as typeof fetch;
  activateFinancialDataAccount("restore-publish-first");
  const stale = restoreFinancialData(backup);
  await hasStarted;
  activateFinancialDataAccount("restore-publish-second");
  release();
  await assert.rejects(stale, FinancialAccountSwitchError);
});

test("account switching prevents expense delete dispatch at the cached-data microtask boundary", async () => {
  let deleteCalls = 0;
  globalThis.fetch = (async (_input, init) => {
    if (init?.method === "DELETE") deleteCalls += 1;
    return new Response(JSON.stringify({ incomeSources: [], expenses: [], budgets: [], investments: [], loans: [] }));
  }) as typeof fetch;
  activateFinancialDataAccount("delete-boundary-first");
  await fetchFinancialData();
  const pending = deleteFinancialExpense("expense-1");
  queueMicrotask(() => activateFinancialDataAccount("delete-boundary-second"));
  await assert.rejects(pending, FinancialAccountSwitchError);
  assert.equal(deleteCalls, 0);
});

test("an in-flight expense delete cannot publish its canonical response into a switched account", async () => {
  let activeAccount = "first";
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const hasStarted = new Promise<void>((resolve) => { started = resolve; });
  const documents = {
    first: { incomeSources: [], expenses: [{ id: "first-expense" }], budgets: [], investments: [], loans: [] },
    second: { incomeSources: [], expenses: [{ id: "second-expense" }], budgets: [], investments: [], loans: [] },
  };
  globalThis.fetch = (async (_input, init) => {
    const account = activeAccount as keyof typeof documents;
    if (init?.method === "DELETE") {
      started();
      await gate;
      documents.first = { ...documents.first, expenses: [] };
    }
    return new Response(JSON.stringify(documents[account]));
  }) as typeof fetch;
  activateFinancialDataAccount("delete-publish-first");
  await fetchFinancialData();
  const staleDelete = deleteFinancialExpense("first-expense");
  await hasStarted;
  activeAccount = "second";
  activateFinancialDataAccount("delete-publish-second");
  const second = await fetchFinancialData();
  release();
  await assert.rejects(staleDelete, FinancialAccountSwitchError);
  assert.equal(second.expenses[0]?.id, "second-expense");
});

test("a pending external receipt confirmation is queued before the immediately following whole-document save", async () => {
  const server = installFakeServer(0);
  activateFinancialDataAccount("receipt-queue-account");
  await fetchFinancialData();
  let release!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const serverExpense = {
    id: "server-expense-847",
    date: "2026-01-01",
    amount: 125,
    category: "Food",
    merchant: "Cafe",
    paymentMethod: "Other",
    note: "server note",
    reimbursable: false,
    recurring: false,
    createdAt: "2026-01-01T12:00:00.000Z",
  };

  const confirmation = enqueueExternalFinancialMutation(
    async () => {
      markStarted();
      await pending;
      return serverExpense;
    },
    (current, expense) => ({ ...current, expenses: [...current.expenses, expense] }),
  );
  await started;
  const followingSave = updateFinancialData((current) => ({
    ...current,
    uiPreferences: { ...current.uiPreferences, dashboardTourDismissed: true },
  }));
  release();
  await confirmation;
  const saved = await followingSave;

  assert.equal(saved.expenses.some((expense) => expense.id === serverExpense.id), true);
  assert.equal((server.document.expenses as Array<{ id: string }>).some((expense) => expense.id === serverExpense.id), true);
});

test("an account switch at the cached-data dispatch boundary prevents the external mutation from starting", async () => {
  installFakeServer(0);
  activateFinancialDataAccount("external-boundary-first");
  await fetchFinancialData();
  let mutationCalls = 0;
  const pending = enqueueExternalFinancialMutation(
    async () => {
      mutationCalls += 1;
      return "should-not-run";
    },
    (current) => current,
  );
  // enqueueWrite's first microtask starts the task; this next microtask runs
  // after it yields at `await ensureGenerationData`, but before its continuation
  // can cross the external-mutation dispatch boundary.
  queueMicrotask(() => {
    activateFinancialDataAccount("external-boundary-second");
  });
  await assert.rejects(pending, FinancialAccountSwitchError);
  assert.equal(mutationCalls, 0);
});

test("a lost receipt confirmation response reconciles before the queued updater PUT", async () => {
  const server = installFakeServer(0);
  activateFinancialDataAccount("uncertain-receipt");
  await fetchFinancialData();
  const receipt = { id: "server-receipt-1", date: "2026-01-01", amount: 25, category: "Food", merchant: "Cafe", paymentMethod: "Other", reimbursable: false, recurring: false, createdAt: "2026-01-01T00:00:00.000Z" };
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const hasStarted = new Promise<void>((resolve) => { started = resolve; });
  const confirmation = enqueueExternalFinancialMutation(
    async () => {
      started();
      await gate;
      server.document = { ...server.document, expenses: [receipt] };
      throw new Error("confirmation response lost");
    },
    (current) => current,
  );
  await hasStarted;
  const following = updateFinancialData(addIncome("next change"));
  release();
  await assert.rejects(confirmation, UncertainExternalFinancialMutationError);
  const saved = await following;
  assert.equal(saved.expenses.some((expense) => expense.id === receipt.id), true);
  assert.equal((server.document.expenses as Array<{ id: string }>)[0]?.id, receipt.id);
  assert.equal((server.document.incomeSources as Array<{ name: string }>)[0]?.name, "next change");
});

test("a direct replacement queued before uncertain reconciliation is rejected without a PUT", async () => {
  const server = installFakeServer(0);
  activateFinancialDataAccount("stale-replacement");
  const stale = await fetchFinancialData();
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const hasStarted = new Promise<void>((resolve) => { started = resolve; });
  const confirmation = enqueueExternalFinancialMutation(
    async () => { started(); await gate; throw new Error("response lost"); },
    (current) => current,
  );
  await hasStarted;
  const replacement = saveFinancialData(stale);
  release();
  await assert.rejects(confirmation, UncertainExternalFinancialMutationError);
  await assert.rejects(replacement, StaleFinancialReplacementError);
  assert.equal(server.writes, 0);
});

test("failed uncertain reconciliation blocks later updater writes from PUT", async () => {
  let getCount = 0;
  let putCount = 0;
  globalThis.fetch = (async (_path: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      putCount += 1;
      return new Response(JSON.stringify({}), { status: 200 });
    }
    getCount += 1;
    if (getCount > 1) return new Response(JSON.stringify({ error: "reconciliation unavailable" }), { status: 503 });
    return new Response(JSON.stringify({ incomeSources: [], expenses: [], budgets: [], investments: [], loans: [] }), { status: 200 });
  }) as typeof fetch;
  activateFinancialDataAccount("failed-reconciliation");
  await fetchFinancialData();
  await assert.rejects(
    enqueueExternalFinancialMutation(async () => { throw new Error("response lost"); }, (current) => current),
    UncertainExternalFinancialMutationError,
  );
  await assert.rejects(updateFinancialData(addIncome("must not write")), /reconciliation unavailable/);
  assert.equal(putCount, 0);
});

test("financial health planning data is normalized without breaking legacy documents", async () => {
  const server = installFakeServer();
  server.document = {
    incomeSources: [],
    expenses: [],
    budgets: [],
    investments: [],
    loans: [],
    netWorthSnapshots: [
      { month: "2026-07-31", assets: "900000", liabilities: 250000, healthScore: 125 },
      { month: "2026-06", assets: 800000, liabilities: 300000 },
      { month: "invalid", assets: 1, liabilities: 0 },
    ],
    emergencyTargetMonths: "8",
    emergencyReserveBalance: "175000",
    emergencyMonthlyContribution: 12500,
    retirementInputs: {
      lifestyleChoice: "Custom",
      customLifestyleExpense: "70000",
      pensionSources: [{
        name: "Defined benefit",
        amount: "30000",
        startAge: "60",
        escalationRate: "3",
      }],
    },
  };

  const data = await fetchFinancialData();
  assert.deepEqual(data.netWorthSnapshots, [{
    month: "2026-06",
    assets: 800000,
    liabilities: 300000,
    netWorth: 500000,
  }, {
    month: "2026-07",
    assets: 900000,
    liabilities: 250000,
    netWorth: 650000,
    healthScore: 100,
  }]);
  assert.deepEqual(data.emergencyFund, {
    targetMonths: 8,
    reserveBalance: 175000,
    monthlyContribution: 12500,
  });
  assert.equal(data.retirementInputs.lifestyleChoice, "Custom");
  assert.equal(data.retirementInputs.customLifestyleExpense, 70000);
  assert.deepEqual(data.retirementInputs.pensionSources, [{
    id: "pension-1",
    name: "Defined benefit",
    monthlyAmount: 30000,
    startAge: 60,
    annualEscalationRate: 3,
  }]);
});

test("financial health and retirement metadata use narrow planning writes", async () => {
  const server = installFakeServer();
  await fetchFinancialData();

  await updateFinancialHealthPlanning({
    emergencyFund: {
      targetMonths: 6,
      reserveBalance: 60_000,
      monthlyContribution: 5_000,
    },
  });
  await updateFinancialHealthPlanning({
    netWorthSnapshot: {
      month: "2026-09",
      assets: 100_000,
      liabilities: 25_000,
      netWorth: 75_000,
      healthScore: 55,
    },
  });
  await updateRetirementPlanning({
    dateOfBirth: "1990-01-01",
    targetRetirementAge: 60,
    lifeExpectancy: 85,
    generalInflation: 6,
    salaryGrowth: 8,
    lifestyleChoice: "Premium",
    pensionSources: [{
      id: "pension",
      name: "Employer pension",
      monthlyAmount: 12_000,
      startAge: 60,
      annualEscalationRate: 5,
    }],
  });

  assert.equal(server.writes, 3);
  assert.deepEqual(server.document.emergencyFund, {
    targetMonths: 6,
    reserveBalance: 60_000,
    monthlyContribution: 5_000,
  });
  assert.deepEqual(server.document.netWorthSnapshots, [{
    month: "2026-09",
    assets: 100_000,
    liabilities: 25_000,
    netWorth: 75_000,
    healthScore: 55,
  }]);
  assert.equal(
    (server.document.retirementInputs as { lifestyleChoice: string }).lifestyleChoice,
    "Premium",
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

test("a full replacement is serialized before a queued update", async () => {
  const server = installFakeServer(10);
  activateFinancialDataAccount("serialized-replacement");
  const initial = await fetchFinancialData();
  const replacement = {
    ...initial,
    expenses: [{
      id: "restored",
      description: "Restored expense",
      amount: 500,
      category: "Other",
      date: "2026-09-01",
      recurring: false,
      createdAt: "2026-09-01T00:00:00.000Z",
    }],
  } as FinancialData;

  await Promise.all([
    saveFinancialData(replacement),
    updateFinancialData(addIncome("salary")),
  ]);

  assert.equal((server.document.expenses as unknown[]).length, 1);
  assert.equal((server.document.incomeSources as unknown[]).length, 1);
  assert.equal(server.reads, 1, "queued writes should reuse canonical responses");
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

test("a held pre-delete refetch finishes before DELETE and cannot defeat later recovery", async () => {
  const order: string[] = [];
  let document = {
    incomeSources: [],
    expenses: [{ id: "held-read-row" }],
    budgets: [],
    investments: [],
    loans: [],
  } as Record<string, unknown>;
  let releaseRead!: () => void;
  let markReadStarted!: () => void;
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
  let getCount = 0;
  globalThis.fetch = (async (_input, init) => {
    const method = init?.method ?? "GET";
    order.push(method);
    if (method === "GET") {
      getCount += 1;
      if (getCount === 1) {
        const staleSnapshot = document;
        markReadStarted();
        await readGate;
        return new Response(JSON.stringify(staleSnapshot));
      }
      if (getCount === 2) {
        return new Response(JSON.stringify({ error: "recovery unavailable" }), { status: 503 });
      }
      return new Response(JSON.stringify(document));
    }
    if (method === "DELETE") {
      document = { ...document, expenses: [] };
      throw new Error("delete response lost");
    }
    document = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify(document));
  }) as typeof fetch;
  activateFinancialDataAccount("held-read-before-delete");

  const refetch = fetchFinancialData();
  await readStarted;
  const deletion = deleteFinancialExpense("held-read-row");
  const deletionOutcome = deletion.catch((error) => error);
  const updater = updateFinancialData(addIncome("after-held-read"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(order, ["GET"], "DELETE must remain queued behind the held GET");
  releaseRead();

  const staleRead = await refetch;
  assert.equal(staleRead.expenses.length, 1);
  const deleteError = await deletionOutcome;
  assert.ok(deleteError instanceof UncertainExternalFinancialMutationError);
  assert.equal(deleteError.reconciledData, null);
  const saved = await updater;
  assert.deepEqual(order, ["GET", "DELETE", "GET", "GET", "PUT"]);
  assert.equal(saved.expenses.length, 0);
  assert.equal((document.expenses as unknown[]).length, 0);
});

test("a refetch started during lost-response DELETE waits for canonical recovery", async () => {
  const order: string[] = [];
  let document = {
    incomeSources: [],
    expenses: [{ id: "in-flight-delete-row" }],
    budgets: [],
    investments: [],
    loans: [],
  } as Record<string, unknown>;
  let releaseDelete!: () => void;
  let markDeleteStarted!: () => void;
  const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve; });
  const deleteStarted = new Promise<void>((resolve) => { markDeleteStarted = resolve; });
  globalThis.fetch = (async (_input, init) => {
    const method = init?.method ?? "GET";
    order.push(method);
    if (method === "DELETE") {
      markDeleteStarted();
      await deleteGate;
      document = { ...document, expenses: [] };
      throw new Error("delete response lost");
    }
    return new Response(JSON.stringify(document));
  }) as typeof fetch;
  activateFinancialDataAccount("refetch-during-delete");
  await fetchFinancialData();

  const deletion = deleteFinancialExpense("in-flight-delete-row");
  const deletionOutcome = deletion.catch((error) => error);
  await deleteStarted;
  const refetch = fetchFinancialData();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(order, ["GET", "DELETE"]);
  releaseDelete();

  const deleteError = await deletionOutcome;
  assert.ok(deleteError instanceof UncertainExternalFinancialMutationError);
  assert.equal(deleteError.reconciledData?.expenses.length, 0);
  const refreshed = await refetch;
  assert.equal(refreshed.expenses.length, 0);
  assert.deepEqual(order, ["GET", "DELETE", "GET", "GET"]);
});

test("overlapping public GETs remain isolated when the account switches", async () => {
  let account = "first";
  let firstGetCalls = 0;
  let releaseFirst!: () => void;
  let markFirstStarted!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
  globalThis.fetch = (async () => {
    const requestedAccount = account;
    if (requestedAccount === "first") {
      firstGetCalls += 1;
      markFirstStarted();
      await firstGate;
    }
    return new Response(JSON.stringify({
      incomeSources: [],
      expenses: [{ id: `${requestedAccount}-row` }],
      budgets: [],
      investments: [],
      loans: [],
    }));
  }) as typeof fetch;
  activateFinancialDataAccount("overlapping-reads-first");
  const first = fetchFinancialData();
  const queuedFirst = fetchFinancialData();
  await firstStarted;

  account = "second";
  activateFinancialDataAccount("overlapping-reads-second");
  const second = await fetchFinancialData();
  assert.equal(second.expenses[0]?.id, "second-row");
  releaseFirst();

  await assert.rejects(first, FinancialAccountSwitchError);
  await assert.rejects(queuedFirst, FinancialAccountSwitchError);
  assert.equal(firstGetCalls, 1, "the queued stale GET must never dispatch");
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

test("an account switch rejects an in-flight read before an export can use it", async () => {
  let releaseRead!: () => void;
  const readBlocked = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  let readStarted!: () => void;
  const readHasStarted = new Promise<void>((resolve) => {
    readStarted = resolve;
  });

  globalThis.fetch = (async () => {
    readStarted();
    await readBlocked;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        expenses: [{ id: "private-first-account-expense" }],
        budgets: [],
        incomeSources: [],
        investments: [],
        loans: [],
      }),
    } as Response;
  }) as typeof fetch;

  activateFinancialDataAccount("export-first");
  const staleExportRead = fetchFinancialData();
  await readHasStarted;
  activateFinancialDataAccount("export-second");
  releaseRead();

  await assert.rejects(staleExportRead, FinancialAccountSwitchError);
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
