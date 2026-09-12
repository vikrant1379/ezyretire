import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import {
  accountDataExportsTable,
  accountDeletionObjectsTable,
  accountDeletionRequestsTable,
  bankStatementImportProvenanceTable,
  db,
  pool,
  expensesTable,
  mobileOtpChallengesTable,
  receiptReviewsTable,
  sessionsTable,
  usersTable,
  vaultDeletionJobsTable,
  vaultDocumentsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import {
  ACCOUNT_EXPORT_VERSION,
  ACCOUNT_FENCE_ADMISSION_CAPACITY,
  accountEmailHash,
  accountHash,
  acquireAccountWriteFence,
  buildAccountExport,
  buildAccountExportZip,
  chunkDeletionInventoryRows,
  processAccountDeletion,
  revokeAllUserSessions,
  runAccountComplianceMaintenance,
  scheduleAccountDeletion,
  withAccountWriteFence,
  setDeletionStatusTestHook,
  streamAccountExportZip,
  setExportSnapshotTestHook,
  setExportStagingTestHook,
  setExportFinalizeTestHook,
  setExportFailureAuditTestHook,
  setFenceCommitTestHook,
  setFenceAdmissionTestHook,
  setSessionRevocationTestHook,
} from "./account-compliance.js";
import {
  accountMutationGuard,
  setAccountMutationAdmissionTimeoutForTests,
} from "../middlewares/accountMutationGuard.js";
import internalMaintenanceRouter from "../routes/internal-maintenance.js";
import { setVaultFileForTests, setVaultObjectDeletionForTests } from "./object-storage.js";
import { PassThrough, Readable } from "node:stream";
import AdmZip from "adm-zip";
import { EventEmitter } from "node:events";
import { sendFinancialDataStream } from "../routes/finance.js";

function testUser(id: string) {
  return {
    id,
    email: `${id}@example.test`,
    fullName: "Compliance Test",
    phone: "+911234567890",
    dateOfBirth: "1990-01-02",
    gender: "other",
    onboardingCompleted: true,
  };
}

async function bounded<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test("Vercel schedules account deletion processing", () => {
  let workspaceRoot = process.cwd();
  while (
    path.dirname(workspaceRoot) !== workspaceRoot
    && !fs.existsSync(path.join(workspaceRoot, "pnpm-workspace.yaml"))
  ) {
    workspaceRoot = path.dirname(workspaceRoot);
  }
  const config = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "vercel.json"), "utf8"));
  assert.ok(config.crons.some((cron: { path: string }) =>
    cron.path === "/api/internal/process-account-deletions"));
});

test("disk-staged HTTP export has no arbitrary account total-byte ceiling", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/lib/account-compliance.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /MAX_ACCOUNT_EXPORT_STAGING_BYTES|export exceeds staging limit/);
  assert.match(source, /archive\.pipe\(output\)/);
  assert.match(source, /ACCOUNT_EXPORT_GENERATION_DEADLINE_MS = 240_000/);
  assert.match(source, /removeStagedExport\(staged\.directory, staged\.filePath\)/);
});

test("personal export is complete and isolated to its account", async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const owner = testUser(`export-owner-${suffix}`);
  const other = testUser(`export-other-${suffix}`);
  const ownerArchivedAt = new Date("2026-02-03T04:05:06.789Z");
  const otherArchivedAt = new Date("2028-09-10T11:12:13.456Z");
  await db.insert(usersTable).values([owner, other]);
  await db.insert(expensesTable).values([
    { id: `owner-expense-${suffix}`, userId: owner.id, amount: "123", date: "2026-01-01" },
    { id: `other-expense-${suffix}`, userId: other.id, amount: "999", date: "2026-01-02" },
  ]);
  await db.insert(bankStatementImportProvenanceTable).values({
    userId: owner.id, importId: "import-1", sourceRowId: "row-1", bank: "hdfc",
    parserVersion: "1", expenseId: `owner-expense-${suffix}`,
  });
  const [document] = await db.insert(vaultDocumentsTable).values([
    {
      userId: owner.id, objectPath: `private/${owner.id}/secret.pdf`, name: "Tax.pdf",
      contentType: "application/pdf", size: 42, category: "tax",
      expiresOn: "2027-08-09", archivedAt: ownerArchivedAt,
    },
    {
      userId: other.id, objectPath: `private/${other.id}/other-secret.pdf`,
      name: "Other account secret.pdf", contentType: "application/pdf", size: 999,
      category: "other-account-category", expiresOn: "2031-12-13",
      archivedAt: otherArchivedAt,
    },
  ]).returning();
  await db.insert(receiptReviewsTable).values({
    userId: owner.id, documentId: document.id, cleanupObjectPath: `private/${owner.id}/cleanup`,
    candidates: [], expiresAt: new Date(Date.now() + 60_000),
  });
  await db.insert(vaultDeletionJobsTable).values({
    userId: owner.id, objectPath: `private/${owner.id}/failed`, reason: "test",
    lastError: "provider-secret-error",
  });
  await db.insert(mobileOtpChallengesTable).values({
    userId: owner.id, phone: "+911234567890", requesterHash: "requester-secret",
    codeHash: "otp-secret-hash", deliveryChannel: "sms",
    expiresAt: new Date(Date.now() + 60_000), resendAvailableAt: new Date(),
  });
  try {
    const exported = await buildAccountExport(owner.id);
    assert.ok(exported);
    assert.equal(exported.manifest.version, ACCOUNT_EXPORT_VERSION);
    assert.equal(exported.manifest.complete, true);
    assert.equal(exported.manifest.recordCounts.expenses, 1);
    assert.deepEqual(exported.data.expenses.map((row) => row.id), [`owner-expense-${suffix}`]);
    assert.equal(JSON.stringify(exported).includes(`other-expense-${suffix}`), false);
    assert.equal("passwordHash" in JSON.parse(JSON.stringify(exported)).data.account[0], false);
    assert.equal(exported.data.account[0].phone, owner.phone);
    assert.equal(exported.data.account[0].dateOfBirth, owner.dateOfBirth);
    assert.equal(exported.data.account[0].gender, owner.gender);
    assert.equal(exported.data.account[0].onboardingCompleted, true);
    assert.equal(typeof exported.data.account[0].createdAt, "string");
    assert.equal(exported.data.bankStatementImportProvenance[0].sourceRowId, "row-1");
    assert.equal(exported.manifest.recordCounts.vaultDocuments, 1);
    assert.equal(exported.data.vaultDocuments.length, 1);
    assert.deepEqual(exported.data.vaultDocuments[0], {
      id: document.id,
      userId: owner.id,
      name: "Tax.pdf",
      contentType: "application/pdf",
      size: 42,
      category: "tax",
      expiresOn: "2027-08-09",
      archivedAt: ownerArchivedAt.toISOString(),
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    });
    const serialized = JSON.stringify(exported);
    for (const otherMetadata of [
      "Other account secret.pdf", "other-account-category", "2031-12-13",
      otherArchivedAt.toISOString(),
    ]) assert.equal(serialized.includes(otherMetadata), false, `export leaked ${otherMetadata}`);
    for (const forbidden of [
      "objectPath", "cleanupObjectPath", "lastError", "codeHash",
      "otp-secret-hash", "provider-secret-error", `private/${owner.id}`,
    ]) assert.equal(serialized.includes(forbidden), false, `export leaked ${forbidden}`);
  } finally {
    await db.delete(usersTable).where(sql`${usersTable.id} in (${owner.id}, ${other.id})`);
    await db.delete(accountDataExportsTable).where(sql`${accountDataExportsTable.userId} in (${owner.id}, ${other.id})`);
  }
});

test("ZIP export contains only data and human-readable index entries", async () => {
  const id = `zip-export-${process.pid}-${Date.now()}`;
  await db.insert(usersTable).values(testUser(id));
  const [document] = await db.insert(vaultDocumentsTable).values({
    userId: id, objectPath: "/objects/vault-documents/00000000-0000-4000-8000-000000000001",
    name: "My statement.pdf", contentType: "application/pdf", size: 10,
  }).returning();
  const fileBytes = Buffer.from("exact-file-bytes");
  setVaultFileForTests(() => ({
    createReadStream: () => Readable.from([fileBytes]),
  } as never));
  try {
    const archive = await buildAccountExportZip(id);
    assert.ok(archive);
    const zip = new AdmZip(archive);
    const names = zip.getEntries().map((entry) => entry.entryName).sort();
    assert.deepEqual(names, [
      "data.json", `files/${document.id}-My_statement.pdf`, "index.html",
    ].sort());
    const data = JSON.parse(zip.readAsText("data.json"));
    assert.equal(data.manifest.complete, true);
    assert.equal(data.data.account[0].id, id);
    assert.match(zip.readAsText("index.html"), /ezyRetire personal data export/);
    assert.deepEqual(zip.readFile(`files/${document.id}-My_statement.pdf`), fileBytes);
    assert.equal(zip.readAsText("data.json").includes("objectPath"), false);
  } finally {
    setVaultFileForTests();
    await db.delete(accountDataExportsTable).where(eq(accountDataExportsTable.userId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

test("unreadable vault bytes fail the ZIP and audit", async () => {
  const id = `zip-failure-${process.pid}-${Date.now()}`;
  await db.insert(usersTable).values(testUser(id));
  await db.insert(vaultDocumentsTable).values({
    userId: id, objectPath: `/objects/vault-documents/${randomUUID()}`,
    name: "unreadable.pdf", contentType: "application/pdf", size: 10,
  });
  setVaultFileForTests(() => ({
    createReadStream: () => { throw new Error("object read failed"); },
  } as never));
  try {
    await assert.rejects(() => buildAccountExportZip(id));
    const [audit] = await db.select().from(accountDataExportsTable)
      .where(eq(accountDataExportsTable.userId, id));
    assert.equal(audit?.status, "failed");
  } finally {
    setVaultFileForTests();
    await db.delete(accountDataExportsTable).where(eq(accountDataExportsTable.userId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

test("premature ZIP destination close fails its audit and releases the fence", async () => {
  const id = `zip-abort-${process.pid}-${Date.now()}`;
  await db.insert(usersTable).values(testUser(id));
  const destination = new PassThrough();
  destination.once("data", () => destination.destroy());
  await assert.rejects(() => streamAccountExportZip(id, destination));
  const audits = await db.select().from(accountDataExportsTable)
    .where(eq(accountDataExportsTable.userId, id));
  assert.equal(audits.some((audit) => audit.status === "started"), false);
  assert.equal(audits.filter((audit) => audit.status === "failed").length, 1);
  await withAccountWriteFence(id, async () => db.execute(sql`select 1`));
  await db.delete(accountDataExportsTable).where(eq(accountDataExportsTable.userId, id));
  await db.delete(usersTable).where(eq(usersTable.id, id));
});

test("ZIP disconnect aborts and settles a pending vault read before fence release and temp cleanup", {
  timeout: 30_000,
}, async () => {
  const id = `zip-read-abort-${process.pid}-${Date.now()}`;
  const objectPath = `/objects/vault-documents/${randomUUID()}`;
  await db.insert(usersTable).values(testUser(id));
  await db.insert(vaultDocumentsTable).values({
    userId: id, objectPath, name: "pending.pdf", contentType: "application/pdf", size: 10,
  });
  let readStarted!: () => void;
  const started = new Promise<void>((resolve) => { readStarted = resolve; });
  let readSettled = false;
  let pendingRead: Readable | undefined;
  const stagedPaths: string[] = [];
  const removedPaths: string[] = [];
  setVaultFileForTests(() => ({
    createReadStream: () => {
      pendingRead = new Readable({
        read() { readStarted(); },
        destroy(error, callback) {
          setTimeout(() => {
            readSettled = true;
            callback(error);
          }, 25);
        },
      });
      return pendingRead;
    },
  } as never));
  setExportStagingTestHook((event, filePath) => {
    if (event === "created") stagedPaths.push(filePath);
    if (event === "removed") removedPaths.push(filePath);
  });
  const destination = new PassThrough();
  let operation: Promise<boolean> | undefined;
  try {
    operation = streamAccountExportZip(id, destination);
    await bounded(started, 15_000, "vault read start");
    destination.destroy();
    await assert.rejects(
      bounded(operation, 20_000, "disconnect settlement"),
      (error: Error) => {
        assert.doesNotMatch(error.message, /timed out/);
        return true;
      },
    );
    assert.equal(readSettled, true);
    await bounded(
      withAccountWriteFence("zip-read-abort-successor", async () => {
        assert.equal(readSettled, true);
        await db.execute(sql`select 1`);
      }),
      5_000,
      "post-abort account admission",
    );
    assert.equal(stagedPaths.length, 1);
    assert.deepEqual(removedPaths, stagedPaths);
    assert.equal(fs.existsSync(stagedPaths[0]), false);
    const [audit] = await db.select().from(accountDataExportsTable)
      .where(eq(accountDataExportsTable.userId, id));
    assert.equal(audit?.status, "failed");
  } finally {
    pendingRead?.destroy();
    if (operation) await bounded(Promise.allSettled([operation]), 5_000, "disconnect cleanup");
    setVaultFileForTests();
    setExportStagingTestHook();
    await db.delete(accountDataExportsTable).where(eq(accountDataExportsTable.userId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

test("ZIP disconnect during finalization tears streams down before fence release and temp cleanup", {
  timeout: 30_000,
}, async () => {
  const id = `zip-finalize-abort-${process.pid}-${Date.now()}`;
  await db.insert(usersTable).values(testUser(id));
  let finalizing!: () => void;
  const finalizeStarted = new Promise<void>((resolve) => { finalizing = resolve; });
  const stagedPaths: string[] = [];
  const removedPaths: string[] = [];
  setExportFinalizeTestHook((archive) => {
    archive.pause();
    finalizing();
  });
  setExportStagingTestHook((event, filePath) => {
    if (event === "created") stagedPaths.push(filePath);
    if (event === "removed") removedPaths.push(filePath);
  });
  const destination = new PassThrough();
  let operation: Promise<boolean> | undefined;
  try {
    operation = streamAccountExportZip(id, destination);
    await bounded(finalizeStarted, 15_000, "archive finalization start");
    destination.destroy();
    await assert.rejects(
      bounded(operation, 10_000, "finalization disconnect settlement"),
      (error: Error) => {
        assert.doesNotMatch(error.message, /timed out/);
        return true;
      },
    );
    await bounded(
      withAccountWriteFence("zip-finalize-abort-successor", async () => db.execute(sql`select 1`)),
      5_000,
      "post-finalization-abort account admission",
    );
    assert.equal(stagedPaths.length, 1);
    assert.deepEqual(removedPaths, stagedPaths);
    assert.equal(fs.existsSync(stagedPaths[0]), false);
  } finally {
    destination.destroy();
    if (operation) await bounded(Promise.allSettled([operation]), 5_000, "finalization cleanup");
    setExportFinalizeTestHook();
    setExportStagingTestHook();
    await db.delete(accountDataExportsTable).where(eq(accountDataExportsTable.userId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

test("slow ZIP egress starts after staging releases admission and always removes its temp file", {
  timeout: 30_000,
}, async () => {
  const id = `zip-slow-egress-${process.pid}-${Date.now()}`;
  await db.insert(usersTable).values(testUser(id));
  let ready!: (filePath: string) => void;
  const stagingReady = new Promise<string>((resolve) => { ready = resolve; });
  const removedPaths: string[] = [];
  setExportStagingTestHook((event, filePath) => {
    if (event === "ready") ready(filePath);
    if (event === "removed") removedPaths.push(filePath);
  });
  const destination = new PassThrough({ highWaterMark: 1 });
  let settled = false;
  let operation: Promise<boolean> | undefined;
  let successor: Promise<void> | undefined;
  try {
    operation = streamAccountExportZip(id, destination).finally(() => { settled = true; });
    void operation.catch(() => undefined);
    const stagedPath = await bounded(stagingReady, 20_000, "export staging");
    assert.equal(fs.existsSync(stagedPath), true);
    let admitted!: () => void;
    const admission = new Promise<void>((resolve) => { admitted = resolve; });
    setFenceAdmissionTestHook((userId) => {
      if (userId === "zip-slow-egress-unrelated") admitted();
    });
    successor = withAccountWriteFence("zip-slow-egress-unrelated", async () => undefined);
    await bounded(admission, 250, "unrelated account admission");
    assert.equal(settled, false);
    destination.resume();
    assert.equal(await bounded(operation, 5_000, "staged export egress"), true);
    await bounded(successor, 5_000, "unrelated account completion");
    assert.deepEqual(removedPaths, [stagedPath]);
    assert.equal(fs.existsSync(stagedPath), false);
  } finally {
    destination.resume();
    destination.destroy();
    if (operation) await bounded(Promise.allSettled([operation]), 5_000, "egress cleanup");
    if (successor) await bounded(Promise.allSettled([successor]), 5_000, "admission cleanup");
    setFenceAdmissionTestHook();
    setExportStagingTestHook();
    await db.delete(accountDataExportsTable).where(eq(accountDataExportsTable.userId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

test("stalled export generation does not delay an unrelated account admission", {
  timeout: 30_000,
}, async () => {
  assert.ok(ACCOUNT_FENCE_ADMISSION_CAPACITY >= 2);
  const id = `zip-stalled-account-${process.pid}-${Date.now()}`;
  await db.insert(usersTable).values(testUser(id));
  let entered!: () => void;
  const snapshotEntered = new Promise<void>((resolve) => { entered = resolve; });
  let continueSnapshot!: () => void;
  const snapshotContinue = new Promise<void>((resolve) => { continueSnapshot = resolve; });
  setExportSnapshotTestHook(async (userId) => {
    if (userId !== id) return;
    entered();
    await snapshotContinue;
  });
  const destination = new PassThrough();
  const exportOperation = streamAccountExportZip(id, destination);
  void exportOperation.catch(() => undefined);
  let unrelated: Promise<void> | undefined;
  try {
    await bounded(snapshotEntered, 15_000, "stalled export snapshot");
    let admitted!: () => void;
    const admission = new Promise<void>((resolve) => { admitted = resolve; });
    setFenceAdmissionTestHook((userId) => {
      if (userId === "zip-stalled-unrelated") admitted();
    });
    unrelated = withAccountWriteFence("zip-stalled-unrelated", async () => undefined);
    await bounded(admission, 250, "unrelated stalled-export admission");
    assert.equal(destination.destroyed, false);
    continueSnapshot();
    destination.resume();
    assert.equal(await bounded(exportOperation, 10_000, "stalled export completion"), true);
    await bounded(unrelated, 5_000, "unrelated stalled-export completion");
  } finally {
    continueSnapshot();
    destination.resume();
    destination.destroy();
    await Promise.allSettled([
      exportOperation,
      ...(unrelated ? [unrelated] : []),
    ]);
    setFenceAdmissionTestHook();
    setExportSnapshotTestHook();
    await db.delete(accountDataExportsTable).where(eq(accountDataExportsTable.userId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

test("ZIP cancellation while queued behind bounded admission settles without a pool leak", {
  timeout: 30_000,
}, async () => {
  const before = pool.totalCount - pool.idleCount;
  const holders = await Promise.all(Array.from(
    { length: ACCOUNT_FENCE_ADMISSION_CAPACITY },
    (_, index) => acquireAccountWriteFence(`zip-capacity-holder-${index}`),
  ));
  const destination = new PassThrough();
  const operation = streamAccountExportZip("zip-queued-account", destination);
  const rejected = assert.rejects(operation, /closed|abort/i);
  await new Promise((resolve) => setImmediate(resolve));
  destination.destroy();
  await rejected;
  await Promise.all(holders.map((release) => release()));
  await withAccountWriteFence("zip-capacity-successor", async () => db.execute(sql`select 1`));
  assert.equal(pool.totalCount - pool.idleCount, before);
});

test("20ms export deadline aborts queued fence admission without poisoning successors", {
  timeout: 5_000,
}, async () => {
  const id = `zip-deadline-queued-${process.pid}-${Date.now()}`;
  const release = await acquireAccountWriteFence(id);
  const destination = new PassThrough();
  const created: string[] = [];
  const removed: string[] = [];
  setExportStagingTestHook((event, filePath) => {
    if (event === "created") created.push(filePath);
    if (event === "removed") removed.push(filePath);
  });
  try {
    const started = Date.now();
    await assert.rejects(
      streamAccountExportZip(id, destination, { generationDeadlineMs: 20 }),
      /deadline/i,
    );
    assert.ok(Date.now() - started < 250);
    assert.equal(created.length, 1);
    assert.deepEqual(removed, created);
    assert.equal(fs.existsSync(created[0]), false);
  } finally {
    await release();
    destination.destroy();
    setExportStagingTestHook();
  }
  let admitted!: () => void;
  const admission = new Promise<void>((resolve) => { admitted = resolve; });
  setFenceAdmissionTestHook((userId) => {
    if (userId === "zip-deadline-queued-successor") admitted();
  });
  try {
    const successor = withAccountWriteFence(
      "zip-deadline-queued-successor",
      async () => db.execute(sql`select 1`),
    );
    await bounded(admission, 250, "queued deadline successor admission");
    await successor;
  } finally {
    setFenceAdmissionTestHook();
  }
});

test("20ms export egress deadline aborts a slow staged download and removes its temp file", {
  timeout: 15_000,
}, async () => {
  const id = `zip-deadline-egress-${process.pid}-${Date.now()}`;
  await db.insert(usersTable).values(testUser(id));
  const destination = new PassThrough({ highWaterMark: 1 });
  const cancellation = new AbortController();
  const created: string[] = [];
  const removed: string[] = [];
  setExportStagingTestHook((event, filePath) => {
    if (event === "created") created.push(filePath);
    if (event === "ready") {
      const timer = setTimeout(
        () => cancellation.abort(new Error("20ms egress deadline exceeded")),
        20,
      );
      timer.unref();
    }
    if (event === "removed") removed.push(filePath);
  });
  try {
    const started = Date.now();
    await assert.rejects(
      streamAccountExportZip(id, destination, {
        generationDeadlineMs: 10_000,
        signal: cancellation.signal,
      }),
      /deadline|abort/i,
    );
    assert.ok(Date.now() - started < 10_000);
    assert.equal(created.length, 1);
    assert.deepEqual(removed, created);
    assert.equal(fs.existsSync(created[0]), false);
    let admitted!: () => void;
    const admission = new Promise<void>((resolve) => { admitted = resolve; });
    setFenceAdmissionTestHook((userId) => {
      if (userId === "zip-deadline-egress-successor") admitted();
    });
    try {
      const successor = withAccountWriteFence(
        "zip-deadline-egress-successor",
        async () => db.execute(sql`select 1`),
      );
      await bounded(admission, 250, "egress deadline successor admission");
      await successor;
    } finally {
      setFenceAdmissionTestHook();
    }
  } finally {
    destination.destroy();
    setExportStagingTestHook();
    await db.delete(accountDataExportsTable).where(eq(accountDataExportsTable.userId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

test("locked failure audit cannot delay cancelled export temp cleanup", {
  timeout: 20_000,
}, async () => {
  const id = `zip-locked-audit-${process.pid}-${Date.now()}`;
  await db.insert(usersTable).values(testUser(id));
  const destination = new PassThrough({ highWaterMark: 1 });
  const cancellation = new AbortController();
  const lockClient = await pool.connect();
  const created: string[] = [];
  const removed: string[] = [];
  let auditId: string | undefined;
  let lockFailure: unknown;
  let cancelAt = 0;
  let lockReadyResolve!: () => void;
  const lockReady = new Promise<void>((resolve) => { lockReadyResolve = resolve; });
  setExportStagingTestHook((event, filePath) => {
    if (event === "created") created.push(filePath);
    if (event === "ready") {
      void (async () => {
        try {
          await lockClient.query("begin");
          const locked = await lockClient.query<{ id: string; status: string }>(
            `select id, status from account_data_exports
             where user_id = $1 order by requested_at desc limit 1 for update`,
            [id],
          );
          auditId = locked.rows[0]?.id;
          assert.equal(locked.rows[0]?.status, "complete");
          cancelAt = Date.now();
          cancellation.abort(new Error("cancel locked audit egress"));
        } catch (error) {
          lockFailure = error;
        } finally {
          lockReadyResolve();
        }
      })();
    }
    if (event === "removed") removed.push(filePath);
  });
  try {
    const operation = streamAccountExportZip(id, destination, {
      generationDeadlineMs: 10_000,
      signal: cancellation.signal,
    });
    await lockReady;
    if (lockFailure) throw lockFailure;
    assert.ok(auditId);
    await assert.rejects(
      bounded(operation, 2_000, "locked failure audit export rejection"),
      /cancel|abort/i,
    );
    assert.ok(Date.now() - cancelAt < 2_000);
    assert.equal(created.length, 1);
    assert.deepEqual(removed, created);
    assert.equal(fs.existsSync(created[0]), false);
    const stillLocked = await lockClient.query<{ status: string }>(
      "select status from account_data_exports where id = $1",
      [auditId],
    );
    assert.equal(stillLocked.rows[0]?.status, "complete");
  } finally {
    destination.destroy();
    setExportStagingTestHook();
    await lockClient.query("rollback").catch(() => undefined);
    lockClient.release();
    await db.delete(accountDataExportsTable).where(eq(accountDataExportsTable.userId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

test("locked generation-failure audit runs only after export temp cleanup", {
  timeout: 30_000,
}, async () => {
  const id = `zip-locked-generation-audit-${process.pid}-${Date.now()}`;
  await db.insert(usersTable).values(testUser(id));
  const destination = new PassThrough();
  const lockClient = await pool.connect();
  const created: string[] = [];
  const removed: string[] = [];
  let lockedAuditId: string | undefined;
  let auditAttemptAt = 0;
  setExportStagingTestHook((event, filePath) => {
    if (event === "created") created.push(filePath);
    if (event === "removed") removed.push(filePath);
  });
  setExportSnapshotTestHook(async () => {
    throw new Error("injected empty-fixture generation failure");
  });
  setExportFailureAuditTestHook(async (auditId, ownerId) => {
    assert.equal(ownerId, id);
    assert.equal(created.length, 1);
    assert.deepEqual(removed, created);
    assert.equal(fs.existsSync(created[0]), false);
    await lockClient.query("begin");
    await lockClient.query(
      `insert into account_data_exports
         (id, user_id, format_version, status)
       values ($1, $2, $3, 'complete')`,
      [auditId, id, ACCOUNT_EXPORT_VERSION],
    );
    lockedAuditId = auditId;
    auditAttemptAt = Date.now();
  });
  try {
    await assert.rejects(
      bounded(
        streamAccountExportZip(id, destination, { generationDeadlineMs: 10_000 }),
        15_000,
        "locked generation failure audit",
      ),
      /injected empty-fixture generation failure/,
    );
    assert.ok(lockedAuditId);
    assert.ok(Date.now() - auditAttemptAt < 2_000);
    assert.deepEqual(removed, created);
    const locked = await lockClient.query<{ status: string }>(
      "select status from account_data_exports where id = $1",
      [lockedAuditId],
    );
    assert.equal(locked.rows[0]?.status, "complete");
  } finally {
    destination.destroy();
    setExportSnapshotTestHook();
    setExportStagingTestHook();
    setExportFailureAuditTestHook();
    await lockClient.query("rollback").catch(() => undefined);
    lockClient.release();
    await db.delete(accountDataExportsTable).where(eq(accountDataExportsTable.userId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

test("ZIP cancellation during pending snapshot marks only its audit and releases admission", async () => {
  const id = `zip-snapshot-close-${process.pid}-${Date.now()}`;
  await db.insert(usersTable).values(testUser(id));
  const destination = new PassThrough();
  let entered!: () => void;
  const snapshotEntered = new Promise<void>((resolve) => { entered = resolve; });
  let continueSnapshot!: () => void;
  const snapshotContinue = new Promise<void>((resolve) => { continueSnapshot = resolve; });
  setExportSnapshotTestHook(async (targetId) => {
    if (targetId !== id) return;
    entered();
    await snapshotContinue;
  });
  try {
    const operation = streamAccountExportZip(id, destination);
    await snapshotEntered;
    destination.destroy();
    continueSnapshot();
    await assert.rejects(operation, /cancelled before archive setup/);
    const audits = await db.select().from(accountDataExportsTable)
      .where(eq(accountDataExportsTable.userId, id));
    assert.equal(audits.some((audit) => audit.status === "started"), false);
    assert.equal(audits.filter((audit) => audit.status === "failed").length, 1);
    await withAccountWriteFence("zip-snapshot-successor", async () => db.execute(sql`select 1`));
  } finally {
    setExportSnapshotTestHook();
    await db.delete(accountDataExportsTable).where(eq(accountDataExportsTable.userId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

test("account deletion processing is retry-safe and purges dependent rows", async () => {
  const id = `delete-${process.pid}-${Date.now()}`;
  const user = testUser(id);
  await db.insert(usersTable).values(user);
  await db.insert(expensesTable).values({
    id: `delete-expense-${id}`, userId: id, amount: "10", date: "2026-01-01",
  });
  await db.insert(accountDeletionRequestsTable).values({
    userId: id,
    accountHash: accountHash(id),
    emailHash: accountEmailHash(user.email),
    scheduledFor: new Date(Date.now() - 1_000),
    retainedUntil: new Date(Date.now() + 60_000),
  });
  assert.equal(await processAccountDeletion(id), "completed");
  assert.equal(await processAccountDeletion(id), "pending");
  assert.equal((await db.select().from(usersTable).where(eq(usersTable.id, id))).length, 0);
  assert.equal((await db.select().from(expensesTable).where(eq(expensesTable.userId, id))).length, 0);
  await db.delete(accountDeletionRequestsTable)
    .where(eq(accountDeletionRequestsTable.accountHash, accountHash(id)));
});

test("account deletion checkpoints object cleanup across bounded invocations", {
  timeout: 30_000,
}, async () => {
  const id = `delete-batches-${process.pid}-${Date.now()}`;
  const user = testUser(id);
  await db.insert(usersTable).values(user);
  const paths = Array.from({ length: 12 }, () => `/objects/vault-documents/${randomUUID()}`);
  await db.insert(vaultDocumentsTable).values(paths.map((objectPath, index) => ({
    id: `${id}-document-${index}`,
    userId: id,
    objectPath,
    name: `${index}.pdf`,
    contentType: "application/pdf",
    size: 1,
  })));
  await db.insert(accountDeletionRequestsTable).values({
    userId: id,
    accountHash: accountHash(id),
    emailHash: accountEmailHash(user.email),
    scheduledFor: new Date(Date.now() - 1_000),
    retainedUntil: new Date(Date.now() + 60_000),
  });
  const deleted: string[] = [];
  setVaultObjectDeletionForTests(async (objectPath) => { deleted.push(objectPath); });
  try {
    assert.equal(await processAccountDeletion(id), "pending");
    assert.equal(deleted.length, 10);
    assert.equal((await db.select().from(usersTable).where(eq(usersTable.id, id))).length, 1);
    const checkpoints = await db.select().from(accountDeletionObjectsTable)
      .where(eq(accountDeletionObjectsTable.userId, id));
    assert.equal(checkpoints.filter((item) => item.status === "complete").length, 10);
    assert.equal(checkpoints.filter((item) => item.status === "pending").length, 2);

    await db.update(accountDeletionRequestsTable).set({ nextAttemptAt: new Date(0) })
      .where(eq(accountDeletionRequestsTable.userId, id));
    assert.equal(await processAccountDeletion(id), "completed");
    assert.equal(new Set(deleted).size, 12);
    assert.equal((await db.select().from(usersTable).where(eq(usersTable.id, id))).length, 0);
    assert.equal((await db.select().from(accountDeletionObjectsTable)
      .where(eq(accountDeletionObjectsTable.userId, id))).length, 0);
  } finally {
    setVaultObjectDeletionForTests();
    await db.delete(accountDeletionRequestsTable)
      .where(eq(accountDeletionRequestsTable.accountHash, accountHash(id)));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

test("22k deletion inventory rows are deduplicated into bind-safe chunks without a connection", () => {
  const paths = Array.from(
    { length: 22_000 },
    (_, index) => `/objects/vault-documents/${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`,
  );
  const chunks = chunkDeletionInventoryRows([...paths, paths[0]]);
  assert.equal(chunks.flat().length, 22_000);
  assert.equal(new Set(chunks.flat()).size, 22_000);
  assert.ok(chunks.every((chunk) => chunk.length <= 200));
  // Three bound values per row (request, owner, path) remains far below
  // PostgreSQL's 65,535 parameter ceiling.
  assert.ok(Math.max(...chunks.map((chunk) => chunk.length * 3)) <= 600);
});

test("cancelling during cooling excludes a request from deletion processing", async () => {
  const id = `cancel-${process.pid}-${Date.now()}`;
  const user = testUser(id);
  await db.insert(usersTable).values(user);
  await db.insert(accountDeletionRequestsTable).values({
    userId: id,
    accountHash: accountHash(id),
    emailHash: accountEmailHash(user.email),
    status: "cancelled",
    scheduledFor: new Date(Date.now() - 1_000),
    cancelledAt: new Date(),
    retainedUntil: new Date(Date.now() + 60_000),
  });
  assert.equal(await processAccountDeletion(id), "pending");
  assert.equal((await db.select().from(usersTable).where(eq(usersTable.id, id))).length, 1);
  await db.delete(accountDeletionRequestsTable).where(eq(accountDeletionRequestsTable.userId, id));
  await db.delete(usersTable).where(eq(usersTable.id, id));
});

test("a later completed deletion pseudonymizes earlier cancelled request history", async () => {
  const id = `cancel-then-delete-${process.pid}-${Date.now()}`;
  const user = testUser(id);
  const cancelledId = `${id}-cancelled`;
  const activeId = `${id}-active`;
  const cancelledAt = new Date(Date.now() - 120_000);
  await db.insert(usersTable).values(user);
  await db.insert(accountDeletionRequestsTable).values([
    {
      id: cancelledId,
      userId: id,
      accountHash: accountHash(id),
      emailHash: accountEmailHash(user.email),
      status: "cancelled",
      scheduledFor: new Date(Date.now() - 180_000),
      cancelledAt,
      retainedUntil: new Date(Date.now() + 60_000),
    },
    {
      id: activeId,
      userId: id,
      accountHash: accountHash(id),
      emailHash: accountEmailHash(user.email),
      scheduledFor: new Date(Date.now() - 60_000),
      retainedUntil: new Date(Date.now() + 60_000),
    },
  ]);
  assert.equal(await processAccountDeletion(id), "completed");
  assert.equal(await processAccountDeletion(id), "pending");
  const requests = await db.select().from(accountDeletionRequestsTable)
    .where(eq(accountDeletionRequestsTable.accountHash, accountHash(id)));
  const cancelled = requests.find((row) => row.id === cancelledId);
  const completed = requests.find((row) => row.id === activeId);
  assert.equal(requests.some((row) => row.userId === id), false);
  assert.equal(cancelled?.userId, accountHash(id));
  assert.equal(cancelled?.status, "cancelled");
  assert.deepEqual(cancelled?.cancelledAt, cancelledAt);
  assert.equal(completed?.userId, accountHash(id));
  assert.equal(completed?.status, "completed");
  assert.ok(completed?.completedAt);
  assert.equal(completed?.attempts, 1);
  await db.delete(accountDeletionRequestsTable)
    .where(eq(accountDeletionRequestsTable.accountHash, accountHash(id)));
});

test("all sessions for one account are revoked without affecting another", async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const ownerId = `session-owner-${suffix}`;
  const otherId = `session-other-${suffix}`;
  const sessionUser = (id: string) => ({
    id, email: `${id}@example.test`, profileImageUrl: null, fullName: null,
    dateOfBirth: null, gender: null, phone: null, onboardingCompleted: false, isAdmin: false,
  });
  await db.insert(sessionsTable).values([
    { sid: `owner-${suffix}`, sess: { user: sessionUser(ownerId) }, expire: new Date(Date.now() + 60_000) },
    { sid: `other-${suffix}`, sess: { user: sessionUser(otherId) }, expire: new Date(Date.now() + 60_000) },
  ]);
  await revokeAllUserSessions(ownerId);
  assert.equal((await db.select().from(sessionsTable).where(eq(sessionsTable.sid, `owner-${suffix}`))).length, 0);
  assert.equal((await db.select().from(sessionsTable).where(eq(sessionsTable.sid, `other-${suffix}`))).length, 1);
  await db.delete(sessionsTable).where(eq(sessionsTable.sid, `other-${suffix}`));
});

test("deletion scheduling atomically rolls back on revocation fault and reconciles retry sessions", {
  timeout: 30_000,
}, async () => {
  const id = `schedule-delete-${process.pid}-${Date.now()}`;
  const user = testUser(id);
  const sessionUser = {
    id, email: user.email, profileImageUrl: null, fullName: user.fullName,
    dateOfBirth: user.dateOfBirth, gender: user.gender, phone: user.phone,
    onboardingCompleted: true, isAdmin: false,
  };
  await db.insert(usersTable).values(user);
  await db.insert(sessionsTable).values({
    sid: `${id}-initial`, sess: { user: sessionUser }, expire: new Date(Date.now() + 60_000),
  });
  let fail = true;
  setSessionRevocationTestHook(async () => {
    if (fail) throw new Error("injected session revocation failure");
  });
  try {
    await assert.rejects(
      bounded(scheduleAccountDeletion(id, user.email), 10_000, "faulted deletion schedule"),
      /injected session revocation failure/,
    );
    assert.equal((await db.select().from(accountDeletionRequestsTable)
      .where(eq(accountDeletionRequestsTable.userId, id))).length, 0);
    assert.equal((await db.select().from(sessionsTable)
      .where(eq(sessionsTable.sid, `${id}-initial`))).length, 1);

    fail = false;
    const created = await bounded(
      scheduleAccountDeletion(id, user.email), 10_000, "deletion schedule retry",
    );
    assert.equal(created.created, true);
    assert.equal((await db.select().from(sessionsTable)
      .where(eq(sessionsTable.sid, `${id}-initial`))).length, 0);

    await db.insert(sessionsTable).values({
      sid: `${id}-retry`, sess: { user: sessionUser }, expire: new Date(Date.now() + 60_000),
    });
    const reconciled = await bounded(
      scheduleAccountDeletion(id, user.email), 10_000, "existing deletion retry",
    );
    assert.equal(reconciled.created, false);
    assert.equal(reconciled.request.id, created.request.id);
    assert.equal((await db.select().from(sessionsTable)
      .where(eq(sessionsTable.sid, `${id}-retry`))).length, 0);
  } finally {
    setSessionRevocationTestHook();
    await db.delete(accountDeletionRequestsTable).where(eq(accountDeletionRequestsTable.userId, id));
    await db.delete(sessionsTable).where(sql`${sessionsTable.sid} in (
      ${`${id}-initial`}, ${`${id}-retry`}
    )`);
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

test("two concurrent deletion workers produce exactly one completion", async () => {
  const id = `concurrent-delete-${process.pid}-${Date.now()}`;
  const user = testUser(id);
  await db.insert(usersTable).values(user);
  await db.insert(accountDeletionRequestsTable).values({
    userId: id, accountHash: accountHash(id), emailHash: accountEmailHash(user.email),
    scheduledFor: new Date(Date.now() - 60_000),
    retainedUntil: new Date(Date.now() + 60_000),
  });
  const results = await Promise.all([processAccountDeletion(id), processAccountDeletion(id)]);
  assert.equal(results.filter((result) => result === "completed").length, 1);
  assert.equal(results.filter((result) => result === "pending").length, 1);
  await db.delete(accountDeletionRequestsTable).where(eq(
    accountDeletionRequestsTable.accountHash, accountHash(id),
  ));
});

test("a held mutation fence delays deletion claim until the write finishes", async () => {
  const id = `fenced-delete-${process.pid}-${Date.now()}`;
  const user = testUser(id);
  await db.insert(usersTable).values(user);
  await db.insert(accountDeletionRequestsTable).values({
    userId: id, accountHash: accountHash(id), scheduledFor: new Date(Date.now() - 60_000),
    retainedUntil: new Date(Date.now() + 60_000),
  });
  const release = await acquireAccountWriteFence(id);
  const processing = processAccountDeletion(id);
  await new Promise((resolve) => setImmediate(resolve));
  const [beforeRelease] = await db.select().from(accountDeletionRequestsTable)
    .where(eq(accountDeletionRequestsTable.userId, id));
  assert.equal(beforeRelease.status, "cooling_off");
  await release();
  assert.equal(await processing, "completed");
  await db.delete(accountDeletionRequestsTable)
    .where(eq(accountDeletionRequestsTable.accountHash, accountHash(id)));
});

test("transaction advisory fences release cleanly and unblock pooled same-account waiters", async () => {
  const id = `xact-fence-${process.pid}-${Date.now()}`;
  const key = `ezyretire-account-write-fence:${id}`;
  const lockCountSql = `
    select count(*)::int as count
    from pg_locks
    where locktype = 'advisory'
      and granted
      and objid::bigint = (hashtext($1)::bigint & 4294967295)
      and classid::bigint = case when hashtext($1) < 0 then 4294967295 else 0 end
  `;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const release = await acquireAccountWriteFence(id);
    if (attempt === 0) {
      const held = await pool.query<{ count: number }>(lockCountSql, [key]);
      assert.equal(held.rows[0]?.count, 1);
    }
    let entered = false;
    const waiter = withAccountWriteFence(id, async () => { entered = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(entered, false);
    await release();
    await waiter;
    assert.equal(entered, true);
  }
  const result = await pool.query<{ count: number }>(lockCountSql, [key]);
  assert.equal(result.rows[0]?.count, 0);
});

test("local admission serializes pool-size-three waiters and nested ownership is reentrant", async () => {
  const id = `nested-fence-${process.pid}-${Date.now()}`;
  let active = 0;
  let maximum = 0;
  const operation = () => withAccountWriteFence(id, async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await withAccountWriteFence(id, async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
    active -= 1;
  });
  await Promise.all([operation(), operation(), operation()]);
  assert.equal(maximum, 1);
});

test("bounded admission is FIFO for unrelated accounts without starving queued work", {
  timeout: 30_000,
}, async () => {
  const holders = await Promise.all(Array.from(
    { length: ACCOUNT_FENCE_ADMISSION_CAPACITY },
    (_, index) => acquireAccountWriteFence(`fifo-holder-${index}`),
  ));
  const admitted: string[] = [];
  setFenceAdmissionTestHook((userId) => {
    if (userId.startsWith("fifo-waiter-")) admitted.push(userId);
  });
  const waiters = ["fifo-waiter-a", "fifo-waiter-b", "fifo-waiter-c"]
    .map((id) => acquireAccountWriteFence(id));
  waiters.forEach((waiter) => { void waiter.catch(() => undefined); });
  try {
    await holders.shift()!();
    const first = await bounded(waiters[0], 5_000, "first FIFO admission");
    assert.deepEqual(admitted, ["fifo-waiter-a"]);
    await first();
    const second = await bounded(waiters[1], 5_000, "second FIFO admission");
    assert.deepEqual(admitted, ["fifo-waiter-a", "fifo-waiter-b"]);
    await second();
    const third = await bounded(waiters[2], 5_000, "third FIFO admission");
    assert.deepEqual(admitted, ["fifo-waiter-a", "fifo-waiter-b", "fifo-waiter-c"]);
    await third();
  } finally {
    setFenceAdmissionTestHook();
    await Promise.all(holders.map((release) => release()));
    const settled = await Promise.allSettled(waiters);
    await Promise.all(settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value()] : []));
  }
});

test("ordinary mutation admission times out or cancels without leaking FIFO capacity", {
  timeout: 30_000,
}, async () => {
  const before = pool.totalCount - pool.idleCount;
  const holders = await Promise.all(Array.from(
    { length: ACCOUNT_FENCE_ADMISSION_CAPACITY },
    (_, index) => acquireAccountWriteFence(`guard-capacity-holder-${index}`),
  ));
  const invoke = async (id: string, abort = false) => {
    const requestEvents = new EventEmitter();
    const responseEvents = new EventEmitter();
    let status = 200;
    let body: unknown;
    const headers = new Map<string, string>();
    const req = Object.assign(requestEvents, {
      method: "POST", path: "/api/financial-data", user: { id },
      aborted: false, complete: true,
    });
    const res = Object.assign(responseEvents, {
      locals: {} as Record<string, unknown>,
      destroyed: false,
      setHeader(name: string, value: string) { headers.set(name, value); },
      status(code: number) { status = code; return this; },
      json(value: unknown) { body = value; return this; },
    });
    const operation = accountMutationGuard(req as never, res as never, () => {
      assert.fail("timed-out mutation must not enter its route");
    });
    if (abort) {
      req.aborted = true;
      requestEvents.emit("aborted");
    }
    await operation;
    return { status, body, headers };
  };
  try {
    setAccountMutationAdmissionTimeoutForTests(20);
    const started = Date.now();
    const timedOut = await invoke("guard-admission-timeout");
    assert.ok(Date.now() - started < 250);
    assert.equal(timedOut.status, 503);
    assert.equal((timedOut.body as { code?: string }).code, "ACCOUNT_WRITE_ADMISSION_BUSY");
    assert.equal((timedOut.body as { retryable?: boolean }).retryable, true);
    assert.equal(timedOut.headers.get("Retry-After"), "1");

    setAccountMutationAdmissionTimeoutForTests(1_000);
    const cancelledAt = Date.now();
    const cancelled = await invoke("guard-admission-cancelled", true);
    assert.ok(Date.now() - cancelledAt < 250);
    assert.equal(cancelled.status, 503);
  } finally {
    setAccountMutationAdmissionTimeoutForTests();
    await Promise.all(holders.map((release) => release()));
  }
  await withAccountWriteFence("guard-capacity-successor", async () => db.execute(sql`select 1`));
  assert.equal(pool.totalCount - pool.idleCount, before);
});

test("guard status-query failure releases PG and local/bounded admission", async () => {
  const before = pool.totalCount - pool.idleCount;
  setDeletionStatusTestHook(async () => { throw new Error("forced status failure"); });
  let forwarded: unknown;
  const req = { method: "POST", path: "/api/financial-data", user: { id: "guard-failure" } };
  const res = { status() { return this; }, json() { return this; } };
  try {
    await accountMutationGuard(req as never, res as never, (error?: unknown) => { forwarded = error; });
    assert.match((forwarded as Error).message, /forced status failure/);
    await withAccountWriteFence("guard-failure", async () => db.execute(sql`select 1`));
    assert.equal(pool.totalCount - pool.idleCount, before);
  } finally {
    setDeletionStatusTestHook();
  }
});

test("disconnected financial stream settles guard ownership after async loop", async () => {
  const id = `stream-disconnect-${process.pid}-${Date.now()}`;
  const events = new EventEmitter();
  const response = Object.assign(events, {
    locals: {} as Record<string, unknown>,
    destroyed: false,
    writableEnded: false,
    status() { return this; },
    setHeader() {},
    removeHeader() {},
    flushHeaders() {},
    write() {
      queueMicrotask(() => {
        response.destroyed = true;
        events.emit("close");
      });
      return false;
    },
    end() { response.writableEnded = true; events.emit("finish"); return response; },
  });
  let handler!: Promise<void>;
  await accountMutationGuard(
    { method: "POST", path: "/api/financial-data", user: { id } } as never,
    response as never,
    () => { handler = sendFinancialDataStream(response as never, { payload: "x".repeat(200_000) }); },
  );
  await handler;
  await withAccountWriteFence(id, async () => db.execute(sql`select 1`));
});

test("guard observes COMMIT failure and still frees local and bounded admission", async () => {
  const id = `guard-commit-failure-${process.pid}-${Date.now()}`;
  const before = pool.totalCount - pool.idleCount;
  let failuresRemaining = 1;
  setFenceCommitTestHook(async () => {
    if (failuresRemaining > 0) {
      failuresRemaining -= 1;
      throw new Error("forced commit failure");
    }
  });
  const unhandled: unknown[] = [];
  const onUnhandled = (error: unknown) => { unhandled.push(error); };
  process.on("unhandledRejection", onUnhandled);
  const events = new EventEmitter();
  const logs: unknown[] = [];
  const response = Object.assign(events, {
    locals: {} as Record<string, unknown>,
    writableEnded: false,
    end() {
      response.writableEnded = true;
      events.emit("finish");
      return response;
    },
  });
  try {
    await accountMutationGuard(
      {
        method: "POST",
        path: "/api/financial-data",
        user: { id },
        log: { error(fields: unknown) { logs.push(fields); } },
      } as never,
      response as never,
      () => undefined,
    );
    response.end();
    await withAccountWriteFence("guard-commit-successor", async () => db.execute(sql`select 1`));
    await withAccountWriteFence(id, async () => db.execute(sql`select 1`));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
    assert.equal(logs.length, 1);
    assert.deepEqual(logs[0], {
      errorName: "Error",
      errorCategory: "account_fence_release_failed",
    });
    assert.equal(pool.totalCount - pool.idleCount, before);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    setFenceCommitTestHook();
  }
});

test("an obsolete lease token cannot finalize a newer claim", async () => {
  const id = `lease-token-${process.pid}-${Date.now()}`;
  const requestId = `${id}-request`;
  await db.insert(accountDeletionRequestsTable).values({
    id: requestId, userId: id, accountHash: accountHash(id), status: "processing",
    scheduledFor: new Date(Date.now() - 60_000), retainedUntil: new Date(Date.now() + 60_000),
    processingLeaseUntil: new Date(Date.now() + 60_000), processingLeaseToken: "new-token",
  });
  const changed = await db.update(accountDeletionRequestsTable).set({ status: "blocked" })
    .where(and(
      eq(accountDeletionRequestsTable.id, requestId),
      eq(accountDeletionRequestsTable.status, "processing"),
      eq(accountDeletionRequestsTable.processingLeaseToken, "obsolete-token"),
    )).returning();
  assert.equal(changed.length, 0);
  const [current] = await db.select().from(accountDeletionRequestsTable)
    .where(eq(accountDeletionRequestsTable.id, requestId));
  assert.equal(current.status, "processing");
  assert.equal(current.processingLeaseToken, "new-token");
  await db.delete(accountDeletionRequestsTable).where(eq(accountDeletionRequestsTable.id, requestId));
});

test("maintenance reclaims an expired processing lease", async () => {
  const id = `stale-lease-${process.pid}-${Date.now()}`;
  const user = testUser(id);
  await db.insert(usersTable).values(user);
  await db.insert(accountDeletionRequestsTable).values({
    userId: id, accountHash: accountHash(id), emailHash: accountEmailHash(user.email),
    status: "processing", scheduledFor: new Date(Date.now() - 120_000),
    processingStartedAt: new Date(Date.now() - 120_000),
    processingLeaseUntil: new Date(Date.now() - 60_000),
    retainedUntil: new Date(Date.now() + 60_000),
  });
  const result = await runAccountComplianceMaintenance(100);
  assert.ok(result.completed >= 1);
  const [request] = await db.select().from(accountDeletionRequestsTable)
    .where(eq(accountDeletionRequestsTable.accountHash, accountHash(id)));
  assert.equal(request?.status, "completed");
  assert.equal(request?.attempts, 1);
  await db.delete(accountDeletionRequestsTable).where(eq(
    accountDeletionRequestsTable.accountHash, accountHash(id),
  ));
});

test("maintenance does not reclaim an active processing lease", async () => {
  const id = `active-lease-${process.pid}-${Date.now()}`;
  const user = testUser(id);
  await db.insert(usersTable).values(user);
  await db.insert(accountDeletionRequestsTable).values({
    userId: id, accountHash: accountHash(id), emailHash: accountEmailHash(user.email),
    status: "processing", scheduledFor: new Date(Date.now() - 120_000),
    processingStartedAt: new Date(Date.now() - 60_000),
    processingLeaseUntil: new Date(Date.now() + 60 * 60_000),
    retainedUntil: new Date(Date.now() + 60_000),
  });
  await runAccountComplianceMaintenance(100);
  const [request] = await db.select().from(accountDeletionRequestsTable)
    .where(eq(accountDeletionRequestsTable.userId, id));
  assert.equal(request?.status, "processing");
  assert.equal(request?.attempts, 0);
  assert.equal((await db.select().from(usersTable).where(eq(usersTable.id, id))).length, 1);
  await db.delete(accountDeletionRequestsTable).where(eq(accountDeletionRequestsTable.userId, id));
  await db.delete(usersTable).where(eq(usersTable.id, id));
});

test("compliance maintenance stops admitting deletion work before its deadline", {
  timeout: 15_000,
}, async () => {
  const id = `maintenance-deadline-${process.pid}-${Date.now()}`;
  const user = testUser(id);
  await db.insert(usersTable).values(user);
  await db.insert(accountDeletionRequestsTable).values({
    userId: id,
    accountHash: accountHash(id),
    emailHash: accountEmailHash(user.email),
    scheduledFor: new Date(Date.now() - 60_000),
    retainedUntil: new Date(Date.now() + 60_000),
  });
  let tick = 0;
  try {
    const result = await runAccountComplianceMaintenance(1, {
      budgetMs: 1,
      now: () => tick++ === 0 ? 0 : 2,
    });
    assert.equal(result.completed, 0);
    assert.equal(result.blocked, 0);
    assert.equal(result.deadlineReached, true);
    const [request] = await db.select().from(accountDeletionRequestsTable)
      .where(eq(accountDeletionRequestsTable.userId, id));
    assert.equal(request?.status, "cooling_off");
    assert.equal((await db.select().from(usersTable).where(eq(usersTable.id, id))).length, 1);
  } finally {
    await db.delete(accountDeletionRequestsTable).where(eq(accountDeletionRequestsTable.userId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

test("deletion backoff prevents an older failing account starving a newer due account", {
  timeout: 30_000,
}, async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const oldId = `backoff-old-${suffix}`;
  const newId = `backoff-new-${suffix}`;
  const oldUser = testUser(oldId);
  const newUser = testUser(newId);
  const oldRequestId = `${oldId}-request`;
  const newRequestId = `${newId}-request`;
  const objectPath = `/objects/vault-documents/${randomUUID()}`;
  await db.insert(usersTable).values([oldUser, newUser]);
  await db.insert(accountDeletionRequestsTable).values([
    {
      id: oldRequestId, userId: oldId, accountHash: accountHash(oldId),
      scheduledFor: new Date(Date.now() - 120_000), requestedAt: new Date(Date.now() - 120_000),
      retainedUntil: new Date(Date.now() + 60_000), inventoryCompletedAt: new Date(),
    },
    {
      id: newRequestId, userId: newId, accountHash: accountHash(newId),
      scheduledFor: new Date(Date.now() - 60_000), requestedAt: new Date(Date.now() - 60_000),
      retainedUntil: new Date(Date.now() + 60_000), inventoryCompletedAt: new Date(),
    },
  ]);
  await db.insert(accountDeletionObjectsTable).values({
    requestId: oldRequestId, userId: oldId, objectPath,
  });
  setVaultObjectDeletionForTests(async (path) => {
    if (path === objectPath) throw new Error("injected storage outage");
  });
  try {
    const first = await runAccountComplianceMaintenance(1);
    assert.equal(first.blocked, 1);
    const [backedOff] = await db.select().from(accountDeletionRequestsTable)
      .where(eq(accountDeletionRequestsTable.id, oldRequestId));
    assert.ok(backedOff.nextAttemptAt && backedOff.nextAttemptAt > new Date());

    const second = await runAccountComplianceMaintenance(1);
    assert.equal(second.completed, 1);
    assert.equal((await db.select().from(usersTable).where(eq(usersTable.id, newId))).length, 0);
    assert.equal((await db.select().from(usersTable).where(eq(usersTable.id, oldId))).length, 1);
  } finally {
    setVaultObjectDeletionForTests();
    await db.delete(accountDeletionRequestsTable).where(sql`${accountDeletionRequestsTable.id} in (
      ${oldRequestId}, ${newRequestId}
    )`);
    await db.delete(usersTable).where(sql`${usersTable.id} in (${oldId}, ${newId})`);
  }
});

test("compliance retention purges expired terminal rows without affecting active or retained rows", async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const expired = `retention-expired-${suffix}`;
  const fresh = `retention-fresh-${suffix}`;
  const active = `retention-active-${suffix}`;
  const old = new Date("2000-01-01T00:00:00.000Z");
  const future = new Date("2099-01-01T00:00:00.000Z");
  await db.insert(accountDataExportsTable).values([
    { id: `${expired}-export`, userId: expired, formatVersion: "1.0", status: "complete", requestedAt: old },
    { id: `${fresh}-export`, userId: fresh, formatVersion: "1.0", status: "complete", requestedAt: future },
  ]);
  await db.insert(accountDeletionRequestsTable).values([
    {
      id: `${expired}-request`, userId: expired, accountHash: accountHash(expired),
      status: "completed", scheduledFor: old, completedAt: old, retainedUntil: old,
    },
    {
      id: `${fresh}-request`, userId: fresh, accountHash: accountHash(fresh),
      status: "completed", scheduledFor: old, completedAt: old, retainedUntil: future,
    },
    {
      id: `${expired}-cancelled`, userId: `${expired}-cancelled`,
      accountHash: accountHash(`${expired}-cancelled`), status: "cancelled",
      scheduledFor: old, cancelledAt: old, retainedUntil: old,
    },
    {
      id: `${fresh}-cancelled`, userId: `${fresh}-cancelled`,
      accountHash: accountHash(`${fresh}-cancelled`), status: "cancelled",
      scheduledFor: old, cancelledAt: old, retainedUntil: future,
    },
    {
      id: `${active}-request`, userId: active, accountHash: accountHash(active),
      status: "cooling_off", scheduledFor: future, retainedUntil: old,
    },
  ]);
  await runAccountComplianceMaintenance(1);
  assert.equal((await db.select().from(accountDataExportsTable)
    .where(eq(accountDataExportsTable.id, `${expired}-export`))).length, 0);
  assert.equal((await db.select().from(accountDataExportsTable)
    .where(eq(accountDataExportsTable.id, `${fresh}-export`))).length, 1);
  assert.equal((await db.select().from(accountDeletionRequestsTable)
    .where(eq(accountDeletionRequestsTable.id, `${expired}-request`))).length, 0);
  assert.equal((await db.select().from(accountDeletionRequestsTable)
    .where(eq(accountDeletionRequestsTable.id, `${fresh}-request`))).length, 1);
  assert.equal((await db.select().from(accountDeletionRequestsTable)
    .where(eq(accountDeletionRequestsTable.id, `${expired}-cancelled`))).length, 0);
  assert.equal((await db.select().from(accountDeletionRequestsTable)
    .where(eq(accountDeletionRequestsTable.id, `${fresh}-cancelled`))).length, 1);
  assert.equal((await db.select().from(accountDeletionRequestsTable)
    .where(eq(accountDeletionRequestsTable.id, `${active}-request`))).length, 1);
  await db.delete(accountDataExportsTable).where(eq(accountDataExportsTable.id, `${fresh}-export`));
  await db.delete(accountDeletionRequestsTable).where(sql`${accountDeletionRequestsTable.id} in (
    ${`${fresh}-request`}, ${`${fresh}-cancelled`}, ${`${active}-request`}
  )`);
});

test("mutation guard allows logout and cancellation but blocks account POSTs", async () => {
  const id = `guard-${process.pid}-${Date.now()}`;
  const user = testUser(id);
  await db.insert(usersTable).values(user);
  await db.insert(accountDeletionRequestsTable).values({
    userId: id, accountHash: accountHash(id), scheduledFor: new Date(Date.now() + 60_000),
    retainedUntil: new Date(Date.now() + 60_000),
  });
  async function invoke(method: string, requestPath: string) {
    let status = 200;
    let nextCalled = false;
    const req = { method, path: requestPath, user: { id } };
    const res = {
      locals: {} as Record<string, unknown>,
      status(code: number) { status = code; return this; },
      json() { return this; },
      once(event: string, handler: () => void) {
        if (event === "finish") handler();
        return this;
      },
      end() { return this; },
    };
    await accountMutationGuard(req as never, res as never, () => { nextCalled = true; });
    return { status, nextCalled };
  }
  assert.equal((await invoke("GET", "/api/logout")).nextCalled, true);
  assert.equal((await invoke("POST", "/api/auth/otp/verify")).nextCalled, true);
  assert.equal((await invoke("POST", "/api/auth/passkeys/authentication/verify")).nextCalled, true);
  assert.equal((await invoke("DELETE", "/api/account/deletion")).nextCalled, true);
  assert.deepEqual(await invoke("POST", "/api/financial-data"), { status: 423, nextCalled: false });
  await db.delete(accountDeletionRequestsTable).where(eq(accountDeletionRequestsTable.userId, id));
  await db.delete(usersTable).where(eq(usersTable.id, id));
});

test("account deletion maintenance route requires cron authorization", async () => {
  process.env.CRON_SECRET = "account-compliance-test-secret";
  const app = express();
  app.use("/api", internalMaintenanceRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/api/internal/process-account-deletions`;
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { authorization: "Bearer wrong" } })).status, 401);
    assert.equal((await fetch(url, {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    })).status, 200);
  } finally {
    server.close();
  }
});