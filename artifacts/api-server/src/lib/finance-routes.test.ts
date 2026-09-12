import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  budgetsTable,
  db,
  expensesTable,
  bankStatementImportProvenanceTable,
  financialAccountsTable,
  premiumEntitlementsTable,
  salaryDetailsTable,
  userProfilesTable,
  usersTable,
  vaultDeletionJobsTable,
  vaultUploadGrantsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import express, { type Request } from "express";
import financeRouter from "../routes/finance.js";
import { setMonthlyReportDeliveryMarkerForTests } from "../routes/finance.js";
import premiumToolsRouter from "../routes/premium-tools.js";
import {
  setPromotedVaultObjectAssertionForTests,
  setVaultFileForTests,
  setVaultObjectAssertionForTests,
  setVaultObjectDeletionForTests,
  setVaultObjectPromotionForTests,
} from "./object-storage.js";
import { runVaultDeletionMaintenance } from "../routes/premium-tools.js";
import {
  FinancialSaveSizeLimitError,
  financialSaveMutationDocument,
  importBankStatementExpenses,
  loadFinancialData,
  managePlanningCategory,
  restoreFinancialData,
  saveFinancialData,
  updateFinancialHealthPlanning,
  updatePlanningFeatures,
  updateRetirementPlanning,
} from "./finance-store.js";
import {
  FINANCIAL_DOCUMENT_ADMISSION_JSON_LIMIT,
  FINANCIAL_SAVE_JSON_LIMIT,
} from "./request-limits.js";

test("canonical mutator inventory requires shared admission enforcement", async () => {
  const source = await readFile(
    new URL("src/lib/finance-store.ts", `file://${process.cwd()}/`),
    "utf8",
  );
  for (const name of [
    "importBankStatementExpenses",
    "managePlanningCategory",
    "updateFinancialHealthPlanning",
    "updatePlanningFeatures",
    "updateRetirementPlanning",
    "saveFinancialData",
    "clearFinancialData",
    "deleteFinancialExpense",
  ]) {
    const start = source.indexOf(`export async function ${name}`);
    assert.notEqual(start, -1, `${name} must remain in the canonical mutator inventory`);
    const next = source.indexOf("\nexport async function ", start + 1);
    const body = source.slice(start, next === -1 ? undefined : next);
    assert.match(
      body,
      /assertCanonicalMutationAdmission/,
      `${name} must enforce or delegate to shared canonical admission`,
    );
  }
  const restoreStart = source.indexOf("export async function restoreFinancialData");
  const restoreEnd = source.indexOf("\nexport async function ", restoreStart + 1);
  assert.match(source.slice(restoreStart, restoreEnd), /saveFinancialData\(/);
  const receiptSource = await readFile(
    new URL("src/routes/premium-tools.ts", `file://${process.cwd()}/`),
    "utf8",
  );
  const receiptConfirmationStart = receiptSource.indexOf(
    'router.post("/receipts/reviews/:id/confirm"',
  );
  assert.notEqual(
    receiptConfirmationStart,
    -1,
    "receipt confirmation must remain in the canonical mutator inventory",
  );
  const nextReceiptRoute = receiptSource.indexOf("\nrouter.", receiptConfirmationStart + 1);
  const receiptConfirmation = receiptSource.slice(
    receiptConfirmationStart,
    nextReceiptRoute === -1 ? undefined : nextReceiptRoute,
  );
  assert.match(
    receiptConfirmation,
    /assertCanonicalMutationAdmission\s*\(\s*tx\s*,\s*financialUser\s*,\s*admissionBaseline(?:\s*,|\s*\))/,
    "receipt confirmation must invoke shared canonical admission with its transaction baseline",
  );
});

test("bank statement import API boundaries", async (t) => {
  const suffix = `${process.pid}-${Date.now()}`;
  const premiumId = `bank-premium-${suffix}`;
  const otherId = `bank-other-${suffix}`;
  const freeId = `bank-free-${suffix}`;
  for (const [id, name] of [[premiumId, "Premium"], [otherId, "Other"], [freeId, "Free"]]) {
    await db.insert(usersTable).values({ id, email: `${id}@example.test`, fullName: name });
  }
  await db.insert(premiumEntitlementsTable).values({
    userId: premiumId, active: true, plan: "premium",
  });
  const existingDate = "2026-02-01";
  await db.insert(expensesTable).values([
    {
      id: `other-existing-${suffix}`, userId: otherId, date: existingDate,
      amount: "125.00", category: "Food & Dining", merchant: "Scoped Cafe",
      paymentMethod: "Bank transfer", note: "", reimbursable: false, recurring: false,
    },
    {
      id: `premium-existing-${suffix}`, userId: premiumId, date: "2026-02-02",
      amount: "75.00", category: "Shopping", merchant: "Existing Shop",
      paymentMethod: "Bank transfer", note: "", reimbursable: false, recurring: false,
    },
  ]);
  await db.insert(bankStatementImportProvenanceTable).values({
    userId: premiumId, importId: "a".repeat(64), sourceRowId: "3",
    bank: "HDFC", parserVersion: "hdfc-v1-csv", expenseId: `premium-existing-${suffix}`,
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.header("x-test-user");
    req.isAuthenticated = (() => Boolean(id)) as Request["isAuthenticated"];
    if (id) req.user = { id, email: `${id}@example.test`, isAdmin: false } as Express.User;
    next();
  });
  app.use("/api", financeRouter);
  const server = app.listen(0);
  const headers = (id?: string) => ({
    "content-type": "application/json",
    ...(id ? { "x-test-user": id } : {}),
  });
  const row = {
    importId: "a".repeat(64), sourceRowId: "1", bank: "HDFC", parserVersion: "hdfc-v1-csv",
    date: existingDate, amount: 125, category: "Food & Dining",
    merchant: "Scoped Cafe", paymentMethod: "Bank transfer",
    note: "reviewed", reimbursable: false, recurring: false,
  };
  const importBody = (rows: unknown[], expectedAccountId = premiumId) => ({
    expectedAccountId,
    rows,
  });
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/api/financial-data/bank-statement-import`;

    await t.test("rejects unauthenticated requests", async () => {
      assert.equal((await fetch(url, {
        method: "POST", headers: headers(), body: JSON.stringify(importBody([row])),
      })).status, 401);
    });
    await t.test("rejects inactive and non-premium accounts", async () => {
      assert.equal((await fetch(url, {
        method: "POST", headers: headers(freeId), body: JSON.stringify(importBody([row], freeId)),
      })).status, 403);
    });
    await t.test("rejects malformed reviewed rows", async () => {
      assert.equal((await fetch(url, {
        method: "POST", headers: headers(premiumId),
        body: JSON.stringify(importBody([{ ...row, amount: -1 }])),
      })).status, 400);
    });
    await t.test("rejects a review bound to another account before saving any rows", async () => {
      const staleMerchant = `Stale account A ${suffix}`;
      const response = await fetch(url, {
        method: "POST", headers: headers(otherId),
        body: JSON.stringify(importBody([{ ...row, merchant: staleMerchant }], premiumId)),
      });
      assert.equal(response.status, 409);
      const saved = await db.select().from(expensesTable).where(and(
        eq(expensesTable.userId, otherId),
        eq(expensesTable.merchant, staleMerchant),
      ));
      assert.equal(saved.length, 0);
    });
    await t.test("accepts expense storage text boundaries", async () => {
      const response = await fetch(url, {
        method: "POST", headers: headers(premiumId),
        body: JSON.stringify(importBody([{
          ...row,
          importId: "c".repeat(64),
          sourceRowId: "text-boundaries",
          merchant: "M".repeat(160),
          category: "C".repeat(80),
          paymentMethod: "P".repeat(80),
          note: "N".repeat(2_000),
        }])),
      });
      assert.equal(response.status, 200);
    });
    await t.test("rejects every text field one character beyond its limit before storage", async () => {
      for (const [field, value, message] of [
        ["merchant", "M".repeat(161), "merchant must be at most 160 characters"],
        ["category", "C".repeat(81), "category must be at most 80 characters"],
        ["paymentMethod", "P".repeat(81), "payment method must be at most 80 characters"],
        ["note", "N".repeat(2_001), "note must be at most 2000 characters"],
      ] as const) {
        const response = await fetch(url, {
          method: "POST", headers: headers(premiumId),
          body: JSON.stringify(importBody([{ ...row, [field]: value }])),
        });
        assert.equal(response.status, 400, field);
        const body = await response.json() as { error: string };
        assert.match(body.error, new RegExp(message), field);
      }
    });
    await t.test("isolates accounts and deduplicates request and existing rows", async () => {
      const firstResponse = await fetch(url, {
        method: "POST", headers: headers(premiumId),
        body: JSON.stringify(importBody([row, { ...row, sourceRowId: "2" }, { ...row, date: "2026-02-02", amount: 75, merchant: "Existing Shop", sourceRowId: "3" }])),
      });
      assert.equal(firstResponse.status, 200);
      assert.match(firstResponse.headers.get("content-type") ?? "", /application\/json/);
      const first = await firstResponse.json() as {
        added: Array<{ id: string; userId?: string }>;
        duplicateCount: number;
        data: { expenses: Array<{ merchant: string }> };
      };
      assert.equal(first.added.length, 2, "distinct source rows with identical purchase fields must both save");
      assert.equal(first.duplicateCount, 1);
      assert.equal(first.added[0]?.userId, premiumId);
      assert.ok(first.data.expenses.some((expense) => expense.merchant === "Scoped Cafe"));
      const premiumRows = await db.select().from(expensesTable).where(eq(expensesTable.userId, premiumId));
      const otherRows = await db.select().from(expensesTable).where(eq(expensesTable.userId, otherId));
      assert.equal(premiumRows.filter((expense) => expense.merchant === "Scoped Cafe").length, 2);
      assert.equal(otherRows.filter((expense) => expense.merchant === "Scoped Cafe").length, 1);
    });
    await t.test("keeps import provenance through a full save only while the expense remains", async () => {
      const savedRow = {
        ...row,
        importId: "b".repeat(64),
        sourceRowId: "full-save-row",
        merchant: "Full Save Cafe",
      };
      const importedResponse = await fetch(url, {
        method: "POST",
        headers: headers(premiumId),
        body: JSON.stringify(importBody([savedRow])),
      });
      assert.equal(importedResponse.status, 200);
      const imported = await importedResponse.json() as {
        added: Array<{ id: string }>;
        data: Record<string, unknown> & {
          expenses: Array<{ id: string; merchant: string }>;
          emergencyFund: Record<string, unknown>;
        };
      };
      assert.equal(imported.added.length, 1);
      const importedExpenseId = imported.added[0]?.id;
      assert.ok(importedExpenseId);

      const fullSaveResponse = await fetch(`http://127.0.0.1:${port}/api/financial-data`, {
        method: "PUT",
        headers: headers(premiumId),
        body: JSON.stringify({
          ...imported.data,
          emergencyFund: { ...imported.data.emergencyFund, monthlyContribution: 321 },
        }),
      });
      assert.equal(fullSaveResponse.status, 200);

      const retryResponse = await fetch(url, {
        method: "POST",
        headers: headers(premiumId),
        body: JSON.stringify(importBody([savedRow])),
      });
      assert.equal(retryResponse.status, 200);
      const retry = await retryResponse.json() as {
        added: unknown[];
        duplicateCount: number;
        data: { expenses: Array<{ id: string; merchant: string }> };
      };
      assert.equal(retry.added.length, 0);
      assert.equal(retry.duplicateCount, 1);
      assert.equal(
        retry.data.expenses.filter((expense) => expense.merchant === savedRow.merchant).length,
        1,
      );

      const removeResponse = await fetch(`http://127.0.0.1:${port}/api/financial-data`, {
        method: "PUT",
        headers: headers(premiumId),
        body: JSON.stringify({
          ...retry.data,
          expenses: retry.data.expenses.filter(({ id }) => id !== importedExpenseId),
        }),
      });
      assert.equal(removeResponse.status, 200);
      const removedProvenance = await db.select()
        .from(bankStatementImportProvenanceTable)
        .where(and(
          eq(bankStatementImportProvenanceTable.userId, premiumId),
          eq(bankStatementImportProvenanceTable.importId, savedRow.importId),
          eq(bankStatementImportProvenanceTable.sourceRowId, savedRow.sourceRowId),
        ));
      assert.equal(removedProvenance.length, 0);
    });
    await t.test("makes retries idempotent and returns parseable canonical JSON", async () => {
      const retryResponse = await fetch(url, {
        method: "POST", headers: headers(premiumId), body: JSON.stringify(importBody([row, row])),
      });
      assert.equal(retryResponse.status, 200);
      assert.match(retryResponse.headers.get("content-type") ?? "", /application\/json/);
      const retry = await retryResponse.json() as { added: unknown[]; duplicateCount: number; data: { expenses: unknown[] } };
      assert.equal(retry.added.length, 0);
      assert.equal(retry.duplicateCount, 2);
      assert.ok(Array.isArray(retry.data.expenses));
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(expensesTable).where(inArray(expensesTable.userId, [premiumId, otherId, freeId]));
    await db.delete(premiumEntitlementsTable).where(eq(premiumEntitlementsTable.userId, premiumId));
    await db.delete(usersTable).where(inArray(usersTable.id, [premiumId, otherId, freeId]));
  }
});

test("cumulative bank imports cannot strand the canonical full-save document", async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const userId = `bank-cumulative-${suffix}`;
  const userValues = {
    id: userId,
    email: `${userId}@example.test`,
    fullName: "Cumulative Import",
  };
  const [user] = await db.insert(usersTable).values(userValues).returning();
  const makeRows = (importId: string, prefix: string) => Array.from(
    { length: 180 },
    (_, index) => ({
      importId,
      sourceRowId: `${prefix}-${index}`,
      bank: "HDFC",
      parserVersion: "hdfc-v1-csv",
      date: "2026-09-10",
      amount: 100 + index,
      category: "Food & Dining",
      merchant: `${prefix} merchant ${index} ${"purchase detail ".repeat(5)}`,
      paymentMethod: "Bank transfer",
      note: "A reviewed statement entry with enough detail to exercise cumulative bytes. ".repeat(12),
      reimbursable: false,
      recurring: false,
    }),
  );
  const firstRows = makeRows("c".repeat(64), "first");
  const secondRows = makeRows("d".repeat(64), "second");

  try {
    const first = await importBankStatementExpenses(user, firstRows);
    assert.equal(first.added.length, firstRows.length);
    const focusedLimit = Buffer.byteLength(JSON.stringify(
      financialSaveMutationDocument(first.data),
    ));
    const {
      monthlyReports: _immediateReports,
      ...actualImmediateClientProjection
    } = first.data;
    const {
      pushSubscriptions: _normalizedPushSubscriptions,
      ...normalizedClientSections
    } = actualImmediateClientProjection;
    const actualReloadedClientProjection = {
      ...normalizedClientSections,
      retirementInputs: {
        ...normalizedClientSections.retirementInputs,
        monthlyContributionOverride:
          normalizedClientSections.retirementInputs.monthlyContributionOverride ?? 0,
      },
    };
    assert.ok(
      Buffer.byteLength(JSON.stringify(actualImmediateClientProjection)) <= focusedLimit,
    );
    assert.ok(
      Buffer.byteLength(JSON.stringify(actualReloadedClientProjection)) <= focusedLimit,
    );

    await assert.rejects(
      importBankStatementExpenses(user, secondRows, focusedLimit),
      (error: unknown) => {
        assert.ok(error instanceof FinancialSaveSizeLimitError);
        assert.equal(error.code, "FINANCIAL_SAVE_SIZE_LIMIT");
        assert.ok(error.actualBytes > focusedLimit);
        return true;
      },
    );
    const rejectedExpenses = await db.select().from(expensesTable).where(and(
      eq(expensesTable.userId, userId),
      inArray(expensesTable.merchant, secondRows.map(({ merchant }) => merchant)),
    ));
    const rejectedProvenance = await db.select()
      .from(bankStatementImportProvenanceTable)
      .where(and(
        eq(bankStatementImportProvenanceTable.userId, userId),
        eq(bankStatementImportProvenanceTable.importId, "d".repeat(64)),
      ));
    assert.equal(rejectedExpenses.length, 0);
    assert.equal(rejectedProvenance.length, 0);

    const app = express();
    app.use(express.json({ limit: "4mb" }));
    app.use((req, _res, next) => {
      req.isAuthenticated = (() => true) as Request["isAuthenticated"];
      req.user = { ...userValues, isAdmin: false } as Express.User;
      next();
    });
    app.use("/api", financeRouter);
    const server = app.listen(0);
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const { port } = server.address() as AddressInfo;
      const base = `http://127.0.0.1:${port}/api/financial-data`;
      const { monthlyReports: _reports, ...transportDocument } = first.data;
      const save = await fetch(base, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...transportDocument,
          emergencyFund: {
            ...transportDocument.emergencyFund,
            monthlyContribution: 1,
          },
        }),
      });
      assert.equal(save.status, 200);
      const reload = await fetch(base);
      assert.equal(reload.status, 200);
      const reloaded = await reload.json() as {
        expenses: unknown[];
        emergencyFund: { monthlyContribution: number };
      };
      assert.equal(reloaded.expenses.length, firstRows.length);
      assert.equal(reloaded.emergencyFund.monthlyContribution, 1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve()));
    }

    const retry = await importBankStatementExpenses(user, firstRows, focusedLimit);
    assert.equal(retry.added.length, 0);
    assert.equal(retry.duplicateCount, firstRows.length);
  } finally {
    await db.delete(expensesTable).where(eq(expensesTable.userId, userId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("full save chunks more than 5,500 expenses and retained import provenance", async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const userId = `bank-save-chunks-${suffix}`;
  const [user] = await db.insert(usersTable).values({
    id: userId,
    email: `${userId}@example.test`,
    fullName: "Chunked Save",
  }).returning();
  const expenses = Array.from({ length: 5_601 }, (_, index) => ({
    id: `chunk-${suffix}-${index}`,
    userId,
    loanId: null,
    date: "2026-09-10",
    amount: "1.00",
    category: "Other",
    merchant: "M",
    paymentMethod: "Cash",
    note: "",
    reimbursable: false,
    recurring: false,
    createdAt: new Date("2026-09-10T00:00:00.000Z"),
  }));
  try {
    for (let offset = 0; offset < expenses.length; offset += 400) {
      const chunk = expenses.slice(offset, offset + 400);
      await db.insert(expensesTable).values(chunk);
      await db.insert(bankStatementImportProvenanceTable).values(chunk.map((expense, index) => ({
        userId,
        importId: "e".repeat(64),
        sourceRowId: String(offset + index),
        bank: "HDFC",
        parserVersion: "hdfc-v1-csv",
        expenseId: expense.id,
      })));
    }
    const saved = await saveFinancialData(user, {
      expenses: expenses.map(({ userId: _userId, loanId: _loanId, ...expense }) => ({
        ...expense,
        amount: 1,
        createdAt: expense.createdAt.toISOString(),
      })),
    });
    assert.equal(saved.expenses.length, expenses.length);
    assert.equal(
      (await db.select().from(bankStatementImportProvenanceTable)
        .where(eq(bankStatementImportProvenanceTable.userId, userId))).length,
      expenses.length,
    );
  } finally {
    await db.delete(expensesTable).where(eq(expensesTable.userId, userId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("bank import batches 5,000 expenses and provenance while preserving order", async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const userId = `bank-import-batch-${suffix}`;
  const [user] = await db.insert(usersTable).values({
    id: userId,
    email: `${userId}@example.test`,
    fullName: "Batched Import",
  }).returning();
  const rows = Array.from({ length: 5_000 }, (_, index) => ({
    importId: "9".repeat(64),
    sourceRowId: String(index),
    bank: "HDFC",
    parserVersion: "hdfc-v1-csv",
    date: "2026-09-10",
    amount: 1,
    category: "Other",
    merchant: `M${index}`,
    paymentMethod: "Cash",
  }));
  try {
    const result = await importBankStatementExpenses(user, rows);
    assert.equal(result.added.length, rows.length);
    assert.deepEqual(
      (result.added as Array<{ merchant: string }>).map(({ merchant }) => merchant),
      rows.map(({ merchant }) => merchant),
    );
    assert.equal(
      (await db.select().from(bankStatementImportProvenanceTable)
        .where(eq(bankStatementImportProvenanceTable.userId, userId))).length,
      rows.length,
    );
  } finally {
    await db.delete(expensesTable).where(eq(expensesTable.userId, userId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("admission headroom remains below the hard normal-save parser ceiling", () => {
  assert.ok(FINANCIAL_DOCUMENT_ADMISSION_JSON_LIMIT < FINANCIAL_SAVE_JSON_LIMIT);
  assert.ok(
    FINANCIAL_SAVE_JSON_LIMIT - FINANCIAL_DOCUMENT_ADMISSION_JSON_LIMIT >= 64 * 1024,
  );
  // financialSaveMutationDocument already materializes the client-only
  // optional numeric default. A document admitted at its conservative measured
  // boundary therefore retains the full explicit transport headroom.
  const clientProjectionAtAdmissionBoundary = FINANCIAL_DOCUMENT_ADMISSION_JSON_LIMIT;
  assert.ok(clientProjectionAtAdmissionBoundary < FINANCIAL_SAVE_JSON_LIMIT);
});

test("planning notification growth is rejected atomically at admission", async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const userId = `planning-admission-${suffix}`;
  const [user] = await db.insert(usersTable).values({
    id: userId,
    email: `${userId}@example.test`,
    fullName: "Planning Admission",
  }).returning();
  try {
    const initial = await updatePlanningFeatures(user, {});
    const currentLimit = Buffer.byteLength(JSON.stringify(
      financialSaveMutationDocument(initial),
    ));
    await assert.rejects(
      updatePlanningFeatures(user, {
        notification: {
          id: `notice-${suffix}`,
          dedupeKey: `notice-${suffix}`,
          type: "budget",
          title: "Boundary notification",
          message: "This notification must not be partially committed.",
          createdAt: "2026-09-10T00:00:00.000Z",
          deliverAfter: "2026-09-10T00:00:00.000Z",
          channels: ["in-app"],
        },
      }, currentLimit),
      FinancialSaveSizeLimitError,
    );
    const [profile] = await db.select().from(userProfilesTable)
      .where(eq(userProfilesTable.userId, userId));
    assert.deepEqual(profile?.planningData?.notificationState ?? [], []);
  } finally {
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("health, retirement, and category growth share atomic admission", async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const userId = `canonical-growth-${suffix}`;
  const [user] = await db.insert(usersTable).values({
    id: userId,
    email: `${userId}@example.test`,
    fullName: "Canonical Growth",
  }).returning();
  try {
    const initial = await updatePlanningFeatures(user, {});
    const limit = Buffer.byteLength(JSON.stringify(financialSaveMutationDocument(initial)));
    await assert.rejects(updateFinancialHealthPlanning(user, {
      netWorthSnapshot: { month: "2026-09", assets: 1, liabilities: 0 },
    }, limit), FinancialSaveSizeLimitError);
    await assert.rejects(updateRetirementPlanning(user, {
      targetRetirementAge: 55,
      lifeExpectancy: 85,
      generalInflation: 6,
      salaryGrowth: 8,
      monthlyContributionOverride: 0,
      investSurplus: false,
      pensionSources: [{
        id: "pension",
        name: "Pension",
        monthlyAmount: 1,
        annualEscalationRate: 0,
      }],
    }, limit), FinancialSaveSizeLimitError);
    await assert.rejects(
      managePlanningCategory(user, "Boundary category", "restore", undefined, limit),
      FinancialSaveSizeLimitError,
    );
    const unchanged = await loadFinancialData(user);
    assert.deepEqual(unchanged.netWorthSnapshots, []);
    assert.deepEqual(unchanged.retirementInputs.pensionSources, []);
    assert.equal(
      (unchanged.budgets as Array<{ category: string }>)
        .some(({ category }) => category === "Boundary category"),
      false,
    );
  } finally {
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("restore admission is atomic, ignores report-only bulk, and reconciles provenance", async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const userId = `restore-provenance-${suffix}`;
  const [user] = await db.insert(usersTable).values({
    id: userId,
    email: `${userId}@example.test`,
    fullName: "Restore Provenance",
  }).returning();
  const rows = ["one", "two"].map((sourceRowId, index) => ({
    importId: "f".repeat(64),
    sourceRowId,
    bank: "HDFC",
    parserVersion: "hdfc-v1-csv",
    date: "2026-09-10",
    amount: index + 1,
    category: "Other",
    merchant: sourceRowId,
    paymentMethod: "Cash",
  }));
  try {
    const imported = await importBankStatementExpenses(user, rows);
    const focusedLimit = Buffer.byteLength(JSON.stringify(
      financialSaveMutationDocument(imported.data),
    ));
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.isAuthenticated = (() => true) as Request["isAuthenticated"];
      req.user = {
        id: userId,
        email: `${userId}@example.test`,
        isAdmin: false,
      } as Express.User;
      res.locals.financialDocumentAdmissionLimit = 1;
      next();
    });
    app.use("/api", financeRouter);
    const server = app.listen(0);
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const { port } = server.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${port}/api/financial-data/restore`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...imported.data,
            expenses: [
              ...imported.data.expenses,
              {
                id: `route-too-large-${suffix}`,
                date: "2026-09-11",
                amount: 3,
                category: "Other",
                merchant: "third",
                paymentMethod: "Cash",
              },
            ],
          }),
        },
      );
      assert.equal(response.status, 413);
      const body = await response.json() as { code: string; error: string };
      assert.equal(body.code, "FINANCIAL_SAVE_SIZE_LIMIT");
      assert.match(body.error, /too large to save/i);
      const saveResponse = await fetch(
        `http://127.0.0.1:${port}/api/financial-data`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...imported.data,
            profileInputs: {
              ...imported.data.profileInputs,
              fullName: "Must Roll Back With Extra Growth",
            },
          }),
        },
      );
      assert.equal(saveResponse.status, 413);
      const saveBody = await saveResponse.json() as { code: string; error: string };
      assert.equal(saveBody.code, "FINANCIAL_SAVE_SIZE_LIMIT");
      assert.match(saveBody.error, /This change/);
      const [unchangedUser] = await db.select().from(usersTable)
        .where(eq(usersTable.id, userId));
      assert.equal(unchangedUser?.fullName, "Restore Provenance");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve()));
    }
    await assert.rejects(
      restoreFinancialData(user, {
        ...imported.data,
        expenses: [
          ...imported.data.expenses,
          {
            id: `too-large-${suffix}`,
            date: "2026-09-11",
            amount: 3,
            category: "Other",
            merchant: "third",
            paymentMethod: "Cash",
          },
        ],
      }, {}, focusedLimit),
      FinancialSaveSizeLimitError,
    );
    assert.equal(
      (await db.select().from(expensesTable).where(eq(expensesTable.userId, userId))).length,
      2,
    );
    assert.equal(
      (await db.select().from(bankStatementImportProvenanceTable)
        .where(eq(bankStatementImportProvenanceTable.userId, userId))).length,
      2,
    );

    const sectionIds = [
      "income-vs-expected",
      "expenses-vs-budget-category",
      "savings-amount-rate",
      "portfolio-value-returns-change",
      "net-worth-change",
      "retirement-date-movement",
      "health-score-change",
      "top-next-month-actions",
    ];
    const largeReport = {
      id: `report-${suffix}`,
      month: "2026-09",
      generatedAt: "2026-10-01T00:00:00.000Z",
      sections: sectionIds.map((id) => ({
        id,
        title: id,
        metrics: {},
        metricFormats: {},
        actions: [],
      })),
      retirementForecast: {
        asOfDate: "2026-09-30",
        assumptions: {},
        projectionInputs: {
          expenses: Array.from({ length: 2_000 }, (_, index) => ({
            id: index,
            detail: "historical projection detail ".repeat(10),
          })),
        },
      },
    };
    assert.ok(Buffer.byteLength(JSON.stringify(largeReport)) > 500_000);
    await restoreFinancialData(user, {
      ...imported.data,
      monthlyReports: [largeReport],
    }, {}, focusedLimit);
    assert.equal(
      (await db.select().from(bankStatementImportProvenanceTable)
        .where(eq(bankStatementImportProvenanceTable.userId, userId))).length,
      2,
    );

    await restoreFinancialData(user, {
      ...imported.data,
      expenses: imported.data.expenses.slice(0, 1),
      monthlyReports: [largeReport],
    }, {});
    const provenance = await db.select().from(bankStatementImportProvenanceTable)
      .where(eq(bankStatementImportProvenanceTable.userId, userId));
    assert.equal(provenance.length, 1);
    assert.equal(provenance[0]?.expenseId, (imported.data.expenses[0] as { id: string }).id);
  } finally {
    await db.delete(expensesTable).where(eq(expensesTable.userId, userId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("restore authoritatively persists exported monthly report history", async () => {
  const userId = `report-restore-${process.pid}-${Date.now()}`;
  await db.insert(usersTable).values({
    id: userId,
    email: `${userId}@example.test`,
    fullName: "Report Restore",
  });
  const sectionIds = [
    "income-vs-expected",
    "expenses-vs-budget-category",
    "savings-amount-rate",
    "portfolio-value-returns-change",
    "net-worth-change",
    "retirement-date-movement",
    "health-score-change",
    "top-next-month-actions",
  ];
  const projectionExpenses = Array.from({ length: 220 }, (_, index) => ({
    id: `historical-${index}`,
    merchant: `Historical merchant ${index}`,
    note: "historical forecast projection input ".repeat(12),
    amount: index + 1,
  }));
  const historicalReport = {
    id: "monthly-report-2026-08",
    month: "2026-08",
    generatedAt: "2026-09-01T00:00:00.000Z",
    sections: sectionIds.map((id) => ({
      id, title: id, metrics: { value: 1 }, metricFormats: { value: "number" }, actions: [],
    })),
    retirementForecast: {
      projectedRetirementMonth: "2045-06",
      projectedRetirementAge: 60,
      asOfDate: "2026-08-31",
      modelVersion: 3,
      assumptions: {
        targetRetirementAge: 60,
        lifeExpectancy: 88,
        generalInflation: 6,
        salaryGrowth: 8,
        monthlyContribution: 50000,
        monthlySpending: 75000,
        portfolioValue: 5000000,
        investedPrincipal: 4000000,
        portfolioReturnAmount: 1000000,
        expectedReturn: 10,
      },
      projectionInputs: {
        expenses: projectionExpenses,
        budgets: [],
        incomes: [],
        investments: [],
        loans: [],
        plannedExpenses: [],
        emergencyFund: { targetMonths: 6 },
        assumptions: { source: "historical" },
      },
      drivers: ["Historical portfolio and spending inputs"],
    },
  };
  await db.insert(userProfilesTable).values({
    userId,
    planningData: {
      monthlyReportSnapshots: [historicalReport],
      pushSubscriptions: [],
      monthlyReportEmailDeliveries: {},
    } as never,
  });

  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as Request["isAuthenticated"];
    req.user = { id: userId, email: `${userId}@example.test`, isAdmin: false } as Express.User;
    next();
  });
  app.use("/api", financeRouter);
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}/api/financial-data`;
    const headers = { "content-type": "application/json" };
    const backup = await (await fetch(base)).json() as Record<string, unknown> & {
      monthlyReports: unknown[];
    };
    assert.ok(JSON.stringify(backup).length > 100 * 1024);
    const expectedReports = backup.monthlyReports;

    assert.equal((await fetch(base, { method: "DELETE" })).status, 200);
    assert.equal((await fetch(`${base}/restore`, {
      method: "POST", headers, body: JSON.stringify(backup),
    })).status, 200);
    const afterClearRestore = await (await fetch(base)).json() as { monthlyReports: unknown[] };
    assert.deepEqual(afterClearRestore.monthlyReports, expectedReports);

    const activePush = [{
      endpoint: "https://fcm.googleapis.com/fcm/send/current",
      p256dh: "current-key",
      auth: "current-auth",
      createdAt: "2026-09-02T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
    }];
    const deliveries = { "monthly-report-other": { sentAt: "2026-09-02T01:00:00.000Z" } };
    const failures = {
      "2026-08": { category: "temporary", failedAt: "2026-09-02T02:00:00.000Z" },
    };
    const [profile] = await db.select().from(userProfilesTable)
      .where(eq(userProfilesTable.userId, userId));
    await db.update(userProfilesTable).set({
      planningData: {
        ...(profile.planningData as Record<string, unknown>),
        monthlyReportSnapshots: [{ ...historicalReport, id: "different", month: "2026-07" }],
        pushSubscriptions: activePush,
        monthlyReportEmailDeliveries: deliveries,
        monthlyReportEmailFailures: failures,
      } as never,
    }).where(eq(userProfilesTable.userId, userId));

    assert.equal((await fetch(`${base}/restore`, {
      method: "POST", headers, body: JSON.stringify(backup),
    })).status, 200);
    let [stored] = await db.select().from(userProfilesTable)
      .where(eq(userProfilesTable.userId, userId));
    let planning = stored.planningData as Record<string, unknown>;
    assert.deepEqual(planning.monthlyReportSnapshots, expectedReports);
    assert.deepEqual(planning.pushSubscriptions, activePush);
    assert.deepEqual(planning.monthlyReportEmailDeliveries, deliveries);
    assert.deepEqual(planning.monthlyReportEmailFailures, failures);

    assert.equal((await fetch(`${base}/restore`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...backup, monthlyReports: [] }),
    })).status, 200);
    [stored] = await db.select().from(userProfilesTable)
      .where(eq(userProfilesTable.userId, userId));
    planning = stored.planningData as Record<string, unknown>;
    assert.deepEqual(planning.monthlyReportSnapshots, []);
    assert.deepEqual(planning.pushSubscriptions, activePush);
    assert.deepEqual(planning.monthlyReportEmailDeliveries, deliveries);
    assert.deepEqual(planning.monthlyReportEmailFailures, failures);
  } finally {
    server.close();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("monthly report email route persists failure and clears it after a successful retry", async () => {
  const userId = `report-email-status-${process.pid}-${Date.now()}`;
  const month = "2026-08";
  const report = {
    id: `monthly-report-${month}`,
    month,
    generatedAt: "2026-09-01T00:00:00.000Z",
    sections: [
      "income-vs-expected",
      "expenses-vs-budget-category",
      "savings-amount-rate",
      "portfolio-value-returns-change",
      "net-worth-change",
      "retirement-date-movement",
      "health-score-change",
      "top-next-month-actions",
    ].map((id) => ({
      id,
      title: id,
      metrics: { amount: 1 },
      metricFormats: { amount: "currency" },
      actions: [],
    })),
  };
  await db.insert(usersTable).values({
    id: userId,
    email: `${userId}@example.test`,
  });
  await db.insert(userProfilesTable).values({
    userId,
    planningData: { monthlyReportSnapshots: [report] } as never,
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as Request["isAuthenticated"];
    req.user = { id: userId, email: `${userId}@example.test`, isAdmin: false } as Express.User;
    next();
  });
  app.use("/api", financeRouter);
  const server = app.listen(0);
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.AUTH_EMAIL_FROM;
  let providerStatus = 503;
  process.env.RESEND_API_KEY = "route-test-key";
  process.env.AUTH_EMAIL_FROM = "ezyRetire <reports@example.test>";
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (String(input) === "https://api.resend.com/emails") {
      return Promise.resolve(new Response(null, { status: providerStatus }));
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/api/financial-data/monthly-reports/${report.id}/email`;

    const failedResponse = await originalFetch(url, { method: "POST" });
    assert.equal(failedResponse.status, 503);
    let [profile] = await db.select().from(userProfilesTable)
      .where(eq(userProfilesTable.userId, userId));
    let planning = profile.planningData as Record<string, unknown>;
    assert.equal(
      (planning.monthlyReportEmailFailures as Record<string, { category: string }>)[month]?.category,
      "temporary",
    );
    const financialUrl = url.slice(0, url.indexOf("/monthly-reports/"));
    const ordinaryDocument = await (await originalFetch(financialUrl)).json();
    const ordinarySaveResponse = await originalFetch(financialUrl, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ordinaryDocument),
    });
    assert.equal(ordinarySaveResponse.status, 200);
    const afterOrdinarySave = await ordinarySaveResponse.json() as {
      monthlyReportEmailFailures: Record<string, { category: string }>;
    };
    assert.equal(afterOrdinarySave.monthlyReportEmailFailures[month]?.category, "temporary");
    [profile] = await db.select().from(userProfilesTable)
      .where(eq(userProfilesTable.userId, userId));
    planning = profile.planningData as Record<string, unknown>;
    assert.equal(
      (planning.monthlyReportEmailFailures as Record<string, { category: string }>)[month]?.category,
      "temporary",
    );

    providerStatus = 200;
    setMonthlyReportDeliveryMarkerForTests(async () => {
      throw new Error("delivery marker unavailable");
    });
    const pendingResponse = await originalFetch(url, { method: "POST" });
    assert.equal(pendingResponse.status, 200);
    const pending = await pendingResponse.json() as {
      monthlyReportEmailFailures: Record<string, unknown>;
      monthlyReportEmailStatusPendingMonths: string[];
    };
    assert.equal(pending.monthlyReportEmailFailures[month], undefined);
    assert.deepEqual(pending.monthlyReportEmailStatusPendingMonths, [month]);
    [profile] = await db.select().from(userProfilesTable)
      .where(eq(userProfilesTable.userId, userId));
    planning = profile.planningData as Record<string, unknown>;
    assert.equal(
      (planning.monthlyReportEmailFailures as Record<string, unknown>)[month],
      undefined,
    );
    assert.equal(
      (planning.monthlyReportEmailDeliveries as Record<string, unknown> | undefined)?.[month],
      undefined,
    );

    setMonthlyReportDeliveryMarkerForTests();
    const recoveredResponse = await originalFetch(url, { method: "POST" });
    assert.equal(recoveredResponse.status, 200);
    const recovered = await recoveredResponse.json() as {
      monthlyReportEmailFailures: Record<string, unknown>;
    };
    assert.equal(recovered.monthlyReportEmailFailures[month], undefined);
    [profile] = await db.select().from(userProfilesTable)
      .where(eq(userProfilesTable.userId, userId));
    planning = profile.planningData as Record<string, unknown>;
    assert.equal(
      (planning.monthlyReportEmailFailures as Record<string, unknown>)[month],
      undefined,
    );
    assert.equal(
      typeof (planning.monthlyReportEmailDeliveries as Record<string, unknown>)[month],
      "string",
    );
  } finally {
    setMonthlyReportDeliveryMarkerForTests();
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalApiKey;
    if (originalFrom === undefined) delete process.env.AUTH_EMAIL_FROM;
    else process.env.AUTH_EMAIL_FROM = originalFrom;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
    await db.delete(userProfilesTable).where(eq(userProfilesTable.userId, userId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("large restore references pin immutable bytes and retain cleanup authority", async () => {
  const userId = `restore-upload-${process.pid}-${Date.now()}`;
  const otherId = `${userId}-other`;
  await db.insert(usersTable).values([{ id: userId }, { id: otherId }]);
  const objectPath = `/objects/vault-staging/${crypto.randomUUID()}`;
  const sectionIds = [
    "income-vs-expected", "expenses-vs-budget-category", "savings-amount-rate",
    "portfolio-value-returns-change", "net-worth-change", "retirement-date-movement",
    "health-score-change", "top-next-month-actions",
  ];
  const historicalExpenses = Array.from({ length: 220 }, (_, index) => ({
    id: `retained-history-${index}`,
    merchant: `Retained historical merchant ${index}`,
    note: "retained historical financial projection evidence ".repeat(14),
    amount: index + 1,
  }));
  const monthlyReports = Array.from({ length: 60 }, (_, index) => {
    const month = `${2020 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`;
    return {
      id: `monthly-report-${month}`,
      month,
      generatedAt: `${month}-01T00:00:00.000Z`,
      sections: sectionIds.map((id) => ({
        id, title: id, metrics: { value: index }, metricFormats: { value: "number" }, actions: [],
      })),
      retirementForecast: {
        projectedRetirementMonth: "2045-06",
        projectedRetirementAge: 60,
        asOfDate: `${month}-01`,
        modelVersion: 3,
        assumptions: {
          targetRetirementAge: 60, lifeExpectancy: 88, generalInflation: 6,
          salaryGrowth: 8, monthlyContribution: 50_000, monthlySpending: 75_000,
          portfolioValue: 5_000_000, investedPrincipal: 4_000_000,
          portfolioReturnAmount: 1_000_000, expectedReturn: 10,
        },
        projectionInputs: {
          expenses: historicalExpenses, budgets: [], incomes: [], investments: [],
          loans: [], plannedExpenses: [], emergencyFund: { targetMonths: 6 },
          assumptions: { source: "retained-history" },
        },
        drivers: ["Retained historical projection inputs"],
      },
    };
  });
  const backup = Buffer.from(JSON.stringify({
    expenses: [],
    profileInputs: { fullName: "Restored Upload Account" },
    monthlyReports,
  }));
  assert.ok(backup.length > 4.5 * 1024 * 1024);
  assert.ok(backup.length < 12 * 1024 * 1024);
  await db.insert(vaultUploadGrantsTable).values({
    userId, objectPath, name: "financial-data-restore.json",
    contentType: "application/json", size: backup.length, purpose: "financial_restore",
    expiresAt: new Date(Date.now() + 60_000),
  });
  const stagingFile: Record<string, any> = {
    generation: "91",
    getMetadata: async () => [{
      generation: "91", size: String(storageBytes.length), contentType: "application/json", metadata: {},
    }],
    setMetadata: async () => undefined,
  };
  setVaultObjectAssertionForTests(async () => stagingFile as never);
  let storageBytes = backup;
  let immutableBytes = backup;
  setVaultObjectPromotionForTests(async () => {
    immutableBytes = Buffer.from(storageBytes);
    storageBytes = Buffer.from('{"expenses":[{"substituted":true}]}');
  });
  setPromotedVaultObjectAssertionForTests(async () => ({} as never));
  setVaultFileForTests(() => ({
    createReadStream: () => Readable.from([immutableBytes]),
  } as never));
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  let authenticatedId = userId;
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as Request["isAuthenticated"];
    req.user = { id: authenticatedId, isAdmin: false } as Express.User;
    next();
  });
  app.use("/api", financeRouter);
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as AddressInfo).port;
    const envelope = JSON.stringify({ restoreUpload: { objectPath, size: backup.length } });
    assert.ok(Buffer.byteLength(envelope) < 1024);
    const response = await fetch(`http://127.0.0.1:${port}/api/financial-data/restore`, {
      method: "POST", headers: { "content-type": "application/json" }, body: envelope,
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-financial-data-stream"), "1");
    assert.equal(response.headers.get("content-length"), null);
    assert.equal(response.headers.get("transfer-encoding"), "chunked");
    const restoredText = await response.text();
    assert.ok(Buffer.byteLength(restoredText) > 4.5 * 1024 * 1024);
    const restoredBody = JSON.parse(restoredText) as {
      monthlyReports: Array<{ retirementForecast?: { projectionInputs?: { expenses?: unknown[] } } }>;
    };
    assert.equal(restoredBody.monthlyReports.length, monthlyReports.length);
    assert.equal(
      restoredBody.monthlyReports[0].retirementForecast?.projectionInputs?.expenses?.length,
      historicalExpenses.length,
    );
    const [restored] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    assert.equal(restored.fullName, "Restored Upload Account");
    const reconciliation = await fetch(`http://127.0.0.1:${port}/api/financial-data`);
    assert.equal(reconciliation.headers.get("x-financial-data-stream"), "1");
    assert.equal(reconciliation.headers.get("content-length"), null);
    assert.equal(reconciliation.headers.get("transfer-encoding"), "chunked");
    const reconciliationText = await reconciliation.text();
    assert.ok(Buffer.byteLength(reconciliationText) > 4.5 * 1024 * 1024);
    assert.equal(
      (JSON.parse(reconciliationText) as { monthlyReports: unknown[] }).monthlyReports.length,
      monthlyReports.length,
    );
    const jobs = await db.select().from(vaultDeletionJobsTable)
      .where(eq(vaultDeletionJobsTable.userId, userId));
    // The promoted-file cleanup is immediately eligible and may be completed
    // by another parallel maintenance test before this process observes it.
    // The staging cleanup must remain until its signed-upload authority expires.
    assert.ok(jobs.length === 1 || jobs.length === 2);
    assert.ok(jobs.every((job) => job.reason === "financial_restore_complete"));
    const [grant] = await db.select().from(vaultUploadGrantsTable)
      .where(eq(vaultUploadGrantsTable.objectPath, objectPath));
    assert.ok(grant.consumedAt);
    assert.ok(grant.promotedObjectPath);
    const stagingJob = jobs.find((job) => job.objectPath === objectPath);
    assert.ok(stagingJob?.finalizeAfter);
    assert.ok(stagingJob.finalizeAfter.getTime()
      >= grant.expiresAt.getTime() + 5 * 60_000);
    const deletedPaths: string[] = [];
    setVaultObjectDeletionForTests(async (path) => { deletedPaths.push(path); });
    await runVaultDeletionMaintenance();
    assert.equal(deletedPaths.includes(objectPath), false);
    assert.equal((await db.select().from(vaultDeletionJobsTable)
      .where(eq(vaultDeletionJobsTable.objectPath, objectPath))).length, 1);
    // A signed PUT may still recreate staging now; durable authority remains.
    await db.update(vaultDeletionJobsTable).set({
      finalizeAfter: new Date(Date.now() - 1),
    }).where(eq(vaultDeletionJobsTable.objectPath, objectPath));
    await runVaultDeletionMaintenance();
    assert.equal(deletedPaths.includes(objectPath), true);
    assert.equal((await db.select().from(vaultDeletionJobsTable)
      .where(eq(vaultDeletionJobsTable.objectPath, objectPath))).length, 0);
    setVaultObjectDeletionForTests();

    const unrelatedPath = `/objects/vault-documents/${crypto.randomUUID()}`;
    const unrelatedFinalizeAfter = new Date(Date.now() + 20 * 60_000);
    const [unrelatedJob] = await db.insert(vaultDeletionJobsTable).values({
      userId, objectPath: unrelatedPath, reason: "promotion_rollback",
      finalizeAfter: unrelatedFinalizeAfter,
    }).returning();
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/financial-data/restore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expenses: [],
        __restoreUploadCleanup: {
          stagingPath: unrelatedPath, promotedPath: unrelatedPath,
        },
      }),
    })).status, 200);
    const [unchangedJob] = await db.select().from(vaultDeletionJobsTable)
      .where(eq(vaultDeletionJobsTable.id, unrelatedJob.id));
    assert.equal(unchangedJob.reason, "promotion_rollback");
    assert.equal(unchangedJob.finalizeAfter?.getTime(), unrelatedFinalizeAfter.getTime());

    const malformedPath = `/objects/vault-staging/${crypto.randomUUID()}`;
    storageBytes = Buffer.from("{not-json");
    await db.insert(vaultUploadGrantsTable).values({
      userId, objectPath: malformedPath, name: "financial-data-restore.json",
      contentType: "application/json", size: storageBytes.length, purpose: "financial_restore",
      expiresAt: new Date(Date.now() + 60_000),
    });
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/financial-data/restore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ restoreUpload: { objectPath: malformedPath, size: storageBytes.length } }),
    })).status, 404);
    const malformedJobs = await db.select().from(vaultDeletionJobsTable).where(and(
      eq(vaultDeletionJobsTable.userId, userId),
      eq(vaultDeletionJobsTable.objectPath, malformedPath),
    ));
    assert.equal(malformedJobs.length, 1);
    assert.equal(malformedJobs[0]?.reason, "financial_restore_staging_rollback");

    const wrongTypePath = `/objects/vault-staging/${crypto.randomUUID()}`;
    await db.insert(vaultUploadGrantsTable).values({
      userId, objectPath: wrongTypePath, name: "wrong.png",
      contentType: "image/png", size: 3, purpose: "financial_restore",
      expiresAt: new Date(Date.now() + 60_000),
    });
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/financial-data/restore`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ restoreUpload: { objectPath: wrongTypePath, size: 3 } }),
    })).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/financial-data/restore`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        restoreUpload: { objectPath, size: 12 * 1024 * 1024 + 1 },
      }),
    })).status, 404);

    const concurrentPath = `/objects/vault-staging/${crypto.randomUUID()}`;
    const winnerA = Buffer.from(JSON.stringify({
      expenses: [], profileInputs: { fullName: "Concurrent A" },
    }));
    const winnerB = Buffer.from(JSON.stringify({
      expenses: [], profileInputs: { fullName: "Concurrent B" },
    }));
    assert.equal(winnerA.length, winnerB.length);
    storageBytes = winnerA;
    await db.insert(vaultUploadGrantsTable).values({
      userId, objectPath: concurrentPath, name: "financial-data-restore.json",
      contentType: "application/json", size: winnerA.length, purpose: "financial_restore",
      expiresAt: new Date(Date.now() + 60_000),
    });
    let pinnedBytes = Buffer.alloc(0);
    setVaultObjectAssertionForTests(async () => {
      pinnedBytes = Buffer.from(storageBytes);
      return stagingFile as never;
    });
    let releasePromotion!: () => void;
    const promotionRelease = new Promise<void>((resolve) => { releasePromotion = resolve; });
    let promotionReached!: () => void;
    const reachedPromotion = new Promise<void>((resolve) => { promotionReached = resolve; });
    let promotionCount = 0;
    setVaultObjectPromotionForTests(async () => {
      promotionCount += 1;
      promotionReached();
      await promotionRelease;
      immutableBytes = Buffer.from(pinnedBytes);
    });
    const concurrentEnvelope = JSON.stringify({
      restoreUpload: { objectPath: concurrentPath, size: winnerA.length },
    });
    const firstRestore = fetch(`http://127.0.0.1:${port}/api/financial-data/restore`, {
      method: "POST", headers: { "content-type": "application/json" }, body: concurrentEnvelope,
    });
    await reachedPromotion;
    storageBytes = winnerB;
    const losingRestore = await fetch(`http://127.0.0.1:${port}/api/financial-data/restore`, {
      method: "POST", headers: { "content-type": "application/json" }, body: concurrentEnvelope,
    });
    assert.equal(losingRestore.status, 404);
    releasePromotion();
    assert.equal((await firstRestore).status, 200);
    assert.equal(promotionCount, 1);
    let [concurrentUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    assert.equal(concurrentUser.fullName, "Concurrent A");
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/financial-data/restore`, {
      method: "POST", headers: { "content-type": "application/json" }, body: concurrentEnvelope,
    })).status, 200);
    [concurrentUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    assert.equal(concurrentUser.fullName, "Concurrent A");
    assert.equal(promotionCount, 1);

    authenticatedId = otherId;
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/financial-data/restore`, {
      method: "POST", headers: { "content-type": "application/json" }, body: envelope,
    })).status, 404);
  } finally {
    server.close();
    setVaultObjectAssertionForTests();
    setVaultObjectPromotionForTests();
    setVaultObjectDeletionForTests();
    setPromotedVaultObjectAssertionForTests();
    setVaultFileForTests();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await db.delete(usersTable).where(eq(usersTable.id, otherId));
  }
});

test("financial-data phone changes clear mobile verification before entitlements are read", async () => {
  const userId = `finance-phone-${process.pid}-${Date.now()}`;
  await db.insert(usersTable).values({
    id: userId,
    email: `${userId}@example.test`,
    phone: "+15551234567",
    phoneVerifiedAt: new Date(),
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as Request["isAuthenticated"];
    req.user = {
      id: userId,
      email: `${userId}@example.test`,
      isAdmin: false,
    } as Express.User;
    next();
  });
  app.use("/api", financeRouter);
  app.use("/api", premiumToolsRouter);
  const server = app.listen(0);

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const update = await fetch(`http://127.0.0.1:${port}/api/financial-data`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profileInputs: { phone: " +1 (555) 987-6543 " },
      }),
    });
    assert.equal(update.status, 200);

    const entitlements = await fetch(`http://127.0.0.1:${port}/api/entitlements`);
    assert.equal(entitlements.status, 200);
    const body = await entitlements.json() as {
      mobileVerification: { hasMobile: boolean; verified: boolean };
    };
    assert.deepEqual(body.mobileVerification, { hasMobile: true, verified: false });

    const [updated] = await db.select({
      phone: usersTable.phone,
      phoneVerifiedAt: usersTable.phoneVerifiedAt,
    }).from(usersTable).where(eq(usersTable.id, userId));
    assert.equal(updated?.phone, "+15559876543");
    assert.equal(updated?.phoneVerifiedAt, null);
  } finally {
    server.close();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("financial data routes persist and reset data", async () => {
  const unique = `${process.pid}-${Date.now()}`;
  const userId = `finance-route-${unique}`;
  await db.insert(usersTable).values({
    id: userId,
    email: `${userId}@example.test`,
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as Request["isAuthenticated"];
    req.user = {
      id: userId,
      email: `${userId}@example.test`,
      isAdmin: false,
    } as Express.User;
    next();
  });
  app.use("/api", financeRouter);
  const server = app.listen(0);

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;

    const initial = await fetch(`http://127.0.0.1:${port}/api/financial-data`);
    assert.equal(initial.status, 200);
    const initialBody = await initial.json() as { expenses: unknown[]; loans: unknown[] };
    assert.deepEqual(initialBody.expenses, []);
    assert.deepEqual(initialBody.loans, []);

    const payload = {
      expenses: [
        {
          id: `exp-${unique}`,
          amount: 2999,
        },
      ],
      budgets: [
        {
          category: "Food",
          monthlyLimit: 20000,
          schedules: [
            {
              id: `budget-window-custom-${unique}`,
              amount: 18000,
              startMonth: "2026-04",
              endMode: "custom",
              endMonth: "2028-03",
              note: "Before school",
            },
            {
              id: `budget-window-retirement-${unique}`,
              amount: 24000,
              startMonth: "2028-04",
              endMode: "retirement",
            },
            {
              id: `budget-window-lifelong-${unique}`,
              amount: 30000,
              startMonth: "2040-01",
              endMode: "lifelong",
              note: "Long term",
            },
            {
              id: `budget-window-yearly-${unique}`,
              amount: 120000,
              startMonth: "2026-03",
              cadence: "yearly",
              annualMonth: 2,
              endMode: "lifelong",
              note: "Annual insurance",
            },
            {
              id: `budget-window-yearly-missing-${unique}`,
              amount: 1,
              startMonth: "2026-03",
              cadence: "yearly",
              endMode: "lifelong",
            },
            {
              id: `budget-window-yearly-null-${unique}`,
              amount: 1,
              startMonth: "2026-03",
              cadence: "yearly",
              annualMonth: null,
              endMode: "lifelong",
            },
            {
              id: `budget-window-yearly-empty-${unique}`,
              amount: 1,
              startMonth: "2026-03",
              cadence: "yearly",
              annualMonth: "",
              endMode: "lifelong",
            },
            {
              id: `budget-window-yearly-boolean-${unique}`,
              amount: 1,
              startMonth: "2026-03",
              cadence: "yearly",
              annualMonth: false,
              endMode: "lifelong",
            },
            {
              id: `budget-window-yearly-negative-${unique}`,
              amount: 1,
              startMonth: "2026-03",
              cadence: "yearly",
              annualMonth: -1,
              endMode: "lifelong",
            },
            {
              id: `budget-window-yearly-overflow-${unique}`,
              amount: 1,
              startMonth: "2026-03",
              cadence: "yearly",
              annualMonth: 12,
              endMode: "lifelong",
            },
          ],
        },
        { category: "Household", monthlyLimit: 12000 },
        {
          category: "Insurance",
          monthlyLimit: 0,
          windows: [
            {
              id: `budget-window-client-yearly-${unique}`,
              monthlyLimit: 150000,
              startDate: "2027-09-01",
              cadence: "yearly",
              annualMonth: 8,
              endMode: "retirement",
              note: "Client window shape",
            },
          ],
        },
      ],
      incomeSources: [
        {
          id: `inc-${unique}`,
          amount: 100000,
          frequency: "Monthly",
          recurring: false,
          incomeEndMode: "custom",
          incomeEndDate: "2035-06-30",
        },
        {
          id: `legacy-annual-once-${unique}`,
          amount: 50000,
          frequency: "Annual",
          recurring: false,
          date: "2030-04-01",
          annualGrowthRate: 12,
          incomeEndMode: "custom",
          incomeEndDate: "2035-06-30",
        },
        {
          id: `legacy-annual-salary-${unique}`,
          type: "Salary",
          amount: 120000,
          frequency: "Annual",
          recurring: true,
          date: "2020-04-01",
          incomeEndMode: "custom",
          incomeEndDate: "2035-06-30",
          salaryDetails: {
            grossCTC: 1200000,
            grossCTCMode: "automatic",
            basicPay: 720000,
            hra: 240000,
            allowances: 240000,
            employeePF: 72000,
            professionalTax: 2400,
            tds: 120000,
            tdsMode: "automatic",
            taxRegime: "new",
            financialYear: "2025-26",
            taxRuleVersion: "india-fy2025-26-v1",
            otherDeductions: 0,
          },
        },
        {
          id: `growing-annual-bonus-${unique}`,
          name: "Growing annual bonus",
          type: "Bonus",
          amount: 50000,
          frequency: "Annual",
          recurring: true,
          date: "2024-09-02",
          annualGrowthRate: 10,
        },
      ],
      incomeReceipts: [{
        id: `receipt-${unique}`,
        incomeSourceId: `inc-${unique}`,
        receivedDate: "2026-09-08",
        amount: 72_500,
        note: "Partial receipt",
        createdAt: "2026-09-08T12:00:00.000Z",
      }],
      investments: [{
        id: `inv-${unique}`,
        currentValue: 400000,
        fundAllocations: [
          {
            id: "allocation-1",
            sourceId: `legacy-annual-once-${unique}`,
            opportunityDate: "2030-04-01",
            investmentDate: "2030-04-02",
            amount: 25000,
            createdAt: "2026-09-04T00:00:00.000Z",
          },
          {
            id: "allocation-grown-annual",
            sourceId: `growing-annual-bonus-${unique}`,
            opportunityDate: "2026-09-02",
            investmentDate: "2026-09-02",
            amount: 60500,
            createdAt: "2026-09-04T00:00:00.000Z",
          },
          {
            id: "allocation-1",
            sourceId: `growing-annual-bonus-${unique}`,
            opportunityDate: "2026-09-02",
            investmentDate: "2026-09-02",
            amount: 1,
          },
          {
            id: "allocation-orphan",
            sourceId: "missing-income",
            opportunityDate: "2026-09-02",
            investmentDate: "2026-09-02",
            amount: 1,
          },
          {
            id: "allocation-too-early",
            sourceId: `growing-annual-bonus-${unique}`,
            opportunityDate: "2026-09-02",
            investmentDate: "2026-09-01",
            amount: 1,
          },
          {
            id: "allocation-over",
            sourceId: `growing-annual-bonus-${unique}`,
            opportunityDate: "2026-09-02",
            investmentDate: "2026-09-03",
            amount: 1,
          },
        ],
        disposals: [{
          id: "sale-1",
          name: "Listed share sale",
          purchaseDate: "2024-01-15",
          saleDate: "2026-08-20",
          costBasis: 100000,
          proceeds: 180000,
          assetType: "Listed Equity",
          eligibleExemption: 10000,
          indexedCostBasis: 120000,
          grandfatheredValue: 150000,
        }],
      }],
      loans: [
        { id: `loan-${unique}`, outstandingPrincipal: 500000 },
        {
          id: `interest-only-loan-${unique}`,
          outstandingPrincipal: 750000,
          repaymentType: "interest-only-plus-bullet",
        },
      ],
      plannedExpenses: [{
        id: `planned-${unique}`,
        name: "Higher education",
        category: "Education",
        amount: 1200000,
        expectedDate: "2032-07-15",
        customInflationRate: 7.25,
        createdAt: "2026-09-08T00:00:00.000Z",
      }],
      netWorthSnapshots: [
        {
          month: "2026-08",
          assets: 1250000,
          liabilities: 500000,
          netWorth: 750000,
          healthScore: 200,
        },
        { month: "not-a-month", assets: 1, liabilities: 0, netWorth: 1 },
      ],
      emergencyFund: {
        targetMonths: 9,
        reserveBalance: 240000,
        monthlyContribution: 18000,
      },
      retirementInputs: {
        dateOfBirth: "1991-05-09",
        targetRetirementAge: 57,
        lifeExpectancy: 88,
        generalInflation: 5.5,
        salaryGrowth: 9.25,
        monthlyContributionOverride: 25000,
        investSurplus: true,
        lifestyleChoice: "Custom",
        customLifestyleExpense: 85000,
        retirementSpendingAdjustmentPercent: 12.5,
        pensionSources: [{
          id: `pension-${unique}`,
          name: "Employer pension",
          monthlyAmount: 32000,
          startAge: 60,
          annualEscalationRate: 4,
        }],
      },
      profileInputs: {
        fullName: "Finance Route User",
        gender: "Male",
        phone: "9999999999",
        onboardingCompleted: true,
        dateOfBirth: "1991-05-09",
        targetRetirementAge: 57,
        lifeExpectancy: 88,
        riskPreference: "Growth",
        onboardingProgress: {
          currentStep: 6,
          completedSteps: [1, 2, 3, 4, 5],
          skippedSteps: [3],
          firstProjectionSaved: false,
        },
      },
    };
    const validBudgetSchedules = payload.budgets[0].schedules!.slice(0, 4);

    const invalidReceiptDocuments = [
      {
        incomeSources: payload.incomeSources,
        incomeReceipts: [{ ...payload.incomeReceipts[0], incomeSourceId: "another-account-source" }],
      },
      {
        incomeSources: payload.incomeSources,
        incomeReceipts: [payload.incomeReceipts[0], { ...payload.incomeReceipts[0] }],
      },
      {
        incomeSources: payload.incomeSources,
        incomeReceipts: [
          payload.incomeReceipts[0],
          { ...payload.incomeReceipts[0], id: ` ${payload.incomeReceipts[0].id} ` },
        ],
      },
      {
        incomeSources: [
          { ...payload.incomeSources[0], id: ` ${payload.incomeSources[0].id} ` },
          ...payload.incomeSources.slice(1),
        ],
        incomeReceipts: [{
          ...payload.incomeReceipts[0],
          incomeSourceId: ` ${payload.incomeSources[0].id} `,
        }],
      },
    ];
    for (const invalidReceiptDocument of invalidReceiptDocuments) {
      const rejected = await fetch(`http://127.0.0.1:${port}/api/financial-data`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          ...invalidReceiptDocument,
          profileInputs: { ...payload.profileInputs, fullName: "Must not be saved" },
        }),
      });
      assert.equal(rejected.status, 400);
    }
    const [unchangedUser] = await db
      .select({ fullName: usersTable.fullName })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    assert.equal(unchangedUser?.fullName, null);

    const persisted = await fetch(`http://127.0.0.1:${port}/api/financial-data`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(persisted.status, 200);
    const persistedBody = await persisted.json() as {
      profileInputs: {
        riskPreference: string;
        fullName?: string;
        onboardingProgress?: {
          currentStep: number;
          completedSteps: number[];
          skippedSteps: number[];
          firstProjectionSaved: boolean;
          dismissed: boolean;
          rerunInProgress: boolean;
        };
      };
      retirementInputs: {
        targetRetirementAge: number;
        lifestyleChoice?: string;
        customLifestyleExpense?: number;
        retirementSpendingAdjustmentPercent?: number;
        pensionSources: unknown[];
      };
      expenses: unknown[];
      budgets: Array<{
        category: string;
        monthlyLimit: number;
        schedules: Array<{
          id: string;
          amount: number;
          startMonth: string;
          endMode: string;
          endMonth?: string;
          note?: string;
          cadence?: string;
          annualMonth?: number;
        }>;
        windows: Array<{
          id: string;
          monthlyLimit: number;
          startDate?: string;
          endMode: string;
          endDate?: string;
          cadence?: string;
          annualMonth?: number;
        }>;
      }>;
      incomeSources: Array<{
        frequency: string;
        recurring: boolean;
        annualGrowthRate?: number;
        incomeEndMode: string;
        incomeEndDate?: string;
        amount: number;
        salaryDetails?: {
          grossCTC: number;
          grossCTCMode: string;
          basicPay: number;
          employeePF: number;
          tds: number;
          tdsMode: string;
          taxRegime?: string;
          financialYear?: string;
          taxRuleVersion?: string;
        };
      }>;
      incomeReceipts: Array<{
        id: string;
        incomeSourceId: string;
        receivedDate: string;
        amount: number;
        note?: string;
        createdAt: string;
      }>;
      investments: Array<{
        fundAllocations?: Array<{
          id: string;
          sourceId: string;
          opportunityDate: string;
          amount: number;
          investmentDate: string;
        }>;
        disposals?: Array<{
          id: string;
          name: string;
          purchaseDate?: string;
          saleDate?: string;
          costBasis?: number;
          proceeds?: number;
          assetType?: string;
          eligibleExemption?: number;
          indexedCostBasis?: number;
          grandfatheredValue?: number;
        }>;
      }>;
      loans: Array<{ id: string; repaymentType: string }>;
      plannedExpenses: Array<{
        id: string;
        name: string;
        category: string;
        amount: number;
        expectedDate: string;
        customInflationRate?: number;
        createdAt: string;
      }>;
      netWorthSnapshots: unknown[];
      emergencyFund: {
        targetMonths: number;
        reserveBalance: number;
        monthlyContribution: number;
      };
      uiPreferences: { investmentOrder: string[]; investmentSort: { by: string } };
    };
    assert.equal(persistedBody.retirementInputs.targetRetirementAge, 57);
    assert.equal(persistedBody.profileInputs.riskPreference, "Growth");
    assert.equal(persistedBody.profileInputs.fullName, "Finance Route User");
    assert.deepEqual(persistedBody.profileInputs.onboardingProgress, {
      currentStep: 6,
      completedSteps: [1, 2, 3, 4, 5],
      skippedSteps: [3],
      firstProjectionSaved: false,
      dismissed: false,
      rerunInProgress: false,
    });
    assert.equal(persistedBody.expenses.length, 1);
    assert.equal(persistedBody.loans[0].repaymentType, "emi");
    assert.equal(persistedBody.loans[1].repaymentType, "interest-only-plus-bullet");
    assert.deepEqual(persistedBody.plannedExpenses, [{
      id: `planned-${unique}`,
      name: "Higher education",
      category: "Education",
      amount: 1200000,
      expectedDate: "2032-07-15",
      customInflationRate: 7.25,
      createdAt: "2026-09-08T00:00:00.000Z",
    }]);
    assert.deepEqual(persistedBody.netWorthSnapshots, [
      {
        month: "2026-08",
        assets: 1250000,
        liabilities: 500000,
        netWorth: 750000,
        healthScore: 100,
      },
    ]);
    assert.deepEqual(persistedBody.emergencyFund, {
      targetMonths: 9,
      reserveBalance: 240000,
      monthlyContribution: 18000,
    });
    assert.equal(persistedBody.retirementInputs.lifestyleChoice, "Custom");
    assert.equal(persistedBody.retirementInputs.customLifestyleExpense, 85000);
    assert.equal(persistedBody.retirementInputs.retirementSpendingAdjustmentPercent, 12.5);
    assert.deepEqual(persistedBody.retirementInputs.pensionSources, [{
      id: `pension-${unique}`,
      name: "Employer pension",
      monthlyAmount: 32000,
      startAge: 60,
      annualEscalationRate: 4,
    }]);
    assert.equal(persistedBody.budgets[0].schedules.length, 4);
    assert.deepEqual(persistedBody.budgets[0].schedules, validBudgetSchedules);
    assert.deepEqual(persistedBody.budgets[0].windows, [
      {
        id: `budget-window-custom-${unique}`,
        monthlyLimit: 18000,
        startDate: "2026-04-01",
        endMode: "custom",
        endDate: "2028-03-01",
        note: "Before school",
      },
      {
        id: `budget-window-retirement-${unique}`,
        monthlyLimit: 24000,
        startDate: "2028-04-01",
        endMode: "retirement",
      },
      {
        id: `budget-window-lifelong-${unique}`,
        monthlyLimit: 30000,
        startDate: "2040-01-01",
        endMode: "lifelong",
        note: "Long term",
      },
      {
        id: `budget-window-yearly-${unique}`,
        monthlyLimit: 120000,
        startDate: "2026-03-01",
        cadence: "yearly",
        annualMonth: 2,
        endMode: "lifelong",
        note: "Annual insurance",
      },
    ]);

    assert.equal(persistedBody.budgets[1].monthlyLimit, 12000);
    assert.deepEqual(
      persistedBody.budgets[1].schedules.map(({ id: _id, ...schedule }) => schedule),
      [{ amount: 12000, startMonth: "1900-01", endMode: "lifelong" }],
    );
    assert.ok(persistedBody.budgets[1].schedules[0].id);
    assert.deepEqual(
      persistedBody.budgets[1].windows.map(({ id: _id, ...window }) => window),
      [{ monthlyLimit: 12000, endMode: "lifelong" }],
    );
    assert.deepEqual(persistedBody.budgets[2].windows, [
      {
        id: `budget-window-client-yearly-${unique}`,
        monthlyLimit: 150000,
        startDate: "2027-09-01",
        cadence: "yearly",
        annualMonth: 8,
        endMode: "retirement",
        note: "Client window shape",
      },
    ]);
    assert.equal(persistedBody.incomeSources[0].incomeEndMode, "custom");
    assert.equal(persistedBody.incomeSources[0].incomeEndDate, "2035-06-30");
    assert.equal(persistedBody.incomeSources[0].recurring, true);
    assert.equal(persistedBody.incomeSources[1].frequency, "One-time");
    assert.equal(persistedBody.incomeSources[1].recurring, false);
    assert.equal(persistedBody.incomeSources[1].annualGrowthRate, undefined);
    assert.equal(persistedBody.incomeSources[1].incomeEndDate, undefined);
    assert.deepEqual(persistedBody.incomeReceipts, [{
      id: `receipt-${unique}`,
      incomeSourceId: `inc-${unique}`,
      receivedDate: "2026-09-08",
      amount: 72_500,
      note: "Partial receipt",
      createdAt: "2026-09-08T12:00:00.000Z",
    }]);
    const migratedSalary = persistedBody.incomeSources[2];
    assert.equal(migratedSalary.frequency, "Monthly");
    assert.equal(migratedSalary.recurring, true);
    assert.equal(migratedSalary.amount, 10000);
    assert.equal(migratedSalary.salaryDetails?.grossCTC, 1200000);
    assert.equal(migratedSalary.salaryDetails?.grossCTCMode, "automatic");
    assert.equal(migratedSalary.salaryDetails?.basicPay, 60000);
    assert.equal(migratedSalary.salaryDetails?.employeePF, 6000);
    assert.equal(migratedSalary.salaryDetails?.tds, 10000);
    assert.equal(migratedSalary.salaryDetails?.tdsMode, "automatic");
    assert.equal(migratedSalary.salaryDetails?.taxRegime, "new");
    assert.equal(migratedSalary.salaryDetails?.financialYear, "2025-26");
    assert.equal(migratedSalary.salaryDetails?.taxRuleVersion, "india-fy2025-26-v1");

    const reloaded = await fetch(`http://127.0.0.1:${port}/api/financial-data`);
    const reloadedBody = await reloaded.json() as {
      budgets: typeof persistedBody.budgets;
      incomeSources: typeof persistedBody.incomeSources;
      incomeReceipts: typeof persistedBody.incomeReceipts;
      investments: typeof persistedBody.investments;
      loans: typeof persistedBody.loans;
      plannedExpenses: typeof persistedBody.plannedExpenses;
      netWorthSnapshots: typeof persistedBody.netWorthSnapshots;
      emergencyFund: typeof persistedBody.emergencyFund;
      retirementInputs: typeof persistedBody.retirementInputs;
      profileInputs: typeof persistedBody.profileInputs;
    };
    assert.deepEqual(reloadedBody.incomeSources[2], migratedSalary);
    assert.deepEqual(reloadedBody.incomeReceipts, persistedBody.incomeReceipts);
    assert.deepEqual(
      [...reloadedBody.budgets].sort((left, right) => left.category.localeCompare(right.category)),
      [...persistedBody.budgets].sort((left, right) => left.category.localeCompare(right.category)),
    );
    assert.deepEqual(reloadedBody.loans, persistedBody.loans);
    assert.deepEqual(reloadedBody.plannedExpenses, persistedBody.plannedExpenses);
    assert.deepEqual(reloadedBody.netWorthSnapshots, persistedBody.netWorthSnapshots);
    assert.deepEqual(reloadedBody.emergencyFund, persistedBody.emergencyFund);
    assert.deepEqual(reloadedBody.retirementInputs, persistedBody.retirementInputs);
    assert.deepEqual(
      reloadedBody.profileInputs.onboardingProgress,
      persistedBody.profileInputs.onboardingProgress,
    );
    assert.equal(persistedBody.investments[0].fundAllocations?.[0].amount, 25000);
    assert.equal(persistedBody.investments[0].fundAllocations?.[0].investmentDate, "2030-04-02");
    assert.equal(persistedBody.investments[0].fundAllocations?.[1].amount, 60500);
    assert.deepEqual(
      persistedBody.investments[0].fundAllocations?.map((allocation) => allocation.id),
      ["allocation-1", "allocation-grown-annual"],
    );
    assert.equal(
      persistedBody.investments[0].fundAllocations?.[0].sourceId,
      `legacy-annual-once-${unique}`,
    );
    assert.equal(
      persistedBody.investments[0].fundAllocations?.[0].opportunityDate,
      "2030-04-01",
    );
    assert.deepEqual(reloadedBody.investments[0].fundAllocations, persistedBody.investments[0].fundAllocations);
    assert.deepEqual(persistedBody.investments[0].disposals, [{
      id: "sale-1",
      name: "Listed share sale",
      purchaseDate: "2024-01-15",
      saleDate: "2026-08-20",
      costBasis: 100000,
      proceeds: 180000,
      assetType: "Listed Equity",
      eligibleExemption: 10000,
      indexedCostBasis: 120000,
      grandfatheredValue: 150000,
    }]);
    assert.deepEqual(reloadedBody.investments[0].disposals, persistedBody.investments[0].disposals);
    assert.deepEqual(persistedBody.uiPreferences.investmentOrder, []);
    assert.equal(persistedBody.uiPreferences.investmentSort.by, "manual");

    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    assert.ok(row);
    const [expense] = await db.select().from(expensesTable).where(eq(expensesTable.userId, userId));
    const [budget] = await db
      .select()
      .from(budgetsTable)
      .where(and(eq(budgetsTable.userId, userId), eq(budgetsTable.category, "Food")));
    const [salary] = await db
      .select()
      .from(salaryDetailsTable)
      .where(eq(salaryDetailsTable.incomeSourceId, `legacy-annual-salary-${unique}`));
    const [profile] = await db
      .select()
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, userId));
    assert.equal(profile?.riskPreference, "Growth");
    assert.equal(Number(expense?.amount), 2999);
    assert.deepEqual(budget?.details, { schedules: validBudgetSchedules });
    assert.equal(salary?.grossCtcMode, "automatic");
    assert.equal(salary?.tdsMode, "automatic");
    assert.equal(salary?.taxRegime, "new");
    assert.equal(salary?.financialYear, "2025-26");
    assert.equal(salary?.taxRuleVersion, "india-fy2025-26-v1");

    const withPreferences = await fetch(`http://127.0.0.1:${port}/api/financial-data`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        uiPreferences: {
          hack: true,
          investmentOrder: ["inv-1", "missing", "inv-1"],
          archivedPlanningCategories: ["Pet care", "Pet care", "Old typo"],
          investmentSort: { by: "gain", direction: "asc" },
          loanSort: { by: "not-a-field", direction: "desc" },
        },
      }),
    });
    assert.equal(withPreferences.status, 200);
    const preferenceBody = await withPreferences.json() as {
      uiPreferences: {
        investmentOrder: string[];
        investmentSort: { by: string; direction: string };
        loanSort: { by: string };
        archivedPlanningCategories: string[];
        hack?: unknown;
      };
    };
    assert.deepEqual(preferenceBody.uiPreferences.investmentOrder, ["inv-1", "missing"]);
    assert.deepEqual(preferenceBody.uiPreferences.investmentSort, { by: "gain", direction: "asc" });
    assert.equal(preferenceBody.uiPreferences.loanSort.by, "manual");
    assert.deepEqual(preferenceBody.uiPreferences.archivedPlanningCategories, ["Pet care", "Old typo"]);
    assert.equal("hack" in preferenceBody.uiPreferences, false);

    const scenarioAge = 55;
    const appliedScenario = await fetch(`http://127.0.0.1:${port}/api/financial-data`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        retirementInputs: {
          ...payload.retirementInputs,
          targetRetirementAge: scenarioAge,
        },
        profileInputs: {
          ...payload.profileInputs,
          targetRetirementAge: scenarioAge,
        },
      }),
    });
    assert.equal(appliedScenario.status, 200);
    const appliedScenarioBody = await appliedScenario.json() as {
      retirementInputs: { targetRetirementAge: number; lifeExpectancy: number };
      profileInputs: { targetRetirementAge: number };
    };
    assert.equal(appliedScenarioBody.retirementInputs.targetRetirementAge, scenarioAge);
    assert.equal(appliedScenarioBody.profileInputs.targetRetirementAge, scenarioAge);
    assert.equal(appliedScenarioBody.retirementInputs.lifeExpectancy, payload.retirementInputs.lifeExpectancy);

    const reloadedScenario = await fetch(`http://127.0.0.1:${port}/api/financial-data`);
    assert.equal(reloadedScenario.status, 200);
    const reloadedScenarioBody = await reloadedScenario.json() as typeof appliedScenarioBody;
    assert.equal(reloadedScenarioBody.retirementInputs.targetRetirementAge, scenarioAge);
    assert.equal(reloadedScenarioBody.profileInputs.targetRetirementAge, scenarioAge);
    assert.equal(reloadedScenarioBody.retirementInputs.lifeExpectancy, payload.retirementInputs.lifeExpectancy);

    const withoutReceiptSource = await fetch(`http://127.0.0.1:${port}/api/financial-data`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        incomeSources: payload.incomeSources.slice(1),
        incomeReceipts: [],
      }),
    });
    assert.equal(withoutReceiptSource.status, 200);
    const withoutReceiptSourceBody = await withoutReceiptSource.json() as {
      incomeReceipts: unknown[];
    };
    assert.deepEqual(withoutReceiptSourceBody.incomeReceipts, []);

    const cleared = await fetch(`http://127.0.0.1:${port}/api/financial-data`, {
      method: "DELETE",
    });
    assert.equal(cleared.status, 200);
    const clearedBody = await cleared.json() as {
      expenses: unknown[];
      budgets: unknown[];
      incomeReceipts: unknown[];
    };
    assert.deepEqual(clearedBody.expenses, []);
    assert.deepEqual(clearedBody.budgets, []);
    assert.deepEqual(clearedBody.incomeReceipts, []);
  } finally {
    server.close();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("planning features persist with account isolation and idempotent state", async () => {
  const unique = `${process.pid}-${Date.now()}-features`;
  const userId = `feature-owner-${unique}`;
  const otherUserId = `feature-other-${unique}`;
  await db.insert(usersTable).values([
    { id: userId, email: `${userId}@example.test` },
    { id: otherUserId, email: `${otherUserId}@example.test` },
  ]);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const requested = req.header("x-test-user");
    const authenticatedId = requested === otherUserId ? otherUserId : userId;
    req.isAuthenticated = (() => true) as Request["isAuthenticated"];
    req.user = {
      id: authenticatedId,
      email: `${authenticatedId}@example.test`,
      isAdmin: false,
    } as Express.User;
    next();
  });
  app.use("/api", financeRouter);
  const server = app.listen(0);

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}/api/financial-data`;
    const jsonHeaders = { "Content-Type": "application/json" };
    const goal = {
      id: "home",
      name: "Home deposit",
      targetAmount: 2_000_000,
      currentAmount: 250_000,
      targetDate: "2030-06-01",
      priority: 1,
      monthlyAllocation: 30_000,
      annualInflationRate: 6,
    };
    const goals = await fetch(`${base}/goals`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ goals: [goal, { ...goal, name: "Latest name" }] }),
    });
    assert.equal(goals.status, 200);
    const goalsBody = await goals.json() as { goals: Array<{ id: string; name: string }> };
    assert.deepEqual(goalsBody.goals.map(({ id, name }) => ({ id, name })), [
      { id: "home", name: "Latest name" },
    ]);

    const reminders = await fetch(`${base}/reminders`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({
        reminders: [{
          id: "tax-date",
          title: "Advance tax",
          date: "2027-03-15",
          amount: 50_000,
          recurrence: "yearly",
          enabled: true,
        }],
      }),
    });
    assert.equal(reminders.status, 200);

    const preferences = {
      enabled: true,
      types: {
        budget: true,
        retirement: true,
        goal: true,
        upcoming: true,
        milestone: true,
        tax: false,
        anomaly: true,
      },
      inApp: true,
      push: true,
      quietHours: { start: "22:30", end: "07:15" },
      weeklyDigest: true,
      monthlyReportEmail: true,
      digestDay: 1,
      timeZone: "Asia/Kolkata",
    };
    assert.equal((await fetch(`${base}/notification-preferences`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify(preferences),
    })).status, 200);

    assert.equal((await fetch(`${base}/push-subscriptions`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({
        endpoint: "https://127.0.0.1/push",
        p256dh: "public-key",
        auth: "private-auth-token",
      }),
    })).status, 400);
    assert.equal((await fetch(`${base}/push-subscriptions`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({
        endpoint: "https://fcm.googleapis.com/fcm/send/subscription-1",
        p256dh: "public-key",
        auth: "private-auth-token",
      }),
    })).status, 200);

    const notification = {
      id: "notification-1",
      dedupeKey: "goal:home:2027-01",
      type: "goal",
      title: "Goal update",
      message: "Contribution due",
      createdAt: "2027-01-01T00:00:00.000Z",
      deliverAfter: "2027-01-01T00:00:00.000Z",
      channels: ["in-app"],
    };
    for (let index = 0; index < 2; index += 1) {
      assert.equal((await fetch(`${base}/notifications`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(index === 0 ? notification : { ...notification, id: "duplicate" }),
      })).status, 200);
    }
    const [deliveryProfile] = await db.select().from(userProfilesTable)
      .where(eq(userProfilesTable.userId, userId));
    const deliveryPlanning = deliveryProfile?.planningData as {
      notificationState?: Array<Record<string, unknown>>;
    };
    await db.update(userProfilesTable).set({
      planningData: {
        ...deliveryPlanning,
        notificationState: deliveryPlanning.notificationState?.map((item) => ({
          ...item,
          pushDeliveredAt: "2027-01-01T00:01:00.000Z",
        })),
      } as never,
    }).where(eq(userProfilesTable.userId, userId));

    assert.equal((await fetch(`${base}/monthly-reports`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        month: "2027-01",
        sections: ["income-vs-expected", "expenses-vs-budget-category", "savings-amount-rate", "portfolio-value-returns-change", "net-worth-change", "retirement-date-movement", "health-score-change", "top-next-month-actions"]
          .map((id) => ({ id, title: id, metrics: { netWorth: 1 }, metricFormats: { netWorth: "currency" }, actions: [] })),
      }),
    })).status, 200);
    assert.equal((await fetch(`${base}/monthly-reports`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        month: "2027-01",
        sections: ["income-vs-expected", "expenses-vs-budget-category", "savings-amount-rate", "portfolio-value-returns-change", "net-worth-change", "retirement-date-movement", "health-score-change", "top-next-month-actions"]
          .map((id) => ({ id, title: id, metrics: { netWorth: 999 }, metricFormats: { netWorth: "currency" }, actions: [] })),
      }),
    })).status, 200);

    // A legacy full-document save must not erase feature data it does not know about.
    assert.equal((await fetch(base, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({
        notifications: [notification],
        monthlyReports: [],
        pushSubscriptions: [{
          endpoint: "https://127.0.0.1/push",
          p256dh: "attacker-key",
          auth: "attacker-auth",
        }],
      }),
    })).status, 200);

    const loaded = await (await fetch(base)).json() as {
      goals: unknown[];
      reminders: unknown[];
      notificationPreferences: typeof preferences;
      notifications: Array<{ id: string; dedupeKey: string; readAt?: string; pushDeliveredAt?: string }>;
      pushSubscriptions: Array<Record<string, unknown>>;
      monthlyReports: Array<{
        month: string;
        sections: Array<{ metrics: { netWorth: number } }>;
      }>;
    };
    assert.equal(loaded.goals.length, 1);
    assert.equal(loaded.reminders.length, 1);
    assert.deepEqual(loaded.notificationPreferences, preferences);
    assert.equal(loaded.notifications.length, 1);
    assert.equal(loaded.notifications[0].id, "notification-1");
    assert.equal(loaded.notifications[0].pushDeliveredAt, "2027-01-01T00:01:00.000Z");
    assert.equal(loaded.pushSubscriptions.length, 1);
    assert.equal("p256dh" in loaded.pushSubscriptions[0], false);
    assert.equal("auth" in loaded.pushSubscriptions[0], false);
    assert.equal(loaded.monthlyReports.length, 1);
    assert.equal(loaded.monthlyReports[0].sections[0].metrics.netWorth, 1);

    const isolated = await (await fetch(base, {
      headers: { "x-test-user": otherUserId },
    })).json() as {
      goals: unknown[];
      notifications: unknown[];
      monthlyReports: unknown[];
    };
    assert.deepEqual(isolated.goals, []);
    assert.deepEqual(isolated.notifications, []);
    assert.deepEqual(isolated.monthlyReports, []);
    assert.equal((await fetch(`${base}/notifications/notification-1`, {
      method: "PATCH",
      headers: { ...jsonHeaders, "x-test-user": otherUserId },
      body: JSON.stringify({ read: true }),
    })).status, 404);

    const marked = await fetch(`${base}/notifications/notification-1`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ read: true }),
    });
    assert.equal(marked.status, 200);
    const markedBody = await marked.json() as {
      notifications: Array<{ id: string; readAt?: string }>;
    };
    assert.ok(markedBody.notifications[0].readAt);

    const [profile] = await db.select().from(userProfilesTable)
      .where(eq(userProfilesTable.userId, userId));
    const stored = profile?.planningData as {
      pushSubscriptions?: Array<{ p256dh: string; auth: string }>;
    };
    assert.equal(stored.pushSubscriptions?.[0].p256dh, "public-key");
    assert.equal(stored.pushSubscriptions?.[0].auth, "private-auth-token");

    assert.equal((await fetch(`${base}/push-subscriptions`, {
      method: "PUT",
      headers: { ...jsonHeaders, "x-test-user": otherUserId },
      body: JSON.stringify({
        endpoint: "https://fcm.googleapis.com/fcm/send/subscription-1",
        p256dh: "other-account-key",
        auth: "other-account-auth",
      }),
    })).status, 200);
    const [firstOwnerAfterTransfer, secondOwnerAfterTransfer] = await Promise.all([
      db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, userId)).then((rows) => rows[0]),
      db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, otherUserId)).then((rows) => rows[0]),
    ]);
    assert.equal(((firstOwnerAfterTransfer?.planningData as { pushSubscriptions?: unknown[] })?.pushSubscriptions ?? []).length, 0);
    assert.equal(((secondOwnerAfterTransfer?.planningData as { pushSubscriptions?: unknown[] })?.pushSubscriptions ?? []).length, 1);
    assert.equal((await fetch(`${base}/push-subscriptions`, {
      method: "PUT", headers: jsonHeaders,
      body: JSON.stringify({
        endpoint: "https://fcm.googleapis.com/fcm/send/subscription-1",
        p256dh: "first-account-key", auth: "first-account-auth",
      }),
    })).status, 200);
    const [transferResponse, concurrentPlanningResponse] = await Promise.all([
      fetch(`${base}/push-subscriptions`, {
        method: "PUT", headers: { ...jsonHeaders, "x-test-user": otherUserId },
        body: JSON.stringify({
          endpoint: "https://fcm.googleapis.com/fcm/send/subscription-1",
          p256dh: "other-account-key", auth: "other-account-auth",
        }),
      }),
      fetch(`${base}/goals`, {
        method: "PUT", headers: jsonHeaders, body: JSON.stringify({ goals: [goal] }),
      }),
    ]);
    assert.equal(transferResponse.status, 200);
    assert.equal(concurrentPlanningResponse.status, 200);
    const [ownerAfterConcurrentTransfer] = await db.select()
      .from(userProfilesTable).where(eq(userProfilesTable.userId, userId)).limit(1);
    assert.equal((ownerAfterConcurrentTransfer.planningData?.goals ?? []).length, 1);
  } finally {
    server.close();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await db.delete(usersTable).where(eq(usersTable.id, otherUserId));
  }
});

test("planning category management never rewrites historical expenses", async () => {
  const unique = `${process.pid}-${Date.now()}`;
  const userId = `planning-category-${unique}`;
  const expenseId = `historical-expense-${unique}`;
  await db.insert(usersTable).values({
    id: userId,
    email: `${userId}@example.test`,
  });
  await db.insert(expensesTable).values({
    id: expenseId,
    userId,
    date: "2025-01-15",
    amount: "1800",
    category: "Pet caare",
    merchant: "Veterinary clinic",
    paymentMethod: "Card",
    note: "Historical record",
    createdAt: new Date("2025-01-15T10:00:00.000Z"),
  });
  await db.insert(budgetsTable).values([
    {
      id: `budget-typo-${unique}`,
      userId,
      category: "Pet caare",
      monthlyLimit: "5000",
      details: {},
    },
    {
      id: `budget-unused-${unique}`,
      userId,
      category: "Unused custom",
      monthlyLimit: "0",
      details: {},
    },
    {
      id: `budget-core-${unique}`,
      userId,
      category: "Housing",
      monthlyLimit: "20000",
      details: {},
    },
  ]);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as Request["isAuthenticated"];
    req.user = {
      id: userId,
      email: `${userId}@example.test`,
      isAdmin: false,
    } as Express.User;
    next();
  });
  app.use("/api", financeRouter);
  const server = app.listen(0);

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const [expenseBefore] = await db
      .select()
      .from(expensesTable)
      .where(eq(expensesTable.id, expenseId));

    const renamed = await fetch(
      `http://127.0.0.1:${port}/api/financial-data/planning-categories/${encodeURIComponent("Pet caare")}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", nextCategory: "Pet care" }),
      },
    );
    assert.equal(renamed.status, 200);
    const renamedBody = await renamed.json() as {
      expenses: Array<{ id: string; category: string }>;
      budgets: Array<{ category: string }>;
      uiPreferences: { archivedPlanningCategories: string[] };
    };
    assert.equal(renamedBody.expenses.find((expense) => expense.id === expenseId)?.category, "Pet caare");
    assert.equal(renamedBody.budgets.some((budget) => budget.category === "Pet care"), true);
    assert.deepEqual(renamedBody.uiPreferences.archivedPlanningCategories, ["Pet caare"]);

    const [expenseAfterRename] = await db
      .select()
      .from(expensesTable)
      .where(eq(expensesTable.id, expenseId));
    assert.deepEqual(expenseAfterRename, expenseBefore);

    const archived = await fetch(
      `http://127.0.0.1:${port}/api/financial-data/planning-categories/${encodeURIComponent("Pet care")}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive" }),
      },
    );
    assert.equal(archived.status, 200);
    const archivedBody = await archived.json() as {
      budgets: Array<{ category: string }>;
      uiPreferences: { archivedPlanningCategories: string[] };
    };
    assert.equal(archivedBody.budgets.some((budget) => budget.category === "Pet care"), true);
    assert.deepEqual(
      archivedBody.uiPreferences.archivedPlanningCategories,
      ["Pet caare", "Pet care"],
    );

    const restored = await fetch(
      `http://127.0.0.1:${port}/api/financial-data/planning-categories/${encodeURIComponent("Pet care")}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      },
    );
    assert.equal(restored.status, 200);
    const restoredBody = await restored.json() as {
      budgets: Array<{ category: string; monthlyLimit: number }>;
      uiPreferences: { archivedPlanningCategories: string[] };
    };
    assert.equal(
      restoredBody.budgets.find((budget) => budget.category === "Pet care")?.monthlyLimit,
      5000,
    );
    assert.deepEqual(restoredBody.uiPreferences.archivedPlanningCategories, ["Pet caare"]);

    const archivedUnused = await fetch(
      `http://127.0.0.1:${port}/api/financial-data/planning-categories/${encodeURIComponent("Unused custom")}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive" }),
      },
    );
    assert.equal(archivedUnused.status, 200);
    const unusedBody = await archivedUnused.json() as {
      budgets: Array<{ category: string }>;
    };
    assert.equal(unusedBody.budgets.some((budget) => budget.category === "Unused custom"), true);

    const coreAttempt = await fetch(
      `http://127.0.0.1:${port}/api/financial-data/planning-categories/Housing`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive" }),
      },
    );
    assert.equal(coreAttempt.status, 400);
    const [housingBudget] = await db
      .select()
      .from(budgetsTable)
      .where(and(eq(budgetsTable.userId, userId), eq(budgetsTable.category, "Housing")));
    assert.ok(housingBudget);

    const [expenseAfterArchive] = await db
      .select()
      .from(expensesTable)
      .where(eq(expensesTable.id, expenseId));
    assert.deepEqual(expenseAfterArchive, expenseBefore);
  } finally {
    server.close();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("restoring a legacy archived category recreates an empty usable plan", async () => {
  const unique = `${process.pid}-${Date.now()}`;
  const userId = `legacy-archived-category-${unique}`;
  const category = "Legacy hobby";
  await db.insert(usersTable).values({
    id: userId,
    email: `${userId}@example.test`,
  });
  await db.insert(userProfilesTable).values({
    userId,
    uiPreferences: {
      archivedPlanningCategories: [category],
    },
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as Request["isAuthenticated"];
    req.user = {
      id: userId,
      email: `${userId}@example.test`,
      isAdmin: false,
    } as Express.User;
    next();
  });
  app.use("/api", financeRouter);
  const server = app.listen(0);

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${port}/api/financial-data/planning-categories/${encodeURIComponent(category)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      },
    );

    assert.equal(response.status, 200);
    const body = await response.json() as {
      budgets: Array<{
        category: string;
        monthlyLimit: number;
        windows: Array<{ id: string; monthlyLimit: number; endMode: string }>;
      }>;
      uiPreferences: { archivedPlanningCategories: string[] };
    };
    const restoredBudget = body.budgets.find((budget) => budget.category === category);
    assert.equal(restoredBudget?.monthlyLimit, 0);
    assert.deepEqual(restoredBudget?.windows, [{
      id: restoredBudget?.windows[0]?.id,
      monthlyLimit: 0,
      endMode: "lifelong",
    }]);
    assert.deepEqual(body.uiPreferences.archivedPlanningCategories, []);
  } finally {
    server.close();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("health and retirement planning updates preserve account-linked historical rows", async () => {
  const unique = `${process.pid}-${Date.now()}`;
  const userId = `narrow-planning-${unique}`;
  const accountId = `account-${unique}`;
  const expenseId = `expense-${unique}`;
  await db.insert(usersTable).values({
    id: userId,
    email: `${userId}@example.test`,
  });
  await db.insert(financialAccountsTable).values({
    id: accountId,
    userId,
    name: "Primary account",
  });
  await db.insert(expensesTable).values({
    id: expenseId,
    userId,
    accountId,
    date: "2026-08-10",
    amount: "2500",
    category: "Food & Dining",
    merchant: "Market",
    paymentMethod: "Card",
    note: "Historical row",
    createdAt: new Date("2026-08-10T10:00:00.000Z"),
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as Request["isAuthenticated"];
    req.user = {
      id: userId,
      email: `${userId}@example.test`,
      isAdmin: false,
    } as Express.User;
    next();
  });
  app.use("/api", financeRouter);
  const server = app.listen(0);

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const [before] = await db
      .select()
      .from(expensesTable)
      .where(eq(expensesTable.id, expenseId));

    const health = await fetch(`http://127.0.0.1:${port}/api/financial-data/health`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        emergencyFund: {
          targetMonths: 6,
          reserveBalance: 60_000,
          monthlyContribution: 5_000,
        },
        netWorthSnapshot: {
          month: "2026-09",
          assets: 100_000,
          liabilities: 25_000,
          netWorth: 1,
          healthScore: 55,
        },
      }),
    });
    assert.equal(health.status, 200);
    const healthBody = await health.json() as {
      emergencyFund: { reserveBalance: number };
      netWorthSnapshots: Array<{ netWorth: number }>;
    };
    assert.equal(healthBody.emergencyFund.reserveBalance, 60_000);
    assert.equal(healthBody.netWorthSnapshots[0].netWorth, 75_000);

    for (const partialUpdate of [
      { lifestyleChoice: "Basic" },
      { targetRetirementAge: 62 },
      { pensionSources: [] },
      {
        dateOfBirth: "1990-01-01",
        targetRetirementAge: 121,
        lifeExpectancy: 85,
        generalInflation: 6,
        salaryGrowth: 8,
        monthlyContributionOverride: 0,
        investSurplus: false,
        lifestyleChoice: "Comfortable",
        customLifestyleExpense: 0,
        pensionSources: [],
      },
    ]) {
      const rejected = await fetch(`http://127.0.0.1:${port}/api/financial-data/retirement-plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partialUpdate),
      });
      assert.equal(rejected.status, 400);
    }

    const retirement = await fetch(`http://127.0.0.1:${port}/api/financial-data/retirement-plan`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dateOfBirth: "1990-01-01",
        targetRetirementAge: 60,
        lifeExpectancy: 85,
        generalInflation: 6,
        salaryGrowth: 8,
        monthlyContributionOverride: 0,
        investSurplus: false,
        lifestyleChoice: "Premium",
        customLifestyleExpense: 0,
        pensionSources: [{
          id: "pension",
          name: "Employer pension",
          monthlyAmount: 12_000,
          startAge: 60,
          annualEscalationRate: 5,
        }],
      }),
    });
    assert.equal(retirement.status, 200);

    const [after] = await db
      .select()
      .from(expensesTable)
      .where(eq(expensesTable.id, expenseId));
    assert.deepEqual(after, before);
    assert.equal(after.accountId, accountId);
  } finally {
    server.close();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("financial data routes reject unauthenticated users", async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => false) as Request["isAuthenticated"];
    next();
  });
  app.use("/api", financeRouter);
  const server = app.listen(0);

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/financial-data`);
    assert.equal(response.status, 401);
  } finally {
    server.close();
  }
});

test("restore bypasses current goal affordability without weakening ordinary saves", async () => {
  const userId = `goal-restore-${process.pid}-${Date.now()}`;
  await db.insert(usersTable).values({
    id: userId, email: `${userId}@example.test`, fullName: "Goal Restore",
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as Request["isAuthenticated"];
    req.user = { id: userId, email: `${userId}@example.test`, isAdmin: false } as Express.User;
    next();
  });
  app.use("/api", financeRouter);
  const server = app.listen(0);
  const headers = { "content-type": "application/json" };
  const goal = {
    id: "historical-goal", name: "Historical allocation",
    targetAmount: 1_000_000, currentAmount: 100_000, targetDate: "2030-01-01",
    priority: 1, monthlyAllocation: 30_000, annualInflationRate: 6,
  };
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}/api/financial-data`;
    assert.equal((await fetch(base, {
      method: "PUT", headers, body: JSON.stringify({
        incomeSources: [{
          id: "income", name: "Income", type: "Other", amount: 100_000,
          frequency: "Monthly", recurring: true,
        }],
        budgets: [{ id: "budget", category: "Living", monthlyLimit: 20_000 }],
        goals: [goal],
      }),
    })).status, 200);
    assert.equal((await fetch(base, {
      method: "PUT", headers, body: JSON.stringify({
        incomeSources: [{
          id: "income", name: "Reduced income", type: "Other", amount: 20_000,
          frequency: "Monthly", recurring: true,
        }],
        budgets: [{ id: "budget", category: "Living", monthlyLimit: 20_000 }],
      }),
    })).status, 200);
    const backup = await (await fetch(base)).json() as Record<string, unknown> & {
      goals: unknown[]; incomeSources: unknown[]; budgets: unknown[];
    };
    assert.equal(backup.goals.length, 1);
    assert.deepEqual(
      backup.goals.map((item) => {
        const { createdAt: _createdAt, ...storedGoal } = item as typeof goal & { createdAt?: string };
        return storedGoal;
      }),
      [goal],
    );

    const ordinaryIncrease = await fetch(base, {
      method: "PUT", headers,
      body: JSON.stringify({
        incomeSources: [{
          id: "income", name: "Reduced income", type: "Other", amount: 20_000,
          frequency: "Monthly", recurring: true,
        }],
        budgets: [{ id: "budget", category: "Living", monthlyLimit: 20_000 }],
        goals: [{ ...goal, monthlyAllocation: 30_001 }],
      }),
    });
    assert.equal(ordinaryIncrease.status, 409);
    assert.equal((await ordinaryIncrease.json() as { code: string }).code,
      "GOAL_ALLOCATION_EXCEEDS_SURPLUS");

    assert.equal((await fetch(base, { method: "DELETE" })).status, 200);
    assert.equal((await fetch(`${base}/restore`, {
      method: "POST", headers, body: JSON.stringify(backup),
    })).status, 200);
    const restored = await (await fetch(base)).json() as {
      goals: unknown[]; incomeSources: unknown[]; budgets: unknown[];
    };
    assert.deepEqual(restored.goals, backup.goals);
    assert.deepEqual(restored.incomeSources, backup.incomeSources);
    assert.deepEqual(restored.budgets, backup.budgets);
  } finally {
    server.close();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("goal allocations cannot exceed the locked confirmed surplus", async () => {
  const userId = `goal-surplus-${process.pid}-${Date.now()}`;
  await db.insert(usersTable).values({ id: userId, email: `${userId}@example.test` });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as Request["isAuthenticated"];
    req.user = { id: userId, email: `${userId}@example.test`, isAdmin: false } as Express.User;
    next();
  });
  app.use("/api", financeRouter);
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}/api/financial-data`;
    const seeded = await fetch(base, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incomeSources: [{ id: "income", amount: 100_000, frequency: "Monthly", recurring: true }],
        budgets: [{ id: "budget", category: "Living", monthlyLimit: 50_000 }],
        investments: [{
          id: "sip", name: "Ordinary SIP", type: "Mutual Fund", currentValue: 0,
          investedAmount: 0, monthlyContribution: 20_000, autoManagedContribution: false,
        }],
      }),
    });
    assert.equal(seeded.status, 200);
    const goal = {
      id: "over", name: "Overcommitted", targetAmount: 1, currentAmount: 0,
      targetDate: "2030-01-01", priority: 1, monthlyAllocation: 30_001, annualInflationRate: 0,
    };
    const rejected = await fetch(`${base}/goals`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goals: [goal] }),
    });
    assert.equal(rejected.status, 409);
    assert.equal((await rejected.json() as { code: string }).code, "GOAL_ALLOCATION_EXCEEDS_SURPLUS");
    const wholeDocumentRejected = await fetch(base, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incomeSources: [{ id: "income", amount: 100_000, frequency: "Monthly", recurring: true }],
        budgets: [{ id: "budget", category: "Living", monthlyLimit: 50_000 }],
        investments: [{
          id: "sip", name: "Ordinary SIP", type: "Mutual Fund", currentValue: 0,
          investedAmount: 0, monthlyContribution: 20_000, autoManagedContribution: false,
        }],
        goals: [goal],
      }),
    });
    assert.equal(wholeDocumentRejected.status, 409);
    const payrollManagedAccepted = await fetch(base, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incomeSources: [{ id: "income", amount: 100_000, frequency: "Monthly", recurring: true }],
        budgets: [{ id: "budget", category: "Living", monthlyLimit: 50_000 }],
        investments: [{
          id: "pf", name: "Salary-linked PF", type: "EPF", currentValue: 0,
          investedAmount: 0, monthlyContribution: 20_000, autoManagedContribution: true,
          linkedIncomeSourceId: "income",
        }],
        goals: [{ ...goal, monthlyAllocation: 50_000 }],
      }),
    });
    assert.equal(payrollManagedAccepted.status, 200);
    const salarySeeded = await fetch(base, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incomeSources: [{
          id: "salary", name: "Salary", type: "Salary", amount: 100_000,
          frequency: "Monthly", recurring: true, date: "2025-01-01",
          salaryDetails: {
            basicPay: 100_000, hra: 0, allowances: 0, employeePF: 20_000,
            professionalTax: 0, tds: 0, otherDeductions: 0,
          },
        }],
        budgets: [{ id: "budget", category: "Living", monthlyLimit: 50_000 }],
        goals: [],
      }),
    });
    assert.equal(salarySeeded.status, 200);
    const salaryOverAllocation = await fetch(`${base}/goals`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goals: [{ ...goal, monthlyAllocation: 30_001 }] }),
    });
    assert.equal(salaryOverAllocation.status, 409);
    const fundedEmergencyAccepted = await fetch(base, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incomeSources: [{
          id: "income", name: "Income", type: "Other", amount: 100_000,
          frequency: "Monthly", recurring: true, date: "2025-01-01",
        }],
        budgets: [{ id: "budget", category: "Living", monthlyLimit: 50_000 }],
        emergencyFund: { targetMonths: 6, reserveBalance: 300_000, monthlyContribution: 10_000 },
        goals: [{ ...goal, monthlyAllocation: 50_000 }],
      }),
    });
    assert.equal(fundedEmergencyAccepted.status, 200);
    const unrelatedBoundarySave = await fetch(base, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incomeSources: [{
          id: "future", name: "Future", type: "Other", amount: 100_000,
          frequency: "Monthly", recurring: true, date: "2099-01-01",
        }],
        goals: [{ ...goal, monthlyAllocation: 50_000 }],
        notificationPreferences: { enabled: false },
      }),
    });
    assert.equal(unrelatedBoundarySave.status, 200);
    const invalidGoalEdit = await fetch(base, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goals: [{ ...goal, name: "x".repeat(161), monthlyAllocation: 50_000 }],
      }),
    });
    assert.equal(invalidGoalEdit.status, 400);
    const afterInvalidGoalEdit = await (await fetch(base)).json() as {
      goals: Array<{ id: string; name: string }>;
    };
    assert.equal(afterInvalidGoalEdit.goals.length, 1);
    assert.equal(afterInvalidGoalEdit.goals[0].id, goal.id);
    assert.equal(afterInvalidGoalEdit.goals[0].name, goal.name);
    const reducedGoal = { ...goal, name: "Reduced safely", monthlyAllocation: 40_000 };
    assert.equal((await fetch(`${base}/goals`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goals: [reducedGoal] }),
    })).status, 200);
    const renamedGoal = { ...reducedGoal, name: "Renamed while over-allocated" };
    assert.equal((await fetch(`${base}/goals`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goals: [renamedGoal] }),
    })).status, 200);
    assert.equal((await fetch(base, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incomeSources: [{
          id: "future", name: "Future", type: "Other", amount: 100_000,
          frequency: "Monthly", recurring: true, date: "2099-01-01",
        }],
        goals: [{ ...renamedGoal, monthlyAllocation: 30_000 }],
      }),
    })).status, 200);
    assert.equal((await fetch(`${base}/goals`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goals: [{ ...renamedGoal, monthlyAllocation: 30_001 }] }),
    })).status, 409);
    const endedSipSeeded = await fetch(base, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incomeSources: [{
          id: "income", name: "Income", type: "Other", amount: 100_000,
          frequency: "Monthly", recurring: true, date: "2025-01-01",
        }],
        budgets: [{ id: "budget", category: "Living", monthlyLimit: 50_000 }],
        investments: [{
          id: "ended", name: "Ended SIP", type: "Mutual Fund", currentValue: 0,
          investedAmount: 0, monthlyContribution: 20_000,
          contributionStartDate: "2025-01-01", contributionEndMode: "custom",
          contributionEndDate: "2025-12-31",
        }],
        goals: [],
      }),
    });
    assert.equal(endedSipSeeded.status, 200);
    assert.equal((await fetch(`${base}/goals`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goals: [{ ...goal, monthlyAllocation: 50_000 }] }),
    })).status, 200);
    const futureIncomeSeeded = await fetch(base, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incomeSources: [{
          id: "future-income", name: "Future income", type: "Other", amount: 100_000,
          frequency: "Monthly", recurring: true, date: "2099-01-01",
        }],
        goals: [],
      }),
    });
    assert.equal(futureIncomeSeeded.status, 200);
    assert.equal((await fetch(`${base}/goals`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goals: [{ ...goal, monthlyAllocation: 1 }] }),
    })).status, 409);
  } finally {
    server.close();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("goal affordability averages historical living expenses through both write paths", async () => {
  const userId = `goal-history-${process.pid}-${Date.now()}`;
  await db.insert(usersTable).values({ id: userId, email: `${userId}@example.test` });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as Request["isAuthenticated"];
    req.user = { id: userId, email: `${userId}@example.test`, isAdmin: false } as Express.User;
    next();
  });
  app.use("/api", financeRouter);
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}/api/financial-data`;
    const today = new Date();
    const expenses = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(today.getFullYear(), today.getMonth() - 6 + index, 10);
      return {
        id: `rent-${index}`, date: date.toISOString().slice(0, 10),
        amount: 20_000, category: "Housing", merchant: "Landlord",
        paymentMethod: "Transfer", recurring: true,
      };
    });
    const incomeSources = [{
      id: "income", name: "Income", type: "Other", amount: 100_000,
      frequency: "Monthly", recurring: true, date: "2025-01-01",
    }];
    assert.equal((await fetch(base, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incomeSources, expenses, budgets: [], loans: [], investments: [], goals: [] }),
    })).status, 200);
    const goal = {
      id: "history-goal", name: "History goal", targetAmount: 1_000_000,
      currentAmount: 0, targetDate: "2030-01-01", priority: 1,
      monthlyAllocation: 70_000, annualInflationRate: 0,
    };
    assert.equal((await fetch(`${base}/goals`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goals: [goal] }),
    })).status, 200);
    assert.equal((await fetch(base, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incomeSources, expenses, budgets: [], loans: [], investments: [],
        goals: [{ ...goal, monthlyAllocation: 80_000 }],
      }),
    })).status, 200);
    assert.equal((await fetch(`${base}/goals`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goals: [{ ...goal, monthlyAllocation: 80_001 }] }),
    })).status, 409);
    const nextCalendarMonth = (today.getMonth() + 1) % 12;
    const annualBudget = [{
      id: "annual-budget", category: "Annual plan", monthlyLimit: 20_000,
      windows: [{
        id: "annual-window", startDate: "2020-01-01", monthlyLimit: 20_000,
        cadence: "yearly", annualMonth: nextCalendarMonth, endMode: "lifelong",
      }],
    }];
    // An effective annual plan owns the client baseline even when zero is due
    // this month; the server must not fall back to historical actuals.
    assert.equal((await fetch(base, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incomeSources, expenses, budgets: annualBudget, loans: [], investments: [],
        goals: [{ ...goal, monthlyAllocation: 100_000 }],
      }),
    })).status, 200);
    assert.equal((await fetch(`${base}/goals`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goals: [{ ...goal, monthlyAllocation: 100_001 }] }),
    })).status, 409);
    const futureContributionDate = new Date(
      today.getFullYear(),
      today.getMonth(),
      Math.min(
        new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate(),
        today.getDate() + 5,
      ),
    );
    assert.ok(futureContributionDate.getDate() > today.getDate(), "test requires a later day this month");
    const futureInvestment = [{
      id: "future-sip", name: "Future SIP", type: "Mutual Fund",
      investedAmount: 0, currentValue: 0, expectedReturn: 8,
      monthlyContribution: 20_000,
      contributionStartDate: futureContributionDate.toISOString().slice(0, 10),
      contributionEndMode: "retirement",
    }];
    const monthlyBudget = [{ id: "monthly", category: "Living", monthlyLimit: 50_000 }];
    assert.equal((await fetch(base, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incomeSources, expenses: [], budgets: monthlyBudget, loans: [],
        investments: futureInvestment, goals: [],
      }),
    })).status, 200);
    assert.equal((await fetch(`${base}/goals`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goals: [{ ...goal, monthlyAllocation: 40_000 }] }),
    })).status, 200);
    assert.equal((await fetch(base, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incomeSources, expenses: [], budgets: monthlyBudget, loans: [],
        investments: futureInvestment,
        goals: [{ ...goal, monthlyAllocation: 50_000 }],
      }),
    })).status, 200);
    assert.equal((await fetch(`${base}/goals`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goals: [{ ...goal, monthlyAllocation: 50_001 }] }),
    })).status, 409);
  } finally {
    server.close();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});
