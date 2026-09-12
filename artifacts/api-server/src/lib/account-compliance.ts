import crypto, { randomBytes } from "crypto";
import {
  accountDataExportsTable,
  accountDeletionObjectsTable,
  accountDeletionRequestsTable,
  adviceRequestsTable,
  bankStatementImportProvenanceTable,
  budgetsTable,
  db, pool, poolMax,
  dependentsTable,
  emailOtpChallengesTable,
  expensesTable,
  financialAccountsTable,
  incomeReceiptsTable,
  incomeSourcesTable,
  investmentsTable,
  loansTable,
  loginActivitiesTable,
  mobileOtpChallengesTable,
  mobileOtpDeliveryAttemptsTable,
  nomineesTable,
  passkeyAuditEventsTable,
  passkeyChallengesTable,
  passkeyCredentialsTable,
  premiumEntitlementsTable,
  receiptReviewsTable,
  retirementPlansTable,
  salaryDetailsTable,
  sessionsTable,
  userProfilesTable,
  usersTable,
  vaultDeletionJobsTable,
  vaultDocumentsTable,
  vaultUploadGrantsTable,
  whatsappNotificationEventsTable,
} from "@workspace/db";
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { deleteVaultObject } from "./object-storage.js";
import { readVaultObjectBytes } from "./object-storage.js";
import { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as archiver from "archiver";
import { AsyncLocalStorage } from "node:async_hooks";
import type { PoolClient } from "pg";
import { createReadStream } from "node:fs";
import { chmod, mkdtemp, open, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ACCOUNT_EXPORT_VERSION = "1.0";
export const ACCOUNT_DELETION_COOLING_MS = 7 * 24 * 60 * 60_000;
export const COMPLIANCE_AUDIT_RETENTION_MS = 3 * 365 * 24 * 60 * 60_000;
export const ACCOUNT_DELETION_LEASE_MS = 10 * 60_000;
export const ACCOUNT_DELETION_OBJECT_BATCH_SIZE = 10;
export const ACCOUNT_DELETION_OBJECT_TIMEOUT_MS = 5_000;
export const ACCOUNT_EXPORT_GENERATION_DEADLINE_MS = 240_000;
const ACCOUNT_EXPORT_FAILURE_AUDIT_BUDGET_MS = 1_000;
export const COMPLIANCE_MAINTENANCE_BUDGET_MS = 20_000;
export const ACCOUNT_DELETION_INVENTORY_PAGE_SIZE = 500;
export const ACCOUNT_DELETION_INVENTORY_INSERT_SIZE = 200;
const ACCOUNT_DELETION_CONTINUATION_DELAY_MS = 1_000;
const ACCOUNT_WRITE_FENCE_PREFIX = "ezyretire-account-write-fence:";
const fenceContext = new AsyncLocalStorage<ReadonlySet<string>>();
const localFenceTails = new Map<string, Promise<void>>();
export const ACCOUNT_FENCE_ADMISSION_CAPACITY = Math.max(0, poolMax - 1);
type FenceAdmissionWaiter = {
  signal?: AbortSignal;
  grant: (release: () => void) => void;
  reject: (error: Error) => void;
  abort?: () => void;
};
const fenceAdmissionWaiters: FenceAdmissionWaiter[] = [];
let activeFenceAdmissions = 0;

function dispatchFenceAdmissions(): void {
  while (
    activeFenceAdmissions < ACCOUNT_FENCE_ADMISSION_CAPACITY
    && fenceAdmissionWaiters.length > 0
  ) {
    const waiter = fenceAdmissionWaiters.shift()!;
    if (waiter.abort) waiter.signal?.removeEventListener("abort", waiter.abort);
    if (waiter.signal?.aborted) {
      waiter.reject(abortReason(waiter.signal));
      continue;
    }
    activeFenceAdmissions += 1;
    let released = false;
    waiter.grant(() => {
      if (released) return;
      released = true;
      activeFenceAdmissions -= 1;
      dispatchFenceAdmissions();
    });
  }
}

async function acquireFenceAdmission(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) throw abortReason(signal);
  if (ACCOUNT_FENCE_ADMISSION_CAPACITY === 0) {
    throw new Error("Account fence admission requires DB_POOL_MAX of at least 2");
  }
  return new Promise<() => void>((resolve, reject) => {
    const waiter: FenceAdmissionWaiter = {
      signal,
      grant: resolve,
      reject,
    };
    waiter.abort = () => {
      const index = fenceAdmissionWaiters.indexOf(waiter);
      if (index >= 0) fenceAdmissionWaiters.splice(index, 1);
      reject(abortReason(signal!));
    };
    signal?.addEventListener("abort", waiter.abort, { once: true });
    fenceAdmissionWaiters.push(waiter);
    dispatchFenceAdmissions();
  });
}
let fenceCommitTestHook: (() => Promise<void>) | undefined;
let fenceAdmissionTestHook: ((userId: string) => void) | undefined;
export function setFenceCommitTestHook(hook?: () => Promise<void>): void {
  fenceCommitTestHook = hook;
}
export function setFenceAdmissionTestHook(hook?: (userId: string) => void): void {
  fenceAdmissionTestHook = hook;
}
export function runWithAccountFenceOwnership<T>(userId: string, work: () => T): T {
  const owned = new Set(fenceContext.getStore() ?? []);
  owned.add(userId);
  return fenceContext.run(owned, work);
}

export async function withAccountWriteFence<T>(
  userId: string,
  work: () => Promise<T>,
  options: { signal?: AbortSignal; lockTimeoutMs?: number } = {},
): Promise<T> {
  if (fenceContext.getStore()?.has(userId)) return work();
  const release = await acquireAccountWriteFence(userId, options);
  try {
    return await runWithAccountFenceOwnership(userId, work);
  } finally {
    await release();
  }
}

export async function acquireAccountWriteFence(
  userId: string,
  options: { signal?: AbortSignal; lockTimeoutMs?: number } = {},
): Promise<() => Promise<void>> {
  const { signal } = options;
  if (signal?.aborted) throw abortReason(signal);
  const previous = localFenceTails.get(userId) ?? Promise.resolve();
  let admit!: () => void;
  const gate = new Promise<void>((resolve) => { admit = resolve; });
  const tail = previous.catch(() => undefined).then(() => gate);
  localFenceTails.set(userId, tail);
  try {
    await waitForAbort(previous.catch(() => undefined), signal);
  } catch (error) {
    void previous.catch(() => undefined).finally(() => {
      admit();
      if (localFenceTails.get(userId) === tail) localFenceTails.delete(userId);
    });
    throw error;
  }
  let releaseAdmission: (() => void) | undefined;
  try {
    releaseAdmission = await acquireFenceAdmission(signal);
  } catch (error) {
    admit();
    if (localFenceTails.get(userId) === tail) localFenceTails.delete(userId);
    throw error;
  }
  fenceAdmissionTestHook?.(userId);
  let client: PoolClient | undefined;
  let transactionStartAttempted = false;
  let transactionStarted = false;
  const key = `${ACCOUNT_WRITE_FENCE_PREFIX}${userId}`;
  try {
    const connect = pool.connect();
    const acquired = await waitForAbort(connect, signal).catch((error) => {
      void connect.then((lateClient) => lateClient.release(), () => undefined);
      throw error;
    });
    client = acquired;
    transactionStartAttempted = true;
    await waitForAbort(acquired.query("begin"), signal);
    transactionStarted = true;
    const lockTimeoutMs = Math.max(1, Math.min(options.lockTimeoutMs ?? 5_000, 30_000));
    await waitForAbort(
      acquired.query("select set_config('lock_timeout', $1, true)", [`${lockTimeoutMs}ms`]),
      signal,
    );
    if (signal?.aborted) throw abortReason(signal);
    const lock = await waitForAbort(
      acquired.query<{ acquired: boolean }>(
        "select pg_try_advisory_xact_lock(hashtext($1)) as acquired",
        [key],
      ),
      signal,
    );
    if (!lock.rows[0]?.acquired) {
      throw new Error("Account fence is busy; retry the operation");
    }
  } catch (error) {
    let discardError: Error | undefined;
    if (client && signal?.aborted) {
      discardError = error instanceof Error ? error : abortReason(signal);
    } else if (client && transactionStarted) {
      try {
        await client.query("rollback");
      } catch (rollbackError) {
        discardError = rollbackError instanceof Error
          ? rollbackError
          : new Error("Account fence acquisition rollback failed");
      }
    } else if (client && transactionStartAttempted) {
      discardError = error instanceof Error
        ? error
        : new Error("Account fence transaction startup failed");
    }
    try {
      client?.release(discardError);
    } finally {
      releaseAdmission();
      admit();
      if (localFenceTails.get(userId) === tail) localFenceTails.delete(userId);
    }
    throw error;
  }
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    let discardError: Error | undefined;
    try {
      await fenceCommitTestHook?.();
      await client!.query("commit");
    } catch (error) {
      try {
        await client!.query("rollback");
      } catch (rollbackError) {
        discardError = rollbackError instanceof Error
          ? rollbackError
          : new Error("Account fence release rollback failed");
      }
      throw error;
    } finally {
      try {
        client!.release(discardError);
      } finally {
        releaseAdmission!();
        admit();
        if (localFenceTails.get(userId) === tail) localFenceTails.delete(userId);
      }
    }
  };
  return release;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Operation aborted");
}

async function waitForAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) throw abortReason(signal);
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(abortReason(signal));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([operation, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
const EXPORT_SECRET_KEYS = new Set([
  "passwordHash", "secret", "token", "accessToken", "refreshToken", "sessionToken",
  "objectPath", "cleanupObjectPath", "lastError", "error", "privateKey", "encryptionKey",
  "codeHash", "challenge", "challengeHash",
]);
function exportProjection<T>(value: T): T {
  if (Array.isArray(value)) return value.map(exportProjection) as T;
  if (value instanceof Date) return value.toISOString() as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !EXPORT_SECRET_KEYS.has(key))
    .map(([key, item]) => [key, exportProjection(item)])) as T;
}

export async function accountDeletionBlocksMutation(userId: string): Promise<boolean> {
  if (deletionStatusTestHook) return deletionStatusTestHook(userId);
  const [request] = await db.select({ status: accountDeletionRequestsTable.status })
    .from(accountDeletionRequestsTable)
    .where(and(
      eq(accountDeletionRequestsTable.userId, userId),
      inArray(accountDeletionRequestsTable.status, ["cooling_off", "processing", "blocked"]),
    )).limit(1);
  return Boolean(request);
}
let deletionStatusTestHook: ((userId: string) => Promise<boolean>) | undefined;
export function setDeletionStatusTestHook(
  hook?: (userId: string) => Promise<boolean>,
): void { deletionStatusTestHook = hook; }
let exportSnapshotTestHook: ((userId: string) => Promise<void>) | undefined;
export function setExportSnapshotTestHook(
  hook?: (userId: string) => Promise<void>,
): void { exportSnapshotTestHook = hook; }
let exportFailureAuditTestHook:
  ((auditId: string, userId: string) => Promise<void>) | undefined;
export function setExportFailureAuditTestHook(
  hook?: (auditId: string, userId: string) => Promise<void>,
): void { exportFailureAuditTestHook = hook; }
let exportStagingTestHook:
  ((event: "created" | "ready" | "removed", filePath: string) => void) | undefined;
export function setExportStagingTestHook(
  hook?: (event: "created" | "ready" | "removed", filePath: string) => void,
): void { exportStagingTestHook = hook; }
let exportFinalizeTestHook: ((archive: archiver.ZipArchive) => void) | undefined;
export function setExportFinalizeTestHook(
  hook?: (archive: archiver.ZipArchive) => void,
): void { exportFinalizeTestHook = hook; }

const toPublicPasskey = (row: typeof passkeyCredentialsTable.$inferSelect) => ({
  id: row.id,
  name: row.name,
  transports: row.transports,
  deviceType: row.deviceType,
  backedUp: row.backedUp,
  lastUsedAt: row.lastUsedAt,
  revokedAt: row.revokedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

function portableProfiles(rows: Array<typeof userProfilesTable.$inferSelect>) {
  return rows.map((row) => {
    const subscriptions = Array.isArray(row.planningData.pushSubscriptions)
      ? row.planningData.pushSubscriptions
      : [];
    return {
      ...row,
      planningData: {
        ...row.planningData,
        pushSubscriptions: subscriptions.map((subscription) => ({
          expirationTime: subscription.expirationTime,
          createdAt: subscription.createdAt,
          updatedAt: subscription.updatedAt,
        })),
      },
    };
  });
}

async function buildAccountExportTransaction(
   userId: string,
   zip: boolean,
   zipTarget?: NodeJS.WritableStream,
   signal?: AbortSignal,
   deadlineAt?: number,
) {
 let attemptedAuditId: string | undefined;
 try {
 return await db.transaction(async (db) => {
   if (signal?.aborted) throw abortReason(signal);
   await db.execute(sql`set transaction isolation level repeatable read`);
   if (deadlineAt) {
     await db.execute(sql`select set_config(
       'statement_timeout',
       ${`${Math.max(1, deadlineAt - Date.now())}ms`},
       true
     )`);
   }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return undefined;
  const [audit] = await db.insert(accountDataExportsTable).values({
    userId,
    formatVersion: ACCOUNT_EXPORT_VERSION,
  }).returning();
  attemptedAuditId = audit.id;
  await exportSnapshotTestHook?.(userId);

  const [
    profiles, retirementPlans, dependents, accounts, incomes, receipts, salaries,
    loans, expenses, budgets, investments, entitlements, documents, uploadGrants,
    deletionJobs, receiptReviews, nominees, advice, loginActivity, passkeys,
    passkeyChallenges, passkeyAudits, mobileChallenges, mobileDeliveryAttempts, exportAudits,
    bankImportProvenance,
  ] = [
    await db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, userId)),
    await db.select().from(retirementPlansTable).where(eq(retirementPlansTable.userId, userId)),
    await db.select().from(dependentsTable).where(eq(dependentsTable.userId, userId)),
    await db.select().from(financialAccountsTable).where(eq(financialAccountsTable.userId, userId)),
    await db.select().from(incomeSourcesTable).where(eq(incomeSourcesTable.userId, userId)),
    await db.select().from(incomeReceiptsTable).where(eq(incomeReceiptsTable.userId, userId)),
    await db.select().from(salaryDetailsTable).where(sql`${salaryDetailsTable.incomeSourceId} in (select id from income_sources where user_id = ${userId})`),
    await db.select().from(loansTable).where(eq(loansTable.userId, userId)),
    await db.select().from(expensesTable).where(eq(expensesTable.userId, userId)),
    await db.select().from(budgetsTable).where(eq(budgetsTable.userId, userId)),
    await db.select().from(investmentsTable).where(eq(investmentsTable.userId, userId)),
    await db.select().from(premiumEntitlementsTable).where(eq(premiumEntitlementsTable.userId, userId)),
    await db.select().from(vaultDocumentsTable).where(eq(vaultDocumentsTable.userId, userId)),
    await db.select().from(vaultUploadGrantsTable).where(eq(vaultUploadGrantsTable.userId, userId)),
    await db.select().from(vaultDeletionJobsTable).where(eq(vaultDeletionJobsTable.userId, userId)),
    await db.select().from(receiptReviewsTable).where(eq(receiptReviewsTable.userId, userId)),
    await db.select().from(nomineesTable).where(eq(nomineesTable.userId, userId)),
    await db.select().from(adviceRequestsTable).where(eq(adviceRequestsTable.userId, userId)),
    await db.select().from(loginActivitiesTable).where(eq(loginActivitiesTable.userId, userId)),
    await db.select().from(passkeyCredentialsTable).where(eq(passkeyCredentialsTable.userId, userId)),
    await db.select({
      id: passkeyChallengesTable.id, type: passkeyChallengesTable.type,
      expiresAt: passkeyChallengesTable.expiresAt, consumedAt: passkeyChallengesTable.consumedAt,
      createdAt: passkeyChallengesTable.createdAt,
    }).from(passkeyChallengesTable).where(eq(passkeyChallengesTable.userId, userId)),
    await db.select().from(passkeyAuditEventsTable).where(eq(passkeyAuditEventsTable.userId, userId)),
    await db.select({
      id: mobileOtpChallengesTable.id, phone: mobileOtpChallengesTable.phone,
      deliveryChannel: mobileOtpChallengesTable.deliveryChannel,
      expiresAt: mobileOtpChallengesTable.expiresAt, deliveredAt: mobileOtpChallengesTable.deliveredAt,
      consumedAt: mobileOtpChallengesTable.consumedAt, createdAt: mobileOtpChallengesTable.createdAt,
    }).from(mobileOtpChallengesTable).where(eq(mobileOtpChallengesTable.userId, userId)),
     await db.select({
       id: mobileOtpDeliveryAttemptsTable.id, challengeId: mobileOtpDeliveryAttemptsTable.challengeId,
       requesterHash: mobileOtpDeliveryAttemptsTable.requesterHash,
       createdAt: mobileOtpDeliveryAttemptsTable.createdAt,
     }).from(mobileOtpDeliveryAttemptsTable).where(eq(mobileOtpDeliveryAttemptsTable.userId, userId)),
     await db.select().from(accountDataExportsTable).where(eq(accountDataExportsTable.userId, userId)),
     await db.select().from(bankStatementImportProvenanceTable)
       .where(eq(bankStatementImportProvenanceTable.userId, userId)),
   ];
  const adviceIds = advice.map((item) => item.id);
  const whatsappEvents = adviceIds.length
    ? await db.select().from(whatsappNotificationEventsTable)
      .where(inArray(whatsappNotificationEventsTable.adviceRequestId, adviceIds))
    : [];
  const emailChallenges = user.email
    ? await db.select({
        id: emailOtpChallengesTable.id, email: emailOtpChallengesTable.email,
        expiresAt: emailOtpChallengesTable.expiresAt, deliveredAt: emailOtpChallengesTable.deliveredAt,
        consumedAt: emailOtpChallengesTable.consumedAt, createdAt: emailOtpChallengesTable.createdAt,
      }).from(emailOtpChallengesTable).where(eq(emailOtpChallengesTable.email, user.email.toLowerCase()))
    : [];
  const [{ count: activeSessions }] = await db.select({ count: sql<number>`count(*)::int` })
    .from(sessionsTable).where(sql`${sessionsTable.sess}->'user'->>'id' = ${userId}`);
  const deletionLifecycle = await db.select({
    id: accountDeletionRequestsTable.id, status: accountDeletionRequestsTable.status,
    requestedAt: accountDeletionRequestsTable.requestedAt,
    scheduledFor: accountDeletionRequestsTable.scheduledFor,
    cancelledAt: accountDeletionRequestsTable.cancelledAt,
    completedAt: accountDeletionRequestsTable.completedAt,
    attempts: accountDeletionRequestsTable.attempts, retainedUntil: accountDeletionRequestsTable.retainedUntil,
  }).from(accountDeletionRequestsTable).where(eq(accountDeletionRequestsTable.userId, userId));

  const data = {
    account: [{
      id: user.id, email: user.email, fullName: user.fullName, profileImageUrl: user.profileImageUrl,
      phone: user.phone, dateOfBirth: user.dateOfBirth, gender: user.gender,
      onboardingCompleted: user.onboardingCompleted, emailVerifiedAt: user.emailVerifiedAt,
      phoneVerifiedAt: user.phoneVerifiedAt,
      createdAt: user.createdAt, updatedAt: user.updatedAt,
    }],
    profileAndPlanning: portableProfiles(profiles),
    retirementPlans,
    dependents,
    financialAccounts: accounts,
    incomeSources: incomes,
    incomeReceipts: receipts,
    salaryDetails: salaries,
    loans,
    expenses,
    budgets,
    investments,
    premiumEntitlements: entitlements,
    vaultDocuments: documents.map(({
      id, userId: ownerId, name, contentType, size, category, expiresOn, archivedAt,
      createdAt, updatedAt,
    }) => ({
      id, userId: ownerId, name, contentType, size, category, expiresOn, archivedAt,
      createdAt, updatedAt,
    })),
    vaultUploadGrants: uploadGrants.map(({ objectPath: _path, promotedObjectPath: _promoted, ...grant }) => grant),
    vaultDeletionJobs: deletionJobs.map(({ objectPath: _path, lastError: _error, ...job }) => job),
    receiptReviews: receiptReviews.map(({ cleanupObjectPath: _path, ...review }) => review),
    nominees,
    adviceRequests: advice,
    whatsappNotificationEvents: whatsappEvents,
    authentication: {
      activeSessionCount: activeSessions,
      loginActivity,
      passkeys: passkeys.map(toPublicPasskey),
      passkeyChallenges,
      passkeyAuditEvents: passkeyAudits,
      emailOtpChallenges: emailChallenges,
     mobileOtpChallenges: mobileChallenges,
      mobileOtpDeliveryAttempts: mobileDeliveryAttempts,
    },
    exportAuditEvents: exportAudits,
    deletionLifecycle,
    bankStatementImportProvenance: bankImportProvenance,
  };
  const safeData = exportProjection(data);
  const authenticationCount = Object.values(data.authentication)
    .reduce<number>((sum, item) => sum + (Array.isArray(item) ? item.length : 0), 0);
  const recordCounts = Object.fromEntries(Object.entries(data).map(([key, value]) => [
    key,
    Array.isArray(value) ? value.length : key === "authentication" ? authenticationCount : 1,
  ]));
  const completedAt = new Date();
  const payload = {
    manifest: {
      format: "ezyRetire personal data export",
      version: ACCOUNT_EXPORT_VERSION,
      exportId: audit.id,
      accountId: userId,
      generatedAt: completedAt.toISOString(),
      complete: true,
      recordCounts,
      securityExclusions: [
        "password hashes", "OTP and WebAuthn challenge secrets", "passkey public keys",
        "session tokens", "push encryption keys", "private object-storage paths",
      ],
      readme: "Each key in data is an account-isolated collection. Dates are ISO-8601 and money values use the stored decimal representation.",
    },
    data: safeData,
  };
  let archiveBytes: Buffer | undefined;
  if (zip) {
     if (signal?.aborted) throw new Error("Export cancelled before archive setup");
    const archive = new archiver.ZipArchive({ store: true });
    const output = zipTarget ?? new PassThrough();
    const chunks: Buffer[] = [];
    if (!zipTarget) (output as PassThrough).on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    const destinationSettled = new Promise<void>((resolve, reject) => {
      const events = output as NodeJS.EventEmitter;
      events.once("error", reject);
      if (zipTarget) {
        events.once("close", () => {
          const state = output as NodeJS.WritableStream & { writableFinished?: boolean };
          if (state.writableFinished) resolve();
          else reject(new Error("Export destination closed before completion"));
        });
      } else {
        events.once("end", resolve);
        events.once("close", () => {
          reject(new Error("Export destination closed before completion"));
        });
      }
      archive.once("error", reject);
    });
    // Cancellation can make the destination reject while an active vault read is
    // still tearing down. Observe that rejection immediately; the read loop below
    // remains the authority for when storage work has actually settled.
    void destinationSettled.catch(() => undefined);
    archive.pipe(output);
    const abortArchive = () => {
      archive.abort();
      archive.destroy();
      if ("destroy" in output && typeof output.destroy === "function") output.destroy();
    };
    signal?.addEventListener("abort", abortArchive, { once: true });
    try {
      archive.append(JSON.stringify(payload, null, 2), { name: "data.json" });
      archive.append(
        `<html><head><meta charset="utf-8"><title>ezyRetire personal data</title></head>` +
        `<body><h1>ezyRetire personal data export</h1><p>Version ${ACCOUNT_EXPORT_VERSION}</p>` +
        `<p>See data.json for the complete allowlisted export. Vault files are in files/.</p></body></html>`,
        { name: "index.html" },
      );
      for (const document of documents) {
        const bytes = await readVaultObjectBytes(
          userId, document.objectPath, 20 * 1024 * 1024, signal,
        );
        archive.append(bytes, { name: safeArchiveName(document.name, document.id) });
      }
      if (signal?.aborted) throw new Error("Personal data export cancelled");
      exportFinalizeTestHook?.(archive);
      // Destination close/error is authoritative. Archiver's finalize promise is
      // deliberately not awaited because abort can leave it pending indefinitely.
      void archive.finalize().catch((error) => {
        if ("destroy" in output && typeof output.destroy === "function") output.destroy(error);
      });
      await destinationSettled;
    } catch (error) {
      archive.abort();
      archive.destroy();
      if ("destroy" in output && typeof output.destroy === "function") output.destroy();
      await Promise.allSettled([
        settleWithin(destinationSettled, 5_000, "Export destination did not settle"),
        settleWithin(
          waitForWritableClose(output),
          5_000,
          "Export staging stream did not close",
        ),
      ]);
      throw error;
    } finally {
      signal?.removeEventListener("abort", abortArchive);
    }
    archiveBytes = zipTarget ? undefined : Buffer.concat(chunks);
  }
  await db.update(accountDataExportsTable).set({
    status: "complete", recordCounts, completedAt,
  }).where(and(eq(accountDataExportsTable.id, audit.id), eq(accountDataExportsTable.userId, userId)));
  return zip ? { archiveBytes, auditId: audit.id } : { payload, auditId: audit.id };
 }, { isolationLevel: "repeatable read" });
 } catch (error) {
    throw attachFailureAudit(error, attemptedAuditId);
 }
}

const failureAuditId = Symbol("accountExportFailureAuditId");
type ExportFailure = Error & { [failureAuditId]?: string };

function attachFailureAudit(error: unknown, auditId?: string): Error {
  const failure = error instanceof Error ? error : new Error("Personal data export failed");
  if (auditId) {
    try {
      (failure as ExportFailure)[failureAuditId] = auditId;
    } catch {
      const wrapped = new Error(failure.message, { cause: failure }) as ExportFailure;
      wrapped[failureAuditId] = auditId;
      return wrapped;
    }
  }
  return failure;
}

function takeFailureAuditId(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const failure = error as ExportFailure;
  const auditId = failure[failureAuditId];
  delete failure[failureAuditId];
  return auditId;
}

/**
 * Failure auditing is deliberately isolated from export teardown. Every database
 * step shares one small budget; timed-out connections are released when they
 * eventually arrive and timed-out clients are discarded.
 */
async function persistExportFailureBestEffort(
  auditId: string | undefined,
  userId: string,
): Promise<void> {
  if (!auditId) return;
  await exportFailureAuditTestHook?.(auditId, userId);
  const deadlineAt = Date.now() + ACCOUNT_EXPORT_FAILURE_AUDIT_BUDGET_MS;
  const remaining = () => Math.max(1, deadlineAt - Date.now());
  let client: PoolClient | undefined;
  let discardError: Error | undefined;
  try {
    const connecting = pool.connect();
    client = await withOperationTimeout(
      connecting,
      remaining(),
      "Export failure audit connection timed out",
    ).catch((error) => {
      void connecting.then((lateClient) => lateClient.release(), () => undefined);
      throw error;
    });
    const timeout = `${remaining()}ms`;
    await withOperationTimeout(client.query(
      `with configured as materialized (
         select set_config('lock_timeout', $1, true),
                set_config('statement_timeout', $1, true)
       )
       insert into account_data_exports
         (id, user_id, format_version, status)
       select $2, $3, $4, 'failed' from configured
       on conflict (id) do update set status = 'failed'`,
      [timeout, auditId, userId, ACCOUNT_EXPORT_VERSION],
    ), remaining(), "Export failure audit write timed out");
  } catch (error) {
    discardError = error instanceof Error ? error : new Error("Export failure audit failed");
  } finally {
    client?.release(discardError);
  }
}

export async function streamAccountExportZip(
  userId: string,
  target: NodeJS.WritableStream,
  options: { generationDeadlineMs?: number; signal?: AbortSignal } = {},
): Promise<boolean> {
  if (isWritableClosed(target)) throw new Error("Export destination is closed");
  const cancellation = new AbortController();
  const generationDeadlineMs = Math.max(
    1,
    options.generationDeadlineMs ?? ACCOUNT_EXPORT_GENERATION_DEADLINE_MS,
  );
  const deadlineAt = Date.now() + generationDeadlineMs;
  const deadline = setTimeout(
    () => cancellation.abort(new Error("Personal data export generation deadline exceeded")),
    generationDeadlineMs,
  );
  deadline.unref();
  const cancelFromCaller = () => cancellation.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", cancelFromCaller, { once: true });
  if (options.signal?.aborted) cancelFromCaller();
  const events = target as NodeJS.EventEmitter;
  const cancelStaging = () => {
    const state = target as NodeJS.WritableStream & { writableFinished?: boolean };
    // A successful pipeline normally closes its destination before its promise
    // resolves. Only a premature close is cancellation.
    if (!state.writableFinished) {
      cancellation.abort(new Error("Export destination closed"));
    }
  };
  events.once("close", cancelStaging);
  events.once("error", cancelStaging);
  let staged: Awaited<ReturnType<typeof stageAccountExportZip>> | undefined;
  let failure: Error | undefined;
  try {
    staged = await stageAccountExportZip(userId, cancellation.signal, deadlineAt);
    if (!staged) return false;
    exportStagingTestHook?.("ready", staged.filePath);
    if (isWritableClosed(target)) throw new Error("Export destination closed after staging");
    await pipeline(createReadStream(staged.filePath), target, { signal: cancellation.signal });
    return true;
  } catch (error) {
    failure = error instanceof Error ? error : new Error("Personal data export failed");
  } finally {
    try {
      if (staged) await removeStagedExport(staged.directory, staged.filePath);
    } finally {
      clearTimeout(deadline);
      events.removeListener("close", cancelStaging);
      events.removeListener("error", cancelStaging);
      options.signal?.removeEventListener("abort", cancelFromCaller);
    }
  }
  await persistExportFailureBestEffort(
    staged?.auditId ?? takeFailureAuditId(failure),
    userId,
  );
  throw failure;
}

async function stageAccountExportZip(
  userId: string,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<{
  directory: string;
  filePath: string;
  auditId: string;
} | undefined> {
  const directory = await mkdtemp(join(tmpdir(), "ezyretire-export-"));
  const filePath = join(directory, "export.zip");
  let output: ReturnType<Awaited<ReturnType<typeof open>>["createWriteStream"]>;
  try {
    await chmod(directory, 0o700);
    const handle = await open(filePath, "wx", 0o600);
    output = handle.createWriteStream();
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  exportStagingTestHook?.("created", filePath);
  try {
    const result = await withAccountWriteFence(userId, async () => {
      if (signal.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error("Export destination closed while waiting");
      }
      return buildAccountExportTransaction(userId, true, output, signal, deadlineAt);
    }, { signal, lockTimeoutMs: 5_000 });
    if (!result) {
      output.destroy();
      await Promise.allSettled([
        settleWithin(waitForWritableClose(output), 5_000, "Export staging stream did not close"),
      ]);
      await removeStagedExport(directory, filePath);
      return undefined;
    }
    return { directory, filePath, auditId: result.auditId };
  } catch (error) {
    output.destroy();
    await Promise.allSettled([
      settleWithin(waitForWritableClose(output), 5_000, "Export staging stream did not close"),
    ]);
    await removeStagedExport(directory, filePath);
    const failure = error instanceof Error ? error : new Error("Personal data export failed");
    await persistExportFailureBestEffort(takeFailureAuditId(failure), userId);
    throw failure;
  }
}

async function settleWithin<T>(
  operation: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  return withOperationTimeout(operation, milliseconds, message);
}

async function waitForWritableClose(output: NodeJS.WritableStream): Promise<void> {
  const state = output as NodeJS.WritableStream & { closed?: boolean };
  if (state.closed) return;
  await new Promise<void>((resolve) => output.once("close", resolve));
}

async function removeStagedExport(directory: string, filePath: string): Promise<void> {
  await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  await rm(directory, { recursive: true, force: true });
  exportStagingTestHook?.("removed", filePath);
}

export async function buildAccountExport(userId: string) {
  try {
    const result = await withAccountWriteFence(
      userId,
      () => buildAccountExportTransaction(userId, false),
    );
    return result && "payload" in result ? result.payload : undefined;
  } catch (error) {
    await persistExportFailureBestEffort(takeFailureAuditId(error), userId);
    throw error;
  }
}

function safeArchiveName(name: string, id: string): string {
  const clean = name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "document";
  return `files/${id}-${clean}`;
}

function isWritableClosed(target: NodeJS.WritableStream): boolean {
  const state = target as NodeJS.WritableStream & {
    destroyed?: boolean;
    closed?: boolean;
    writableEnded?: boolean;
  };
  return state.destroyed === true || state.closed === true || state.writableEnded === true;
}

export async function buildAccountExportZip(userId: string): Promise<Buffer | undefined> {
  try {
    return await withAccountWriteFence(userId, async () => {
    const cancellation = new AbortController();
    const deadlineAt = Date.now() + ACCOUNT_EXPORT_GENERATION_DEADLINE_MS;
    const deadline = setTimeout(
      () => cancellation.abort(new Error("Personal data export generation deadline exceeded")),
      ACCOUNT_EXPORT_GENERATION_DEADLINE_MS,
    );
    deadline.unref();
    try {
      const result = await buildAccountExportTransaction(
        userId,
        true,
        undefined,
        cancellation.signal,
        deadlineAt,
      );
      return result && "archiveBytes" in result ? result.archiveBytes : undefined;
    } finally {
      clearTimeout(deadline);
    }
    });
  } catch (error) {
    await persistExportFailureBestEffort(takeFailureAuditId(error), userId);
    throw error;
  }
}

export async function markLatestExportFailed(userId: string): Promise<void> {
  await db.update(accountDataExportsTable).set({
    status: "failed",
  }).where(and(
    eq(accountDataExportsTable.userId, userId),
    eq(accountDataExportsTable.status, "started"),
  ));
}

export function accountHash(userId: string): string {
  return crypto.createHash("sha256").update(`ezyretire-account:${userId}`).digest("hex");
}

export function accountEmailHash(email: string): string {
  return crypto.createHash("sha256")
    .update(`ezyretire-email:${email.trim().toLowerCase()}`)
    .digest("hex");
}

let sessionRevocationTestHook: (() => Promise<void>) | undefined;
export function setSessionRevocationTestHook(hook?: () => Promise<void>): void {
  sessionRevocationTestHook = hook;
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await db.delete(sessionsTable).where(sql`${sessionsTable.sess}->'user'->>'id' = ${userId}`);
}

export async function scheduleAccountDeletion(userId: string, email: string): Promise<{
  request: typeof accountDeletionRequestsTable.$inferSelect;
  created: boolean;
}> {
  return withAccountWriteFence(userId, () => db.transaction(async (tx) => {
    const [existing] = await tx.select().from(accountDeletionRequestsTable).where(and(
      eq(accountDeletionRequestsTable.userId, userId),
      inArray(accountDeletionRequestsTable.status, ["cooling_off", "processing", "blocked"]),
    )).limit(1);
    let request = existing;
    let created = false;
    if (!request) {
      const now = new Date();
      const [inserted] = await tx.insert(accountDeletionRequestsTable).values({
        userId,
        accountHash: accountHash(userId),
        emailHash: accountEmailHash(email),
        requestedAt: now,
        scheduledFor: new Date(now.getTime() + ACCOUNT_DELETION_COOLING_MS),
        retainedUntil: new Date(now.getTime() + COMPLIANCE_AUDIT_RETENTION_MS),
      }).returning();
      if (!inserted) throw new Error("Account deletion request was not created");
      request = inserted;
      created = true;
    }
    await sessionRevocationTestHook?.();
    await tx.delete(sessionsTable).where(sql`${sessionsTable.sess}->'user'->>'id' = ${userId}`);
    return { request, created };
  }));
}

export async function processAccountDeletion(
  userId: string,
  options: { deadlineAt?: number } = {},
): Promise<"pending" | "completed" | "blocked"> {
  return withAccountWriteFence(
    userId,
    async () => processAccountDeletionFenced(userId, options.deadlineAt),
  );
}

async function processAccountDeletionFenced(
  userId: string,
  deadlineAt = Date.now() + COMPLIANCE_MAINTENANCE_BUDGET_MS,
): Promise<"pending" | "completed" | "blocked"> {
  const now = new Date();
  const [request] = await db.select().from(accountDeletionRequestsTable).where(and(
    eq(accountDeletionRequestsTable.userId, userId),
    or(
      and(inArray(accountDeletionRequestsTable.status, ["cooling_off", "blocked"]),
        lte(accountDeletionRequestsTable.scheduledFor, now),
        or(isNull(accountDeletionRequestsTable.nextAttemptAt),
          lte(accountDeletionRequestsTable.nextAttemptAt, now))),
      and(eq(accountDeletionRequestsTable.status, "processing"),
        lte(accountDeletionRequestsTable.processingLeaseUntil, now),
        or(isNull(accountDeletionRequestsTable.nextAttemptAt),
          lte(accountDeletionRequestsTable.nextAttemptAt, now))),
    ),
  )).limit(1);
  if (!request) return "pending";

  const leaseToken = randomBytes(32).toString("hex");
  const [claimed] = await db.update(accountDeletionRequestsTable).set({
    status: "processing", processingStartedAt: request.processingStartedAt ?? new Date(),
    processingLeaseUntil: new Date(Date.now() + ACCOUNT_DELETION_LEASE_MS),
    processingLeaseToken: leaseToken,
    attempts: sql`${accountDeletionRequestsTable.attempts} + 1`, lastError: null,
  }).where(and(
    eq(accountDeletionRequestsTable.id, request?.id ?? ""),
    or(
      inArray(accountDeletionRequestsTable.status, ["cooling_off", "blocked"]),
      and(eq(accountDeletionRequestsTable.status, "processing"),
        lte(accountDeletionRequestsTable.processingLeaseUntil, now)),
    ),
  )).returning();
  if (!claimed) return "pending";
  const requestId = claimed.id;
  try {
    await revokeAllUserSessions(userId);
    if (!claimed.inventoryCompletedAt) {
      let inventoryRequest = claimed;
      let inventory = await inventoryAccountDeletionPage(inventoryRequest, userId);
      const discoveredPaths = [...inventory.paths];
      // Empty or short terminal pages can advance through the small fixed set
      // of sources in one pass. A full page always checkpoints and yields.
      for (let phaseStep = 1;
        phaseStep < 4 && !inventory.complete
          && inventory.nextCursor === null
          && inventory.nextPhase !== inventoryRequest.inventoryPhase;
        phaseStep += 1) {
        inventoryRequest = {
          ...inventoryRequest,
          inventoryPhase: inventory.nextPhase,
          inventoryCursor: null,
        };
        inventory = await inventoryAccountDeletionPage(inventoryRequest, userId);
        discoveredPaths.push(...inventory.paths);
      }
      for (const chunk of chunkDeletionInventoryRows(discoveredPaths)) {
        await db.insert(accountDeletionObjectsTable).values(chunk.map((objectPath) => ({
          requestId,
          userId,
          objectPath,
        }))).onConflictDoNothing({
          target: [
            accountDeletionObjectsTable.requestId,
            accountDeletionObjectsTable.objectPath,
          ],
        });
      }
      await db.update(accountDeletionRequestsTable).set({
        inventoryPhase: inventory.nextPhase,
        inventoryCursor: inventory.nextCursor,
        inventoryCompletedAt: inventory.complete ? new Date() : null,
        status: "processing",
        processingLeaseUntil: inventory.complete ? claimed.processingLeaseUntil : new Date(),
        processingLeaseToken: inventory.complete ? leaseToken : null,
        nextAttemptAt: inventory.complete
          ? null
          : new Date(Date.now() + ACCOUNT_DELETION_CONTINUATION_DELAY_MS),
      }).where(and(
        eq(accountDeletionRequestsTable.id, requestId),
        eq(accountDeletionRequestsTable.processingLeaseToken, leaseToken),
      ));
      if (!inventory.complete) return "pending";
    }

    const pendingObjects = await db.select().from(accountDeletionObjectsTable).where(and(
      eq(accountDeletionObjectsTable.requestId, requestId),
      eq(accountDeletionObjectsTable.status, "pending"),
    )).orderBy(
      asc(accountDeletionObjectsTable.createdAt),
      asc(accountDeletionObjectsTable.id),
    ).limit(ACCOUNT_DELETION_OBJECT_BATCH_SIZE);
    let objectFailure = false;
    for (const object of pendingObjects) {
      if (Date.now() >= deadlineAt) break;
      try {
        await withOperationTimeout(
          deleteVaultObject(object.objectPath, userId),
          Math.max(1, Math.min(
            ACCOUNT_DELETION_OBJECT_TIMEOUT_MS,
            deadlineAt - Date.now(),
          )),
          "Stored object deletion timed out",
        );
        await db.update(accountDeletionObjectsTable).set({
          status: "complete",
          attempts: sql`${accountDeletionObjectsTable.attempts} + 1`,
          lastAttemptAt: new Date(),
          lastError: null,
          completedAt: new Date(),
        }).where(and(
          eq(accountDeletionObjectsTable.id, object.id),
          eq(accountDeletionObjectsTable.requestId, requestId),
          eq(accountDeletionObjectsTable.status, "pending"),
        ));
      } catch (error) {
        objectFailure = true;
        await db.update(accountDeletionObjectsTable).set({
          attempts: sql`${accountDeletionObjectsTable.attempts} + 1`,
          lastAttemptAt: new Date(),
          lastError: error instanceof Error ? error.message.slice(0, 500) : "Storage deletion failed",
        }).where(and(
          eq(accountDeletionObjectsTable.id, object.id),
          eq(accountDeletionObjectsTable.requestId, requestId),
          eq(accountDeletionObjectsTable.status, "pending"),
        ));
      }
    }
    const [remainingObject] = await db.select({ id: accountDeletionObjectsTable.id })
      .from(accountDeletionObjectsTable).where(and(
        eq(accountDeletionObjectsTable.requestId, requestId),
        eq(accountDeletionObjectsTable.status, "pending"),
      )).limit(1);
    if (remainingObject) {
      await db.update(accountDeletionRequestsTable).set({
        status: objectFailure ? "blocked" : "processing",
        processingLeaseUntil: objectFailure ? null : new Date(),
        processingLeaseToken: null,
        nextAttemptAt: new Date(Date.now() + (
          objectFailure
            ? deletionRetryBackoffMs(claimed.attempts)
            : ACCOUNT_DELETION_CONTINUATION_DELAY_MS
        )),
        lastError: objectFailure ? "One or more stored objects could not be deleted" : null,
      }).where(and(
        eq(accountDeletionRequestsTable.id, requestId),
        eq(accountDeletionRequestsTable.status, "processing"),
        eq(accountDeletionRequestsTable.processingLeaseToken, leaseToken),
      ));
      return objectFailure ? "blocked" : "pending";
    }

    await db.transaction(async (tx) => {
      const [ownedLease] = await tx.select({ id: accountDeletionRequestsTable.id })
        .from(accountDeletionRequestsTable).where(and(
          eq(accountDeletionRequestsTable.id, requestId),
          eq(accountDeletionRequestsTable.status, "processing"),
          eq(accountDeletionRequestsTable.processingLeaseToken, leaseToken),
        )).for("update");
      if (!ownedLease) throw new Error("Account deletion lease was lost before finalization");
      const [unfinished] = await tx.select({ id: accountDeletionObjectsTable.id })
        .from(accountDeletionObjectsTable).where(and(
          eq(accountDeletionObjectsTable.requestId, requestId),
          eq(accountDeletionObjectsTable.status, "pending"),
        )).limit(1);
      if (unfinished) throw new Error("Object cleanup is not complete");
      const [current] = await tx.select({ email: usersTable.email }).from(usersTable)
        .where(eq(usersTable.id, userId)).for("update");
      if (current?.email) {
        await tx.delete(emailOtpChallengesTable)
          .where(eq(emailOtpChallengesTable.email, current.email.toLowerCase()));
      }
      await tx.delete(usersTable).where(eq(usersTable.id, userId));
      await tx.delete(accountDeletionObjectsTable)
        .where(eq(accountDeletionObjectsTable.requestId, requestId));
      await tx.update(accountDataExportsTable).set({ userId: request.accountHash })
        .where(eq(accountDataExportsTable.userId, userId));
      await tx.update(accountDeletionRequestsTable).set({ userId: request.accountHash })
        .where(eq(accountDeletionRequestsTable.userId, userId));
      await tx.update(accountDeletionRequestsTable).set({
        status: "completed", completedAt: new Date(), lastError: null,
        processingLeaseUntil: null, processingLeaseToken: null,
      }).where(and(eq(accountDeletionRequestsTable.id, requestId),
        eq(accountDeletionRequestsTable.status, "processing"),
        eq(accountDeletionRequestsTable.processingLeaseToken, leaseToken)));
    });
    return "completed";
  } catch (error) {
    await db.update(accountDeletionRequestsTable).set({
      status: "blocked",
      processingLeaseUntil: null,
      nextAttemptAt: new Date(Date.now() + deletionRetryBackoffMs(claimed.attempts)),
      lastError: error instanceof Error ? error.message.slice(0, 1000) : "Deletion failed",
    }).where(and(eq(accountDeletionRequestsTable.id, requestId),
      eq(accountDeletionRequestsTable.status, "processing"),
      eq(accountDeletionRequestsTable.processingLeaseToken, leaseToken)));
    return "blocked";
  }
}

type DeletionInventoryPhase =
  | "vault_documents"
  | "upload_grants"
  | "deletion_jobs"
  | "receipt_reviews"
  | "complete";

export function chunkDeletionInventoryRows(
  paths: readonly string[],
  chunkSize = ACCOUNT_DELETION_INVENTORY_INSERT_SIZE,
): string[][] {
  const size = Math.max(1, Math.min(chunkSize, ACCOUNT_DELETION_INVENTORY_INSERT_SIZE));
  const unique = [...new Set(paths)];
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += size) {
    chunks.push(unique.slice(index, index + size));
  }
  return chunks;
}

async function inventoryAccountDeletionPage(
  request: typeof accountDeletionRequestsTable.$inferSelect,
  userId: string,
): Promise<{
  paths: string[];
  nextPhase: DeletionInventoryPhase;
  nextCursor: string | null;
  complete: boolean;
}> {
  const phase = request.inventoryPhase as DeletionInventoryPhase;
  const cursor = request.inventoryCursor;
  const pageWhere = <T, U>(userColumn: T, idColumn: U) => and(
    eq(userColumn as never, userId),
    ...(cursor ? [gt(idColumn as never, cursor)] : []),
  );
  let rows: Array<{ id: string; paths: string[] }>;
  let following: DeletionInventoryPhase;
  if (phase === "vault_documents") {
    const page = await db.select({ id: vaultDocumentsTable.id, path: vaultDocumentsTable.objectPath })
      .from(vaultDocumentsTable).where(pageWhere(vaultDocumentsTable.userId, vaultDocumentsTable.id))
      .orderBy(asc(vaultDocumentsTable.id)).limit(ACCOUNT_DELETION_INVENTORY_PAGE_SIZE);
    rows = page.map((row) => ({ id: row.id, paths: [row.path] }));
    following = "upload_grants";
  } else if (phase === "upload_grants") {
    const page = await db.select({
      id: vaultUploadGrantsTable.id,
      path: vaultUploadGrantsTable.objectPath,
      promoted: vaultUploadGrantsTable.promotedObjectPath,
    }).from(vaultUploadGrantsTable)
      .where(pageWhere(vaultUploadGrantsTable.userId, vaultUploadGrantsTable.id))
      .orderBy(asc(vaultUploadGrantsTable.id)).limit(ACCOUNT_DELETION_INVENTORY_PAGE_SIZE);
    rows = page.map((row) => ({
      id: row.id,
      paths: [row.path, row.promoted].filter((path): path is string => Boolean(path)),
    }));
    following = "deletion_jobs";
  } else if (phase === "deletion_jobs") {
    const page = await db.select({ id: vaultDeletionJobsTable.id, path: vaultDeletionJobsTable.objectPath })
      .from(vaultDeletionJobsTable)
      .where(pageWhere(vaultDeletionJobsTable.userId, vaultDeletionJobsTable.id))
      .orderBy(asc(vaultDeletionJobsTable.id)).limit(ACCOUNT_DELETION_INVENTORY_PAGE_SIZE);
    rows = page.map((row) => ({ id: row.id, paths: [row.path] }));
    following = "receipt_reviews";
  } else if (phase === "receipt_reviews") {
    const page = await db.select({ id: receiptReviewsTable.id, path: receiptReviewsTable.cleanupObjectPath })
      .from(receiptReviewsTable).where(pageWhere(receiptReviewsTable.userId, receiptReviewsTable.id))
      .orderBy(asc(receiptReviewsTable.id)).limit(ACCOUNT_DELETION_INVENTORY_PAGE_SIZE);
    rows = page.map((row) => ({
      id: row.id,
      paths: row.path ? [row.path] : [],
    }));
    following = "complete";
  } else {
    return { paths: [], nextPhase: "complete", nextCursor: null, complete: true };
  }
  const pageFull = rows.length === ACCOUNT_DELETION_INVENTORY_PAGE_SIZE;
  return {
    paths: rows.flatMap((row) => row.paths),
    nextPhase: pageFull ? phase : following,
    nextCursor: pageFull ? rows.at(-1)!.id : null,
    complete: !pageFull && following === "complete",
  };
}

function deletionRetryBackoffMs(attempts: number): number {
  return Math.min(60 * 60_000, 5_000 * 2 ** Math.min(Math.max(0, attempts - 1), 9));
}

async function withOperationTimeout<T>(
  operation: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runAccountComplianceMaintenance(
  limit = 25,
  options: { budgetMs?: number; now?: () => number } = {},
): Promise<{
  completed: number;
  blocked: number;
  auditRowsPurged: number;
  deadlineReached: boolean;
}> {
  const bounded = Math.max(1, Math.min(limit, 100));
  const clock = options.now ?? Date.now;
  const deadline = clock() + Math.max(1, options.budgetMs ?? COMPLIANCE_MAINTENANCE_BUDGET_MS);
  const due = await db.select({ userId: accountDeletionRequestsTable.userId })
    .from(accountDeletionRequestsTable).where(or(
      and(
        inArray(accountDeletionRequestsTable.status, ["cooling_off", "blocked"]),
        lte(accountDeletionRequestsTable.scheduledFor, new Date()),
        or(
          isNull(accountDeletionRequestsTable.nextAttemptAt),
          lte(accountDeletionRequestsTable.nextAttemptAt, new Date()),
        ),
      ),
      and(
        eq(accountDeletionRequestsTable.status, "processing"),
        lte(accountDeletionRequestsTable.processingLeaseUntil, new Date()),
        or(
          isNull(accountDeletionRequestsTable.nextAttemptAt),
          lte(accountDeletionRequestsTable.nextAttemptAt, new Date()),
        ),
      ),
    )).orderBy(
      asc(sql`coalesce(${accountDeletionRequestsTable.nextAttemptAt}, ${accountDeletionRequestsTable.scheduledFor})`),
      asc(accountDeletionRequestsTable.requestedAt),
    ).limit(bounded);
  let completed = 0;
  let blocked = 0;
  for (const item of due) {
    if (clock() >= deadline - ACCOUNT_DELETION_OBJECT_TIMEOUT_MS) break;
    const result = await processAccountDeletion(item.userId, { deadlineAt: deadline });
    if (result === "completed") completed += 1;
    if (result === "blocked") blocked += 1;
  }
  const deadlineReached = clock() >= deadline;
  const cutoff = new Date(Date.now() - COMPLIANCE_AUDIT_RETENTION_MS);
  const retentionLimit = 100;
  const expiredExports = await db.select({ id: accountDataExportsTable.id })
    .from(accountDataExportsTable).where(lte(accountDataExportsTable.requestedAt, cutoff))
    .orderBy(asc(accountDataExportsTable.requestedAt)).limit(retentionLimit);
  const expiredRequests = await db.select({ id: accountDeletionRequestsTable.id })
    .from(accountDeletionRequestsTable).where(and(
    inArray(accountDeletionRequestsTable.status, ["cancelled", "completed"]),
    lte(accountDeletionRequestsTable.retainedUntil, new Date()),
  )).orderBy(asc(accountDeletionRequestsTable.retainedUntil)).limit(retentionLimit);
  const deletedExports = expiredExports.length
    ? await db.delete(accountDataExportsTable)
      .where(inArray(accountDataExportsTable.id, expiredExports.map((row) => row.id)))
      .returning({ id: accountDataExportsTable.id })
    : [];
  const deletedRequests = expiredRequests.length
    ? await db.delete(accountDeletionRequestsTable)
      .where(inArray(accountDeletionRequestsTable.id, expiredRequests.map((row) => row.id)))
      .returning({ id: accountDeletionRequestsTable.id })
    : [];
  return {
    completed,
    blocked,
    auditRowsPurged: deletedExports.length + deletedRequests.length,
    deadlineReached,
  };
}