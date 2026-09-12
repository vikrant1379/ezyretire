import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
  db,
  emailOtpChallengesTable,
  pinLoginAttemptsTable,
  pool,
  poolMax,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import { and, count, eq, inArray } from "drizzle-orm";
import { createAccountPinHash, verifyAccountPin } from "./account-pin.js";
import {
  cleanExpiredPinLoginAttempts,
  PIN_ATTEMPT_CLEANUP_LOCK_ID,
  PIN_ATTEMPT_CLEANUP_LOCK_NAMESPACE,
} from "./account-pin-attempt-cleanup.js";
import { createSession } from "./auth.js";
import { hashRequester } from "./email-otp.js";

process.env.SESSION_SECRET ??= "test-only-session-secret-that-is-at-least-32-characters";
process.env.RESEND_API_KEY = "test-resend-key";
process.env.AUTH_EMAIL_FROM = "ezyRetire <login@example.test>";

const nativeFetch = globalThis.fetch;
const deliveredCodes = new Map<string, string>();
globalThis.fetch = (input, init) => {
  if (String(input) === "https://api.resend.com/emails") {
    const payload = JSON.parse(String(init?.body)) as { to: string[]; subject: string };
    const code = payload.subject.match(/^\d{6}/)?.[0];
    if (code) deliveredCodes.set(payload.to[0], code);
    return Promise.resolve(new Response(JSON.stringify({ id: "test-message" }), { status: 200 }));
  }
  return nativeFetch(input, init);
};

const { default: app } = await import("../app.js");

function uniqueTestIp(unique: string, suffix: string): string {
  const namespace = createHash("sha256").update(unique).digest("hex").slice(0, 8);
  return `2001:db8:${namespace.slice(0, 4)}:${namespace.slice(4)}::${suffix}`;
}

test("PIN routes enforce lockouts and allow email-verified recovery", async () => {
  const unique = `${process.pid}-${Date.now()}`;
  const accountEmail = `pin-limit-${unique}@example.test`;
  const recoveryEmail = `pin-recovery-${unique}@example.test`;
  const unknownEmail = `pin-unknown-${unique}@example.test`;
  const accountId = `pin-limit-${unique}`;
  const recoveryId = `pin-recovery-${unique}`;
  const accountPin = "4826";
  const replacementPin = "7319";
  const accountIp = uniqueTestIp(unique, "31");
  const recoveryIp = uniqueTestIp(unique, "32");
  const networkIp = uniqueTestIp(unique, "33");
  const sessionIds = new Set<string>();

  await db.insert(usersTable).values([
    {
      id: accountId,
      email: accountEmail,
      emailVerifiedAt: new Date(),
      pinHash: await createAccountPinHash(accountPin),
      onboardingCompleted: true,
    },
    {
      id: recoveryId,
      email: recoveryEmail,
      emailVerifiedAt: new Date(),
      pinHash: await createAccountPinHash(accountPin),
      onboardingCompleted: true,
    },
  ]);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const api = `http://127.0.0.1:${port}/api`;
  const post = (path: string, body: unknown, ip: string, cookie?: string) =>
    nativeFetch(`${api}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  const rememberSession = (response: Response): string => {
    const cookie = response.headers.get("set-cookie") ?? "";
    const sid = cookie.match(/^sid=([^;]+)/)?.[1];
    if (sid) sessionIds.add(decodeURIComponent(sid));
    return cookie;
  };

  try {
    const existingWrong = await post(
      "/auth/pin/login",
      { email: accountEmail, pin: "9999" },
      accountIp,
    );
    const existingWrongBody = await existingWrong.json();
    const unknownWrong = await post(
      "/auth/pin/login",
      { email: unknownEmail, pin: "9999" },
      accountIp,
    );
    assert.equal(unknownWrong.status, existingWrong.status);
    assert.deepEqual(await unknownWrong.json(), existingWrongBody);

    for (let attempt = 1; attempt < 5; attempt += 1) {
      const response = await post(
        "/auth/pin/login",
        { email: accountEmail, pin: "9999" },
        accountIp,
      );
      assert.equal(response.status, 401);
      assert.equal((await response.json() as { reason: string }).reason, "invalid");
    }
    const lockedLogin = await post(
      "/auth/pin/login",
      { email: accountEmail, pin: accountPin },
      accountIp,
    );
    assert.equal(lockedLogin.status, 429);
    assert.equal((await lockedLogin.json() as { reason: string }).reason, "locked");

    const [lockedUser] = await db.select().from(usersTable).where(eq(usersTable.id, accountId));
    assert.ok(lockedUser.pinLockedUntil && lockedUser.pinLockedUntil > new Date());
    assert.equal(lockedUser.pinFailedAttempts, 0);

    await db.update(usersTable).set({
      pinFailedAttempts: 3,
      pinLockedUntil: new Date(Date.now() - 1),
    }).where(eq(usersTable.id, accountId));
    const afterExpiry = await post(
      "/auth/pin/login",
      { email: accountEmail, pin: accountPin },
      accountIp,
    );
    assert.equal(afterExpiry.status, 200);
    rememberSession(afterExpiry);
    const [resetUser] = await db.select().from(usersTable).where(eq(usersTable.id, accountId));
    assert.equal(resetUser.pinFailedAttempts, 0);
    assert.equal(resetUser.pinLockedUntil, null);

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await post(
        "/auth/pin/login",
        { email: `network-${attempt}-${unique}@example.test`, pin: "9999" },
        networkIp,
      );
      assert.equal(response.status, 401);
    }
    const networkBlocked = await post(
      "/auth/pin/login",
      { email: recoveryEmail, pin: accountPin },
      networkIp,
    );
    assert.equal(networkBlocked.status, 429);
    assert.deepEqual(await networkBlocked.json(), {
      error: "Too many PIN attempts. Try again in 15 minutes.",
    });

    const otpRequest = await post("/auth/otp/request", { email: recoveryEmail }, recoveryIp);
    assert.equal(otpRequest.status, 200);
    const { challengeId } = await otpRequest.json() as { challengeId: string };
    const code = deliveredCodes.get(recoveryEmail);
    assert.match(code ?? "", /^\d{6}$/);
    const otpVerified = await post("/auth/otp/verify", { challengeId, code }, recoveryIp);
    assert.equal(otpVerified.status, 200);
    const recoveryCookie = rememberSession(otpVerified);

    const replaced = await post(
      "/auth/pin/setup",
      { pin: replacementPin },
      recoveryIp,
      recoveryCookie,
    );
    assert.equal(replaced.status, 200);
    assert.equal((await replaced.json() as { pinConfigured: boolean }).pinConfigured, true);
    const [recoveredUser] = await db.select().from(usersTable).where(eq(usersTable.id, recoveryId));
    assert.ok(recoveredUser.pinHash);
    assert.equal(await verifyAccountPin(accountPin, recoveredUser.pinHash), false);
    assert.equal(await verifyAccountPin(replacementPin, recoveredUser.pinHash), true);
    assert.equal(recoveredUser.pinFailedAttempts, 0);
    assert.equal(recoveredUser.pinLockedUntil, null);

    const oldPinLogin = await post(
      "/auth/pin/login",
      { email: recoveryEmail, pin: accountPin },
      recoveryIp,
    );
    assert.equal(oldPinLogin.status, 401);
    const newPinLogin = await post(
      "/auth/pin/login",
      { email: recoveryEmail, pin: replacementPin },
      recoveryIp,
    );
    assert.equal(newPinLogin.status, 200);
    rememberSession(newPinLogin);
  } finally {
    server.close();
    globalThis.fetch = nativeFetch;
    await db.delete(emailOtpChallengesTable).where(eq(emailOtpChallengesTable.email, recoveryEmail));
    await db.delete(pinLoginAttemptsTable).where(
      eq(pinLoginAttemptsTable.requesterHash, hashRequester(accountIp)),
    );
    await db.delete(pinLoginAttemptsTable).where(
      eq(pinLoginAttemptsTable.requesterHash, hashRequester(recoveryIp)),
    );
    await db.delete(pinLoginAttemptsTable).where(
      eq(pinLoginAttemptsTable.requesterHash, hashRequester(networkIp)),
    );
    for (const sid of sessionIds) {
      await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
    }
    await db.delete(usersTable).where(eq(usersTable.id, accountId));
    await db.delete(usersTable).where(eq(usersTable.id, recoveryId));
  }
});


test("PIN replacement rejects missing, expired, and wrong-account email verification", async () => {
  const unique = `${process.pid}-${Date.now()}`;
  const userId = `pin-step-up-${unique}`;
  const email = `pin-step-up-${unique}@example.test`;
  const sessionIds: string[] = [];
  const sessionUser = {
    id: userId,
    email,
    profileImageUrl: null,
    fullName: "PIN Step-up Tester",
    dateOfBirth: null,
    gender: null,
    phone: null,
    onboardingCompleted: true,
    isAdmin: false,
  };
  await db.insert(usersTable).values({
    id: userId,
    email,
    fullName: sessionUser.fullName,
    onboardingCompleted: true,
    emailVerifiedAt: new Date(),
    pinHash: await createAccountPinHash("1357"),
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const verificationStates = [
      undefined,
      { userId: "different-user", verifiedAt: Date.now(), method: "email_otp" as const },
      { userId, verifiedAt: Date.now() - 11 * 60 * 1000, method: "email_otp" as const },
    ];
    for (const emailStepUp of verificationStates) {
      const sid = await createSession({
        user: sessionUser,
        authenticatedAt: Date.now(),
        ...(emailStepUp ? { emailStepUp } : {}),
      });
      sessionIds.push(sid);
      const response = await nativeFetch(`http://127.0.0.1:${port}/api/auth/pin/setup`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `sid=${sid}` },
        body: JSON.stringify({ pin: "2468" }),
      });
      assert.equal(response.status, 403);
      assert.match((await response.json() as { error: string }).error, /verify your email again/i);
    }
  } finally {
    server.close();
    for (const sid of sessionIds) {
      await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
    }
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

test("concurrent PIN guesses cannot bypass account or network limits", async () => {
  const unique = `${process.pid}-${Date.now()}-concurrent`;
  const accountEmail = `pin-concurrent-${unique}@example.test`;
  const accountId = `pin-concurrent-${unique}`;
  const accountPin = "4826";
  const accountIp = uniqueTestIp(unique, "41");
  const networkIp = uniqueTestIp(unique, "42");
  const accountRequesterHash = hashRequester(accountIp);
  const networkRequesterHash = hashRequester(networkIp);

  await db.insert(usersTable).values({
    id: accountId,
    email: accountEmail,
    emailVerifiedAt: new Date(),
    pinHash: await createAccountPinHash(accountPin),
    onboardingCompleted: true,
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const api = `http://127.0.0.1:${port}/api`;
  const post = (email: string, pin: string, ip: string) =>
    nativeFetch(`${api}/auth/pin/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ email, pin }),
    });

  try {
    const accountBurst = await Promise.all(
      Array.from({ length: 6 }, () => post(accountEmail, "9999", accountIp)),
    );
    assert.deepEqual(
      accountBurst.map((response) => response.status).sort(),
      [401, 401, 401, 401, 401, 429],
    );
    const accountBodies = await Promise.all(
      accountBurst.map((response) => response.json() as Promise<{ reason: string }>),
    );
    assert.equal(accountBodies.filter(({ reason }) => reason === "invalid").length, 5);
    assert.equal(accountBodies.filter(({ reason }) => reason === "locked").length, 1);

    const [lockedUser] = await db.select().from(usersTable).where(eq(usersTable.id, accountId));
    assert.ok(lockedUser.pinLockedUntil && lockedUser.pinLockedUntil > new Date());
    assert.equal(lockedUser.pinFailedAttempts, 0);

    await db.update(usersTable).set({
      pinFailedAttempts: 0,
      pinLockedUntil: null,
    }).where(eq(usersTable.id, accountId));
    await db.insert(pinLoginAttemptsTable).values(
      Array.from({ length: 15 }, () => ({
        accountHash: "0".repeat(64),
        requesterHash: networkRequesterHash,
        succeeded: false,
      })),
    );
    const burstSize = poolMax + 20;
    assert.ok(burstSize > poolMax);
    const networkBurstPromise = Promise.all(
      Array.from({ length: burstSize }, () => post(accountEmail, "9999", networkIp)),
    );
    const unrelatedQuery = await Promise.race([
      db.select({ userCount: count() }).from(usersTable),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Unrelated database query stalled during PIN burst")), 2_000);
      }),
    ]);
    assert.ok(unrelatedQuery[0].userCount >= 1);
    const networkBurst = await networkBurstPromise;
    assert.equal(networkBurst.filter(({ status }) => status === 401).length, 5);
    assert.equal(networkBurst.filter(({ status }) => status === 429).length, burstSize - 5);
    assert.equal(networkBurst.filter(({ status }) => status >= 500).length, 0);
    const throttledBodies = await Promise.all(
      networkBurst
        .filter(({ status }) => status === 429)
        .map((response) => response.json()),
    );
    for (const responseBody of throttledBodies) {
      assert.deepEqual(responseBody, {
        error: "Too many PIN attempts. Try again in 15 minutes.",
      });
    }

    const [{ failedAttempts }] = await db.select({ failedAttempts: count() })
      .from(pinLoginAttemptsTable)
      .where(and(
        eq(pinLoginAttemptsTable.requesterHash, networkRequesterHash),
        eq(pinLoginAttemptsTable.succeeded, false),
      ));
    assert.equal(failedAttempts, 20);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await db.delete(pinLoginAttemptsTable).where(eq(
      pinLoginAttemptsTable.requesterHash,
      accountRequesterHash,
    ));
    await db.delete(pinLoginAttemptsTable).where(eq(
      pinLoginAttemptsTable.requesterHash,
      networkRequesterHash,
    ));
    await db.delete(usersTable).where(eq(usersTable.id, accountId));
  }
});

test("PIN attempt cleanup removes expired rows without weakening active throttling", async () => {
  const unique = `${process.pid}-${Date.now()}-cleanup`;
  const ip = uniqueTestIp(unique, "51");
  const requesterHash = hashRequester(ip);
  const staleId = `pin-stale-${unique}`;
  const activeIds = Array.from({ length: 20 }, (_, index) => `pin-active-${index}-${unique}`);
  const now = new Date();

  await db.insert(pinLoginAttemptsTable).values([
    {
      id: staleId,
      accountHash: "1".repeat(64),
      requesterHash,
      succeeded: false,
      createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000 - 1),
    },
    ...activeIds.map((id) => ({
      id,
      accountHash: "2".repeat(64),
      requesterHash,
      succeeded: false,
      createdAt: new Date(now.getTime() - 14 * 60 * 1000),
    })),
  ]);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    assert.equal(await cleanExpiredPinLoginAttempts(now), true);
    const remaining = await db.select({ id: pinLoginAttemptsTable.id })
      .from(pinLoginAttemptsTable)
      .where(inArray(pinLoginAttemptsTable.id, [staleId, ...activeIds]));
    assert.equal(remaining.some(({ id }) => id === staleId), false);
    assert.equal(remaining.length, activeIds.length);

    const throttled = await nativeFetch(`http://127.0.0.1:${port}/api/auth/pin/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({
        email: `pin-cleanup-${unique}@example.test`,
        pin: "9999",
      }),
    });
    assert.equal(throttled.status, 429);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await db.delete(pinLoginAttemptsTable).where(eq(
      pinLoginAttemptsTable.requesterHash,
      requesterHash,
    ));
  }
});

test("PIN login does not perform expired-attempt retention work", async () => {
  const unique = `${process.pid}-${Date.now()}-retention`;
  const attemptId = `pin-expired-${unique}`;
  const loginIp = uniqueTestIp(unique, "52");
  await db.insert(pinLoginAttemptsTable).values({
    id: attemptId,
    accountHash: "1".repeat(64),
    requesterHash: hashRequester(uniqueTestIp(unique, "51")),
    succeeded: false,
    createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await nativeFetch(`http://127.0.0.1:${port}/api/auth/pin/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": loginIp },
      body: JSON.stringify({ email: `${unique}@example.test`, pin: "9999" }),
    });
    assert.equal(response.status, 401);
    const retained = await db.select({ id: pinLoginAttemptsTable.id })
      .from(pinLoginAttemptsTable)
      .where(eq(pinLoginAttemptsTable.id, attemptId));
    assert.equal(retained.length, 1);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await db.delete(pinLoginAttemptsTable).where(eq(pinLoginAttemptsTable.id, attemptId));
    await db.delete(pinLoginAttemptsTable).where(eq(
      pinLoginAttemptsTable.requesterHash,
      hashRequester(loginIp),
    ));
  }
});

test("PIN attempt cleanup skips contention and resumes after transaction lock release", async () => {
  const unique = `${process.pid}-${Date.now()}-cleanup-lock`;
  const staleId = `pin-stale-${unique}`;
  const requesterHash = createHash("sha256").update(unique).digest("hex");
  const now = new Date();
  const lockHolder = await pool.connect();
  let transactionOpen = false;

  await db.insert(pinLoginAttemptsTable).values({
    id: staleId,
    accountHash: "3".repeat(64),
    requesterHash,
    succeeded: false,
    createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000 - 1),
  });

  try {
    await lockHolder.query("begin");
    transactionOpen = true;
    const held = await lockHolder.query<{ acquired: boolean }>(
      "select pg_try_advisory_xact_lock($1, $2) as acquired",
      [PIN_ATTEMPT_CLEANUP_LOCK_NAMESPACE, PIN_ATTEMPT_CLEANUP_LOCK_ID],
    );
    assert.equal(held.rows[0]?.acquired, true);

    assert.equal(await cleanExpiredPinLoginAttempts(now), false);
    const whileLocked = await db.select({ id: pinLoginAttemptsTable.id })
      .from(pinLoginAttemptsTable)
      .where(eq(pinLoginAttemptsTable.id, staleId));
    assert.equal(whileLocked.length, 1);

    await lockHolder.query("commit");
    transactionOpen = false;

    assert.equal(await cleanExpiredPinLoginAttempts(now), true);
    const afterCommit = await db.select({ id: pinLoginAttemptsTable.id })
      .from(pinLoginAttemptsTable)
      .where(eq(pinLoginAttemptsTable.id, staleId));
    assert.equal(afterCommit.length, 0);
  } finally {
    if (transactionOpen) await lockHolder.query("rollback");
    lockHolder.release();
    await db.delete(pinLoginAttemptsTable).where(eq(pinLoginAttemptsTable.id, staleId));
  }
});

test("PIN attempt cleanup resumes after a failed lock-holding transaction rolls back", async () => {
  const unique = `${process.pid}-${Date.now()}-cleanup-rollback`;
  const staleId = `pin-stale-${unique}`;
  const requesterHash = createHash("sha256").update(unique).digest("hex");
  const now = new Date();
  const lockHolder = await pool.connect();
  let transactionOpen = false;

  await db.insert(pinLoginAttemptsTable).values({
    id: staleId,
    accountHash: "4".repeat(64),
    requesterHash,
    succeeded: false,
    createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000 - 1),
  });

  try {
    await lockHolder.query("begin");
    transactionOpen = true;
    const held = await lockHolder.query<{ acquired: boolean }>(
      "select pg_try_advisory_xact_lock($1, $2) as acquired",
      [PIN_ATTEMPT_CLEANUP_LOCK_NAMESPACE, PIN_ATTEMPT_CLEANUP_LOCK_ID],
    );
    assert.equal(held.rows[0]?.acquired, true);

    await lockHolder.query("rollback");
    transactionOpen = false;

    assert.equal(await cleanExpiredPinLoginAttempts(now), true);
    const afterRollback = await db.select({ id: pinLoginAttemptsTable.id })
      .from(pinLoginAttemptsTable)
      .where(eq(pinLoginAttemptsTable.id, staleId));
    assert.equal(afterRollback.length, 0);
  } finally {
    if (transactionOpen) await lockHolder.query("rollback");
    lockHolder.release();
    await db.delete(pinLoginAttemptsTable).where(eq(pinLoginAttemptsTable.id, staleId));
  }
});