import crypto from "crypto";
import {
  db,
  expensesTable,
  mobileOtpDeliveryAttemptsTable,
  mobileOtpChallengesTable,
  nomineesTable,
  premiumEntitlementsTable,
  receiptReviewsTable,
  usersTable,
  vaultDeletionJobsTable,
  vaultDocumentsTable,
  vaultUploadGrantsTable,
} from "@workspace/db";
import { and, count, desc, eq, gt, isNull, isNotNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  assertVaultObject,
  assertPromotedVaultObject,
  createVaultDocumentPath,
  createVaultStagingPath,
  createVaultUploadUrl,
  deleteVaultObject,
  fenceVaultObjectPath,
  isVaultDocumentPath,
  isVaultObjectPath,
  isVaultStagingPath,
  markVaultOwner,
  MAX_VAULT_SIZE,
  promoteVaultObject,
  streamVaultObject,
} from "../lib/object-storage.js";
import {
  createMobileOtp,
  hashMobileOtp,
  hashMobileRequester,
  MOBILE_OTP_MAX_ATTEMPTS,
  MOBILE_OTP_MAX_REQUESTS,
  MOBILE_OTP_RESEND_MS,
  MOBILE_OTP_TTL_MS,
  MOBILE_OTP_WINDOW_MS,
  sendVerificationSms,
} from "../lib/mobile-otp.js";
import { MobileDeliveryError } from "../lib/mobile-otp.js";
import { extractReceiptCandidates, normalizeReceiptCandidates } from "../lib/receipt-ocr.js";
import { normalizeOptionalPhone } from "../lib/auth-profile-input.js";
import {
  assertCanonicalMutationAdmission,
  captureCanonicalAdmissionBaseline,
  financialLifecycleLockKey,
} from "../lib/finance-store.js";

const router: IRouter = Router();
const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const SMS_INDETERMINATE_RETRY_MS = 3_000;
const SMS_DELIVERY_LEASE_MS = 12_000;
const STAGING_AUTHORITY_GRACE_MS = 5 * 60_000;
const PROMOTION_LEASE_MS = 60_000;
const PROMOTION_SETTLE_GRACE_MS = 5 * 60_000;
let storageCommitHookForTests: ((operation: "replacement" | "receipt_confirmation") => void) | undefined;

export function setStorageCommitHookForTests(
  hook?: (operation: "replacement" | "receipt_confirmation") => void,
): void {
  storageCommitHookForTests = hook;
}

function userId(req: Request, res: Response): string | undefined {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Login required" });
    return;
  }
  return req.user.id;
}
function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function documentJson(row: typeof vaultDocumentsTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}
function nomineeJson(row: typeof nomineesTable.$inferSelect, gapStatus = "incomplete") {
  return {
    ...row, gapStatus,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

async function enqueueDeletion(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  objectPath: string,
  reason: string,
  finalizeAfter: Date | null = null,
): Promise<void> {
  await tx.insert(vaultDeletionJobsTable).values({ userId, objectPath, reason, finalizeAfter })
    .onConflictDoNothing({ target: vaultDeletionJobsTable.objectPath });
}

async function processDeletionJob(userId: string, objectPath: string): Promise<boolean> {
  const job = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(vaultDeletionJobsTable).where(and(
      eq(vaultDeletionJobsTable.userId, userId),
      eq(vaultDeletionJobsTable.objectPath, objectPath),
    )).for("update");
    if (!locked) return undefined;
    const now = new Date();
    if (locked.finalizeAfter && locked.finalizeAfter > now) return false;
    if (locked.reason === "promotion_rollback") {
      await tx.update(vaultDeletionJobsTable).set({
        reason: "promotion_cleanup_settle",
        finalizeAfter: new Date(now.getTime() + PROMOTION_SETTLE_GRACE_MS),
        updatedAt: now,
      }).where(eq(vaultDeletionJobsTable.id, locked.id));
      return false;
    }
    return locked;
  });
  if (job === undefined) return true;
  if (job === false) return false;
  try {
    if (job.reason === "promotion_cleanup_settle") await fenceVaultObjectPath(objectPath, userId);
    else await deleteVaultObject(objectPath, userId);
    await db.delete(vaultDeletionJobsTable).where(and(
      eq(vaultDeletionJobsTable.id, job.id),
      eq(vaultDeletionJobsTable.userId, userId),
    ));
    return true;
  } catch (error) {
    await db.update(vaultDeletionJobsTable).set({
      attempts: sql`${vaultDeletionJobsTable.attempts} + 1`,
      lastError: text(error instanceof Error ? error.message : "Storage deletion failed", 500),
      lastAttemptAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(vaultDeletionJobsTable.id, job.id),
      eq(vaultDeletionJobsTable.userId, userId),
    ));
    return false;
  }
}

async function processDeletionJobs(userId: string): Promise<{ cleaned: number; failed: number }> {
  const jobs = await db.select({ objectPath: vaultDeletionJobsTable.objectPath })
    .from(vaultDeletionJobsTable).where(eq(vaultDeletionJobsTable.userId, userId));
  let cleaned = 0;
  let failed = 0;
  for (const job of jobs) {
    if (await processDeletionJob(userId, job.objectPath)) cleaned += 1;
    else failed += 1;
  }
  return { cleaned, failed };
}

export async function runVaultDeletionMaintenance(limit = 100): Promise<{ cleaned: number; failed: number }> {
  const boundedLimit = Math.max(1, Math.min(limit, 500));
  await discoverExpiredStorage(boundedLimit);
  const now = new Date();
  const jobs = await db.select({
    userId: vaultDeletionJobsTable.userId,
    objectPath: vaultDeletionJobsTable.objectPath,
  }).from(vaultDeletionJobsTable).where(or(
    isNull(vaultDeletionJobsTable.finalizeAfter),
    lte(vaultDeletionJobsTable.finalizeAfter, now),
  )).limit(boundedLimit);
  let cleaned = 0;
  let failed = 0;
  for (const job of jobs) {
    if (await processDeletionJob(job.userId, job.objectPath)) cleaned += 1;
    else failed += 1;
  }
  return { cleaned, failed };
}

async function discoverExpiredStorage(limit: number, ownerId?: string): Promise<void> {
  const now = new Date();
  const abandonedRegistrations = await db.select({
    id: vaultUploadGrantsTable.id,
    userId: vaultUploadGrantsTable.userId,
  }).from(vaultUploadGrantsTable).where(and(
    ...(ownerId ? [eq(vaultUploadGrantsTable.userId, ownerId)] : []),
    eq(vaultUploadGrantsTable.purpose, "receipt_review"),
    isNotNull(vaultUploadGrantsTable.consumedAt),
    isNull(vaultUploadGrantsTable.claimedAt),
    isNotNull(vaultUploadGrantsTable.documentId),
    lt(vaultUploadGrantsTable.consumedAt, new Date(now.getTime() - 30 * 60_000)),
  )).limit(limit);
  for (const candidate of abandonedRegistrations) {
    await db.transaction(async (tx) => {
      const [grant] = await tx.select().from(vaultUploadGrantsTable).where(and(
        eq(vaultUploadGrantsTable.id, candidate.id),
        eq(vaultUploadGrantsTable.userId, candidate.userId),
      )).for("update");
      if (!grant?.documentId || !grant.promotedObjectPath || grant.claimedAt
        || grant.purpose !== "receipt_review" || !grant.consumedAt
        || grant.consumedAt >= new Date(now.getTime() - 30 * 60_000)) return;
      const [document] = await tx.select().from(vaultDocumentsTable).where(and(
        eq(vaultDocumentsTable.id, grant.documentId),
        eq(vaultDocumentsTable.userId, grant.userId),
      )).for("update");
      if (document) {
        if (document.objectPath === grant.promotedObjectPath) {
          await enqueueDeletion(tx, grant.userId, document.objectPath, "unclaimed_receipt_registration");
          await tx.delete(vaultDocumentsTable).where(and(
            eq(vaultDocumentsTable.id, document.id),
            eq(vaultDocumentsTable.userId, grant.userId),
            eq(vaultDocumentsTable.objectPath, grant.promotedObjectPath),
          ));
        } else {
          await tx.update(vaultUploadGrantsTable).set({
            documentId: null,
            promotedObjectPath: null,
          }).where(and(
            eq(vaultUploadGrantsTable.id, grant.id),
            eq(vaultUploadGrantsTable.userId, grant.userId),
          ));
        }
      }
      await enqueueDeletion(
        tx, grant.userId, grant.objectPath, "staging_upload",
        new Date(grant.expiresAt.getTime() + STAGING_AUTHORITY_GRACE_MS),
      );
    });
  }
  const grants = await db.select({
    id: vaultUploadGrantsTable.id,
    userId: vaultUploadGrantsTable.userId,
  }).from(vaultUploadGrantsTable).where(and(
    ...(ownerId ? [eq(vaultUploadGrantsTable.userId, ownerId)] : []),
    isNull(vaultUploadGrantsTable.consumedAt),
    lt(vaultUploadGrantsTable.expiresAt, now),
  )).limit(limit);
  for (const candidate of grants) {
    await db.transaction(async (tx) => {
      const [grant] = await tx.select().from(vaultUploadGrantsTable).where(and(
        eq(vaultUploadGrantsTable.id, candidate.id),
        eq(vaultUploadGrantsTable.userId, candidate.userId),
      )).for("update");
      if (!grant || grant.consumedAt || grant.expiresAt >= now) return;
      await enqueueDeletion(
        tx, grant.userId, grant.objectPath, "expired_upload_grant",
        new Date(grant.expiresAt.getTime() + STAGING_AUTHORITY_GRACE_MS),
      );
      await tx.delete(vaultUploadGrantsTable).where(and(
        eq(vaultUploadGrantsTable.id, grant.id),
        eq(vaultUploadGrantsTable.userId, grant.userId),
      ));
    });
  }
  const reviewLimit = Math.max(0, limit - grants.length);
  const reviews = reviewLimit === 0 ? [] : await db.select({
    id: receiptReviewsTable.id,
    userId: receiptReviewsTable.userId,
  }).from(receiptReviewsTable).where(and(
    ...(ownerId ? [eq(receiptReviewsTable.userId, ownerId)] : []),
    eq(receiptReviewsTable.status, "pending"),
    lt(receiptReviewsTable.expiresAt, now),
  )).limit(reviewLimit);
  for (const candidate of reviews) {
    await db.transaction(async (tx) => {
      const [review] = await tx.select().from(receiptReviewsTable).where(and(
        eq(receiptReviewsTable.id, candidate.id),
        eq(receiptReviewsTable.userId, candidate.userId),
      )).for("update");
      if (!review || review.status !== "pending" || review.expiresAt >= now) return;
      if (review.documentId) {
        const [document] = await tx.select().from(vaultDocumentsTable).where(and(
          eq(vaultDocumentsTable.id, review.documentId),
          eq(vaultDocumentsTable.userId, review.userId),
        )).for("update");
        if (document) {
          const [otherOwner] = await tx.select({ id: receiptReviewsTable.id })
            .from(receiptReviewsTable).where(and(
              eq(receiptReviewsTable.documentId, document.id),
              ne(receiptReviewsTable.id, review.id),
              or(
                eq(receiptReviewsTable.status, "pending"),
                and(eq(receiptReviewsTable.status, "confirmed"), eq(receiptReviewsTable.retainOriginal, true)),
              ),
            )).for("update");
          if (!otherOwner) {
            await enqueueDeletion(tx, review.userId, document.objectPath, "expired_receipt_review");
            await tx.delete(vaultDocumentsTable).where(and(
              eq(vaultDocumentsTable.id, document.id),
              eq(vaultDocumentsTable.userId, review.userId),
            ));
          }
        }
      }
      await tx.delete(receiptReviewsTable).where(and(
        eq(receiptReviewsTable.id, review.id),
        eq(receiptReviewsTable.userId, review.userId),
      ));
    });
  }
}

async function cleanupExpiredStorage(userId: string): Promise<{ cleaned: number; failed: number }> {
  await discoverExpiredStorage(100, userId);
  return processDeletionJobs(userId);
}

async function cleanupGrantedObject(
  userId: string,
  objectPath: string,
): Promise<"cleaned" | "not_found" | "owned" | "pending"> {
  const result = await db.transaction(async (tx) => {
    const [grant] = await tx.select().from(vaultUploadGrantsTable).where(and(
      eq(vaultUploadGrantsTable.userId, userId),
      eq(vaultUploadGrantsTable.objectPath, objectPath),
    )).for("update");
    if (!grant) return "not_found";
    if (grant.consumedAt && grant.documentId && grant.promotedObjectPath) {
      if (grant.claimedAt) return "owned";
      const [document] = await tx.select().from(vaultDocumentsTable).where(and(
        eq(vaultDocumentsTable.id, grant.documentId),
        eq(vaultDocumentsTable.userId, userId),
      )).for("update");
      if (document) {
        if (document.objectPath === grant.promotedObjectPath) {
          await enqueueDeletion(tx, userId, document.objectPath, "unclaimed_registration");
          await tx.delete(vaultDocumentsTable).where(and(
            eq(vaultDocumentsTable.id, document.id),
            eq(vaultDocumentsTable.userId, userId),
            eq(vaultDocumentsTable.objectPath, grant.promotedObjectPath),
          ));
        } else {
          await tx.update(vaultUploadGrantsTable).set({
            documentId: null,
            promotedObjectPath: null,
          }).where(and(
            eq(vaultUploadGrantsTable.id, grant.id),
            eq(vaultUploadGrantsTable.userId, userId),
          ));
        }
      }
      await enqueueDeletion(
        tx, userId, objectPath, "staging_upload",
        new Date(grant.expiresAt.getTime() + STAGING_AUTHORITY_GRACE_MS),
      );
      return "pending";
    }
    const [document] = await tx.select({ id: vaultDocumentsTable.id }).from(vaultDocumentsTable)
      .where(and(
        eq(vaultDocumentsTable.userId, userId),
        eq(vaultDocumentsTable.objectPath, objectPath),
      )).for("update");
    if (document) return "owned";
    await enqueueDeletion(
      tx, userId, objectPath, "abandoned_upload_grant",
      new Date(grant.expiresAt.getTime() + STAGING_AUTHORITY_GRACE_MS),
    );
    await tx.update(vaultUploadGrantsTable).set({ consumedAt: new Date() }).where(and(
      eq(vaultUploadGrantsTable.id, grant.id),
      eq(vaultUploadGrantsTable.userId, userId),
    ));
    return "pending";
  });
  if (result !== "pending") return result;
  const processed = await processDeletionJobs(userId);
  return processed.failed === 0 ? "cleaned" : "pending";
}

router.use(["/vault", "/receipts"], async (req, res, next): Promise<void> => {
  const id = userId(req, res);
  if (!id) return;
  if (req.path === "/cleanup" || req.path === "/cleanup-status") {
    next();
    return;
  }
  const [entitlement] = await db.select().from(premiumEntitlementsTable)
    .where(eq(premiumEntitlementsTable.userId, id));
  if (!entitlement?.active || entitlement.plan !== "premium"
    || (entitlement.validUntil && entitlement.validUntil <= new Date())) {
    res.status(403).json({ error: "An active premium plan is required" });
    return;
  }
  next();
});

router.get("/vault/cleanup-status", async (req, res): Promise<void> => {
  const id = userId(req, res);
  if (!id) return;
  const now = new Date();
  const rows = await db.select().from(vaultDeletionJobsTable)
    .where(eq(vaultDeletionJobsTable.userId, id));
  res.json({
    pending: rows.length,
    failed: rows.filter((row) => row.attempts > 0).length,
    scheduled: rows.filter((row) => row.finalizeAfter && row.finalizeAfter > now).length,
  });
});

router.get("/entitlements", async (req, res): Promise<void> => {
  const id = userId(req, res);
  if (!id) return;
  const [[stored], [account]] = await Promise.all([
    db.select().from(premiumEntitlementsTable).where(eq(premiumEntitlementsTable.userId, id)),
    db.select({ phone: usersTable.phone, phoneVerifiedAt: usersTable.phoneVerifiedAt })
      .from(usersTable).where(eq(usersTable.id, id)),
  ]);
  const active = Boolean(stored?.active && (!stored.validUntil || stored.validUntil > new Date()));
  res.json({
    plan: active && stored?.plan === "premium" ? "premium" : "free",
    premium: active,
    validUntil: active ? stored?.validUntil?.toISOString() ?? null : null,
    capabilities: {
      receiptOcr: active,
      bankStatementImport: active,
      documentVault: active,
      nomineeTracker: true,
      verifiedMobile: true,
    },
    mobileVerification: {
      hasMobile: Boolean(account?.phone),
      verified: Boolean(account?.phone && account.phoneVerifiedAt),
    },
  });
});

router.post("/auth/mobile-otp/request", async (req, res): Promise<void> => {
  const id = userId(req, res);
  if (!id) return;
  const now = new Date();
  const requesterHash = hashMobileRequester(req.ip || "unknown");
  const issuance = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`mobile:${id}`}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`mobile-network:${requesterHash}`}))`);
    const [account] = await tx.select().from(usersTable)
      .where(eq(usersTable.id, id)).for("update");
    const verificationPhone = normalizeOptionalPhone(account?.phone);
    if (!verificationPhone || !/^\+[1-9]\d{7,14}$/.test(verificationPhone)) {
      return { status: "invalid_phone" as const };
    }
    if (account?.phoneVerifiedAt) return { status: "verified" as const };
    const windowStart = new Date(now.getTime() - MOBILE_OTP_WINDOW_MS);
    const [{ accountDeliveryAttempts }] = await tx
      .select({ accountDeliveryAttempts: count() })
      .from(mobileOtpDeliveryAttemptsTable)
      .where(and(
        eq(mobileOtpDeliveryAttemptsTable.userId, id),
        gt(mobileOtpDeliveryAttemptsTable.createdAt, windowStart),
      ));
    const [{ networkDeliveryAttempts }] = await tx
      .select({ networkDeliveryAttempts: count() })
      .from(mobileOtpDeliveryAttemptsTable)
      .where(and(
        eq(mobileOtpDeliveryAttemptsTable.requesterHash, requesterHash),
        gt(mobileOtpDeliveryAttemptsTable.createdAt, windowStart),
      ));
    if (accountDeliveryAttempts >= MOBILE_OTP_MAX_REQUESTS
      || networkDeliveryAttempts >= MOBILE_OTP_MAX_REQUESTS) {
      return { status: "limited" as const };
    }
    await tx.update(mobileOtpChallengesTable).set({ consumedAt: now }).where(and(
      eq(mobileOtpChallengesTable.userId, id),
      ne(mobileOtpChallengesTable.phone, verificationPhone),
      isNull(mobileOtpChallengesTable.consumedAt),
    ));
    const [latest] = await tx.select().from(mobileOtpChallengesTable)
      .where(eq(mobileOtpChallengesTable.userId, id))
      .orderBy(desc(mobileOtpChallengesTable.createdAt)).limit(1);
    if (latest?.resendAvailableAt && latest.resendAvailableAt > now) {
      return { status: "throttled" as const, retry: Math.ceil((latest.resendAvailableAt.getTime() - now.getTime()) / 1000) };
    }
    const [reusable] = await tx.select().from(mobileOtpChallengesTable)
      .where(and(
        eq(mobileOtpChallengesTable.userId, id),
        eq(mobileOtpChallengesTable.phone, verificationPhone),
        isNull(mobileOtpChallengesTable.deliveredAt),
        isNull(mobileOtpChallengesTable.consumedAt),
        gt(mobileOtpChallengesTable.expiresAt, now),
      )).orderBy(desc(mobileOtpChallengesTable.createdAt)).limit(1);
    if (reusable) {
      const deliveryAttemptId = crypto.randomUUID();
      const deliveryLeaseUntil = new Date(now.getTime() + SMS_DELIVERY_LEASE_MS);
      await tx.update(mobileOtpChallengesTable).set({
        deliveryAttemptId, deliveryLeaseUntil,
        resendAvailableAt: new Date(now.getTime() + Math.max(MOBILE_OTP_RESEND_MS, SMS_DELIVERY_LEASE_MS)),
      }).where(eq(mobileOtpChallengesTable.id, reusable.id));
      await tx.insert(mobileOtpDeliveryAttemptsTable).values({
        userId: id,
        challengeId: reusable.id,
        requesterHash,
      });
      return {
        status: "issued" as const, challengeId: reusable.id, code: createMobileOtp(reusable.id),
        phone: verificationPhone, deliveryAttemptId,
      };
    }
    const [{ accountRequests }] = await tx.select({ accountRequests: count() }).from(mobileOtpChallengesTable)
      .where(and(
        eq(mobileOtpChallengesTable.userId, id),
        gt(mobileOtpChallengesTable.createdAt, windowStart),
      ));
    const [{ networkRequests }] = await tx.select({ networkRequests: count() }).from(mobileOtpChallengesTable)
      .where(and(
        eq(mobileOtpChallengesTable.requesterHash, requesterHash),
        gt(mobileOtpChallengesTable.createdAt, windowStart),
      ));
    if (accountRequests >= MOBILE_OTP_MAX_REQUESTS || networkRequests >= MOBILE_OTP_MAX_REQUESTS) {
      return { status: "limited" as const };
    }
    const challengeId = crypto.randomUUID();
    const deliveryAttemptId = crypto.randomUUID();
    const deliveryLeaseUntil = new Date(now.getTime() + SMS_DELIVERY_LEASE_MS);
    const code = createMobileOtp(challengeId);
    await tx.insert(mobileOtpChallengesTable).values({
      id: challengeId, userId: id, phone: verificationPhone, requesterHash,
      codeHash: hashMobileOtp(challengeId, code), deliveryChannel: "sms",
      expiresAt: new Date(now.getTime() + MOBILE_OTP_TTL_MS),
      resendAvailableAt: new Date(now.getTime() + Math.max(MOBILE_OTP_RESEND_MS, SMS_DELIVERY_LEASE_MS)),
      deliveryAttemptId,
      deliveryLeaseUntil,
      maxAttempts: MOBILE_OTP_MAX_ATTEMPTS,
    });
    await tx.insert(mobileOtpDeliveryAttemptsTable).values({
      userId: id,
      challengeId,
      requesterHash,
    });
    return { status: "issued" as const, challengeId, code, phone: verificationPhone, deliveryAttemptId };
  });
  if (issuance.status === "invalid_phone") {
    res.status(400).json({ error: "Add a valid international mobile number before verification" });
    return;
  }
  if (issuance.status === "verified") {
    res.json({ verified: true, message: "Mobile number is already verified" });
    return;
  }
  if (issuance.status === "throttled") {
    res.status(429).json({ error: "Please wait before requesting another code", retryAfterSeconds: issuance.retry });
    return;
  }
  if (issuance.status === "limited") {
    res.status(429).json({ error: "Too many verification requests. Try again later." });
    return;
  }
  try {
    await sendVerificationSms(issuance.phone, issuance.code);
  } catch (smsError) {
    const indeterminate = smsError instanceof MobileDeliveryError && smsError.indeterminate;
    if (indeterminate) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`mobile:${id}`}))`);
        await tx.update(mobileOtpChallengesTable).set({
          resendAvailableAt: new Date(Date.now() + SMS_INDETERMINATE_RETRY_MS),
          deliveryAttemptId: null, deliveryLeaseUntil: null,
        }).where(and(
          eq(mobileOtpChallengesTable.id, issuance.challengeId),
          eq(mobileOtpChallengesTable.deliveryAttemptId, issuance.deliveryAttemptId),
          isNull(mobileOtpChallengesTable.deliveredAt),
          isNull(mobileOtpChallengesTable.consumedAt),
        ));
      });
      res.status(503).json({ error: "SMS delivery status is uncertain. Please retry shortly.", retryAfterSeconds: 3 });
      return;
    }
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`mobile:${id}`}))`);
      await tx.update(mobileOtpChallengesTable).set({
        consumedAt: new Date(), deliveryAttemptId: null, deliveryLeaseUntil: null,
      }).where(and(
        eq(mobileOtpChallengesTable.id, issuance.challengeId),
        eq(mobileOtpChallengesTable.deliveryAttemptId, issuance.deliveryAttemptId),
        isNull(mobileOtpChallengesTable.deliveredAt),
        isNull(mobileOtpChallengesTable.consumedAt),
      ));
    });
    req.log.warn({ errorName: smsError instanceof Error ? smsError.name : "Unknown" }, "Mobile OTP delivery failed");
    res.status(503).json({ error: "Mobile verification delivery is temporarily unavailable" });
    return;
  }
  const delivered = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`mobile:${id}`}))`);
    const [delivered] = await tx.update(mobileOtpChallengesTable).set({
      deliveredAt: new Date(), deliveryChannel: "sms",
      deliveryAttemptId: null, deliveryLeaseUntil: null,
    }).where(and(
      eq(mobileOtpChallengesTable.id, issuance.challengeId),
      eq(mobileOtpChallengesTable.deliveryAttemptId, issuance.deliveryAttemptId),
      isNull(mobileOtpChallengesTable.deliveredAt),
      isNull(mobileOtpChallengesTable.consumedAt),
    )).returning({ id: mobileOtpChallengesTable.id });
    if (delivered) {
      await tx.update(mobileOtpChallengesTable).set({ consumedAt: new Date() })
        .where(and(
          eq(mobileOtpChallengesTable.userId, id),
          ne(mobileOtpChallengesTable.id, issuance.challengeId),
          isNull(mobileOtpChallengesTable.consumedAt),
        ));
    }
    return Boolean(delivered);
  });
  if (!delivered) {
    res.status(503).json({ error: "Mobile verification delivery could not be finalized" });
    return;
  }
  res.json({
    challengeId: issuance.challengeId, deliveryChannel: "sms",
    message: "Verification code sent by SMS",
    resendAfterSeconds: MOBILE_OTP_RESEND_MS / 1000,
  });
});

router.post("/auth/mobile-otp/verify", async (req, res): Promise<void> => {
  const id = userId(req, res);
  if (!id) return;
  const challengeId = text(req.body?.challengeId, 36);
  const code = text(req.body?.code, 6);
  if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: "Enter the 6-digit verification code" });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [account] = await tx.select({ phone: usersTable.phone }).from(usersTable)
      .where(eq(usersTable.id, id)).for("update");
    const [challenge] = await tx.select().from(mobileOtpChallengesTable)
      .where(and(eq(mobileOtpChallengesTable.id, challengeId), eq(mobileOtpChallengesTable.userId, id))).for("update");
    if (!challenge || !challenge.deliveredAt || challenge.consumedAt) return "invalid" as const;
    const currentPhone = normalizeOptionalPhone(account?.phone);
    if (!currentPhone || challenge.phone !== currentPhone) return "invalid" as const;
    if (challenge.expiresAt <= new Date()) return "expired" as const;
    if (challenge.failedAttempts >= challenge.maxAttempts) return "exhausted" as const;
    if (challenge.codeHash !== hashMobileOtp(challenge.id, code)) {
      const attempts = challenge.failedAttempts + 1;
      await tx.update(mobileOtpChallengesTable).set({ failedAttempts: attempts }).where(eq(mobileOtpChallengesTable.id, challenge.id));
      return attempts >= challenge.maxAttempts ? "exhausted" as const : "wrong" as const;
    }
    const verifiedAt = new Date();
    const [phoneOwner] = await tx.select({ id: usersTable.id }).from(usersTable).where(and(
      eq(usersTable.phone, challenge.phone), isNotNull(usersTable.phoneVerifiedAt),
    ));
    if (phoneOwner && phoneOwner.id !== id) return "already_used" as const;
    const [verified] = await tx.update(usersTable).set({ phoneVerifiedAt: verifiedAt, updatedAt: verifiedAt })
      .where(and(eq(usersTable.id, id), eq(usersTable.phone, challenge.phone)))
      .returning({ id: usersTable.id });
    if (!verified) return "invalid" as const;
    await tx.update(mobileOtpChallengesTable).set({ consumedAt: verifiedAt })
      .where(eq(mobileOtpChallengesTable.id, challenge.id));
    return "verified" as const;
  }).catch((error: unknown) => {
    if (isRecord(error) && error.code === "23505") return "already_used" as const;
    throw error;
  });
  if (result !== "verified") {
    const messages = {
      invalid: "This code is no longer available. Request a new code.",
      already_used: "This mobile number is already verified on another account.",
      expired: "This code has expired. Request a new code.",
      exhausted: "Too many incorrect attempts. Request a new code.",
      wrong: "That code is incorrect.",
    };
    res.status(401).json({ error: messages[result], reason: result });
    return;
  }
  res.json({ verified: true });
});

router.post("/vault/uploads/request-url", async (req, res): Promise<void> => {
  const id = userId(req, res);
  if (!id) return;
  const name = text(req.body?.name, 240);
  const contentType = text(req.body?.contentType, 120).toLowerCase();
  const size = Number(req.body?.size);
  const purpose = req.body?.purpose === undefined ? "vault_document" : req.body.purpose;
  if (!name || !ALLOWED_TYPES.has(contentType) || !Number.isInteger(size) || size < 1 || size > MAX_VAULT_SIZE) {
    res.status(400).json({ error: "Use a PDF, JPEG, PNG, or WebP file no larger than 20 MB" });
    return;
  }
  if (purpose !== "vault_document" && purpose !== "receipt_review") {
    res.status(400).json({ error: "Invalid upload purpose" });
    return;
  }
  await cleanupExpiredStorage(id);
  const objectPath = createVaultStagingPath();
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  const [grant] = await db.insert(vaultUploadGrantsTable).values({
    userId: id, objectPath, name, contentType, size, purpose,
    expiresAt,
  }).returning({ id: vaultUploadGrantsTable.id });
  let upload;
  try {
    upload = await createVaultUploadUrl(
      id, purpose, size, contentType, objectPath, expiresAt,
    );
  } catch {
    await db.delete(vaultUploadGrantsTable).where(and(
      eq(vaultUploadGrantsTable.id, grant.id),
      eq(vaultUploadGrantsTable.userId, id),
      isNull(vaultUploadGrantsTable.consumedAt),
    )).catch(() => undefined);
    res.status(503).json({ error: "Storage provider is temporarily unavailable" });
    return;
  }
  res.json({ ...upload, metadata: { name, contentType, size } });
});

router.post("/vault/cleanup", async (req, res): Promise<void> => {
  const id = userId(req, res);
  if (!id) return;
  if (req.body?.objectPath !== undefined) {
    const objectPath = text(req.body.objectPath, 1024);
    if (!isVaultObjectPath(objectPath)) {
      res.status(400).json({ error: "Invalid vault object path" });
      return;
    }
    try {
      const result = await cleanupGrantedObject(id, objectPath);
      if (result === "not_found") {
        const [pending] = await db.select({ id: vaultDeletionJobsTable.id })
          .from(vaultDeletionJobsTable).where(and(
            eq(vaultDeletionJobsTable.userId, id),
            eq(vaultDeletionJobsTable.objectPath, objectPath),
          ));
        if (!pending) {
          res.status(404).json({ error: "Upload grant not found" });
          return;
        }
        const cleaned = await processDeletionJob(id, objectPath);
        res.status(cleaned ? 200 : 503).json(cleaned
          ? { cleaned: 1, failed: 0, retryRequired: false, cleanupPending: false }
          : { cleaned: 0, failed: 1, retryRequired: true, cleanupPending: true });
      } else if (result === "owned") {
        res.status(409).json({ error: "A vault document or deletion job already owns this object" });
      } else if (result === "pending") {
        res.status(503).json({
          error: "Object cleanup is temporarily unavailable",
          cleaned: 0,
          failed: 1,
          retryRequired: true,
          cleanupPending: true,
        });
      } else {
        res.json({ cleaned: 1, failed: 0, retryRequired: false, cleanupPending: false });
      }
    } catch {
      res.status(503).json({
        error: "Object cleanup is temporarily unavailable",
        cleaned: 0,
        failed: 1,
        retryRequired: true,
        cleanupPending: true,
      });
    }
    return;
  }
  const result = await cleanupExpiredStorage(id);
  res.status(result.failed > 0 ? 503 : 200).json({
    ...result,
    retryRequired: result.failed > 0,
    cleanupPending: result.failed > 0,
  });
});

router.get("/vault/documents", async (req, res): Promise<void> => {
  const id = userId(req, res);
  if (!id) return;
  const rows = await db.select().from(vaultDocumentsTable)
    .where(eq(vaultDocumentsTable.userId, id)).orderBy(desc(vaultDocumentsTable.createdAt));
  res.json({ documents: rows.map(documentJson) });
});

router.post("/vault/documents", async (req, res): Promise<void> => {
  const id = userId(req, res);
  if (!id) return;
  const objectPath = text(req.body?.objectPath, 1024);
  const name = text(req.body?.name, 240);
  const contentType = text(req.body?.contentType, 120).toLowerCase();
  const category = text(req.body?.category, 64) || "other";
  const size = Number(req.body?.size);
  const expiresOn = req.body?.expiresOn == null ? null : req.body.expiresOn;
  if (!name || !ALLOWED_TYPES.has(contentType) || !Number.isInteger(size) || size < 1 || size > MAX_VAULT_SIZE
    || (expiresOn !== null && !validDate(expiresOn))) {
    res.status(400).json({ error: "Invalid document metadata" });
    return;
  }
  const [associatedGrant] = await db.select().from(vaultUploadGrantsTable).where(and(
    eq(vaultUploadGrantsTable.userId, id),
    eq(vaultUploadGrantsTable.objectPath, objectPath),
    eq(vaultUploadGrantsTable.name, name),
    eq(vaultUploadGrantsTable.contentType, contentType),
    eq(vaultUploadGrantsTable.size, size),
    isNotNull(vaultUploadGrantsTable.consumedAt),
    isNotNull(vaultUploadGrantsTable.documentId),
  ));
  if (associatedGrant?.documentId) {
    const [associated] = await db.select().from(vaultDocumentsTable).where(and(
      eq(vaultDocumentsTable.id, associatedGrant.documentId),
      eq(vaultDocumentsTable.userId, id),
    ));
    if (associated && associated.objectPath === associatedGrant.promotedObjectPath) {
      res.json({ document: documentJson(associated) });
      return;
    }
  }
  const [existing] = await db.select().from(vaultDocumentsTable).where(and(
    eq(vaultDocumentsTable.userId, id),
    eq(vaultDocumentsTable.objectPath, objectPath),
  ));
  if (existing) {
    if (existing.name === name && existing.contentType === contentType && existing.size === size) {
      res.json({ document: documentJson(existing) });
    } else {
      res.status(409).json({ error: "This uploaded object is already registered" });
    }
    return;
  }
  try {
    if (!isVaultStagingPath(objectPath)) throw new Error("UPLOAD_GRANT_INVALID");
    const [pendingGrant] = await db.select({ purpose: vaultUploadGrantsTable.purpose })
      .from(vaultUploadGrantsTable).where(and(
        eq(vaultUploadGrantsTable.userId, id),
        eq(vaultUploadGrantsTable.objectPath, objectPath),
        isNull(vaultUploadGrantsTable.consumedAt),
      ));
    if (!pendingGrant) throw new Error("UPLOAD_GRANT_INVALID");
    const file = await assertVaultObject(
      objectPath, size, contentType, undefined, id, pendingGrant.purpose,
    );
    await markVaultOwner(file, id);
    const promotedPath = createVaultDocumentPath();
    await db.transaction((tx) => enqueueDeletion(
      tx, id, promotedPath, "promotion_rollback", new Date(Date.now() + PROMOTION_LEASE_MS),
    ));
    await promoteVaultObject(file, objectPath, promotedPath, id);
    await assertPromotedVaultObject(promotedPath, size, contentType, id);
    const [row] = await db.transaction(async (tx) => {
      const [grant] = await tx.select().from(vaultUploadGrantsTable).where(and(
        eq(vaultUploadGrantsTable.userId, id), eq(vaultUploadGrantsTable.objectPath, objectPath),
        eq(vaultUploadGrantsTable.name, name), eq(vaultUploadGrantsTable.contentType, contentType),
        eq(vaultUploadGrantsTable.size, size), isNull(vaultUploadGrantsTable.consumedAt),
        gt(vaultUploadGrantsTable.expiresAt, new Date()),
      )).for("update");
      if (!grant) throw new Error("UPLOAD_GRANT_INVALID");
      const [rollback] = await tx.select().from(vaultDeletionJobsTable).where(and(
        eq(vaultDeletionJobsTable.userId, id),
        eq(vaultDeletionJobsTable.objectPath, promotedPath),
      )).for("update");
      if (!rollback || rollback.reason !== "promotion_rollback") throw new Error("PROMOTION_EXPIRED");
      const [created] = await tx.insert(vaultDocumentsTable).values({
        userId: id, objectPath: promotedPath, name, contentType, size, category, expiresOn,
      }).returning();
      await tx.update(vaultUploadGrantsTable).set({
        consumedAt: new Date(), promotedObjectPath: promotedPath, documentId: created.id,
      })
        .where(and(eq(vaultUploadGrantsTable.id, grant.id), eq(vaultUploadGrantsTable.userId, id)));
      await tx.delete(vaultDeletionJobsTable).where(and(
        eq(vaultDeletionJobsTable.userId, id),
        eq(vaultDeletionJobsTable.objectPath, promotedPath),
      ));
      await enqueueDeletion(
        tx, id, objectPath, "staging_upload",
        new Date(grant.expiresAt.getTime() + STAGING_AUTHORITY_GRACE_MS),
      );
      return [created];
    });
    res.status(201).json({ document: documentJson(row) });
  } catch (error) {
    req.log.warn({ errorName: error instanceof Error ? error.name : "Unknown" }, "Vault upload confirmation failed");
    res.status(400).json({ error: "Uploaded object could not be confirmed" });
  }
});

router.get("/vault/documents/:id/download", async (req, res): Promise<void> => {
  const id = userId(req, res);
  if (!id) return;
  const [row] = await db.select().from(vaultDocumentsTable)
    .where(and(eq(vaultDocumentsTable.id, req.params.id), eq(vaultDocumentsTable.userId, id)));
  if (!row) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  try {
    await streamVaultObject(id, row.objectPath, row.contentType, row.name, res);
  } catch {
    res.status(503).json({ error: "Storage provider is temporarily unavailable" });
  }
});

router.get("/vault/documents/:id/preview", async (req, res): Promise<void> => {
  const id = userId(req, res);
  if (!id) return;
  const [row] = await db.select().from(vaultDocumentsTable)
    .where(and(eq(vaultDocumentsTable.id, req.params.id), eq(vaultDocumentsTable.userId, id)));
  if (!row || !["image/jpeg", "image/png", "image/webp"].includes(row.contentType)) {
    res.status(404).json({ error: "Inline preview is only available for raster images" });
    return;
  }
  try {
    await streamVaultObject(id, row.objectPath, row.contentType, row.name, res, true);
  } catch {
    res.status(503).json({ error: "Storage provider is temporarily unavailable" });
  }
});

router.put("/vault/documents/:id", async (req, res): Promise<void> => {
  const id = userId(req, res);
  if (!id) return;
  const [current] = await db.select().from(vaultDocumentsTable)
    .where(and(eq(vaultDocumentsTable.id, req.params.id), eq(vaultDocumentsTable.userId, id)));
  if (!current) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const objectPath = text(req.body?.objectPath, 1024);
  const name = text(req.body?.name, 240);
  const contentType = text(req.body?.contentType, 120).toLowerCase();
  const size = Number(req.body?.size);
  if (objectPath === current.objectPath && current.name === name
    && current.contentType === contentType && current.size === size) {
    res.json({ document: documentJson(current), cleanupPending: false });
    return;
  }
  if (objectPath === current.objectPath || !name || !ALLOWED_TYPES.has(contentType)
    || !Number.isInteger(size) || size < 1 || size > MAX_VAULT_SIZE) {
    res.status(400).json({ error: "Invalid replacement metadata" });
    return;
  }
  try {
    const [availableGrant] = await db.select({ id: vaultUploadGrantsTable.id })
      .from(vaultUploadGrantsTable).where(and(
        eq(vaultUploadGrantsTable.userId, id), eq(vaultUploadGrantsTable.objectPath, objectPath),
        eq(vaultUploadGrantsTable.name, name), eq(vaultUploadGrantsTable.contentType, contentType),
        eq(vaultUploadGrantsTable.size, size), isNull(vaultUploadGrantsTable.consumedAt),
        gt(vaultUploadGrantsTable.expiresAt, new Date()),
      ));
    if (!availableGrant) throw new Error("UPLOAD_GRANT_INVALID");
    const [pendingGrant] = await db.select({ purpose: vaultUploadGrantsTable.purpose })
      .from(vaultUploadGrantsTable).where(and(
        eq(vaultUploadGrantsTable.userId, id),
        eq(vaultUploadGrantsTable.objectPath, objectPath),
        isNull(vaultUploadGrantsTable.consumedAt),
      ));
    if (!pendingGrant) throw new Error("UPLOAD_GRANT_INVALID");
    const file = await assertVaultObject(
      objectPath, size, contentType, undefined, id, pendingGrant.purpose,
    );
    await markVaultOwner(file, id);
    const promotedPath = createVaultDocumentPath();
    await db.transaction((tx) => enqueueDeletion(
      tx, id, promotedPath, "promotion_rollback", new Date(Date.now() + PROMOTION_LEASE_MS),
    ));
    await promoteVaultObject(file, objectPath, promotedPath, id);
    await assertPromotedVaultObject(promotedPath, size, contentType, id);
    const [updated] = await db.transaction(async (tx) => {
      const [lockedCurrent] = await tx.select().from(vaultDocumentsTable).where(and(
        eq(vaultDocumentsTable.id, current.id),
        eq(vaultDocumentsTable.userId, id),
      )).for("update");
      if (!lockedCurrent || lockedCurrent.objectPath !== current.objectPath) {
        throw new Error("DOCUMENT_CHANGED");
      }
      const [grant] = await tx.select().from(vaultUploadGrantsTable).where(and(
        eq(vaultUploadGrantsTable.userId, id), eq(vaultUploadGrantsTable.objectPath, objectPath),
        eq(vaultUploadGrantsTable.name, name), eq(vaultUploadGrantsTable.contentType, contentType),
        eq(vaultUploadGrantsTable.size, size), isNull(vaultUploadGrantsTable.consumedAt),
        gt(vaultUploadGrantsTable.expiresAt, new Date()),
      )).for("update");
      if (!grant) throw new Error("UPLOAD_GRANT_INVALID");
      const [rollback] = await tx.select().from(vaultDeletionJobsTable).where(and(
        eq(vaultDeletionJobsTable.userId, id),
        eq(vaultDeletionJobsTable.objectPath, promotedPath),
      )).for("update");
      if (!rollback || rollback.reason !== "promotion_rollback") throw new Error("PROMOTION_EXPIRED");
      await tx.update(vaultUploadGrantsTable).set({
        documentId: null,
        promotedObjectPath: null,
      }).where(and(
        eq(vaultUploadGrantsTable.userId, id),
        eq(vaultUploadGrantsTable.documentId, lockedCurrent.id),
        eq(vaultUploadGrantsTable.promotedObjectPath, lockedCurrent.objectPath),
      ));
      const [changed] = await tx.update(vaultDocumentsTable)
        .set({ objectPath: promotedPath, name, contentType, size, updatedAt: new Date() })
        .where(and(eq(vaultDocumentsTable.id, current.id), eq(vaultDocumentsTable.userId, id))).returning();
      await tx.update(vaultUploadGrantsTable).set({
        consumedAt: new Date(),
        promotedObjectPath: promotedPath,
        documentId: changed.id,
      })
        .where(and(eq(vaultUploadGrantsTable.id, grant.id), eq(vaultUploadGrantsTable.userId, id)));
      await enqueueDeletion(tx, id, lockedCurrent.objectPath, "document_replaced");
      await tx.delete(vaultDeletionJobsTable).where(and(
        eq(vaultDeletionJobsTable.userId, id),
        eq(vaultDeletionJobsTable.objectPath, promotedPath),
      ));
      await enqueueDeletion(
        tx, id, objectPath, "staging_upload",
        new Date(grant.expiresAt.getTime() + STAGING_AUTHORITY_GRACE_MS),
      );
      storageCommitHookForTests?.("replacement");
      return [changed];
    });
    const cleanupPending = !(await processDeletionJob(id, current.objectPath));
    res.json({ document: documentJson(updated), cleanupPending });
  } catch (error) {
    req.log.warn({ errorName: error instanceof Error ? error.name : "Unknown" }, "Vault replacement failed");
    res.status(503).json({ error: "Replacement could not be completed. Retry safely.", retryRequired: true });
  }
});

router.patch("/vault/documents/:id/lifecycle", async (req, res): Promise<void> => {
  const id = userId(req, res);
  if (!id) return;
  if (typeof req.body?.archived !== "boolean") {
    res.status(400).json({ error: "archived must be a boolean" });
    return;
  }
  const [row] = await db.update(vaultDocumentsTable)
    .set({ archivedAt: req.body.archived ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(vaultDocumentsTable.id, req.params.id), eq(vaultDocumentsTable.userId, id))).returning();
  if (!row) res.status(404).json({ error: "Document not found" });
  else res.json({ document: documentJson(row) });
});

router.delete("/vault/documents/:id", async (req, res): Promise<void> => {
  const id = userId(req, res);
  if (!id) return;
  try {
    const removed = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(vaultDocumentsTable)
        .where(and(eq(vaultDocumentsTable.id, req.params.id), eq(vaultDocumentsTable.userId, id)))
        .for("update");
      if (!row) return false;
      await enqueueDeletion(tx, id, row.objectPath, "document_deleted");
      await tx.delete(vaultDocumentsTable)
        .where(and(eq(vaultDocumentsTable.id, row.id), eq(vaultDocumentsTable.userId, id)));
      return row.objectPath;
    });
    if (!removed) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const cleanupPending = !(await processDeletionJob(id, removed));
    res.status(cleanupPending ? 202 : 200).json({ cleanupPending });
  } catch (error) {
    req.log.warn({ errorName: error instanceof Error ? error.name : "Unknown" }, "Vault document deletion failed");
    res.status(503).json({ error: "Document deletion could not be committed", retryRequired: true });
  }
});

router.post("/receipts/reviews", async (req, res): Promise<void> => {
  const id = userId(req, res);
  if (!id) return;
  const documentId = text(req.body?.documentId, 36);
  const submittedCandidates = normalizeReceiptCandidates(req.body?.candidates);
  if (!documentId) {
    res.status(400).json({ error: "A vault receipt document is required" });
    return;
  }
  const [document] = await db.select().from(vaultDocumentsTable)
    .where(and(eq(vaultDocumentsTable.id, documentId), eq(vaultDocumentsTable.userId, id)));
  if (!document) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  let candidates = submittedCandidates;
  if (candidates.length === 0) {
    try {
      candidates = await extractReceiptCandidates(id, document.objectPath, document.contentType);
    } catch (error) {
      const unavailable = error instanceof Error && error.message === "RECEIPT_OCR_NOT_CONFIGURED";
      req.log.warn({ errorName: error instanceof Error ? error.name : "Unknown" }, "Receipt OCR failed");
      res.status(unavailable ? 503 : 422).json({
        error: unavailable
          ? "Receipt scanning is temporarily unavailable"
          : "No reliable receipt details could be extracted. Enter them manually.",
      });
      return;
    }
  }
  let created = true;
  let review;
  try {
    review = await db.transaction(async (tx) => {
      const [lockedDocument] = await tx.select().from(vaultDocumentsTable).where(and(
        eq(vaultDocumentsTable.id, documentId), eq(vaultDocumentsTable.userId, id),
      )).for("update");
      if (!lockedDocument) return null;
      const [existing] = await tx.select().from(receiptReviewsTable)
        .where(eq(receiptReviewsTable.documentId, documentId)).for("update");
      if (existing) {
        created = false;
        return existing;
      }
      const [inserted] = await tx.insert(receiptReviewsTable).values({
        userId: id, documentId, candidates,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }).returning();
      await tx.update(vaultUploadGrantsTable).set({ claimedAt: new Date() }).where(and(
        eq(vaultUploadGrantsTable.userId, id),
        eq(vaultUploadGrantsTable.documentId, documentId),
        eq(vaultUploadGrantsTable.purpose, "receipt_review"),
        isNull(vaultUploadGrantsTable.claimedAt),
      ));
      return inserted;
    });
  } catch (error) {
    const [existing] = await db.select().from(receiptReviewsTable).where(and(
      eq(receiptReviewsTable.documentId, documentId),
      eq(receiptReviewsTable.userId, id),
    ));
    if (!existing) throw error;
    created = false;
    review = existing;
  }
  if (!review) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.status(created ? 201 : 200).json({
    review: { id: review.id, documentId, candidates, status: "pending", expiresAt: review.expiresAt.toISOString() },
    saved: false,
  });
});

router.get("/receipts/reviews/:id", async (req, res): Promise<void> => {
  const id = userId(req, res);
  if (!id) return;
  const [review] = await db.select().from(receiptReviewsTable)
    .where(and(eq(receiptReviewsTable.id, req.params.id), eq(receiptReviewsTable.userId, id)));
  if (!review) res.status(404).json({ error: "Receipt review not found" });
  else res.json({ review: {
    ...review, expiresAt: review.expiresAt.toISOString(), createdAt: review.createdAt.toISOString(),
    confirmedAt: review.confirmedAt?.toISOString() ?? null,
  } });
});

router.post("/receipts/reviews/:id/confirm", async (req, res): Promise<void> => {
  const id = userId(req, res);
  if (!id) return;
  const values = req.body?.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    res.status(400).json({ error: "Reviewed receipt values are required" });
    return;
  }
  const reviewed = values as Record<string, unknown>;
  const merchant = text(reviewed.merchant, 160);
  const amount = Number(reviewed.amount);
  const date = reviewed.date;
  const category = text(reviewed.category, 80);
  const retainOriginal = reviewed.retainOriginal === true;
  const lineItems = Array.isArray(reviewed.lineItems) ? reviewed.lineItems.slice(0, 100)
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => `${text(item.description, 120)} (${Math.max(0, Number(item.amount) || 0).toFixed(2)})`)
    .filter(Boolean) : [];
  if (!merchant || !Number.isFinite(amount) || amount <= 0 || amount > 999_999_999_999.99
    || !validDate(date) || !category) {
    res.status(400).json({ error: "Confirm the merchant, amount, date, and category" });
    return;
  }
  const now = new Date();
  let result;
  try {
    result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${financialLifecycleLockKey(id)}))`);
      const [financialUser] = await tx.select().from(usersTable)
        .where(eq(usersTable.id, id)).limit(1);
      if (!financialUser) return null;
      const admissionBaseline = await captureCanonicalAdmissionBaseline(tx, financialUser);
      const [review] = await tx.select().from(receiptReviewsTable)
        .where(and(eq(receiptReviewsTable.id, req.params.id), eq(receiptReviewsTable.userId, id)))
        .for("update");
      if (!review) return null;
      if (review.confirmedExpenseDeletedId) throw new Error("CONFIRMED_EXPENSE_DELETED");
      if (review.status === "confirmed" && review.confirmedExpenseId) {
        const [expense] = await tx.select().from(expensesTable).where(and(
          eq(expensesTable.id, review.confirmedExpenseId),
          eq(expensesTable.userId, id),
        ));
        if (!expense) throw new Error("CONFIRMED_EXPENSE_MISSING");
        return {
          reviewId: review.id,
          expense,
          cleanupPath: review.cleanupObjectPath,
          confirmedValues: review.confirmedValues as Record<string, unknown>,
          retainOriginal: review.retainOriginal,
        };
      }
      if (review.status !== "pending" || review.expiresAt <= now) return null;
      let cleanupPath: string | null = null;
      if (!retainOriginal && review.documentId) {
        const [document] = await tx.select().from(vaultDocumentsTable).where(and(
          eq(vaultDocumentsTable.id, review.documentId), eq(vaultDocumentsTable.userId, id),
        )).for("update");
        if (document) {
          const [otherOwner] = await tx.select({ id: receiptReviewsTable.id })
            .from(receiptReviewsTable).where(and(
              eq(receiptReviewsTable.documentId, document.id),
              ne(receiptReviewsTable.id, review.id),
              or(
                eq(receiptReviewsTable.status, "pending"),
                and(eq(receiptReviewsTable.status, "confirmed"), eq(receiptReviewsTable.retainOriginal, true)),
              ),
            )).for("update");
          if (!otherOwner) {
            await enqueueDeletion(tx, id, document.objectPath, "receipt_confirmed");
            await tx.delete(vaultDocumentsTable).where(and(
              eq(vaultDocumentsTable.id, document.id), eq(vaultDocumentsTable.userId, id),
            ));
            cleanupPath = document.objectPath;
          }
        }
      }
      const note = [`Receipt merchant: ${merchant}`, ...lineItems.map((item) => `Item: ${item}`)].join("\n");
      const [expense] = await tx.insert(expensesTable).values({
        userId: id,
        merchant,
        amount: String(Math.round(amount * 100) / 100),
        date,
        category,
        note,
      }).returning();
      await tx.update(receiptReviewsTable)
        .set({
          status: "confirmed",
          confirmedExpenseId: expense.id,
          cleanupObjectPath: cleanupPath,
          confirmedValues: { ...reviewed, lineItems, retainOriginal },
          retainOriginal,
          confirmedAt: now,
        })
        .where(and(eq(receiptReviewsTable.id, review.id), eq(receiptReviewsTable.userId, id)));
      const internalAdmissionLimit = res.locals.financialDocumentAdmissionLimit;
      await assertCanonicalMutationAdmission(
        tx,
        financialUser,
        admissionBaseline,
        typeof internalAdmissionLimit === "number"
          && Number.isSafeInteger(internalAdmissionLimit)
          && internalAdmissionLimit > 0
          ? internalAdmissionLimit
          : undefined,
      );
      storageCommitHookForTests?.("receipt_confirmation");
      return {
        reviewId: review.id,
        expense,
        cleanupPath,
        confirmedValues: { ...reviewed, lineItems, retainOriginal },
        retainOriginal,
      };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CONFIRMED_EXPENSE_DELETED") {
      res.status(410).json({ error: "The confirmed receipt expense was deleted" });
      return;
    }
    req.log.warn({ errorName: error instanceof Error ? error.name : "Unknown" }, "Receipt confirmation cleanup failed");
    res.status(503).json({ error: "Receipt confirmation is temporarily unavailable", retryRequired: true });
    return;
  }
  if (!result) {
    res.status(409).json({ error: "Receipt review expired or was already completed" });
    return;
  }
  const cleanupPending = result.cleanupPath
    ? !(await processDeletionJob(id, result.cleanupPath))
    : false;
  res.json({
    reviewId: result.reviewId,
    expense: result.expense,
    status: "confirmed",
    values: result.confirmedValues,
    saved: true,
    retainedOriginal: result.retainOriginal,
    cleanupPending,
  });
});

router.delete("/receipts/reviews/:id", async (req, res): Promise<void> => {
  const id = userId(req, res);
  if (!id) return;
  let result;
  try {
    result = await db.transaction(async (tx) => {
      const [review] = await tx.select().from(receiptReviewsTable).where(and(
        eq(receiptReviewsTable.id, req.params.id), eq(receiptReviewsTable.userId, id),
        eq(receiptReviewsTable.status, "pending"),
      )).for("update");
      if (!review) return null;
      let cleanupPath: string | null = null;
      if (review.documentId) {
        const [document] = await tx.select().from(vaultDocumentsTable).where(and(
          eq(vaultDocumentsTable.id, review.documentId), eq(vaultDocumentsTable.userId, id),
        )).for("update");
        if (document) {
          const [otherOwner] = await tx.select({ id: receiptReviewsTable.id })
            .from(receiptReviewsTable).where(and(
              eq(receiptReviewsTable.documentId, document.id),
              ne(receiptReviewsTable.id, review.id),
              or(
                eq(receiptReviewsTable.status, "pending"),
                and(eq(receiptReviewsTable.status, "confirmed"), eq(receiptReviewsTable.retainOriginal, true)),
              ),
            )).for("update");
          if (!otherOwner) {
            await enqueueDeletion(tx, id, document.objectPath, "receipt_discarded");
            await tx.delete(vaultDocumentsTable).where(and(
              eq(vaultDocumentsTable.id, document.id), eq(vaultDocumentsTable.userId, id),
            ));
            cleanupPath = document.objectPath;
          }
        }
      }
      await tx.update(receiptReviewsTable).set({ status: "discarded" })
        .where(and(eq(receiptReviewsTable.id, review.id), eq(receiptReviewsTable.userId, id)));
      return { cleanupPath };
    });
  } catch (error) {
    req.log.warn({ errorName: error instanceof Error ? error.name : "Unknown" }, "Receipt discard cleanup failed");
    res.status(503).json({ error: "Receipt discard is temporarily unavailable", retryRequired: true });
    return;
  }
  if (!result) {
    res.status(404).json({ error: "Pending receipt review not found" });
    return;
  }
  const cleanupPending = result.cleanupPath
    ? !(await processDeletionJob(id, result.cleanupPath))
    : false;
  res.status(cleanupPending ? 202 : 200).json({ cleanupPending });
});

router.get("/nominees", async (req, res): Promise<void> => {
  const id = userId(req, res);
  if (!id) return;
  const rows = await db.select().from(nomineesTable).where(eq(nomineesTable.userId, id))
    .orderBy(desc(nomineesTable.createdAt));
  const totals = new Map<string, number>();
  rows.forEach((row) => {
    const key = `${row.coverageType}:${row.coverageLabel}:${row.institution ?? ""}`;
    totals.set(key, (totals.get(key) ?? 0) + row.allocationPercent);
  });
  res.json({ nominees: rows.map((row) => {
    const key = `${row.coverageType}:${row.coverageLabel}:${row.institution ?? ""}`;
    return nomineeJson(row, (totals.get(key) ?? 0) === 100 ? "complete" : "incomplete");
  }) });
});

async function saveNominee(req: Request, res: Response, existingId?: string): Promise<void> {
  const id = userId(req, res);
  if (!id) return;
  const name = text(req.body?.name, 120);
  const relationship = text(req.body?.relationship, 64);
  const allocationPercent = Number(req.body?.allocationPercent);
  const coverageType = text(req.body?.coverageType, 32) || "other";
  const coverageLabel = text(req.body?.coverageLabel, 160) || "General";
  const institution = text(req.body?.institution, 160) || null;
  const status = text(req.body?.status, 24) || "active";
  const reviewStatus = text(req.body?.reviewStatus, 24) || "not_reviewed";
  const reminderOn = req.body?.reminderOn == null ? null : req.body.reminderOn;
  const dateOfBirth = req.body?.dateOfBirth == null ? null : req.body.dateOfBirth;
  const contact = text(req.body?.contact, 160) || null;
  const notes = text(req.body?.notes, 1000) || null;
  if (!name || !relationship || !["life", "health", "investment", "other"].includes(coverageType)
    || !["active", "needs_review", "inactive"].includes(status)
    || !["not_reviewed", "reviewed", "needs_update"].includes(reviewStatus)
    || !Number.isInteger(allocationPercent) || allocationPercent < 0 || allocationPercent > 100
    || (dateOfBirth !== null && !validDate(dateOfBirth))
    || (reminderOn !== null && !validDate(reminderOn))) {
    res.status(400).json({ error: "Invalid nominee details" });
    return;
  }
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`nominees:${id}`}))`);
    const rows = await tx.select().from(nomineesTable).where(eq(nomineesTable.userId, id));
    if (existingId && !rows.some((row) => row.id === existingId)) return { status: "missing" as const };
    const target = `${coverageType}:${coverageLabel}:${institution ?? ""}`;
    const total = rows.filter((row) => row.id !== existingId
      && `${row.coverageType}:${row.coverageLabel}:${row.institution ?? ""}` === target)
      .reduce((sum, row) => sum + row.allocationPercent, 0);
    if (total + allocationPercent > 100) return { status: "allocation" as const };
    const values = {
      userId: id, name, relationship, allocationPercent, coverageType, coverageLabel, institution,
      status, reviewStatus, reminderOn, dateOfBirth, contact, notes,
    };
    const [row] = existingId
      ? await tx.update(nomineesTable).set({ ...values, updatedAt: new Date() })
          .where(and(eq(nomineesTable.id, existingId), eq(nomineesTable.userId, id))).returning()
      : await tx.insert(nomineesTable).values(values).returning();
    return { status: "saved" as const, row };
  });
  if (outcome.status === "missing") res.status(404).json({ error: "Nominee not found" });
  else if (outcome.status === "allocation") res.status(409).json({ error: "Allocations for this coverage cannot exceed 100%" });
  else res.status(existingId ? 200 : 201).json({ nominee: nomineeJson(outcome.row) });
}
router.post("/nominees", (req, res) => saveNominee(req, res));
router.put("/nominees/:id", (req, res) => saveNominee(req, res, req.params.id));
router.delete("/nominees/:id", async (req, res): Promise<void> => {
  const id = userId(req, res);
  if (!id) return;
  const [row] = await db.delete(nomineesTable)
    .where(and(eq(nomineesTable.id, req.params.id), eq(nomineesTable.userId, id))).returning();
  if (!row) res.status(404).json({ error: "Nominee not found" });
  else res.status(204).end();
});

export default router;