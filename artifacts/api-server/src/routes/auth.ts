import {
  GetCurrentAuthUserResponse,
  LoginWithAccountPinBody,
  LoginWithAccountPinResponse,
  SetupAccountPinBody,
  SetupAccountPinResponse,
} from "@workspace/api-zod";
import { accountDeletionRequestsTable, db, emailOtpChallengesTable, mobileOtpChallengesTable, pinLoginAttemptsTable, usersTable } from "@workspace/db";
import crypto from "crypto";
import { and, count, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import * as oidc from "openid-client";
import {
  clearSession,
  createSession,
  deleteSession,
  getSession,
  getOidcConfig,
  getSessionId,
  isAdminIdentity,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
  updateSession,
} from "../lib/auth.js";
import {
  getAdminAuthorizationFailureRedirect,
  getCallbackFailureRedirect,
  getSafeReturnTo,
  type BrowserLoginIntent,
} from "../lib/auth-redirect.js";
import { isValidOptionalPhone, normalizeOptionalPhone } from "../lib/auth-profile-input.js";
import { getEnv } from "../lib/env.js";
import {
  createOtpCode,
  EmailDeliveryError,
  hashOtp,
  hashRequester,
  hasMultipleOtpEmailAddresses,
  isValidOtpEmail,
  normalizeOtpEmail,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_REQUESTS_PER_NETWORK,
  OTP_REQUEST_WINDOW_MS,
  OTP_RESEND_MS,
  OTP_TTL_MS,
  sendLoginCode,
} from "../lib/email-otp.js";
import { recordLoginActivity, type LoginMethod } from "../lib/login-activity.js";
import { accountEmailHash, accountHash, withAccountWriteFence } from "../lib/account-compliance.js";
import {
  createAccountPinHash,
  DUMMY_ACCOUNT_PIN_HASH,
  isValidAccountPin,
  verifyAccountPin,
} from "../lib/account-pin.js";

const OIDC_COOKIE_TTL = 10 * 60 * 1000;
const OTP_INDETERMINATE_RETRY_MS = 3_000;
const PIN_LOCK_MS = 15 * 60 * 1000;
const PIN_MAX_ACCOUNT_ATTEMPTS = 5;
const PIN_MAX_NETWORK_ATTEMPTS = 20;
const PIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const PIN_STEP_UP_MAX_AGE_MS = 10 * 60 * 1000;
const PASSKEY_STEP_UP_COOKIE = "__Host-ezyretire-passkey-step-up";
const PASSKEY_STEP_UP_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  path: "/",
};
const router: IRouter = Router();

type RequesterQueue = {
  pending: number;
  tail: Promise<void>;
};
const pinRequesterQueues = new Map<string, RequesterQueue>();

const otpRequesterQueues = new Map<string, RequesterQueue>();
function profileInput(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function sessionUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    profileImageUrl: user.profileImageUrl,
    fullName: user.fullName,
    dateOfBirth: user.dateOfBirth,
    gender: user.gender,
    phone: user.phone,
    onboardingCompleted: user.onboardingCompleted,
    isAdmin: isAdminIdentity(user.id, user.email),
  };
}

function passkeyStepUpBinding(challengeId: string, sid: string): string {
  const secret = getEnv("SESSION_SECRET");
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${challengeId}:${sid}`)
    .digest("base64url");
  return `${challengeId}.${signature}`;
}

function hasValidPasskeyStepUpBinding(req: Request, challengeId: string): boolean {
  const sid = getSessionId(req);
  const binding = req.cookies?.[PASSKEY_STEP_UP_COOKIE];
  if (!sid || typeof binding !== "string") return false;
  const expected = passkeyStepUpBinding(challengeId, sid);
  const actualBuffer = Buffer.from(binding);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

async function createCredentialSession(
  req: Request,
  res: Response,
  user: typeof usersTable.$inferSelect,
  emailStepUp = false,
) {
  const session = await withAccountWriteFence(user.id, async () => {
    const [current] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.id, user.id)).limit(1);
    const [denied] = await db.select({ id: accountDeletionRequestsTable.id })
      .from(accountDeletionRequestsTable).where(and(
        eq(accountDeletionRequestsTable.accountHash, accountHash(user.id)),
        sql`${accountDeletionRequestsTable.status} in ('processing', 'blocked', 'completed')`,
      )).limit(1);
    if (!current || denied) throw new Error("ACCOUNT_DELETION_IN_PROGRESS");
    const nextSession: SessionData = {
      user: sessionUser(user),
      authenticatedAt: Date.now(),
      ...(emailStepUp
        ? { emailStepUp: { userId: user.id, verifiedAt: Date.now(), method: "email_otp" as const } }
        : {}),
    };
    const currentSid = getSessionId(req);
    const currentSession = emailStepUp && currentSid ? await getSession(currentSid) : null;
    if (currentSid && currentSession?.user.id === user.id) {
      const rotatedSid = await createSession({ ...currentSession, ...nextSession });
      await deleteSession(currentSid);
      return rotatedSid;
    }
    return createSession(nextSession);
  });
  res.cookie(SESSION_COOKIE, session, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

async function safelyRecordLogin(
  req: Request,
  userId: string,
  authMethod: LoginMethod,
): Promise<void> {
  try {
    await recordLoginActivity(req, userId, authMethod);
  } catch (error) {
    req.log.warn(
      { errorName: error instanceof Error ? error.name : "Unknown", authMethod },
      "Login activity could not be recorded",
    );
  }
}

function getOrigin(req: Request): string {
  const configuredOrigin = getEnv("APP_URL")?.replace(/\/+$/, "");
  if (configuredOrigin) return configuredOrigin;
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  return `${proto}://${host}`;
}

function setCookie(res: Response, name: string, value: string, maxAge: number) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

function clearOidcCookies(res: Response) {
  ["code_verifier", "nonce", "state", "return_to", "login_intent"].forEach((name) =>
    res.clearCookie(name, { path: "/" }),
  );
}

async function beginBrowserLogin(
  req: Request,
  res: Response,
  intent: BrowserLoginIntent,
): Promise<void> {
  if (intent === "admin") {
    await clearSession(res, getSessionId(req));
  }

  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const verifier = oidc.randomPKCECodeVerifier();
  const challenge = await oidc.calculatePKCECodeChallenge(verifier);
  const redirectTo = oidc.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl,
    scope: "openid email profile offline_access",
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "login consent",
    state,
    nonce,
  });

  setCookie(res, "code_verifier", verifier, OIDC_COOKIE_TTL);
  setCookie(res, "nonce", nonce, OIDC_COOKIE_TTL);
  setCookie(res, "state", state, OIDC_COOKIE_TTL);
  setCookie(res, "return_to", getSafeReturnTo(req.query.returnTo), OIDC_COOKIE_TTL);
  setCookie(res, "login_intent", intent, OIDC_COOKIE_TTL);
  res.redirect(redirectTo.href);
}

router.get("/auth/user", (req, res) => {
  res.json(
    GetCurrentAuthUserResponse.parse({
      user: req.isAuthenticated() ? req.user : null,
    }),
  );
});

router.patch("/auth/profile", async (req, res): Promise<void> => {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Login required" });
    return;
  }

  const fullName = profileInput(req.body?.fullName);
  const dateOfBirth = profileInput(req.body?.dateOfBirth);
  const gender = profileInput(req.body?.gender);
  const phone = normalizeOptionalPhone(req.body?.phone);
  const onboardingCompleted = req.body?.onboardingCompleted === true;
  if (fullName.length < 2 || fullName.length > 100 || !isValidDate(dateOfBirth) || !gender) {
    res.status(400).json({ error: "Complete your name, date of birth, and gender" });
    return;
  }
  if (!isValidOptionalPhone(phone)) {
    res.status(400).json({ error: "Enter a valid mobile number" });
    return;
  }

  const [user] = await db.transaction(async (tx) => {
    const [existingUser] = await tx.select().from(usersTable)
      .where(eq(usersTable.id, req.user.id)).for("update");
    if (!existingUser) return [];
    const phoneChanged = existingUser.phone !== phone;
    if (phoneChanged) {
      await tx.update(mobileOtpChallengesTable).set({ consumedAt: new Date() })
        .where(and(
          eq(mobileOtpChallengesTable.userId, req.user.id),
          isNull(mobileOtpChallengesTable.consumedAt),
        ));
    }
    return tx.update(usersTable)
      .set({
        fullName,
        dateOfBirth,
        gender,
        phone,
        phoneVerifiedAt: phoneChanged ? null : existingUser.phoneVerifiedAt,
        onboardingCompleted,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, req.user.id))
      .returning();
  });
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  const sid = getSessionId(req);
  if (sid) {
    const session = await getSession(sid);
    if (session) await updateSession(sid, { ...session, user: sessionUser(user) });
  }
  req.user = sessionUser(user);
  res.json({ user: sessionUser(user) });
});

router.post("/auth/pin/setup", async (req, res): Promise<void> => {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Login required" });
    return;
  }
  const body = SetupAccountPinBody.safeParse(req.body);
  if (!body.success || !isValidAccountPin(body.data.pin)) {
    res.status(400).json({ error: "Enter a 4-digit PIN" });
    return;
  }
  const { pin } = body.data;
  const sid = getSessionId(req);
  const session = sid ? await getSession(sid) : null;
  const stepUp = session?.emailStepUp;
  if (
    !stepUp
    || stepUp.userId !== req.user.id
    || Date.now() - stepUp.verifiedAt > PIN_STEP_UP_MAX_AGE_MS
  ) {
    res.status(403).json({ error: "Verify your email again before setting a PIN" });
    return;
  }
  const pinHash = await createAccountPinHash(pin);
  const [user] = await db.update(usersTable).set({
    pinHash,
    pinFailedAttempts: 0,
    pinLockedUntil: null,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, req.user.id)).returning();
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  res.json(SetupAccountPinResponse.parse({
    user: sessionUser(user),
    pinConfigured: true,
  }));
});

router.post("/auth/pin/login", async (req, res): Promise<void> => {
  const body = LoginWithAccountPinBody.safeParse(req.body);
  const email = normalizeOtpEmail(body.success ? body.data.email : "");
  const pin = body.success ? body.data.pin : "";
  if (!body.success || !isValidOtpEmail(email) || !isValidAccountPin(pin)) {
    res.status(400).json({ error: "Enter your 4-digit PIN" });
    return;
  }
  const requesterHash = hashRequester(req.ip || "unknown");
  const emailHash = accountEmailHash(email);
  const now = new Date();
  const windowStart = new Date(now.getTime() - PIN_ATTEMPT_WINDOW_MS);
  const result = await withRequesterAdmission(
    pinRequesterQueues,
    requesterHash,
    PIN_MAX_NETWORK_ATTEMPTS,
    () => db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${requesterHash}))`);
      const [{ requestCount }] = await tx.select({ requestCount: count() })
        .from(pinLoginAttemptsTable)
        .where(and(
          eq(pinLoginAttemptsTable.requesterHash, requesterHash),
          eq(pinLoginAttemptsTable.succeeded, false),
          gt(pinLoginAttemptsTable.createdAt, windowStart),
        ));
      if (requestCount >= PIN_MAX_NETWORK_ATTEMPTS) {
        return { status: "network_locked" as const };
      }

      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${emailHash}))`);
      const [user] = await tx.select().from(usersTable).where(eq(usersTable.email, email)).for("update");
      const valid = await verifyAccountPin(pin, user?.pinHash ?? DUMMY_ACCOUNT_PIN_HASH);
      const locked = Boolean(user?.pinLockedUntil && user.pinLockedUntil > now);
      if (!user || !user.pinHash || !valid || locked) {
        await tx.insert(pinLoginAttemptsTable).values({
          accountHash: emailHash,
          requesterHash,
          succeeded: false,
        });
        if (user && !locked) {
          const attempts = user.pinFailedAttempts + 1;
          await tx.update(usersTable).set({
            pinFailedAttempts: attempts >= PIN_MAX_ACCOUNT_ATTEMPTS ? 0 : attempts,
            pinLockedUntil: attempts >= PIN_MAX_ACCOUNT_ATTEMPTS
              ? new Date(now.getTime() + PIN_LOCK_MS)
              : null,
            updatedAt: now,
          }).where(eq(usersTable.id, user.id));
        }
        return { status: locked ? "locked" as const : "invalid" as const };
      }
      await tx.update(usersTable).set({
        pinFailedAttempts: 0,
        pinLockedUntil: null,
        updatedAt: now,
      }).where(eq(usersTable.id, user.id));
      await tx.insert(pinLoginAttemptsTable).values({
        accountHash: emailHash,
        requesterHash,
        succeeded: true,
      });
      return { status: "verified" as const, user };
    }),
  );
  if (result.status === "network_locked") {
    res.status(429).json({ error: "Too many PIN attempts. Try again in 15 minutes." });
    return;
  }
  if (result.status !== "verified") {
    res.status(result.status === "locked" ? 429 : 401).json({
      error: result.status === "locked"
        ? "Too many PIN attempts. Try again in 15 minutes or reset your PIN."
        : "That PIN is incorrect. Try again or reset your PIN.",
      reason: result.status,
    });
    return;
  }
  try {
    await createCredentialSession(req, res, result.user);
  } catch (error) {
    if (error instanceof Error && error.message === "ACCOUNT_DELETION_IN_PROGRESS") {
      res.status(423).json({ error: "Account deletion is in progress", reason: "deletion_in_progress" });
      return;
    }
    throw error;
  }
  await safelyRecordLogin(req, result.user.id, "pin");
  res.json(LoginWithAccountPinResponse.parse({ user: sessionUser(result.user) }));
});

router.post("/auth/otp/request", async (req, res): Promise<void> => {
  const purpose = req.body?.purpose;
  if (purpose !== undefined && purpose !== "passkey_management") {
    res.status(400).json({ error: "Unsupported email verification purpose" });
    return;
  }
  const passkeyManagement = purpose === "passkey_management";
  if (passkeyManagement && (!req.isAuthenticated() || !req.user?.email)) {
    res.status(401).json({ error: "Sign in again before verifying passkey management" });
    return;
  }
  const email = normalizeOtpEmail(passkeyManagement ? req.user?.email : req.body?.email);
  if (!isValidOtpEmail(email)) {
    res.status(400).json({
      error: hasMultipleOtpEmailAddresses(email)
        ? "Enter one email address only. It looks like two addresses may have been joined together."
        : "Enter a valid email address, such as name@example.com.",
    });
    return;
  }

  const requesterHash = hashRequester(req.ip || "unknown");
  const now = new Date();
  const issuance = await withRequesterAdmission(
    otpRequesterQueues,
    requesterHash,
    OTP_MAX_REQUESTS_PER_NETWORK,
    () => db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${email}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${requesterHash}))`);
    const [latest] = await tx
      .select()
      .from(emailOtpChallengesTable)
      .where(eq(emailOtpChallengesTable.email, email))
      .orderBy(desc(emailOtpChallengesTable.createdAt))
      .limit(1);
    if (latest && !latest.deliveredAt && !latest.consumedAt && latest.expiresAt > now) {
      if (latest.resendAvailableAt > now) {
        return {
          status: "throttled" as const,
          retryAfterSeconds: Math.max(1, Math.ceil((latest.resendAvailableAt.getTime() - now.getTime()) / 1000)),
        };
      }
      return {
        status: "issued" as const,
        id: latest.id,
        code: createOtpCode(latest.id),
      };
    }
    if (latest && latest.resendAvailableAt > now) {
      return {
        status: "throttled" as const,
        retryAfterSeconds: Math.max(1, Math.ceil((latest.resendAvailableAt.getTime() - now.getTime()) / 1000)),
      };
    }
    const [{ requestCount }] = await tx
      .select({ requestCount: count() })
      .from(emailOtpChallengesTable)
      .where(and(
        eq(emailOtpChallengesTable.requesterHash, requesterHash),
        gt(emailOtpChallengesTable.createdAt, new Date(now.getTime() - OTP_REQUEST_WINDOW_MS)),
      ));
    if (requestCount >= OTP_MAX_REQUESTS_PER_NETWORK) {
      return { status: "network-limited" as const };
    }

    const id = crypto.randomUUID();
    const code = createOtpCode(id);
    await tx.insert(emailOtpChallengesTable).values({
      id,
      email,
      requesterHash,
      codeHash: hashOtp(id, code),
      expiresAt: new Date(now.getTime() + OTP_TTL_MS),
      resendAvailableAt: new Date(now.getTime() + OTP_RESEND_MS),
      maxAttempts: OTP_MAX_ATTEMPTS,
    });
    return { status: "issued" as const, id, code };
    }),
  );

  if (issuance.status === "throttled") {
    res.status(429).json({
      error: `Please wait ${issuance.retryAfterSeconds} seconds before requesting another code`,
      retryAfterSeconds: issuance.retryAfterSeconds,
    });
    return;
  }
  if (issuance.status === "network-limited" || issuance.status === "network_locked") {
    res.status(429).json({ error: "Too many code requests. Please wait a few minutes and try again." });
    return;
  }

  try {
    await sendLoginCode(email, issuance.code, issuance.id);
  } catch (error) {
    const deliveryError = error instanceof EmailDeliveryError ? error : undefined;
    if (deliveryError?.indeterminate) {
      await db
        .update(emailOtpChallengesTable)
        .set({ resendAvailableAt: new Date(Date.now() + OTP_INDETERMINATE_RETRY_MS) })
        .where(eq(emailOtpChallengesTable.id, issuance.id));
    } else {
      await db.delete(emailOtpChallengesTable).where(eq(emailOtpChallengesTable.id, issuance.id));
    }
    req.log.warn({
      errorName: error instanceof Error ? error.name : "Unknown",
      deliveryCategory: deliveryError?.category ?? "unknown",
      providerStatus: deliveryError?.providerStatus,
      providerType: deliveryError?.providerType,
      deliveryIndeterminate: deliveryError?.indeterminate ?? false,
    }, "OTP email delivery failed");
    const userMessage = deliveryError?.category === "recipient"
      ? "We couldn't deliver to that address. Check it for mistakes and try again."
      : deliveryError?.category === "quota"
        ? "Email delivery is temporarily busy. Please try again later."
        : "Email delivery is temporarily unavailable. Please try again in a moment.";
    res.status(503).json({
      error: userMessage,
      ...(deliveryError?.indeterminate
        ? { retryAfterSeconds: Math.ceil(OTP_INDETERMINATE_RETRY_MS / 1000) }
        : {}),
    });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${email}))`);
    await tx
      .update(emailOtpChallengesTable)
      .set({ consumedAt: new Date() })
      .where(and(
        eq(emailOtpChallengesTable.email, email),
        ne(emailOtpChallengesTable.id, issuance.id),
        isNull(emailOtpChallengesTable.consumedAt),
      ));
    await tx
      .update(emailOtpChallengesTable)
      .set({ deliveredAt: new Date() })
      .where(eq(emailOtpChallengesTable.id, issuance.id));
  });
  if (passkeyManagement) {
    const sid = getSessionId(req);
    if (!sid) {
      res.status(401).json({ error: "Sign in again before verifying passkey management" });
      return;
    }
    res.cookie(PASSKEY_STEP_UP_COOKIE, passkeyStepUpBinding(issuance.id, sid), {
      ...PASSKEY_STEP_UP_COOKIE_OPTIONS,
      maxAge: OTP_TTL_MS,
    });
  } else {
    res.clearCookie(PASSKEY_STEP_UP_COOKIE, PASSKEY_STEP_UP_COOKIE_OPTIONS);
  }

  res.json({
    message: "If the address can receive email, a sign-in code is on its way.",
    challengeId: issuance.id,
    resendAfterSeconds: OTP_RESEND_MS / 1000,
  });
});

router.post("/auth/otp/verify", async (req, res): Promise<void> => {
  const challengeId = typeof req.body?.challengeId === "string" ? req.body.challengeId : "";
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: "Enter the 6-digit code from your email" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [challenge] = await tx
      .select()
      .from(emailOtpChallengesTable)
      .where(eq(emailOtpChallengesTable.id, challengeId))
      .for("update");
    if (!challenge || !challenge.deliveredAt || challenge.consumedAt) return { status: "invalid" as const };
    if (challenge.expiresAt <= new Date()) return { status: "expired" as const };
    if (challenge.failedAttempts >= challenge.maxAttempts) return { status: "exhausted" as const };
    if (challenge.codeHash !== hashOtp(challenge.id, code)) {
      const attempts = challenge.failedAttempts + 1;
      await tx
        .update(emailOtpChallengesTable)
        .set({ failedAttempts: attempts })
        .where(eq(emailOtpChallengesTable.id, challenge.id));
      return { status: attempts >= challenge.maxAttempts ? "exhausted" as const : "wrong" as const };
    }
    const [deletedIdentity] = await tx.select({ id: accountDeletionRequestsTable.id })
      .from(accountDeletionRequestsTable).where(and(
        eq(accountDeletionRequestsTable.emailHash, accountEmailHash(challenge.email)),
        sql`${accountDeletionRequestsTable.status} in ('processing', 'blocked', 'completed')`,
      )).limit(1);
    if (deletedIdentity) return { status: "deleted" as const };

    const verifiedAt = new Date();
    await tx
      .update(emailOtpChallengesTable)
      .set({ consumedAt: verifiedAt })
      .where(and(eq(emailOtpChallengesTable.id, challenge.id), isNull(emailOtpChallengesTable.consumedAt)));
    let [user] = await tx.select().from(usersTable).where(eq(usersTable.email, challenge.email));
    if (user) {
      [user] = await tx
        .update(usersTable)
        .set({ emailVerifiedAt: verifiedAt, updatedAt: verifiedAt })
        .where(eq(usersTable.id, user.id))
        .returning();
    } else {
      [user] = await tx
        .insert(usersTable)
        .values({ id: crypto.randomUUID(), email: challenge.email, emailVerifiedAt: verifiedAt })
        .returning();
    }
    return { status: "verified" as const, user };
  });

  if (result.status !== "verified") {
    if (result.status === "deleted") {
      res.status(410).json({ error: "This account was permanently deleted and cannot be restored." });
      return;
    }
    const messages = {
      invalid: "This code has already been used or is no longer available. Request a new code.",
      expired: "This code has expired. Request a new code to continue.",
      exhausted: "Too many incorrect attempts. Request a new code to continue.",
      wrong: "That code is incorrect. Check the email and try again.",
    };
    res.status(401).json({ error: messages[result.status], reason: result.status });
    return;
  }
  const passkeyStepUpCookie = req.cookies?.[PASSKEY_STEP_UP_COOKIE];
  const passkeyStepUpAttempt = typeof passkeyStepUpCookie === "string"
    && passkeyStepUpCookie.startsWith(`${challengeId}.`);
  const passkeyStepUpAuthorized = passkeyStepUpAttempt
    && req.isAuthenticated()
    && req.user.id === result.user.id
    && hasValidPasskeyStepUpBinding(req, challengeId);
  if (passkeyStepUpAttempt && !passkeyStepUpAuthorized) {
    res.clearCookie(PASSKEY_STEP_UP_COOKIE, PASSKEY_STEP_UP_COOKIE_OPTIONS);
    res.status(401).json({
      error: "Sign in again before verifying passkey management",
      reason: "passkey_step_up_session_changed",
    });
    return;
  }
  try {
    await createCredentialSession(req, res, result.user, passkeyStepUpAuthorized);
  } catch (error) {
    if (error instanceof Error && error.message === "ACCOUNT_DELETION_IN_PROGRESS") {
      res.status(423).json({ error: "Account deletion is in progress", reason: "deletion_in_progress" });
      return;
    }
    throw error;
  }
  res.clearCookie(PASSKEY_STEP_UP_COOKIE, PASSKEY_STEP_UP_COOKIE_OPTIONS);
  await safelyRecordLogin(req, result.user.id, "email_otp");
  res.json({
    user: sessionUser(result.user),
    needsProfile: !result.user.onboardingCompleted,
    pinConfigured: Boolean(result.user.pinHash),
    passkeyStepUpAuthorized,
  });
});

// Password authentication is intentionally retired for consumer accounts.
router.post(["/auth/login", "/auth/register"], (_req, res): void => {
  res.status(410).json({ error: "Password sign-in is no longer available. Request an email code instead." });
});

router.get("/login", async (req, res): Promise<void> => {
  await beginBrowserLogin(req, res, "user");
});

router.get("/admin/login", async (req, res): Promise<void> => {
  await beginBrowserLogin(req, res, "admin");
});

router.get("/callback", async (req, res): Promise<void> => {
  const loginIntent: BrowserLoginIntent =
    req.cookies?.login_intent === "admin" ? "admin" : "user";
  const returnTo = getSafeReturnTo(req.query.returnTo);
  const verifier = req.cookies?.code_verifier;
  const nonce = req.cookies?.nonce;
  const expectedState = req.cookies?.state;
  if (!verifier || !expectedState) {
    clearOidcCookies(res);
    res.redirect(getCallbackFailureRedirect(loginIntent, returnTo));
    return;
  }

  try {
    const config = await getOidcConfig();
    const callbackUrl = `${getOrigin(req)}/api/callback`;
    const currentUrl = new URL(
      `${callbackUrl}?${new URL(req.url, `http://${req.headers.host}`).searchParams}`,
    );
    const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: verifier,
      expectedNonce: nonce,
      expectedState,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims?.sub) throw new Error("Missing authenticated user claims");

    const userData = {
      id: claims.sub,
      email: (claims.email as string | undefined) ?? null,
      fullName:
        ((claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(" ")) as string | undefined) ?? null,
      profileImageUrl:
        ((claims.profile_image_url || claims.picture) as string | undefined) ?? null,
    };
    const login = await withAccountWriteFence(userData.id, async () => {
      const [deletedIdentity] = await db.select({ id: accountDeletionRequestsTable.id })
        .from(accountDeletionRequestsTable).where(and(
          eq(accountDeletionRequestsTable.accountHash, accountHash(userData.id)),
          sql`${accountDeletionRequestsTable.status} in ('processing', 'blocked', 'completed')`,
        )).limit(1);
      if (deletedIdentity) return undefined;
      const [dbUser] = await db
        .insert(usersTable)
        .values(userData)
        .onConflictDoUpdate({
          target: usersTable.id,
          set: { ...userData, updatedAt: new Date() },
        })
        .returning();
      const isAdmin = isAdminIdentity(dbUser.id, dbUser.email);
      if (loginIntent === "admin" && !isAdmin) return { unauthorized: true as const };
      const now = Math.floor(Date.now() / 1000);
      const session: SessionData = {
        user: {
          id: dbUser.id, email: dbUser.email, profileImageUrl: dbUser.profileImageUrl,
          fullName: dbUser.fullName, dateOfBirth: dbUser.dateOfBirth, gender: dbUser.gender,
          phone: dbUser.phone, onboardingCompleted: dbUser.onboardingCompleted, isAdmin,
        },
        authenticatedAt: Date.now(),
        access_token: tokens.access_token, refresh_token: tokens.refresh_token,
        expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
      };
      return { dbUser, sid: await createSession(session) };
    });
    if (!login) {
      clearOidcCookies(res);
      res.redirect(getCallbackFailureRedirect(loginIntent, returnTo));
      return;
    }
    if ("unauthorized" in login) {
      clearOidcCookies(res);
      res.redirect(getAdminAuthorizationFailureRedirect(returnTo));
      return;
    }
    setCookie(res, SESSION_COOKIE, login.sid, SESSION_TTL);
    await safelyRecordLogin(req, login.dbUser.id, "oidc");
    clearOidcCookies(res);
    res.redirect(returnTo);
  } catch (error) {
    req.log.warn(
      { errorName: error instanceof Error ? error.name : "Unknown" },
      "Browser authentication callback failed",
    );
    clearOidcCookies(res);
    res.redirect(getCallbackFailureRedirect(loginIntent, returnTo));
  }
});

router.get("/logout", async (req, res): Promise<void> => {
  const returnTo = getSafeReturnTo(req.query.returnTo);
  await clearSession(res, getSessionId(req));
  res.redirect(returnTo);
});

export default router;

async function withRequesterAdmission<T>(
  queues: Map<string, RequesterQueue>,
  requesterHash: string,
  maxPending: number,
  operation: () => Promise<T>,
): Promise<T | { status: "network_locked" }> {
  let queue = queues.get(requesterHash);
  if (!queue) {
    queue = { pending: 0, tail: Promise.resolve() };
    queues.set(requesterHash, queue);
  }
  if (queue.pending >= maxPending) {
    return { status: "network_locked" };
  }

  queue.pending += 1;
  const predecessor = queue.tail;
  let release!: () => void;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  queue.tail = predecessor.then(() => turn);

  await predecessor;
  try {
    return await operation();
  } finally {
    queue.pending -= 1;
    release();
    if (queue.pending === 0 && queues.get(requesterHash) === queue) {
      queues.delete(requesterHash);
    }
  }
}
