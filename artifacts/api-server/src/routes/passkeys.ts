import crypto from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import {
  db,
  accountDeletionRequestsTable,
  passkeyAuditEventsTable,
  passkeyChallengesTable,
  passkeyCredentialsTable,
  usersTable,
} from "@workspace/db";
import { and, count, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  createSession,
  getSession,
  getSessionId,
  isAdminIdentity,
  SESSION_COOKIE,
  SESSION_TTL,
} from "../lib/auth.js";
import { hashRequester } from "../lib/email-otp.js";
import { recordLoginActivity } from "../lib/login-activity.js";
import { accountHash, withAccountWriteFence } from "../lib/account-compliance.js";
import {
  createPasskeyBrowserBinding,
  getPasskeyConfig,
  isTrustedPasskeyMutation,
  passkeyBrowserBindingMatches,
  PASSKEY_CEREMONY_COOKIE,
  PASSKEY_CHALLENGE_TTL_MS,
  PASSKEY_RATE_WINDOW_MS,
  PASSKEY_CLEANUP_BATCH_SIZE,
  PASSKEY_CHALLENGE_RETENTION_MS,
  isPasskeyChallengeRateLimited,
  isPasskeyChallengeCleanupCandidate,
  isPasskeyChallengeUsable,
  hasRecentEmailStepUp,
  passkeyUserHandleMatches,
  PasskeyConfigurationError,
  isPasskeyPrerequisiteError,
  passkeyUnavailableReason,
  PASSKEY_UNAVAILABLE_MESSAGE,
} from "../lib/passkeys.js";

const router: IRouter = Router();

const passkeyCeremonyCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  path: "/",
};

function requesterHash(req: Request): string {
  return hashRequester(req.ip || "unknown");
}

function credentialView(row: typeof passkeyCredentialsTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    transports: row.transports,
    deviceType: row.deviceType,
    backedUp: row.backedUp,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

function passkeyName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length >= 1 && name.length <= 80 ? name : null;
}

function userForSession(user: typeof usersTable.$inferSelect) {
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

async function requireRecentEmailVerification(req: Request, res: Response) {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Login required" });
    return null;
  }
  const sid = getSessionId(req);
  const session = sid ? await getSession(sid) : null;
  const evidence = session?.emailStepUp;
  if (!hasRecentEmailStepUp(evidence, req.user.id)) {
    res.status(403).json({
      error: "Verify your email in this session before managing passkeys",
      reason: "current_session_email_verification_required",
    });
    return null;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id));
  if (!user) {
    res.status(401).json({ error: "Account not found" });
    return null;
  }
  return user;
}

function requireTrustedMutation(
  req: Request,
  res: Response,
  config: ReturnType<typeof getPasskeyConfig>,
): boolean {
  if (isTrustedPasskeyMutation(req, config.origin)) return true;
  res.status(403).json({ error: "Passkey request could not be verified" });
  return false;
}

function setPasskeyCeremonyCookie(res: Response, value: string): void {
  res.cookie(PASSKEY_CEREMONY_COOKIE, value, {
    ...passkeyCeremonyCookieOptions,
    maxAge: PASSKEY_CHALLENGE_TTL_MS,
  });
}

function takePasskeyCeremonyCookie(req: Request, res: Response): unknown {
  const value = req.cookies?.[PASSKEY_CEREMONY_COOKIE];
  res.clearCookie(PASSKEY_CEREMONY_COOKIE, passkeyCeremonyCookieOptions);
  return value;
}

async function issueChallenge(
  req: Request,
  res: Response,
  type: "registration" | "authentication",
  challenge: string,
  userId: string | null,
  rpId: string,
  rpOrigin: string,
  browserBindingHash: string,
): Promise<string | null> {
  const network = requesterHash(req);
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${network}:${type}`}))`);
    const cleanupCandidates = await tx
      .select({
        id: passkeyChallengesTable.id,
        consumedAt: passkeyChallengesTable.consumedAt,
        expiresAt: passkeyChallengesTable.expiresAt,
        createdAt: passkeyChallengesTable.createdAt,
      })
      .from(passkeyChallengesTable)
      .where(or(
        and(
          lte(passkeyChallengesTable.expiresAt, now),
          lte(passkeyChallengesTable.createdAt, new Date(now.getTime() - PASSKEY_RATE_WINDOW_MS)),
        ),
        lt(passkeyChallengesTable.consumedAt, new Date(now.getTime() - PASSKEY_CHALLENGE_RETENTION_MS)),
      ))
      .limit(PASSKEY_CLEANUP_BATCH_SIZE);
    const idsToDelete = cleanupCandidates
      .filter((candidate) => isPasskeyChallengeCleanupCandidate(candidate, now))
      .map((candidate) => candidate.id);
    if (idsToDelete.length) {
      await tx.delete(passkeyChallengesTable).where(inArray(passkeyChallengesTable.id, idsToDelete));
    }
    const [{ total }] = await tx
      .select({ total: count() })
      .from(passkeyChallengesTable)
      .where(and(
        eq(passkeyChallengesTable.requesterHash, network),
        eq(passkeyChallengesTable.type, type),
        gt(passkeyChallengesTable.createdAt, new Date(now.getTime() - PASSKEY_RATE_WINDOW_MS)),
      ));
    if (isPasskeyChallengeRateLimited(total)) return null;
    const id = crypto.randomUUID();
    await tx.insert(passkeyChallengesTable).values({
      id,
      type,
      challenge,
      rpId,
      rpOrigin,
      browserBindingHash,
      userId,
      requesterHash: network,
      expiresAt: new Date(now.getTime() + PASSKEY_CHALLENGE_TTL_MS),
    });
    return id;
  });
  if (!result) res.status(429).json({ error: "Too many passkey attempts. Try again later." });
  return result;
}

router.post("/auth/passkeys/registration/options", async (req, res): Promise<void> => {
  const user = await requireRecentEmailVerification(req, res);
  if (!user) return;
  const config = getPasskeyConfig(req);
  if (!requireTrustedMutation(req, res, config)) return;
  const credentials = await db
    .select()
    .from(passkeyCredentialsTable)
    .where(and(eq(passkeyCredentialsTable.userId, user.id), isNull(passkeyCredentialsTable.revokedAt)));
  const options = await generateRegistrationOptions({
    ...config,
    userID: new TextEncoder().encode(user.id),
    userName: user.email ?? user.id,
    userDisplayName: user.fullName ?? user.email ?? "ezyRetire customer",
    attestationType: "none",
    timeout: PASSKEY_CHALLENGE_TTL_MS,
    excludeCredentials: credentials.map((credential) => ({
      id: credential.id,
      transports: credential.transports,
    })),
    authenticatorSelection: {
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    },
  });
  const browserBinding = createPasskeyBrowserBinding();
  const challengeId = await issueChallenge(
    req,
    res,
    "registration",
    options.challenge,
    user.id,
    config.rpID,
    config.origin,
    browserBinding.hash,
  );
  if (!challengeId) return;
  setPasskeyCeremonyCookie(res, browserBinding.value);
  res.json({ challengeId, options });
});

router.post("/auth/passkeys/registration/verify", async (req, res): Promise<void> => {
  const user = await requireRecentEmailVerification(req, res);
  if (!user) return;
  const config = getPasskeyConfig(req);
  if (!requireTrustedMutation(req, res, config)) return;
  const browserBinding = takePasskeyCeremonyCookie(req, res);
  const name = passkeyName(req.body?.name);
  const challengeId = typeof req.body?.challengeId === "string" ? req.body.challengeId : "";
  const response = req.body?.response as RegistrationResponseJSON | undefined;
  if (!name || !challengeId || !response?.id) {
    res.status(400).json({ error: "A valid passkey name and response are required" });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [challenge] = await tx
      .select()
      .from(passkeyChallengesTable)
      .where(eq(passkeyChallengesTable.id, challengeId))
      .for("update");
    if (
      !isPasskeyChallengeUsable(challenge, "registration", user.id) ||
      challenge.rpId !== config.rpID ||
      challenge.rpOrigin !== config.origin ||
      !passkeyBrowserBindingMatches(browserBinding, challenge.browserBindingHash)
    ) return null;
    const consumedAt = new Date();
    await tx.update(passkeyChallengesTable).set({ consumedAt }).where(eq(passkeyChallengesTable.id, challenge.id));
    try {
      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpID,
        requireUserPresence: true,
        requireUserVerification: true,
      });
      if (!verification.verified) return null;
      const info = verification.registrationInfo;
      const [credential] = await tx.insert(passkeyCredentialsTable).values({
        id: info.credential.id,
        userId: user.id,
        name,
        publicKey: Buffer.from(info.credential.publicKey).toString("base64url"),
        counter: info.credential.counter,
        transports: response.response.transports ?? [],
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
      }).onConflictDoNothing().returning();
      if (!credential) return null;
      await tx.insert(passkeyAuditEventsTable).values({
        userId: user.id,
        credentialId: credential.id,
        event: "registered",
      });
      return credential;
    } catch (error) {
      if (isPasskeyPrerequisiteError(error)) throw error;
      return null;
    }
  });
  if (!result) {
    res.status(400).json({ error: "Passkey registration could not be verified" });
    return;
  }
  res.status(201).json({ credential: credentialView(result) });
});

router.post("/auth/passkeys/authentication/options", async (req, res): Promise<void> => {
  const config = getPasskeyConfig(req);
  if (!requireTrustedMutation(req, res, config)) return;
  const options = await generateAuthenticationOptions({
    rpID: config.rpID,
    timeout: PASSKEY_CHALLENGE_TTL_MS,
    userVerification: "required",
    allowCredentials: [],
  });
  const browserBinding = createPasskeyBrowserBinding();
  const challengeId = await issueChallenge(
    req,
    res,
    "authentication",
    options.challenge,
    null,
    config.rpID,
    config.origin,
    browserBinding.hash,
  );
  if (!challengeId) return;
  setPasskeyCeremonyCookie(res, browserBinding.value);
  res.json({ challengeId, options });
});

router.post("/auth/passkeys/authentication/verify", async (req, res): Promise<void> => {
  const config = getPasskeyConfig(req);
  if (!requireTrustedMutation(req, res, config)) return;
  const browserBinding = takePasskeyCeremonyCookie(req, res);
  const challengeId = typeof req.body?.challengeId === "string" ? req.body.challengeId : "";
  const response = req.body?.response as AuthenticationResponseJSON | undefined;
  if (!challengeId || !response?.id) {
    res.status(400).json({ error: "A valid passkey response is required" });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [challenge] = await tx.select().from(passkeyChallengesTable)
      .where(eq(passkeyChallengesTable.id, challengeId)).for("update");
    if (
      !isPasskeyChallengeUsable(challenge, "authentication", null) ||
      challenge.rpId !== config.rpID ||
      challenge.rpOrigin !== config.origin ||
      !passkeyBrowserBindingMatches(browserBinding, challenge.browserBindingHash) ||
      typeof response.response.userHandle !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(response.response.userHandle)
    ) return null;
    await tx.update(passkeyChallengesTable).set({ consumedAt: new Date() })
      .where(eq(passkeyChallengesTable.id, challenge.id));
    const [credential] = await tx.select().from(passkeyCredentialsTable)
      .where(and(eq(passkeyCredentialsTable.id, response.id), isNull(passkeyCredentialsTable.revokedAt)))
      .for("update");
    if (!credential) return null;
    if (!passkeyUserHandleMatches(response.response.userHandle, credential.userId)) return null;
    try {
      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpID,
        requireUserVerification: true,
        credential: {
          id: credential.id,
          publicKey: Buffer.from(credential.publicKey, "base64url"),
          counter: credential.counter,
          transports: credential.transports,
        },
      });
      if (!verification.verified || !verification.authenticationInfo.userVerified) return null;
      const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, credential.userId));
      if (!user) return null;
      await tx.update(passkeyCredentialsTable).set({
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(passkeyCredentialsTable.id, credential.id));
      await tx.insert(passkeyAuditEventsTable).values({
        userId: user.id,
        credentialId: credential.id,
        event: "authenticated",
      });
      return user;
    } catch (error) {
      if (isPasskeyPrerequisiteError(error)) throw error;
      return null;
    }
  });
  if (!result) {
    // Deliberately identical for unknown, revoked, expired, replayed, and invalid credentials.
    res.status(401).json({ error: "Passkey sign-in could not be verified" });
    return;
  }
  const sid = await withAccountWriteFence(result.id, async () => {
    const [current] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.id, result.id)).limit(1);
    const [denied] = await db.select({ id: accountDeletionRequestsTable.id })
      .from(accountDeletionRequestsTable).where(and(
        eq(accountDeletionRequestsTable.accountHash, accountHash(result.id)),
        sql`${accountDeletionRequestsTable.status} in ('processing', 'blocked', 'completed')`,
      )).limit(1);
    if (!current || denied) return undefined;
    return createSession({ user: userForSession(result) });
  });
  if (!sid) {
    res.status(401).json({ error: "Passkey sign-in could not be verified" });
    return;
  }
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
  try {
    await recordLoginActivity(req, result.id, "passkey");
  } catch (error) {
    req.log.warn({ errorName: error instanceof Error ? error.name : "Unknown" }, "Passkey login activity could not be recorded");
  }
  res.json({ user: userForSession(result), needsProfile: !result.onboardingCompleted });
});

router.get("/auth/passkeys", async (req, res): Promise<void> => {
  const user = await requireRecentEmailVerification(req, res);
  if (!user) return;
  const credentials = await db.select().from(passkeyCredentialsTable)
    .where(and(eq(passkeyCredentialsTable.userId, user.id), isNull(passkeyCredentialsTable.revokedAt)))
    .orderBy(desc(passkeyCredentialsTable.createdAt));
  res.json({ credentials: credentials.map(credentialView) });
});

router.patch("/auth/passkeys/:id", async (req, res): Promise<void> => {
  const user = await requireRecentEmailVerification(req, res);
  if (!user) return;
  const config = getPasskeyConfig(req);
  if (!requireTrustedMutation(req, res, config)) return;
  const name = passkeyName(req.body?.name);
  if (!name) {
    res.status(400).json({ error: "Passkey name must be between 1 and 80 characters" });
    return;
  }
  const credential = await db.transaction(async (tx) => {
    const [updated] = await tx.update(passkeyCredentialsTable).set({ name, updatedAt: new Date() })
      .where(and(
        eq(passkeyCredentialsTable.id, req.params.id),
        eq(passkeyCredentialsTable.userId, user.id),
        isNull(passkeyCredentialsTable.revokedAt),
      )).returning();
    if (updated) {
      await tx.insert(passkeyAuditEventsTable).values({
        userId: user.id,
        credentialId: updated.id,
        event: "renamed",
      });
    }
    return updated;
  });
  if (!credential) {
    res.status(404).json({ error: "Passkey not found" });
    return;
  }
  res.json({ credential: credentialView(credential) });
});

router.delete("/auth/passkeys/:id", async (req, res): Promise<void> => {
  const user = await requireRecentEmailVerification(req, res);
  if (!user) return;
  const config = getPasskeyConfig(req);
  if (!requireTrustedMutation(req, res, config)) return;
  const credential = await db.transaction(async (tx) => {
    const [updated] = await tx.update(passkeyCredentialsTable)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(passkeyCredentialsTable.id, req.params.id),
        eq(passkeyCredentialsTable.userId, user.id),
        isNull(passkeyCredentialsTable.revokedAt),
      )).returning();
    if (updated) {
      await tx.insert(passkeyAuditEventsTable).values({
        userId: user.id,
        credentialId: updated.id,
        event: "revoked",
      });
    }
    return updated;
  });
  if (!credential) {
    res.status(404).json({ error: "Passkey not found" });
    return;
  }
  res.status(204).end();
});

router.use((error: unknown, req: Request, res: Response, next: (error?: unknown) => void) => {
  if (!isPasskeyPrerequisiteError(error) || res.headersSent) {
    next(error);
    return;
  }
  req.log.error({
    errorName: error instanceof Error ? error.name : "Unknown",
    errorCode: typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined,
  }, "Passkey prerequisite unavailable");
  res.status(503).json({
    error: PASSKEY_UNAVAILABLE_MESSAGE,
      reason: passkeyUnavailableReason(error),
  });
});

export default router;