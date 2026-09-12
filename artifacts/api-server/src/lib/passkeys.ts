import { getEnv } from "./env.js";
import type { Request } from "express";
import crypto from "node:crypto";
import { validatePasskeyConfiguration } from "@workspace/db/passkey-config";

export const PASSKEY_CEREMONY_COOKIE = "__Host-ezyretire-passkey";
export const PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const PASSKEY_RATE_WINDOW_MS = 10 * 60 * 1000;
export const PASSKEY_MAX_CHALLENGES_PER_NETWORK = 20;
export const RECENT_EMAIL_VERIFICATION_MS = 15 * 60 * 1000;
export const PASSKEY_CHALLENGE_RETENTION_MS = 24 * 60 * 60 * 1000;
export const PASSKEY_CLEANUP_BATCH_SIZE = 100;
export const PASSKEY_UNAVAILABLE_MESSAGE = "Passkey setup is temporarily unavailable. Please use email or PIN sign-in and try again later.";

export class PasskeyConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasskeyConfigurationError";
  }
}

export function isPasskeyPrerequisiteError(error: unknown): boolean {
  if (error instanceof PasskeyConfigurationError) return true;
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  return ["42P01", "42703", "42883"].includes(code);
}

export function passkeyUnavailableReason(
  error: unknown,
): "passkey_configuration_unavailable" | "passkey_schema_unavailable" {
  return error instanceof PasskeyConfigurationError
    ? "passkey_configuration_unavailable"
    : "passkey_schema_unavailable";
}

export type StoredPasskeyChallenge = {
  type: string;
  userId: string | null;
  consumedAt: Date | null;
  expiresAt: Date;
  rpId?: string;
  rpOrigin?: string;
};

export function createPasskeyBrowserBinding(): { value: string; hash: string } {
  const value = crypto.randomBytes(32).toString("base64url");
  return {
    value,
    hash: crypto.createHash("sha256").update(value).digest("hex"),
  };
}

export function passkeyBrowserBindingMatches(value: unknown, expectedHash: unknown): boolean {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(value) ||
    typeof expectedHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(expectedHash)
  ) return false;
  const actual = crypto.createHash("sha256").update(value).digest();
  const expected = Buffer.from(expectedHash, "hex");
  return crypto.timingSafeEqual(actual, expected);
}

export function isTrustedPasskeyMutation(req: Request, expectedOrigin: string): boolean {
  return req.headers.origin === expectedOrigin && Boolean(req.is("application/json"));
}

export function isPasskeyChallengeCleanupCandidate(
  challenge: { consumedAt: Date | null; expiresAt: Date; createdAt: Date },
  now = new Date(),
): boolean {
  return (
    challenge.expiresAt <= now &&
    challenge.createdAt <= new Date(now.getTime() - PASSKEY_RATE_WINDOW_MS)
  ) ||
    Boolean(challenge.consumedAt && challenge.consumedAt <= new Date(now.getTime() - PASSKEY_CHALLENGE_RETENTION_MS));
}

export function passkeyUserHandleMatches(userHandle: unknown, userId: string): boolean {
  if (typeof userHandle !== "string" || !/^[A-Za-z0-9_-]+$/.test(userHandle)) return false;
  try {
    const decoded = Buffer.from(userHandle, "base64url");
    if (!decoded.length) return false;
    const expected = Buffer.from(userId, "utf8");
    const actualDigest = crypto.createHash("sha256").update(decoded).digest();
    const expectedDigest = crypto.createHash("sha256").update(expected).digest();
    return crypto.timingSafeEqual(actualDigest, expectedDigest) && decoded.equals(expected);
  } catch {
    return false;
  }
}

export function isPasskeyChallengeUsable(
  challenge: StoredPasskeyChallenge | undefined,
  type: "registration" | "authentication",
  userId: string | null,
  now = new Date(),
): boolean {
  return Boolean(
    challenge &&
    challenge.type === type &&
    challenge.userId === userId &&
    !challenge.consumedAt &&
    challenge.expiresAt > now,
  );
}

export function isPasskeyChallengeRateLimited(count: number): boolean {
  return count >= PASSKEY_MAX_CHALLENGES_PER_NETWORK;
}

export function hasRecentEmailStepUp(
  evidence: { userId: string; verifiedAt: number; method: string } | undefined,
  userId: string,
  now = Date.now(),
): boolean {
  return Boolean(
    evidence &&
    evidence.method === "email_otp" &&
    evidence.userId === userId &&
    now - evidence.verifiedAt <= RECENT_EMAIL_VERIFICATION_MS &&
    evidence.verifiedAt <= now + 30_000,
  );
}

export function getPasskeyConfig(req: Request): { rpID: string; origin: string; rpName: string } {
  const configuredRpID = getEnv("PASSKEY_RP_ID")?.trim().toLowerCase();
  const configuredOrigin = getEnv("PASSKEY_ORIGIN")?.replace(/\/+$/, "");
  if (configuredRpID && configuredOrigin) {
    const validation = validatePasskeyConfiguration({
      rpID: configuredRpID,
      origin: configuredOrigin,
      requireHttps: process.env.NODE_ENV === "production",
    });
    if (validation.problems.length || !validation.origin) {
      throw new PasskeyConfigurationError(validation.problems[0] || "Passkey configuration is invalid");
    }
    return { rpID: validation.rpID, origin: validation.origin, rpName: "ezyRetire" };
  }
  if (configuredRpID || configuredOrigin || process.env.NODE_ENV === "production") {
    throw new PasskeyConfigurationError("PASSKEY_RP_ID and PASSKEY_ORIGIN must both be configured");
  }

  const host = (req.hostname || "").toLowerCase();
  const replitDevelopmentDomain = getEnv("REPLIT_DEV_DOMAIN")?.trim().toLowerCase();
  if (
    process.env.NODE_ENV === "development" &&
    replitDevelopmentDomain &&
    host === replitDevelopmentDomain
  ) {
    return {
      rpID: replitDevelopmentDomain,
      origin: `https://${replitDevelopmentDomain}`,
      rpName: "ezyRetire (development)",
    };
  }
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new PasskeyConfigurationError("Passkeys require explicit PASSKEY_RP_ID and PASSKEY_ORIGIN outside localhost");
  }
  const port = req.socket.localPort;
  const origin = `http://${host}${port && port !== 80 ? `:${port}` : ""}`;
  return { rpID: host, origin, rpName: "ezyRetire (development)" };
}