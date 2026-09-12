import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  db,
  expensesTable,
  mobileOtpDeliveryAttemptsTable,
  mobileOtpChallengesTable,
  premiumEntitlementsTable,
  receiptReviewsTable,
  usersTable,
  vaultDeletionJobsTable,
  vaultDocumentsTable,
  vaultUploadGrantsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import express, { type Request } from "express";
import {
  createMobileOtp,
  hashMobileOtp,
  hashMobileRequester,
  MOBILE_OTP_MAX_ATTEMPTS,
  MOBILE_OTP_TTL_MS,
  MobileDeliveryError,
  setVerificationSmsSenderForTests,
} from "./mobile-otp.js";
import {
  assertVaultObject,
  fenceVaultObjectPath,
  isVaultObjectPath,
  promoteVaultObject,
  setVaultObjectAssertionForTests,
  setPromotedVaultObjectAssertionForTests,
  setVaultObjectDeletionForTests,
  setVaultObjectFenceForTests,
  setVaultFileForTests,
  setVaultObjectPromotionForTests,
} from "./object-storage.js";
import { extractReceiptCandidates, normalizeReceiptCandidates } from "./receipt-ocr.js";
import premiumToolsRouter, {
  runVaultDeletionMaintenance,
  setStorageCommitHookForTests,
} from "../routes/premium-tools.js";
import financeRouter from "../routes/finance.js";

process.env.SESSION_SECRET ??= "test-only-session-secret-that-is-at-least-32-characters";
setVaultObjectPromotionForTests(async () => undefined);
setPromotedVaultObjectAssertionForTests(async () => ({} as never));

async function premiumServer(userId: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as Request["isAuthenticated"];
    req.user = { id: userId, email: `${userId}@example.test`, isAdmin: false } as Express.User;
    req.log = { warn: () => undefined } as unknown as Request["log"];
    next();
  });
  app.use("/api", premiumToolsRouter);
  app.use("/api", financeRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return { server, port: (server.address() as AddressInfo).port };
}

test("direct upload issuance signs the exact persisted grant expiry", async () => {
  const userId = `upload-expiry-${process.pid}-${Date.now()}`;
  await db.insert(usersTable).values({ id: userId, email: `${userId}@example.test` });
  await db.insert(premiumEntitlementsTable).values({ userId, active: true, plan: "premium" });
  const { server, port } = await premiumServer(userId);
  const originalFetch = globalThis.fetch;
  let signedExpiry: string | undefined;
  globalThis.fetch = (async (input, init) => {
    if (String(input).includes(":1106/object-storage/signed-object-url")) {
      signedExpiry = String((JSON.parse(String(init?.body)) as Record<string, unknown>).expires_at);
      return new Response(JSON.stringify({
        signed_url: "https://storage.googleapis.com/private-bucket/signed?signature=test",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/vault/uploads/request-url`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "receipt.png", contentType: "image/png", size: 10,
        purpose: "receipt_review",
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { objectPath: string };
    const [grant] = await db.select().from(vaultUploadGrantsTable)
      .where(eq(vaultUploadGrantsTable.objectPath, body.objectPath));
    assert.equal(signedExpiry, grant.expiresAt.toISOString());
  } finally {
    globalThis.fetch = originalFetch;
    server.close();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("cleanup routes remain available without a premium entitlement", async () => {
  const userId = `cleanup-free-${process.pid}-${Date.now()}`;
  await db.insert(usersTable).values({ id: userId, email: `${userId}@example.test` });
  const { server, port } = await premiumServer(userId);
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/vault/cleanup-status`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/vault/cleanup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objectPath: `/objects/vault/${crypto.randomUUID()}` }),
    })).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/vault/documents`)).status, 403);
  } finally {
    server.close();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("promotion cleanup waits for its lease and settle grace", async () => {
  const userId = `promotion-settle-${process.pid}-${Date.now()}`;
  const objectPath = `/objects/vault-documents/${crypto.randomUUID()}`;
  await db.insert(usersTable).values({ id: userId, email: `${userId}@example.test` });
  const [job] = await db.insert(vaultDeletionJobsTable).values({
    userId, objectPath, reason: "promotion_rollback",
    finalizeAfter: new Date(Date.now() + 60_000),
  }).returning();
  const fenced: string[] = [];
  setVaultObjectFenceForTests(async (path) => { fenced.push(path); });
  try {
    await runVaultDeletionMaintenance();
    assert.deepEqual(fenced, []);
    await db.update(vaultDeletionJobsTable).set({ finalizeAfter: new Date(Date.now() - 1_000) })
      .where(eq(vaultDeletionJobsTable.id, job.id));
    await runVaultDeletionMaintenance();
    const [claimed] = await db.select().from(vaultDeletionJobsTable)
      .where(eq(vaultDeletionJobsTable.id, job.id));
    assert.equal(claimed.reason, "promotion_cleanup_settle");
    assert.deepEqual(fenced, []);
    await db.update(vaultDeletionJobsTable).set({ finalizeAfter: new Date(Date.now() - 1_000) })
      .where(eq(vaultDeletionJobsTable.id, job.id));
    await runVaultDeletionMaintenance();
    assert.deepEqual(fenced, [objectPath]);
    assert.equal((await db.select().from(vaultDeletionJobsTable)
      .where(eq(vaultDeletionJobsTable.id, job.id))).length, 0);
  } finally {
    setVaultObjectFenceForTests();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("global maintenance discovers expired grants and pending reviews", async () => {
  const userId = `global-discovery-${process.pid}-${Date.now()}`;
  const expiredGrantPath = `/objects/vault-staging/${crypto.randomUUID()}`;
  const freshGrantPath = `/objects/vault-staging/${crypto.randomUUID()}`;
  const reviewPath = `/objects/vault-documents/${crypto.randomUUID()}`;
  await db.insert(usersTable).values({ id: userId, email: `${userId}@example.test` });
  const [expiredGrant, freshGrant] = await db.insert(vaultUploadGrantsTable).values([
    { userId, objectPath: expiredGrantPath, name: "old.png", contentType: "image/png", size: 1,
      expiresAt: new Date(Date.now() - 10 * 60_000) },
    { userId, objectPath: freshGrantPath, name: "new.png", contentType: "image/png", size: 1,
      expiresAt: new Date(Date.now() + 60_000) },
  ]).returning();
  const [document] = await db.insert(vaultDocumentsTable).values({
    userId, objectPath: reviewPath, name: "receipt.png", contentType: "image/png", size: 1,
  }).returning();
  const [expiredReview, freshReview] = await db.insert(receiptReviewsTable).values([
    { userId, documentId: document.id, candidates: [], expiresAt: new Date(Date.now() - 1_000) },
    { userId, candidates: [], expiresAt: new Date(Date.now() + 60_000) },
  ]).returning();
  const deleted: string[] = [];
  setVaultObjectDeletionForTests(async (path) => { deleted.push(path); });
  try {
    await runVaultDeletionMaintenance(10);
    assert.equal((await db.select().from(vaultUploadGrantsTable)
      .where(eq(vaultUploadGrantsTable.id, expiredGrant.id))).length, 0);
    assert.equal((await db.select().from(vaultUploadGrantsTable)
      .where(eq(vaultUploadGrantsTable.id, freshGrant.id))).length, 1);
    assert.equal((await db.select().from(receiptReviewsTable)
      .where(eq(receiptReviewsTable.id, expiredReview.id))).length, 0);
    assert.equal((await db.select().from(receiptReviewsTable)
      .where(eq(receiptReviewsTable.id, freshReview.id))).length, 1);
    assert.ok(deleted.includes(expiredGrantPath));
    assert.ok(deleted.includes(reviewPath));
  } finally {
    setVaultObjectDeletionForTests();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("legacy review ranking preserves fresh and confirmed-retained document owners", async () => {
  const ranked = await db.execute(sql`
    with candidates(id, document_id, status, retain_original, expires_at, confirmed_at, created_at) as (
      values
        ('expired', 'pending-document', 'pending', false, now() - interval '1 minute', null, now() - interval '2 minutes'),
        ('fresh', 'pending-document', 'pending', false, now() + interval '30 minutes', null, now() - interval '1 minute'),
        ('fresh-again', 'retained-document', 'pending', false, now() + interval '60 minutes', null, now()),
        ('retained', 'retained-document', 'confirmed', true, now() - interval '1 day', now(), now() - interval '1 day')
    ),
    ordered as (
      select id, document_id, row_number() over (
        partition by document_id
        order by
          case
            when status = 'confirmed' and retain_original then 0
            when status = 'pending' and expires_at > now() then 1
            else 2
          end,
          confirmed_at desc nulls last,
          expires_at desc,
          created_at desc,
          id desc
      ) as position
      from candidates
    )
    select id from ordered where position = 1 order by document_id
  `);
  assert.deepEqual(
    (ranked.rows as Array<{ id: string }>).map(({ id }) => id).sort(),
    ["fresh", "retained"],
  );

  const userId = `legacy-ranking-${process.pid}-${Date.now()}`;
  const objectPath = `/objects/vault-documents/${crypto.randomUUID()}`;
  await db.insert(usersTable).values({ id: userId, email: `${userId}@example.test` });
  const [document] = await db.insert(vaultDocumentsTable).values({
    userId, objectPath, name: "receipt.png", contentType: "image/png", size: 1,
  }).returning();
  const [fresh] = await db.insert(receiptReviewsTable).values({
    userId, documentId: document.id, candidates: [], expiresAt: new Date(Date.now() + 60_000),
  }).returning();
  const [expiredHistory] = await db.insert(receiptReviewsTable).values({
    userId, documentId: null, candidates: [], expiresAt: new Date(Date.now() - 60_000),
  }).returning();
  try {
    await runVaultDeletionMaintenance(10);
    assert.equal((await db.select().from(receiptReviewsTable)
      .where(eq(receiptReviewsTable.id, expiredHistory.id))).length, 0);
    assert.equal((await db.select().from(receiptReviewsTable)
      .where(eq(receiptReviewsTable.id, fresh.id)))[0]?.documentId, document.id);
    assert.equal((await db.select().from(vaultDocumentsTable)
      .where(eq(vaultDocumentsTable.id, document.id))).length, 1);
    assert.equal((await db.select().from(vaultDeletionJobsTable)
      .where(eq(vaultDeletionJobsTable.objectPath, objectPath))).length, 0);
  } finally {
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("concurrent receipt review creation owns a document only once", async () => {
  const userId = `review-owner-${process.pid}-${Date.now()}`;
  await db.insert(usersTable).values({ id: userId, email: `${userId}@example.test` });
  await db.insert(premiumEntitlementsTable).values({ userId, active: true, plan: "premium" });
  const [document] = await db.insert(vaultDocumentsTable).values({
    userId, objectPath: `/objects/vault-documents/${crypto.randomUUID()}`,
    name: "receipt.png", contentType: "image/png", size: 1,
  }).returning();
  const { server, port } = await premiumServer(userId);
  const request = () => fetch(`http://127.0.0.1:${port}/api/receipts/reviews`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      documentId: document.id,
      candidates: [{ merchant: "Store", amount: 1, date: "2026-01-01", category: "Other" }],
    }),
  });
  try {
    const responses = await Promise.all([request(), request()]);
    assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 201]);
    const bodies = await Promise.all(responses.map((response) => response.json())) as Array<{
      review: { id: string };
    }>;
    assert.equal(bodies[0].review.id, bodies[1].review.id);
    assert.equal((await db.select().from(receiptReviewsTable)
      .where(eq(receiptReviewsTable.documentId, document.id))).length, 1);
  } finally {
    server.close();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("a settled tombstone permanently fences a delayed promotion", async () => {
  const userId = `promotion-race-${process.pid}-${Date.now()}`;
  const sourcePath = `/objects/vault-staging/${crypto.randomUUID()}`;
  await db.insert(usersTable).values({ id: userId, email: `${userId}@example.test` });
  await db.insert(premiumEntitlementsTable).values({ userId, active: true, plan: "premium" });
  await db.insert(vaultUploadGrantsTable).values({
    userId, objectPath: sourcePath, name: "race.png", contentType: "image/png",
    size: 20, expiresAt: new Date(Date.now() + 60_000),
  });
  setVaultObjectAssertionForTests(async () => ({ setMetadata: async () => undefined } as never));
  let releaseCopy!: () => void;
  const copyBarrier = new Promise<void>((resolve) => { releaseCopy = resolve; });
  let destinationPath = "";
  let copyStarted!: () => void;
  const started = new Promise<void>((resolve) => { copyStarted = resolve; });
  const storage = new Map<string, "private" | "tombstone">();
  setVaultObjectPromotionForTests(async (_source, destination) => {
    destinationPath = destination;
    copyStarted();
    await copyBarrier;
    if (storage.has(destination)) throw new Error("ifGenerationMatch precondition failed");
    storage.set(destination, "private");
  });
  setVaultObjectFenceForTests(async (path) => { storage.set(path, "tombstone"); });
  const { server, port } = await premiumServer(userId);
  try {
    const confirmation = fetch(`http://127.0.0.1:${port}/api/vault/documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        objectPath: sourcePath, name: "race.png", contentType: "image/png", size: 20,
      }),
    });
    await started;
    await db.update(vaultDeletionJobsTable).set({ finalizeAfter: new Date(Date.now() - 1_000) })
      .where(eq(vaultDeletionJobsTable.objectPath, destinationPath));
    await runVaultDeletionMaintenance();
    await db.update(vaultDeletionJobsTable).set({ finalizeAfter: new Date(Date.now() - 1_000) })
      .where(eq(vaultDeletionJobsTable.objectPath, destinationPath));
    await runVaultDeletionMaintenance();
    assert.equal(storage.get(destinationPath), "tombstone");
    assert.equal((await db.select().from(vaultDeletionJobsTable)
      .where(eq(vaultDeletionJobsTable.objectPath, destinationPath))).length, 0);
    releaseCopy();
    assert.equal((await confirmation).status, 400);
    assert.equal(storage.get(destinationPath), "tombstone");
    assert.equal((await db.select().from(vaultDocumentsTable)
      .where(eq(vaultDocumentsTable.objectPath, destinationPath))).length, 0);
  } finally {
    releaseCopy();
    server.close();
    setVaultObjectAssertionForTests();
    setVaultObjectPromotionForTests(async () => undefined);
    setVaultObjectFenceForTests();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("mobile OTP retry invalidates but retains a challenge for a replaced phone", async () => {
  const userId = `mobile-retry-${process.pid}-${Date.now()}`;
  const oldChallengeId = crypto.randomUUID();
  await db.insert(usersTable).values({ id: userId, email: `${userId}@example.test`, phone: "+15550000001" });
  await db.insert(mobileOtpChallengesTable).values({
    id: oldChallengeId,
    userId,
    phone: "+15550000000",
    requesterHash: hashMobileRequester("old"),
    codeHash: hashMobileOtp(oldChallengeId, createMobileOtp(oldChallengeId)),
    deliveryChannel: "sms",
    expiresAt: new Date(Date.now() + 60_000),
    resendAvailableAt: new Date(Date.now() - 1_000),
  });
  const sent: string[] = [];
  setVerificationSmsSenderForTests(async (phone) => { sent.push(phone); });
  const { server, port } = await premiumServer(userId);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/mobile-otp/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(sent, ["+15550000001"]);
    const oldRows = await db.select().from(mobileOtpChallengesTable)
      .where(eq(mobileOtpChallengesTable.id, oldChallengeId));
    assert.ok(oldRows[0]?.consumedAt);
    const [current] = await db.select().from(mobileOtpChallengesTable)
      .where(and(
        eq(mobileOtpChallengesTable.userId, userId),
        eq(mobileOtpChallengesTable.phone, "+15550000001"),
      ));
    assert.equal(current?.phone, "+15550000001");
  } finally {
    server.close();
    setVerificationSmsSenderForTests();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("concurrent phone replacement cannot verify the replacement with an old code", async () => {
  const userId = `mobile-race-${process.pid}-${Date.now()}`;
  const challengeId = crypto.randomUUID();
  const code = createMobileOtp(challengeId);
  await db.insert(usersTable).values({ id: userId, email: `${userId}@example.test`, phone: "+15550000002" });
  await db.insert(mobileOtpChallengesTable).values({
    id: challengeId,
    userId,
    phone: "+15550000002",
    requesterHash: hashMobileRequester("race"),
    codeHash: hashMobileOtp(challengeId, code),
    deliveryChannel: "sms",
    deliveredAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    resendAvailableAt: new Date(),
  });
  const { server, port } = await premiumServer(userId);
  try {
    let verification!: Promise<Response>;
    await db.transaction(async (tx) => {
      await tx.select({ id: usersTable.id }).from(usersTable)
        .where(eq(usersTable.id, userId)).for("update");
      verification = fetch(`http://127.0.0.1:${port}/api/auth/mobile-otp/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId, code }),
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      await tx.update(usersTable).set({ phone: "+15550000003", phoneVerifiedAt: null })
        .where(eq(usersTable.id, userId));
    });
    const response = await verification;
    assert.equal(response.status, 401);
    const [account] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    assert.equal(account?.phone, "+15550000003");
    assert.equal(account?.phoneVerifiedAt, null);
    const [challenge] = await db.select().from(mobileOtpChallengesTable)
      .where(eq(mobileOtpChallengesTable.id, challengeId));
    assert.equal(challenge?.consumedAt, null);
  } finally {
    server.close();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("mobile OTP phone alternation retains quota evidence and invalidates old codes", async () => {
  const userId = `mobile-quota-${process.pid}-${Date.now()}`;
  const phoneA = "+15550000101";
  const phoneB = "+15550000102";
  await db.insert(usersTable).values({ id: userId, email: `${userId}@example.test`, phone: phoneA });
  const sent: string[] = [];
  setVerificationSmsSenderForTests(async (phone) => { sent.push(phone); });
  const { server, port } = await premiumServer(userId);
  let firstChallengeId = "";
  try {
    for (let index = 0; index <= 10; index += 1) {
      const phone = index % 2 === 0 ? phoneA : phoneB;
      await db.update(usersTable).set({ phone, phoneVerifiedAt: null }).where(eq(usersTable.id, userId));
      const response = await fetch(`http://127.0.0.1:${port}/api/auth/mobile-otp/request`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      if (index < 10) {
        assert.equal(response.status, 200);
        const payload = await response.json() as { challengeId: string };
        if (index === 0) firstChallengeId = payload.challengeId;
        await db.update(mobileOtpChallengesTable)
          .set({ resendAvailableAt: new Date(Date.now() - 1_000) })
          .where(eq(mobileOtpChallengesTable.userId, userId));
      } else {
        assert.equal(response.status, 429);
      }
    }
    assert.equal(sent.length, 10);
    const rows = await db.select().from(mobileOtpChallengesTable)
      .where(eq(mobileOtpChallengesTable.userId, userId));
    assert.equal(rows.length, 10);
    assert.equal(rows.filter((row) => row.consumedAt).length, 9);
    const oldCode = createMobileOtp(firstChallengeId);
    const verification = await fetch(`http://127.0.0.1:${port}/api/auth/mobile-otp/verify`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId: firstChallengeId, code: oldCode }),
    });
    assert.equal(verification.status, 401);
  } finally {
    server.close();
    setVerificationSmsSenderForTests();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("indeterminate mobile delivery retries retain per-send evidence and stop at ten calls", async () => {
  const userId = `mobile-delivery-quota-${process.pid}-${Date.now()}`;
  const phone = "+15550000103";
  await db.insert(usersTable).values({ id: userId, email: `${userId}@example.test`, phone });
  const codes: string[] = [];
  setVerificationSmsSenderForTests(async (_phone, code) => {
    codes.push(code);
    throw new MobileDeliveryError(true);
  });
  const { server, port } = await premiumServer(userId);
  let challengeId = "";
  try {
    for (let index = 0; index <= 10; index += 1) {
      const response = await fetch(`http://127.0.0.1:${port}/api/auth/mobile-otp/request`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      if (index < 10) {
        assert.equal(response.status, 503);
        const [challenge] = await db.select().from(mobileOtpChallengesTable)
          .where(eq(mobileOtpChallengesTable.userId, userId));
        challengeId ||= challenge.id;
        assert.equal(challenge.id, challengeId);
        await db.update(mobileOtpChallengesTable)
          .set({ resendAvailableAt: new Date(Date.now() - 1_000) })
          .where(eq(mobileOtpChallengesTable.id, challengeId));
      } else {
        assert.equal(response.status, 429);
      }
    }
    assert.equal(codes.length, 10);
    assert.equal(new Set(codes).size, 1);
    const attempts = await db.select().from(mobileOtpDeliveryAttemptsTable)
      .where(eq(mobileOtpDeliveryAttemptsTable.userId, userId));
    assert.equal(attempts.length, 10);
    assert.ok(attempts.every((attempt) => attempt.challengeId === challengeId));

    await db.update(usersTable).set({ phone: "+15550000104" }).where(eq(usersTable.id, userId));
    const verification = await fetch(`http://127.0.0.1:${port}/api/auth/mobile-otp/verify`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId, code: codes[0] }),
    });
    assert.equal(verification.status, 401);
  } finally {
    server.close();
    setVerificationSmsSenderForTests();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("storage cleanup retains scoped evidence after deletion failure and retries safely", async () => {
  const userId = `storage-cleanup-${process.pid}-${Date.now()}`;
  const otherId = `${userId}-other`;
  await db.insert(usersTable).values([
    { id: userId, email: `${userId}@example.test` },
    { id: otherId, email: `${otherId}@example.test` },
  ]);
  await db.insert(premiumEntitlementsTable).values({ userId, plan: "premium", active: true });
  const receiptPath = `/objects/vault/${crypto.randomUUID()}`;
  const grantPath = `/objects/vault/${crypto.randomUUID()}`;
  const otherPath = `/objects/vault/${crypto.randomUUID()}`;
  const [document] = await db.insert(vaultDocumentsTable).values({
    userId, objectPath: receiptPath, name: "receipt.png", contentType: "image/png", size: 20,
  }).returning();
  const [review] = await db.insert(receiptReviewsTable).values({
    userId, documentId: document.id, candidates: [], expiresAt: new Date(Date.now() - 60_000),
  }).returning();
  const [grant] = await db.insert(vaultUploadGrantsTable).values({
    userId, objectPath: grantPath, name: "abandoned.png", contentType: "image/png", size: 20,
    expiresAt: new Date(Date.now() - 6 * 60_000),
  }).returning();
  const [otherGrant] = await db.insert(vaultUploadGrantsTable).values({
    userId: otherId, objectPath: otherPath, name: "other.png", contentType: "image/png", size: 20,
    expiresAt: new Date(Date.now() - 60_000),
  }).returning();
  setVaultObjectDeletionForTests(async () => { throw new Error("storage unavailable"); });
  const { server, port } = await premiumServer(userId);
  try {
    const failed = await fetch(`http://127.0.0.1:${port}/api/vault/cleanup`, { method: "POST" });
    assert.equal(failed.status, 503);
    assert.equal((await db.select().from(receiptReviewsTable).where(eq(receiptReviewsTable.id, review.id))).length, 0);
    assert.equal((await db.select().from(vaultDocumentsTable).where(eq(vaultDocumentsTable.id, document.id))).length, 0);
    assert.equal((await db.select().from(vaultUploadGrantsTable).where(eq(vaultUploadGrantsTable.id, grant.id))).length, 0);
    assert.equal((await db.select().from(vaultDeletionJobsTable)
      .where(eq(vaultDeletionJobsTable.userId, userId))).length, 2);

    const deleted: string[] = [];
    setVaultObjectDeletionForTests(async (path) => { deleted.push(path); });
    const retried = await fetch(`http://127.0.0.1:${port}/api/vault/cleanup`, { method: "POST" });
    assert.equal(retried.status, 200);
    assert.deepEqual(new Set(deleted), new Set([receiptPath, grantPath]));
    assert.equal((await db.select().from(receiptReviewsTable).where(eq(receiptReviewsTable.id, review.id))).length, 0);
    assert.equal((await db.select().from(vaultDocumentsTable).where(eq(vaultDocumentsTable.id, document.id))).length, 0);
    assert.equal((await db.select().from(vaultUploadGrantsTable).where(eq(vaultUploadGrantsTable.id, grant.id))).length, 0);
    assert.equal((await db.select().from(vaultDeletionJobsTable)
      .where(eq(vaultDeletionJobsTable.userId, userId))).length, 0);
    assert.equal((await db.select().from(vaultUploadGrantsTable).where(and(
      eq(vaultUploadGrantsTable.id, otherGrant.id),
      eq(vaultUploadGrantsTable.userId, otherId),
    ))).length, 1);
  } finally {
    server.close();
    setVaultObjectDeletionForTests();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await db.delete(usersTable).where(eq(usersTable.id, otherId));
  }
});

test("immediate upload cleanup is owner-scoped, refuses owned documents, and retains retry evidence", async () => {
  const userId = `immediate-cleanup-${process.pid}-${Date.now()}`;
  const otherId = `${userId}-other`;
  await db.insert(usersTable).values([
    { id: userId, email: `${userId}@example.test` },
    { id: otherId, email: `${otherId}@example.test` },
  ]);
  await db.insert(premiumEntitlementsTable).values({ userId, plan: "premium", active: true });
  const ownPath = `/objects/vault/${crypto.randomUUID()}`;
  const retryPath = `/objects/vault/${crypto.randomUUID()}`;
  const otherPath = `/objects/vault/${crypto.randomUUID()}`;
  const ownedPath = `/objects/vault/${crypto.randomUUID()}`;
  const grants = await db.insert(vaultUploadGrantsTable).values([
    { userId, objectPath: ownPath, name: "own.png", contentType: "image/png", size: 20, expiresAt: new Date(Date.now() - 6 * 60_000) },
    { userId, objectPath: retryPath, name: "retry.png", contentType: "image/png", size: 20, expiresAt: new Date(Date.now() - 6 * 60_000) },
    { userId: otherId, objectPath: otherPath, name: "other.png", contentType: "image/png", size: 20, expiresAt: new Date(Date.now() + 60_000) },
    { userId, objectPath: ownedPath, name: "owned.png", contentType: "image/png", size: 20, expiresAt: new Date(Date.now() + 60_000) },
  ]).returning();
  await db.insert(vaultDocumentsTable).values({
    userId, objectPath: ownedPath, name: "owned.png", contentType: "image/png", size: 20,
  });
  const deleted: string[] = [];
  setVaultObjectDeletionForTests(async (path) => {
    if (path === retryPath) throw new Error("storage unavailable");
    deleted.push(path);
  });
  const { server, port } = await premiumServer(userId);
  const cleanup = (objectPath: string) => fetch(`http://127.0.0.1:${port}/api/vault/cleanup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ objectPath }),
  });
  try {
    assert.equal((await cleanup(ownPath)).status, 200);
    assert.deepEqual(deleted, [ownPath]);
    assert.equal((await db.select().from(vaultUploadGrantsTable)
      .where(eq(vaultUploadGrantsTable.id, grants[0].id))).length, 1);

    assert.equal((await cleanup(otherPath)).status, 404);
    assert.equal((await db.select().from(vaultUploadGrantsTable)
      .where(eq(vaultUploadGrantsTable.id, grants[2].id))).length, 1);
    assert.equal(deleted.includes(otherPath), false);

    assert.equal((await cleanup(ownedPath)).status, 409);
    assert.equal((await db.select().from(vaultUploadGrantsTable)
      .where(eq(vaultUploadGrantsTable.id, grants[3].id))).length, 1);
    assert.equal(deleted.includes(ownedPath), false);

    const failed = await cleanup(retryPath);
    assert.equal(failed.status, 503);
    assert.equal((await failed.json() as { retryRequired: boolean }).retryRequired, true);
    assert.equal((await db.select().from(vaultUploadGrantsTable)
      .where(eq(vaultUploadGrantsTable.id, grants[1].id))).length, 1);
    assert.equal((await db.select().from(vaultDeletionJobsTable)
      .where(eq(vaultDeletionJobsTable.objectPath, retryPath))).length, 1);

    setVaultObjectDeletionForTests(async (path) => { deleted.push(path); });
    assert.equal((await cleanup(retryPath)).status, 200);
    assert.equal((await db.select().from(vaultUploadGrantsTable)
      .where(eq(vaultUploadGrantsTable.id, grants[1].id))).length, 1);
    assert.equal(deleted.includes(retryPath), true);
  } finally {
    server.close();
    setVaultObjectDeletionForTests();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await db.delete(usersTable).where(eq(usersTable.id, otherId));
  }
});

test("financial restore rejects cross-account expense ID collisions atomically", async () => {
  const accountA = `restore-collision-a-${process.pid}-${Date.now()}`;
  const accountB = `${accountA}-b`;
  const receiptExpenseId = crypto.randomUUID();
  const unrelatedExpenseId = crypto.randomUUID();
  const partialExpenseId = crypto.randomUUID();
  const originalVerifiedAt = new Date(Date.now() - 60_000);
  await db.insert(usersTable).values([
    {
      id: accountA,
      email: `${accountA}@example.test`,
      fullName: "Original Account",
      dateOfBirth: "1990-01-02",
      phone: "+919876543210",
      phoneVerifiedAt: originalVerifiedAt,
      gender: "Female",
      onboardingCompleted: false,
    },
    { id: accountB, email: `${accountB}@example.test` },
  ]);
  const [activeChallenge] = await db.insert(mobileOtpChallengesTable).values({
    userId: accountA,
    phone: "+919876543210",
    requesterHash: crypto.randomBytes(32).toString("hex"),
    codeHash: crypto.randomBytes(32).toString("hex"),
    deliveryChannel: "sms",
    expiresAt: new Date(Date.now() + 60_000),
    resendAvailableAt: new Date(),
  }).returning();
  await db.insert(expensesTable).values([
    { id: receiptExpenseId, userId: accountB, merchant: "B receipt collision" },
    { id: unrelatedExpenseId, userId: accountB, merchant: "B plain collision" },
  ]);
  const [review] = await db.insert(receiptReviewsTable).values({
    userId: accountA,
    documentId: null,
    candidates: [],
    status: "confirmed",
    confirmedExpenseDeletedId: receiptExpenseId,
    confirmedExpenseDeletedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  }).returning();
  const { server, port } = await premiumServer(accountA);
  const restore = (ids: string[]) => fetch(`http://127.0.0.1:${port}/api/financial-data/restore`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      profileInputs: {
        fullName: "Restored Account",
        dateOfBirth: "1991-02-03",
        phone: "+919123456789",
        gender: "Male",
        onboardingCompleted: true,
      },
      expenses: ids.map((id) => ({
        id, date: "2026-09-10", amount: 12.5, category: "Shopping", merchant: "Backup",
      })),
    }),
  });
  try {
    assert.equal((await restore([receiptExpenseId, partialExpenseId])).status, 409);
    assert.equal((await db.select().from(expensesTable)
      .where(and(eq(expensesTable.userId, accountA), eq(expensesTable.id, partialExpenseId)))).length, 0);
    const [storedReview] = await db.select().from(receiptReviewsTable)
      .where(eq(receiptReviewsTable.id, review.id));
    assert.equal(storedReview.confirmedExpenseId, null);
    assert.equal(storedReview.confirmedExpenseDeletedId, receiptExpenseId);
    const [unchangedAccount] = await db.select().from(usersTable).where(eq(usersTable.id, accountA));
    assert.equal(unchangedAccount.fullName, "Original Account");
    assert.equal(unchangedAccount.dateOfBirth, "1990-01-02");
    assert.equal(unchangedAccount.phone, "+919876543210");
    assert.equal(unchangedAccount.phoneVerifiedAt?.getTime(), originalVerifiedAt.getTime());
    assert.equal(unchangedAccount.gender, "Female");
    assert.equal(unchangedAccount.onboardingCompleted, false);
    const [unchangedChallenge] = await db.select().from(mobileOtpChallengesTable)
      .where(eq(mobileOtpChallengesTable.id, activeChallenge.id));
    assert.equal(unchangedChallenge.consumedAt, null);

    assert.equal((await restore([unrelatedExpenseId])).status, 409);
    assert.equal((await db.select().from(expensesTable)
      .where(eq(expensesTable.userId, accountA))).length, 0);
    const removedFromB = await db.delete(expensesTable).where(and(
      eq(expensesTable.id, receiptExpenseId),
      eq(expensesTable.userId, accountB),
    )).returning({ id: expensesTable.id });
    assert.equal(removedFromB.length, 1);
    assert.equal((await restore([partialExpenseId])).status, 200);
    const [restoredAccount] = await db.select().from(usersTable).where(eq(usersTable.id, accountA));
    assert.equal(restoredAccount.fullName, "Restored Account");
    assert.equal(restoredAccount.dateOfBirth, "1991-02-03");
    assert.equal(restoredAccount.phone, "+919123456789");
    assert.equal(restoredAccount.phoneVerifiedAt, null);
    assert.equal(restoredAccount.gender, "Male");
    assert.equal(restoredAccount.onboardingCompleted, true);
    const [consumedChallenge] = await db.select().from(mobileOtpChallengesTable)
      .where(eq(mobileOtpChallengesTable.id, activeChallenge.id));
    assert.ok(consumedChallenge.consumedAt);
    assert.equal((await db.select().from(expensesTable).where(and(
      eq(expensesTable.id, partialExpenseId),
      eq(expensesTable.userId, accountA),
    ))).length, 1);
  } finally {
    server.close();
    await db.delete(usersTable).where(eq(usersTable.id, accountA));
    await db.delete(usersTable).where(eq(usersTable.id, accountB));
  }
});

test("vault and receipt mutations retain DB evidence on storage failure and complete on retry", async () => {
  const userId = `storage-mutations-${process.pid}-${Date.now()}`;
  await db.insert(usersTable).values({ id: userId, email: `${userId}@example.test` });
  await db.insert(premiumEntitlementsTable).values({ userId, plan: "premium", active: true });
  const path = () => `/objects/vault/${crypto.randomUUID()}`;
  const stagingPath = () => `/objects/vault-staging/${crypto.randomUUID()}`;
  const deletePath = path();
  const oldPath = path();
  const oldRegistrationSourcePath = stagingPath();
  const replacementPath = stagingPath();
  const createPath = stagingPath();
  const confirmPath = path();
  const discardPath = path();
  const [deleteDocument, replacementDocument, confirmDocument, discardDocument] =
    await db.insert(vaultDocumentsTable).values([
      { userId, objectPath: deletePath, name: "delete.png", contentType: "image/png", size: 20 },
      { userId, objectPath: oldPath, name: "old.png", contentType: "image/png", size: 20 },
      { userId, objectPath: confirmPath, name: "confirm.png", contentType: "image/png", size: 20 },
      { userId, objectPath: discardPath, name: "discard.png", contentType: "image/png", size: 20 },
    ]).returning();
  const [replacementGrant, createGrant] = await db.insert(vaultUploadGrantsTable).values([
    { userId, objectPath: replacementPath, name: "new.png", contentType: "image/png", size: 20, expiresAt: new Date(Date.now() + 60_000) },
    { userId, objectPath: createPath, name: "create.png", contentType: "image/png", size: 20, expiresAt: new Date(Date.now() + 60_000) },
  ]).returning();
  const [oldReceiptRegistration] = await db.insert(vaultUploadGrantsTable).values({
    userId,
    objectPath: oldRegistrationSourcePath,
    name: "old.png",
    contentType: "image/png",
    size: 20,
    purpose: "receipt_review",
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: new Date(Date.now() - 31 * 60_000),
    promotedObjectPath: oldPath,
    documentId: replacementDocument.id,
    claimedAt: new Date(Date.now() - 31 * 60_000),
  }).returning();
  const [confirmReview, discardReview] = await db.insert(receiptReviewsTable).values([
    { userId, documentId: confirmDocument.id, candidates: [], expiresAt: new Date(Date.now() + 60_000) },
    { userId, documentId: discardDocument.id, candidates: [], expiresAt: new Date(Date.now() + 60_000) },
  ]).returning();
  setVaultObjectAssertionForTests(async () => ({ setMetadata: async () => undefined } as never));
  let failingPath: string | undefined;
  setVaultObjectDeletionForTests(async (objectPath) => {
    if (objectPath === failingPath) throw new Error("storage unavailable");
  });
  const { server, port } = await premiumServer(userId);
  const json = { "content-type": "application/json" };
  try {
    failingPath = deletePath;
    const pendingDelete = await fetch(`http://127.0.0.1:${port}/api/vault/documents/${deleteDocument.id}`, {
      method: "DELETE",
    });
    assert.equal(pendingDelete.status, 202);
    assert.equal((await pendingDelete.json() as { cleanupPending: boolean }).cleanupPending, true);
    assert.equal((await db.select().from(vaultDocumentsTable).where(eq(vaultDocumentsTable.id, deleteDocument.id))).length, 0);
    assert.equal((await db.select().from(vaultDeletionJobsTable)
      .where(eq(vaultDeletionJobsTable.objectPath, deletePath))).length, 1);
    failingPath = undefined;
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/vault/cleanup`, {
      method: "POST", headers: json, body: JSON.stringify({ objectPath: deletePath }),
    })).status, 200);

    setVaultObjectAssertionForTests(async () => { throw new Error("metadata unavailable"); });
    const createBody = { objectPath: createPath, name: "create.png", contentType: "image/png", size: 20 };
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/vault/documents`, {
      method: "POST", headers: json, body: JSON.stringify(createBody),
    })).status, 400);
    let [storedCreateGrant] = await db.select().from(vaultUploadGrantsTable)
      .where(eq(vaultUploadGrantsTable.id, createGrant.id));
    assert.equal(storedCreateGrant?.consumedAt, null);
    assert.equal((await db.select().from(vaultDocumentsTable)
      .where(eq(vaultDocumentsTable.objectPath, createPath))).length, 0);
    setVaultObjectAssertionForTests(async () => ({ setMetadata: async () => undefined } as never));
    setPromotedVaultObjectAssertionForTests(async () => {
      throw new Error("Promoted object metadata does not match");
    });
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/vault/documents`, {
      method: "POST", headers: json, body: JSON.stringify(createBody),
    })).status, 400);
    assert.equal((await db.select().from(vaultDocumentsTable)
      .where(eq(vaultDocumentsTable.objectPath, createPath))).length, 0);
    assert.ok((await db.select().from(vaultDeletionJobsTable)
      .where(eq(vaultDeletionJobsTable.userId, userId)))
      .some(({ reason }) => reason === "promotion_rollback"));
    setPromotedVaultObjectAssertionForTests(async () => ({} as never));
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/vault/documents`, {
      method: "POST", headers: json, body: JSON.stringify(createBody),
    })).status, 201);
    [storedCreateGrant] = await db.select().from(vaultUploadGrantsTable)
      .where(eq(vaultUploadGrantsTable.id, createGrant.id));
    assert.ok(storedCreateGrant?.consumedAt);
    assert.ok(storedCreateGrant?.promotedObjectPath);
    assert.ok(storedCreateGrant?.documentId);
    const [registeredCreate] = await db.select().from(vaultDocumentsTable)
      .where(and(eq(vaultDocumentsTable.userId, userId), eq(vaultDocumentsTable.name, "create.png")));
    assert.equal(registeredCreate.id, storedCreateGrant?.documentId);
    const registrationRetry = await fetch(`http://127.0.0.1:${port}/api/vault/documents`, {
      method: "POST", headers: json, body: JSON.stringify(createBody),
    });
    assert.equal(registrationRetry.status, 200);
    assert.equal((await registrationRetry.json() as { document: { id: string } }).document.id, registeredCreate.id);

    const replacementBody = { objectPath: replacementPath, name: "new.png", contentType: "image/png", size: 20 };
    failingPath = oldPath;
    const pendingReplacement = await fetch(`http://127.0.0.1:${port}/api/vault/documents/${replacementDocument.id}`, {
      method: "PUT", headers: json, body: JSON.stringify(replacementBody),
    });
    assert.equal(pendingReplacement.status, 200);
    assert.equal((await pendingReplacement.json() as { cleanupPending: boolean }).cleanupPending, true);
    let [storedReplacement] = await db.select().from(vaultDocumentsTable)
      .where(eq(vaultDocumentsTable.id, replacementDocument.id));
    let [storedReplacementGrant] = await db.select().from(vaultUploadGrantsTable)
      .where(eq(vaultUploadGrantsTable.id, replacementGrant.id));
    assert.match(storedReplacement?.objectPath ?? "", /^\/objects\/vault-documents\/[0-9a-f-]{36}$/i);
    assert.ok(storedReplacementGrant?.consumedAt);
    const [retiredOldReceiptRegistration] = await db.select().from(vaultUploadGrantsTable)
      .where(eq(vaultUploadGrantsTable.id, oldReceiptRegistration.id));
    assert.equal(retiredOldReceiptRegistration.documentId, null);
    assert.equal(retiredOldReceiptRegistration.promotedObjectPath, null);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/vault/cleanup`, {
      method: "POST", headers: json, body: JSON.stringify({ objectPath: oldRegistrationSourcePath }),
    })).status, 503);
    await runVaultDeletionMaintenance(100);
    const [replacementAfterOldCleanup] = await db.select().from(vaultDocumentsTable)
      .where(eq(vaultDocumentsTable.id, replacementDocument.id));
    assert.equal(replacementAfterOldCleanup.objectPath, storedReplacement?.objectPath);
    assert.equal((await db.select().from(vaultDeletionJobsTable)
      .where(eq(vaultDeletionJobsTable.objectPath, replacementAfterOldCleanup.objectPath))).length, 0);
    failingPath = undefined;
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/vault/cleanup`, {
      method: "POST", headers: json, body: JSON.stringify({ objectPath: oldPath }),
    })).status, 200);
    [storedReplacement] = await db.select().from(vaultDocumentsTable)
      .where(eq(vaultDocumentsTable.id, replacementDocument.id));
    [storedReplacementGrant] = await db.select().from(vaultUploadGrantsTable)
      .where(eq(vaultUploadGrantsTable.id, replacementGrant.id));
    assert.match(storedReplacement?.objectPath ?? "", /^\/objects\/vault-documents\/[0-9a-f-]{36}$/i);
    assert.ok(storedReplacementGrant?.consumedAt);

    const confirmBody = { values: {
      merchant: "Retry Store", amount: 12.5, date: "2026-09-10", category: "Shopping", retainOriginal: false,
    } };
    failingPath = confirmPath;
    const pendingConfirm = await fetch(`http://127.0.0.1:${port}/api/receipts/reviews/${confirmReview.id}/confirm`, {
      method: "POST", headers: json, body: JSON.stringify(confirmBody),
    });
    assert.equal(pendingConfirm.status, 200);
    assert.equal((await pendingConfirm.json() as { cleanupPending: boolean }).cleanupPending, true);
    let [storedConfirm] = await db.select().from(receiptReviewsTable)
      .where(eq(receiptReviewsTable.id, confirmReview.id));
    assert.equal(storedConfirm?.status, "confirmed");
    assert.equal((await db.select().from(vaultDocumentsTable)
      .where(eq(vaultDocumentsTable.id, confirmDocument.id))).length, 0);
    assert.equal((await db.select().from(expensesTable).where(and(
      eq(expensesTable.userId, userId), eq(expensesTable.merchant, "Retry Store"),
    ))).length, 1);
    failingPath = undefined;
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/vault/cleanup`, {
      method: "POST", headers: json, body: JSON.stringify({ objectPath: confirmPath }),
    })).status, 200);
    [storedConfirm] = await db.select().from(receiptReviewsTable)
      .where(eq(receiptReviewsTable.id, confirmReview.id));
    assert.equal(storedConfirm?.status, "confirmed");
    assert.equal((await db.select().from(vaultDocumentsTable)
      .where(eq(vaultDocumentsTable.id, confirmDocument.id))).length, 0);
    assert.equal((await db.select().from(expensesTable).where(and(
      eq(expensesTable.userId, userId), eq(expensesTable.merchant, "Retry Store"),
    ))).length, 1);

    const [receiptExpense] = await db.select().from(expensesTable).where(and(
      eq(expensesTable.userId, userId), eq(expensesTable.merchant, "Retry Store"),
    ));
    const savedWithReceipt = await fetch(`http://127.0.0.1:${port}/api/financial-data`, {
      method: "PUT", headers: json,
      body: JSON.stringify({ expenses: [{
        id: receiptExpense.id, date: receiptExpense.date, amount: Number(receiptExpense.amount),
        category: receiptExpense.category, merchant: "Updated Retry Store",
      }] }),
    });
    assert.equal(savedWithReceipt.status, 200);
    assert.ok((await savedWithReceipt.json() as { expenses: Array<{ id: string }> })
      .expenses.some(({ id }) => id === receiptExpense.id));
    const retriedConfirmation = await fetch(
      `http://127.0.0.1:${port}/api/receipts/reviews/${confirmReview.id}/confirm`,
      { method: "POST", headers: json, body: JSON.stringify(confirmBody) },
    );
    assert.equal(retriedConfirmation.status, 200);
    assert.equal((await retriedConfirmation.json() as { expense: { id: string } }).expense.id, receiptExpense.id);
    const receiptBackup = await (await fetch(
      `http://127.0.0.1:${port}/api/financial-data`,
    )).json() as Record<string, unknown> & { expenses: Array<{ id: string }> };
    const staleSave = await fetch(`http://127.0.0.1:${port}/api/financial-data`, {
      method: "PUT", headers: json, body: JSON.stringify({ expenses: [] }),
    });
    assert.equal(staleSave.status, 200);
    assert.ok((await staleSave.json() as { expenses: Array<{ id: string }> })
      .expenses.some(({ id }) => id === receiptExpense.id));
    const deletedExpense = await fetch(
      `http://127.0.0.1:${port}/api/financial-data/expenses/${receiptExpense.id}`,
      { method: "DELETE" },
    );
    assert.equal(deletedExpense.status, 200);
    assert.equal((await deletedExpense.json() as { expenses: Array<{ id: string }> })
      .expenses.some(({ id }) => id === receiptExpense.id), false);
    const staleResurrection = await fetch(`http://127.0.0.1:${port}/api/financial-data`, {
      method: "PUT", headers: json,
      body: JSON.stringify({ expenses: [{
        id: receiptExpense.id, date: receiptExpense.date, amount: Number(receiptExpense.amount),
        category: receiptExpense.category, merchant: "Stale Retry Store",
      }] }),
    });
    assert.equal(staleResurrection.status, 200);
    assert.equal((await staleResurrection.json() as { expenses: Array<{ id: string }> })
      .expenses.some(({ id }) => id === receiptExpense.id), false);
    assert.equal((await fetch(
      `http://127.0.0.1:${port}/api/receipts/reviews/${confirmReview.id}/confirm`,
      { method: "POST", headers: json, body: JSON.stringify(confirmBody) },
    )).status, 410);
    const restoredReceiptBackup = await fetch(
      `http://127.0.0.1:${port}/api/financial-data/restore`,
      { method: "POST", headers: json, body: JSON.stringify(receiptBackup) },
    );
    assert.equal(restoredReceiptBackup.status, 200);
    assert.deepEqual(
      (await restoredReceiptBackup.json() as { expenses: Array<{ id: string }> })
        .expenses.map(({ id }) => id).sort(),
      receiptBackup.expenses.map(({ id }) => id).sort(),
    );
    const confirmationAfterRestore = await fetch(
      `http://127.0.0.1:${port}/api/receipts/reviews/${confirmReview.id}/confirm`,
      { method: "POST", headers: json, body: JSON.stringify(confirmBody) },
    );
    assert.equal(confirmationAfterRestore.status, 200);
    assert.equal(
      (await confirmationAfterRestore.json() as { expense: { id: string } }).expense.id,
      receiptExpense.id,
    );
    const beforeReceiptBackup = {
      ...receiptBackup,
      expenses: receiptBackup.expenses.filter(({ id }) => id !== receiptExpense.id),
    };
    const restoredBeforeReceiptBackup = await fetch(
      `http://127.0.0.1:${port}/api/financial-data/restore`,
      { method: "POST", headers: json, body: JSON.stringify(beforeReceiptBackup) },
    );
    assert.equal(restoredBeforeReceiptBackup.status, 200);
    assert.equal(
      (await restoredBeforeReceiptBackup.json() as { expenses: Array<{ id: string }> })
        .expenses.some(({ id }) => id === receiptExpense.id),
      false,
    );
    assert.equal((await fetch(
      `http://127.0.0.1:${port}/api/receipts/reviews/${confirmReview.id}/confirm`,
      { method: "POST", headers: json, body: JSON.stringify(confirmBody) },
    )).status, 410);
    const clearedFinancialData = await fetch(`http://127.0.0.1:${port}/api/financial-data`, {
      method: "DELETE",
    });
    assert.equal(clearedFinancialData.status, 200);
    assert.deepEqual((await clearedFinancialData.json() as { expenses: unknown[] }).expenses, []);

    failingPath = discardPath;
    const pendingDiscard = await fetch(`http://127.0.0.1:${port}/api/receipts/reviews/${discardReview.id}`, {
      method: "DELETE",
    });
    assert.equal(pendingDiscard.status, 202);
    assert.equal((await pendingDiscard.json() as { cleanupPending: boolean }).cleanupPending, true);
    let [storedDiscard] = await db.select().from(receiptReviewsTable)
      .where(eq(receiptReviewsTable.id, discardReview.id));
    assert.equal(storedDiscard?.status, "discarded");
    assert.equal((await db.select().from(vaultDocumentsTable)
      .where(eq(vaultDocumentsTable.id, discardDocument.id))).length, 0);
    failingPath = undefined;
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/vault/cleanup`, {
      method: "POST", headers: json, body: JSON.stringify({ objectPath: discardPath }),
    })).status, 200);
    [storedDiscard] = await db.select().from(receiptReviewsTable)
      .where(eq(receiptReviewsTable.id, discardReview.id));
    assert.equal(storedDiscard?.status, "discarded");
    assert.equal((await db.select().from(vaultDocumentsTable)
      .where(eq(vaultDocumentsTable.id, discardDocument.id))).length, 0);
  } finally {
    server.close();
    setVaultObjectAssertionForTests();
    setVaultObjectDeletionForTests();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("storage intents roll back before physical deletion when their transaction fails", async () => {
  const userId = `storage-rollback-${process.pid}-${Date.now()}`;
  await db.insert(usersTable).values({ id: userId, email: `${userId}@example.test` });
  await db.insert(premiumEntitlementsTable).values({ userId, plan: "premium", active: true });
  const oldPath = `/objects/vault/${crypto.randomUUID()}`;
  const newPath = `/objects/vault-staging/${crypto.randomUUID()}`;
  const receiptPath = `/objects/vault/${crypto.randomUUID()}`;
  const [document, receiptDocument] = await db.insert(vaultDocumentsTable).values([
    { userId, objectPath: oldPath, name: "old.png", contentType: "image/png", size: 20 },
    { userId, objectPath: receiptPath, name: "receipt.png", contentType: "image/png", size: 20 },
  ]).returning();
  const [grant] = await db.insert(vaultUploadGrantsTable).values({
    userId, objectPath: newPath, name: "new.png", contentType: "image/png", size: 20,
    expiresAt: new Date(Date.now() + 60_000),
  }).returning();
  const [review] = await db.insert(receiptReviewsTable).values({
    userId, documentId: receiptDocument.id, candidates: [], expiresAt: new Date(Date.now() + 60_000),
  }).returning();
  const deleted: string[] = [];
  setVaultObjectAssertionForTests(async () => ({ setMetadata: async () => undefined } as never));
  setVaultObjectDeletionForTests(async (path) => { deleted.push(path); });
  const { server, port } = await premiumServer(userId);
  const headers = { "content-type": "application/json" };
  try {
    setVaultObjectPromotionForTests(async () => { throw new Error("copy unavailable"); });
    const copyFailure = await fetch(`http://127.0.0.1:${port}/api/vault/documents/${document.id}`, {
      method: "PUT", headers,
      body: JSON.stringify({ objectPath: newPath, name: "new.png", contentType: "image/png", size: 20 }),
    });
    assert.equal(copyFailure.status, 503);
    assert.equal((await db.select().from(vaultDocumentsTable)
      .where(eq(vaultDocumentsTable.id, document.id)))[0]?.objectPath, oldPath);
    assert.equal((await db.select().from(vaultUploadGrantsTable)
      .where(eq(vaultUploadGrantsTable.id, grant.id)))[0]?.consumedAt, null);
    setVaultObjectPromotionForTests(async () => undefined);

    setStorageCommitHookForTests((operation) => {
      if (operation === "replacement") throw new Error("injected replacement rollback");
    });
    const replacement = await fetch(`http://127.0.0.1:${port}/api/vault/documents/${document.id}`, {
      method: "PUT", headers,
      body: JSON.stringify({ objectPath: newPath, name: "new.png", contentType: "image/png", size: 20 }),
    });
    assert.equal(replacement.status, 503);
    assert.equal(deleted.length, 0);
    assert.equal((await db.select().from(vaultDocumentsTable)
      .where(eq(vaultDocumentsTable.id, document.id)))[0]?.objectPath, oldPath);
    assert.equal((await db.select().from(vaultUploadGrantsTable)
      .where(eq(vaultUploadGrantsTable.id, grant.id)))[0]?.consumedAt, null);
    assert.equal((await db.select().from(vaultDeletionJobsTable)
      .where(eq(vaultDeletionJobsTable.objectPath, oldPath))).length, 0);

    setStorageCommitHookForTests((operation) => {
      if (operation === "receipt_confirmation") throw new Error("injected receipt rollback");
    });
    const body = { values: {
      merchant: "Rollback Store", amount: 12.5, date: "2026-09-10",
      category: "Shopping", retainOriginal: false,
    } };
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/receipts/reviews/${review.id}/confirm`, {
      method: "POST", headers, body: JSON.stringify(body),
    })).status, 503);
    assert.equal(deleted.length, 0);
    assert.equal((await db.select().from(receiptReviewsTable)
      .where(eq(receiptReviewsTable.id, review.id)))[0]?.status, "pending");
    assert.equal((await db.select().from(vaultDocumentsTable)
      .where(eq(vaultDocumentsTable.id, receiptDocument.id))).length, 1);
    assert.equal((await db.select().from(expensesTable)
      .where(eq(expensesTable.merchant, "Rollback Store"))).length, 0);

    setStorageCommitHookForTests();
    body.values.amount = 1_000_000_000_000;
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/receipts/reviews/${review.id}/confirm`, {
      method: "POST", headers, body: JSON.stringify(body),
    })).status, 400);
    assert.equal(deleted.length, 0);
  } finally {
    server.close();
    setStorageCommitHookForTests();
    setVaultObjectAssertionForTests();
    setVaultObjectDeletionForTests();
    setVaultObjectPromotionForTests(async () => undefined);
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("mobile OTP values are six digits, challenge-bound, and safely limited", () => {
  for (let index = 0; index < 20; index += 1) {
    assert.match(createMobileOtp(), /^\d{6}$/);
  }
  assert.notEqual(hashMobileOtp("challenge-a", "123456"), hashMobileOtp("challenge-b", "123456"));
  assert.notEqual(hashMobileOtp("challenge-a", "123456"), hashMobileOtp("challenge-a", "123457"));
  assert.equal(hashMobileRequester("203.0.113.5"), hashMobileRequester("203.0.113.5"));
  assert.equal(MOBILE_OTP_MAX_ATTEMPTS, 5);
  assert.equal(MOBILE_OTP_TTL_MS, 10 * 60_000);
  assert.equal(createMobileOtp("same-challenge"), createMobileOtp("same-challenge"));
});

test("vault object paths cannot escape the account-controlled namespace", () => {
  assert.equal(isVaultObjectPath("/objects/vault/13cbbf06-4ac8-4c12-8918-51f794a388aa"), true);
  assert.equal(isVaultObjectPath("/objects/uploads/13cbbf06-4ac8-4c12-8918-51f794a388aa"), false);
  assert.equal(isVaultObjectPath("/objects/vault/../../secret"), false);
  assert.equal(isVaultObjectPath("https://storage.googleapis.com/bucket/file"), false);
});

test("legacy vault documents remain owner-authorized for download, preview, and OCR", async () => {
  const userId = `legacy-document-${process.pid}-${Date.now()}`;
  const otherId = `${userId}-other`;
  await db.insert(usersTable).values([{ id: userId }, { id: otherId }]);
  await db.insert(premiumEntitlementsTable).values([
    { userId, plan: "premium", active: true },
    { userId: otherId, plan: "premium", active: true },
  ]);
  const path = `/objects/vault/${crypto.randomUUID()}`;
  const [document] = await db.insert(vaultDocumentsTable).values({
    userId, objectPath: path, name: "legacy.png", contentType: "image/png", size: 3,
  }).returning();
  setVaultFileForTests(() => ({
    createReadStream: () => Readable.from([Buffer.from("old")]),
  } as never));
  const { server, port } = await premiumServer(userId);
  try {
    const download = await fetch(
      `http://127.0.0.1:${port}/api/vault/documents/${document.id}/download`,
    );
    assert.equal(download.status, 200);
    assert.equal(await download.text(), "old");
    assert.match(download.headers.get("content-disposition") ?? "", /legacy\.png/);
    const preview = await fetch(
      `http://127.0.0.1:${port}/api/vault/documents/${document.id}/preview`,
    );
    assert.equal(preview.status, 200);
    assert.equal(await preview.text(), "old");

    await db.update(vaultDocumentsTable).set({ userId: otherId })
      .where(eq(vaultDocumentsTable.id, document.id));
    assert.equal((await fetch(
      `http://127.0.0.1:${port}/api/vault/documents/${document.id}/download`,
    )).status, 404);

    const oldUrl = process.env.RECEIPT_OCR_URL;
    const oldKey = process.env.RECEIPT_OCR_API_KEY;
    const originalFetch = globalThis.fetch;
    process.env.RECEIPT_OCR_URL = "https://ocr.example";
    process.env.RECEIPT_OCR_API_KEY = "test-key";
    globalThis.fetch = (async () => new Response(JSON.stringify({
      candidates: [{ merchant: "Legacy", amount: 1, date: "2026-01-01" }],
    }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const candidates = await extractReceiptCandidates(userId, path, "image/png");
      assert.equal(candidates[0]?.merchant, "Legacy");
    } finally {
      globalThis.fetch = originalFetch;
      if (oldUrl === undefined) delete process.env.RECEIPT_OCR_URL; else process.env.RECEIPT_OCR_URL = oldUrl;
      if (oldKey === undefined) delete process.env.RECEIPT_OCR_API_KEY;
      else process.env.RECEIPT_OCR_API_KEY = oldKey;
    }
  } finally {
    server.close();
    setVaultFileForTests();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await db.delete(usersTable).where(eq(usersTable.id, otherId));
  }
});

test("promotion fails closed when the storage file cannot copy", async () => {
  setVaultObjectPromotionForTests();
  await assert.rejects(
    promoteVaultObject(
      {} as never,
      `/objects/vault-staging/${crypto.randomUUID()}`,
      `/objects/vault-documents/${crypto.randomUUID()}`,
      "owner",
    ),
    /copy is unavailable/,
  );
  setVaultObjectPromotionForTests(async () => undefined);
});

test("validated staging files are pinned to their exact generation", async () => {
  setVaultObjectAssertionForTests();
  let pinnedOptions: unknown;
  const pinned = {};
  const file = {
    exists: async () => [true],
    getMetadata: async () => [{ size: "20", contentType: "image/png", generation: "12345" }],
    name: "vault-staging/source",
    bucket: {
      file: (_name: string, options: unknown) => {
        pinnedOptions = options;
        return pinned;
      },
    },
  };
  const result = await assertVaultObject(
    `/objects/vault-staging/${crypto.randomUUID()}`, 20, "image/png", file as never,
  );
  assert.equal(result, pinned);
  assert.deepEqual(pinnedOptions, { generation: "12345" });
});

test("oversized receipt streams fail before the OCR provider is called", async () => {
  const oldUrl = process.env.RECEIPT_OCR_URL;
  const oldKey = process.env.RECEIPT_OCR_API_KEY;
  process.env.RECEIPT_OCR_URL = "https://ocr.invalid";
  process.env.RECEIPT_OCR_API_KEY = "test";
  let providerCalls = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    throw new Error("provider should not be called");
  }) as typeof fetch;
  const file = {
    createReadStream: () => (async function* () {
      yield Buffer.alloc(20 * 1024 * 1024);
      yield Buffer.alloc(1);
    })(),
  };
  try {
    await assert.rejects(
      extractReceiptCandidates(file as never, "image/png"),
      /RECEIPT_OCR_FILE_TOO_LARGE/,
    );
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.RECEIPT_OCR_URL;
    else process.env.RECEIPT_OCR_URL = oldUrl;
    if (oldKey === undefined) delete process.env.RECEIPT_OCR_API_KEY;
    else process.env.RECEIPT_OCR_API_KEY = oldKey;
  }
});

test("promotion is create-only and writes owner metadata in the copy operation", async () => {
  setVaultObjectPromotionForTests();
  let copyOptions: unknown;
  const source = {
    copy: async (_destination: unknown, options: unknown) => {
      copyOptions = options;
      return [];
    },
  };
  await promoteVaultObject(
    source as never,
    `/objects/vault-staging/${crypto.randomUUID()}`,
    `/objects/vault-documents/${crypto.randomUUID()}`,
    "storage-owner",
  );
  assert.deepEqual(copyOptions, {
    preconditionOpts: { ifGenerationMatch: 0 },
    metadata: { "custom:owner": "storage-owner" },
  });
  setVaultObjectPromotionForTests(async () => undefined);
});

test("promotion cleanup writes a permanent zero-byte tombstone", async () => {
  setVaultObjectFenceForTests();
  let savedData: unknown;
  let savedOptions: unknown;
  const file = {
    save: async (data: unknown, options: unknown) => {
      savedData = data;
      savedOptions = options;
    },
  };
  await fenceVaultObjectPath(`/objects/vault-documents/${crypto.randomUUID()}`, file as never);
  assert.ok(Buffer.isBuffer(savedData));
  assert.equal((savedData as Buffer).length, 0);
  assert.deepEqual(savedOptions, {
    resumable: false,
    contentType: "application/x-vault-tombstone",
    metadata: {
      contentType: "application/x-vault-tombstone",
      cacheControl: "no-store, max-age=0",
      metadata: { "custom:vault-tombstone": "true" },
    },
  });
  setVaultObjectFenceForTests();
});

test("OCR provider output is bounded and invalid monetary values are rejected", () => {
  const candidates = normalizeReceiptCandidates([{
    merchant: " Test Store ",
    amount: "12.345",
    date: "not-a-date",
    category: "Dining",
    lineItems: [{ description: " Coffee ", amount: -4 }, { description: "", amount: 5 }],
  }]);
  assert.deepEqual(candidates, [{
    merchant: "Test Store",
    amount: 12.35,
    date: "",
    category: "Dining",
    lineItems: [{ description: "Coffee", amount: 0 }],
  }]);
  assert.deepEqual(normalizeReceiptCandidates({ candidates: [] }), []);
});

test("receipt candidates remain review-only until explicit confirmation", async () => {
  const source = await readFile(new URL("./src/routes/premium-tools.ts", `file://${process.cwd()}/`), "utf8");
  const createStart = source.indexOf('router.post("/receipts/reviews"');
  const confirmStart = source.indexOf('router.post("/receipts/reviews/:id/confirm"');
  const createHandler = source.slice(createStart, confirmStart);
  const confirmHandler = source.slice(confirmStart, source.indexOf('router.delete("/receipts/reviews/:id"', confirmStart));
  assert.match(createHandler, /insert\(receiptReviewsTable\)/);
  assert.doesNotMatch(createHandler, /expensesTable|financial/i);
  assert.match(createHandler, /saved:\s*false/);
  assert.match(confirmHandler, /status:\s*"confirmed"/);
  assert.match(confirmHandler, /insert\(expensesTable\)/);
  assert.match(confirmHandler, /saved:\s*true/);
});

test("vault and nominee writes include the authenticated account boundary", async () => {
  const source = await readFile(new URL("./src/routes/premium-tools.ts", `file://${process.cwd()}/`), "utf8");
  assert.match(source, /eq\(vaultDocumentsTable\.userId,\s*id\)/);
  assert.match(source, /eq\(nomineesTable\.userId,\s*id\)/);
  assert.match(source, /eq\(receiptReviewsTable\.userId,\s*id\)/);
  assert.match(source, /Allocations for this coverage cannot exceed 100%/);
  assert.match(source, /An active premium plan is required/);
  assert.match(source, /vaultUploadGrantsTable/);
  assert.match(source, /UPLOAD_GRANT_INVALID/);
  assert.match(source, /retainOriginal/);
  assert.match(source, /coverageType/);
  assert.doesNotMatch(source, /sendMobileFallbackEmail/);
});