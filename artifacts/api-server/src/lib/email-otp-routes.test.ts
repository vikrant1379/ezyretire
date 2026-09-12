import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { db, emailOtpChallengesTable, loginActivitiesTable, poolMax, sessionsTable, usersTable } from "@workspace/db";
import { count, eq } from "drizzle-orm";
import { hashRequester, OTP_MAX_REQUESTS_PER_NETWORK } from "./email-otp.js";
import { createSession } from "./auth.js";

process.env.SESSION_SECRET ??= "test-only-session-secret-that-is-at-least-32-characters";
process.env.RESEND_API_KEY = "test-resend-key";
process.env.AUTH_EMAIL_FROM = "ezyRetire <login@example.test>";

const nativeFetch = globalThis.fetch;
const deliveredCodes = new Map<string, string>();
let deliveryFailureResponse: { status: number; type: string } | null = null;
let stallDelivery = false;
const deliveredMessages = new Map<string, {
  from: string;
  subject: string;
  text: string;
  html: string;
}>();
globalThis.fetch = (input, init) => {
  if (String(input) === "https://api.resend.com/emails") {
    if (stallDelivery) {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    }
    if (deliveryFailureResponse) {
      return Promise.resolve(new Response(
        JSON.stringify({ name: deliveryFailureResponse.type, message: "sensitive provider details" }),
        { status: deliveryFailureResponse.status, headers: { "content-type": "application/json" } },
      ));
    }
    const payload = JSON.parse(String(init?.body)) as {
      from: string;
      to: string[];
      subject: string;
      text: string;
      html: string;
    };
    const code = payload.subject.match(/^\d{6}/)?.[0];
    if (code) {
      deliveredCodes.set(payload.to[0], code);
      deliveredMessages.set(payload.to[0], payload);
    }
    return Promise.resolve(new Response(JSON.stringify({ id: "test-message" }), { status: 200 }));
  }
  return nativeFetch(input, init);
};

const { default: app } = await import("../app.js");

test("email OTP bursts leave database capacity for unrelated work", async () => {
  const unique = `otp-burst-${process.pid}-${Date.now()}`;
  const burstIp = `198.51.100.${(process.pid % 200) + 1}`;
  const burstRequesterHash = hashRequester(burstIp);
  await db.insert(emailOtpChallengesTable).values(
    Array.from({ length: OTP_MAX_REQUESTS_PER_NETWORK - 5 }, (_, index) => ({
      id: crypto.randomUUID(),
      email: `seed-${index}-${unique}@example.test`,
      requesterHash: burstRequesterHash,
      codeHash: "0".repeat(64),
      expiresAt: new Date(Date.now() + 10 * 60_000),
      resendAvailableAt: new Date(Date.now() - 1),
      maxAttempts: 5,
      deliveredAt: new Date(),
    })),
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const api = `http://127.0.0.1:${port}/api`;
  const burstSize = poolMax + OTP_MAX_REQUESTS_PER_NETWORK;

  try {
    assert.ok(burstSize > poolMax);
    const burstPromise = Promise.all(
      Array.from({ length: burstSize }, async (_, index) => {
        const response = await nativeFetch(`${api}/auth/otp/request`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": burstIp,
          },
          body: JSON.stringify({ email: `request-${index}-${unique}@example.test` }),
        });
        return {
          response,
          body: await response.json() as { error?: string },
        };
      }),
    );
    const unrelatedQuery = await Promise.race([
      db.select({ userCount: count() }).from(usersTable),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Unrelated database query stalled during email-code burst")), 2_000);
      }),
    ]);
    assert.ok(unrelatedQuery[0].userCount >= 0);

    const burst = await burstPromise;
    assert.equal(burst.filter(({ response }) => response.status === 200).length, 5);
    assert.equal(burst.filter(({ response }) => response.status === 429).length, burstSize - 5);
    assert.equal(burst.filter(({ response }) => response.status >= 500).length, 0);
    for (const { body } of burst.filter(({ response }) => response.status === 429)) {
      assert.deepEqual(body, {
        error: "Too many code requests. Please wait a few minutes and try again.",
      });
    }
  } finally {
    server.close();
    await db.delete(emailOtpChallengesTable).where(eq(emailOtpChallengesTable.requesterHash, burstRequesterHash));
  }
});

test("email OTP routes preserve accounts and enforce challenge abuse controls", async () => {
  const unique = `${process.pid}-${Date.now()}`;
  const existingEmail = `existing-${unique}@example.test`;
  const newEmail = `new-${unique}@example.test`;
  const expiredEmail = `expired-${unique}@example.test`;
  const exhaustedEmail = `exhausted-${unique}@example.test`;
  const concurrentEmail = `concurrent-${unique}@example.test`;
  const failedEmail = `failed-${unique}@example.test`;
  const senderFailureEmail = `sender-failed-${unique}@example.test`;
  const quotaFailureEmail = `quota-failed-${unique}@example.test`;
  const configFailureEmail = `config-failed-${unique}@example.test`;
  const pendingFailureEmail = `pending-failed-${unique}@example.test`;
  const stalledFailureEmail = `stalled-failed-${unique}@example.test`;
  const existingId = `existing-otp-${unique}`;
  await db.insert(usersTable).values({
    id: existingId,
    email: existingEmail,
    fullName: "Existing Customer",
    onboardingCompleted: true,
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const api = `http://127.0.0.1:${port}/api`;
  const post = (path: string, body: unknown, ip?: string) =>
    nativeFetch(`${api}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(ip ? { "x-forwarded-for": ip } : {}),
      },
      body: JSON.stringify(body),
    });
  const requestCode = async (email: string, ip?: string) => {
    const response = await post("/auth/otp/request", { email }, ip);
    const body = await response.json() as {
      challengeId?: string;
      error?: string;
      retryAfterSeconds?: number;
    };
    return { response, body, code: deliveredCodes.get(email) };
  };

  try {
    const malformedEmail = `first-${unique}@example.testsecond-${unique}@example.test`;
    const malformedRequest = await requestCode(malformedEmail);
    assert.equal(malformedRequest.response.status, 400);
    assert.match(malformedRequest.body.error ?? "", /one email address|two addresses/i);
    assert.equal(deliveredCodes.has(malformedEmail), false);
    const malformedChallenges = await db
      .select()
      .from(emailOtpChallengesTable)
      .where(eq(emailOtpChallengesTable.email, malformedEmail));
    assert.equal(malformedChallenges.length, 0);

    const existingRequest = await requestCode(existingEmail);
    assert.equal(existingRequest.response.status, 200);
    assert.ok(existingRequest.body.challengeId);
    assert.match(existingRequest.code ?? "", /^\d{6}$/);
    const deliveredMessage = deliveredMessages.get(existingEmail);
    assert.equal(deliveredMessage?.from, "ezyRetire <login@example.test>");
    assert.equal(
      deliveredMessage?.subject,
      `${existingRequest.code} is your ezyRetire sign-in code`,
    );
    assert.match(deliveredMessage?.text ?? "", /^Your ezyRetire sign-in code is \d{6}\./);
    assert.match(deliveredMessage?.html ?? "", />ezyRetire<\/h1>/);
    assert.doesNotMatch(
      `${deliveredMessage?.subject}${deliveredMessage?.text}${deliveredMessage?.html}`,
      /WealthOne|Retire Wise/,
    );

    const throttled = await requestCode(existingEmail);
    assert.equal(throttled.response.status, 429);
    assert.equal("challengeId" in throttled.body, false);

    const concurrentResults = await Promise.all([
      requestCode(concurrentEmail),
      requestCode(concurrentEmail),
    ]);
    assert.deepEqual(
      concurrentResults.map(({ response }) => response.status).sort(),
      [200, 429],
    );

    const wrong = await post("/auth/otp/verify", {
      challengeId: existingRequest.body.challengeId,
      code: "999999" === existingRequest.code ? "888888" : "999999",
    });
    assert.equal(wrong.status, 401);
    assert.equal((await wrong.json() as { reason: string }).reason, "wrong");

    const verified = await post("/auth/otp/verify", {
      challengeId: existingRequest.body.challengeId,
      code: existingRequest.code,
    });
    assert.equal(verified.status, 200);
    const verifiedBody = await verified.json() as { user: { id: string; fullName: string }; needsProfile: boolean };
    assert.equal(verifiedBody.user.id, existingId);
    assert.equal(verifiedBody.user.fullName, "Existing Customer");
    assert.equal(verifiedBody.needsProfile, false);
    assert.match(verified.headers.get("set-cookie") ?? "", /^sid=/);
    const activitiesAfterLogin = await db
      .select()
      .from(loginActivitiesTable)
      .where(eq(loginActivitiesTable.userId, existingId));
    assert.equal(activitiesAfterLogin.length, 1);
    assert.equal(activitiesAfterLogin[0].authMethod, "email_otp");

    const replayed = await post("/auth/otp/verify", {
      challengeId: existingRequest.body.challengeId,
      code: existingRequest.code,
    });
    assert.equal(replayed.status, 401);
    assert.equal((await replayed.json() as { reason: string }).reason, "invalid");
    const activitiesAfterReplay = await db
      .select()
      .from(loginActivitiesTable)
      .where(eq(loginActivitiesTable.userId, existingId));
    assert.equal(activitiesAfterReplay.length, 1);

    const authState = await nativeFetch(`${api}/auth/user`, {
      headers: { cookie: verified.headers.get("set-cookie") ?? "" },
    });
    assert.equal(authState.status, 200);
    const activitiesAfterRoutineRequest = await db
      .select()
      .from(loginActivitiesTable)
      .where(eq(loginActivitiesTable.userId, existingId));
    assert.equal(activitiesAfterRoutineRequest.length, 1);

    await db.update(emailOtpChallengesTable)
      .set({ resendAvailableAt: new Date(Date.now() - 1) })
      .where(eq(emailOtpChallengesTable.id, existingRequest.body.challengeId!));
    const existingSessionId = await createSession({
      user: {
        id: existingId,
        email: existingEmail,
        profileImageUrl: null,
        fullName: "Existing Customer",
        dateOfBirth: null,
        gender: null,
        phone: null,
        onboardingCompleted: true,
        isAdmin: false,
      },
    });
    const stepUpRequestResponse = await nativeFetch(`${api}/auth/otp/request`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `sid=${existingSessionId}`,
      },
      body: JSON.stringify({
        purpose: "passkey_management",
        email: `stale-${unique}@example.test`,
      }),
    });
    assert.equal(stepUpRequestResponse.status, 200);
    const stepUpRequestBody = await stepUpRequestResponse.json() as { challengeId: string };
    const stepUpBindingCookie = stepUpRequestResponse.headers
      .getSetCookie()
      .find((value) => value.startsWith("__Host-ezyretire-passkey-step-up="))
      ?.split(";")[0];
    assert.ok(stepUpBindingCookie);
    assert.equal(deliveredCodes.has(`stale-${unique}@example.test`), false);
    const steppedUp = await nativeFetch(`${api}/auth/otp/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `sid=${existingSessionId}; ${stepUpBindingCookie}`,
      },
      body: JSON.stringify({
        challengeId: stepUpRequestBody.challengeId,
        code: deliveredCodes.get(existingEmail),
      }),
    });
    assert.equal(steppedUp.status, 200);
    const clearedStepUpCookie = steppedUp.headers
      .getSetCookie()
      .find((value) => value.startsWith("__Host-ezyretire-passkey-step-up=")) ?? "";
    assert.match(clearedStepUpCookie, /(?:Max-Age=0|Expires=Thu, 01 Jan 1970 00:00:00 GMT)/i);
    assert.match(clearedStepUpCookie, /Path=\//i);
    assert.match(clearedStepUpCookie, /HttpOnly/i);
    assert.match(clearedStepUpCookie, /Secure/i);
    assert.match(clearedStepUpCookie, /SameSite=Strict/i);
    const rotatedSessionId = steppedUp.headers
      .getSetCookie()
      .find((value) => value.startsWith("sid="))
      ?.slice(4)
      .split(";")[0];
    assert.ok(rotatedSessionId);
    assert.notEqual(rotatedSessionId, existingSessionId);
    const [oldSession] = await db.select().from(sessionsTable).where(eq(sessionsTable.sid, existingSessionId));
    assert.equal(oldSession, undefined);
    const [upgradedSession] = await db.select().from(sessionsTable).where(eq(sessionsTable.sid, rotatedSessionId));
    const upgradedSessionData = upgradedSession.sess as {
      user: { id: string };
      emailStepUp: { userId: string };
    };
    assert.equal(upgradedSessionData.user.id, existingId);
    assert.equal(upgradedSessionData.emailStepUp.userId, existingId);
    const oldSessionPasskeys = await nativeFetch(`${api}/auth/passkeys`, {
      headers: { cookie: `sid=${existingSessionId}` },
    });
    assert.equal(oldSessionPasskeys.status, 401);
    const rotatedSessionPasskeys = await nativeFetch(`${api}/auth/passkeys`, {
      headers: { cookie: `sid=${rotatedSessionId}` },
    });
    assert.equal(rotatedSessionPasskeys.status, 200);
    await db.update(emailOtpChallengesTable)
      .set({ resendAvailableAt: new Date(Date.now() - 1) })
      .where(eq(emailOtpChallengesTable.email, existingEmail));
    const laterOrdinaryRequest = await requestCode(existingEmail);
    assert.equal(laterOrdinaryRequest.response.status, 200);
    const laterOrdinaryVerification = await nativeFetch(`${api}/auth/otp/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `sid=${rotatedSessionId}; ${stepUpBindingCookie}`,
      },
      body: JSON.stringify({
        challengeId: laterOrdinaryRequest.body.challengeId,
        code: laterOrdinaryRequest.code,
      }),
    });
    assert.equal(laterOrdinaryVerification.status, 200);
    const laterOrdinarySessionId = laterOrdinaryVerification.headers
      .getSetCookie()
      .find((value) => value.startsWith("sid="))
      ?.slice(4)
      .split(";")[0];
    assert.ok(laterOrdinarySessionId);
    await db.delete(sessionsTable).where(eq(sessionsTable.sid, laterOrdinarySessionId));
    await db.delete(sessionsTable).where(eq(sessionsTable.sid, rotatedSessionId));

    const newRequest = await requestCode(newEmail);
    const newVerified = await post("/auth/otp/verify", {
      challengeId: newRequest.body.challengeId,
      code: newRequest.code,
    });
    const newBody = await newVerified.json() as { user: { id: string }; needsProfile: boolean };
    assert.equal(newVerified.status, 200);
    assert.equal(newBody.needsProfile, true);
    const [newUser] = await db.select().from(usersTable).where(eq(usersTable.email, newEmail));
    assert.equal(newUser.id, newBody.user.id);
    assert.ok(newUser.emailVerifiedAt);

    await db.update(emailOtpChallengesTable)
      .set({ resendAvailableAt: new Date(Date.now() - 1) })
      .where(eq(emailOtpChallengesTable.id, newRequest.body.challengeId!));
    const replacementRequest = await requestCode(newEmail);
    assert.equal(replacementRequest.response.status, 200);
    const oldAfterResend = await post("/auth/otp/verify", {
      challengeId: newRequest.body.challengeId,
      code: newRequest.code,
    });
    assert.equal((await oldAfterResend.json() as { reason: string }).reason, "invalid");

    const recoverableEmail = `recoverable-${unique}@example.test`;
    const originalRequest = await requestCode(recoverableEmail);
    await db.update(emailOtpChallengesTable)
      .set({ resendAvailableAt: new Date(Date.now() - 1) })
      .where(eq(emailOtpChallengesTable.id, originalRequest.body.challengeId!));
    deliveryFailureResponse = { status: 500, type: "application_error" };
    const failedReplacement = await requestCode(recoverableEmail);
    assert.equal(failedReplacement.response.status, 503);
    deliveryFailureResponse = null;
    const originalAfterFailure = await post("/auth/otp/verify", {
      challengeId: originalRequest.body.challengeId,
      code: originalRequest.code,
    });
    assert.equal(originalAfterFailure.status, 200);

    const expiredRequest = await requestCode(expiredEmail);
    await db.update(emailOtpChallengesTable)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(emailOtpChallengesTable.id, expiredRequest.body.challengeId!));
    const expired = await post("/auth/otp/verify", {
      challengeId: expiredRequest.body.challengeId,
      code: expiredRequest.code,
    });
    assert.equal((await expired.json() as { reason: string }).reason, "expired");

    const exhaustedRequest = await requestCode(exhaustedEmail);
    let finalReason = "";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await post("/auth/otp/verify", {
        challengeId: exhaustedRequest.body.challengeId,
        code: "999999" === exhaustedRequest.code ? "888888" : "999999",
      });
      finalReason = (await response.json() as { reason: string }).reason;
    }
    assert.equal(finalReason, "exhausted");
    const correctAfterExhaustion = await post("/auth/otp/verify", {
      challengeId: exhaustedRequest.body.challengeId,
      code: exhaustedRequest.code,
    });
    assert.equal((await correctAfterExhaustion.json() as { reason: string }).reason, "exhausted");

    deliveryFailureResponse = { status: 500, type: "application_error" };
    const deliveryFailure = await requestCode(failedEmail);
    assert.equal(deliveryFailure.response.status, 503);
    assert.match(deliveryFailure.body.error ?? "", /try again/i);
    assert.equal(deliveryFailure.body.retryAfterSeconds, 3);
    const [pendingAfterServerFailure] = await db
      .select()
      .from(emailOtpChallengesTable)
      .where(eq(emailOtpChallengesTable.email, failedEmail));
    assert.ok(pendingAfterServerFailure);
    assert.equal(pendingAfterServerFailure.deliveredAt, null);
    await db.update(emailOtpChallengesTable)
      .set({ resendAvailableAt: new Date(Date.now() - 1) })
      .where(eq(emailOtpChallengesTable.id, pendingAfterServerFailure.id));
    deliveryFailureResponse = null;
    const recoveredServerFailure = await requestCode(failedEmail);
    assert.equal(recoveredServerFailure.response.status, 200);
    assert.equal(recoveredServerFailure.body.challengeId, pendingAfterServerFailure.id);
    const verifiedServerFailure = await post("/auth/otp/verify", {
      challengeId: recoveredServerFailure.body.challengeId,
      code: recoveredServerFailure.code,
    });
    assert.equal(verifiedServerFailure.status, 200);

    deliveryFailureResponse = { status: 403, type: "validation_error" };
    const senderFailure = await requestCode(senderFailureEmail);
    assert.equal(senderFailure.response.status, 503);
    assert.match(senderFailure.body.error ?? "", /temporarily unavailable/i);
    deliveryFailureResponse = { status: 429, type: "daily_quota_exceeded" };
    const quotaFailure = await requestCode(quotaFailureEmail);
    assert.equal(quotaFailure.response.status, 503);
    assert.match(quotaFailure.body.error ?? "", /temporarily busy/i);
    deliveryFailureResponse = null;

    const previousApiKey = process.env.RESEND_API_KEY;
    try {
      delete process.env.RESEND_API_KEY;
      const configFailure = await requestCode(configFailureEmail);
      assert.equal(configFailure.response.status, 503);
      assert.match(configFailure.body.error ?? "", /temporarily unavailable/i);
    } finally {
      process.env.RESEND_API_KEY = previousApiKey;
    }

    for (const failedAddress of [senderFailureEmail, quotaFailureEmail, configFailureEmail]) {
      const failedChallenges = await db
        .select()
        .from(emailOtpChallengesTable)
        .where(eq(emailOtpChallengesTable.email, failedAddress));
      assert.equal(failedChallenges.length, 0);
    }

    const retryAfterFailure = await requestCode(quotaFailureEmail);
    assert.equal(retryAfterFailure.response.status, 200);
    assert.ok(retryAfterFailure.body.challengeId);

    deliveryFailureResponse = { status: 409, type: "concurrent_idempotent_requests" };
    const pendingFailure = await requestCode(pendingFailureEmail);
    assert.equal(pendingFailure.response.status, 503);
    assert.equal(pendingFailure.body.retryAfterSeconds, 3);
    const [pendingChallenge] = await db
      .select()
      .from(emailOtpChallengesTable)
      .where(eq(emailOtpChallengesTable.email, pendingFailureEmail));
    assert.ok(pendingChallenge);
    assert.equal(pendingChallenge.deliveredAt, null);

    await db.update(emailOtpChallengesTable)
      .set({ resendAvailableAt: new Date(Date.now() - 1) })
      .where(eq(emailOtpChallengesTable.id, pendingChallenge.id));
    deliveryFailureResponse = null;
    const recoveredPending = await requestCode(pendingFailureEmail);
    assert.equal(recoveredPending.response.status, 200);
    assert.equal(recoveredPending.body.challengeId, pendingChallenge.id);
    assert.match(recoveredPending.code ?? "", /^\d{6}$/);

    stallDelivery = true;
    const stalledStartedAt = Date.now();
    const stalledFailure = await requestCode(stalledFailureEmail);
    const stalledElapsedMs = Date.now() - stalledStartedAt;
    assert.equal(stalledFailure.response.status, 503);
    assert.match(stalledFailure.body.error ?? "", /try again/i);
    assert.equal(stalledFailure.body.retryAfterSeconds, 3);
    assert.ok(stalledElapsedMs < 10_000, `stalled request took ${stalledElapsedMs}ms`);
    const [stalledChallenge] = await db
      .select()
      .from(emailOtpChallengesTable)
      .where(eq(emailOtpChallengesTable.email, stalledFailureEmail));
    assert.ok(stalledChallenge);
    assert.equal(stalledChallenge.deliveredAt, null);
    await db.update(emailOtpChallengesTable)
      .set({ resendAvailableAt: new Date(Date.now() - 1) })
      .where(eq(emailOtpChallengesTable.id, stalledChallenge.id));
    stallDelivery = false;
    const recoveredStall = await requestCode(stalledFailureEmail);
    assert.equal(recoveredStall.response.status, 200);
    assert.equal(recoveredStall.body.challengeId, stalledChallenge.id);

    const passwordLogin = await post("/auth/login", { email: existingEmail, password: "old-password" });
    assert.equal(passwordLogin.status, 410);
  } finally {
    server.close();
    globalThis.fetch = nativeFetch;
    await db.delete(emailOtpChallengesTable).where(eq(emailOtpChallengesTable.email, existingEmail));
    await db.delete(emailOtpChallengesTable).where(eq(emailOtpChallengesTable.email, newEmail));
    await db.delete(emailOtpChallengesTable).where(eq(emailOtpChallengesTable.email, expiredEmail));
    await db.delete(emailOtpChallengesTable).where(eq(emailOtpChallengesTable.email, exhaustedEmail));
    await db.delete(emailOtpChallengesTable).where(eq(emailOtpChallengesTable.email, concurrentEmail));
    await db.delete(emailOtpChallengesTable).where(eq(emailOtpChallengesTable.email, failedEmail));
    await db.delete(emailOtpChallengesTable).where(eq(emailOtpChallengesTable.email, senderFailureEmail));
    await db.delete(emailOtpChallengesTable).where(eq(emailOtpChallengesTable.email, quotaFailureEmail));
    await db.delete(emailOtpChallengesTable).where(eq(emailOtpChallengesTable.email, configFailureEmail));
    await db.delete(emailOtpChallengesTable).where(eq(emailOtpChallengesTable.email, pendingFailureEmail));
    await db.delete(emailOtpChallengesTable).where(eq(emailOtpChallengesTable.email, stalledFailureEmail));
    await db.delete(emailOtpChallengesTable).where(eq(emailOtpChallengesTable.email, `recoverable-${unique}@example.test`));
    await db.delete(usersTable).where(eq(usersTable.email, existingEmail));
    await db.delete(usersTable).where(eq(usersTable.email, newEmail));
    await db.delete(usersTable).where(eq(usersTable.email, `recoverable-${unique}@example.test`));
    await db.delete(usersTable).where(eq(usersTable.email, failedEmail));
  }
});
