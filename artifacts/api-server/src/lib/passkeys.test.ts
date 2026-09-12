import assert from "node:assert/strict";
import test from "node:test";
import { generateAuthenticationOptions, generateRegistrationOptions } from "@simplewebauthn/server";
import {
  getPasskeyConfig,
  createPasskeyBrowserBinding,
  isTrustedPasskeyMutation,
  isPasskeyChallengeRateLimited,
  isPasskeyChallengeUsable,
  hasRecentEmailStepUp,
  passkeyUserHandleMatches,
  passkeyBrowserBindingMatches,
  isPasskeyChallengeCleanupCandidate,
  PASSKEY_MAX_CHALLENGES_PER_NETWORK,
} from "./passkeys.js";

function request(hostname: string, localPort = 3000) {
  return { hostname, socket: { localPort } } as never;
}

test("passkey ceremonies always require discoverability and user verification", async () => {
  const registration = await generateRegistrationOptions({
    rpID: "example.com",
    rpName: "test",
    userID: new TextEncoder().encode("customer-1"),
    userName: "customer@example.com",
    authenticatorSelection: {
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    },
  });
  assert.equal(registration.authenticatorSelection?.residentKey, "required");
  assert.equal(registration.authenticatorSelection?.requireResidentKey, true);
  assert.equal(registration.authenticatorSelection?.userVerification, "required");

  const authentication = await generateAuthenticationOptions({
    rpID: "example.com",
    allowCredentials: [],
    userVerification: "required",
  });
  assert.deepEqual(authentication.allowCredentials, []);
  assert.equal(authentication.userVerification, "required");
});

test("passkey challenge lifecycle rejects replay, expiry, wrong ceremony, and wrong owner", () => {
  const now = new Date("2030-01-01T00:00:00Z");
  const valid = {
    type: "registration",
    userId: "customer-1",
    consumedAt: null,
    expiresAt: new Date(now.getTime() + 1_000),
  };
  assert.equal(isPasskeyChallengeUsable(valid, "registration", "customer-1", now), true);
  assert.equal(isPasskeyChallengeUsable({ ...valid, consumedAt: now }, "registration", "customer-1", now), false);
  assert.equal(isPasskeyChallengeUsable({ ...valid, expiresAt: now }, "registration", "customer-1", now), false);
  assert.equal(isPasskeyChallengeUsable(valid, "authentication", "customer-1", now), false);
  assert.equal(isPasskeyChallengeUsable(valid, "registration", "customer-2", now), false);
});

test("passkey ceremonies are bound to one browser without storing its cookie", () => {
  const first = createPasskeyBrowserBinding();
  const second = createPasskeyBrowserBinding();
  assert.match(first.value, /^[A-Za-z0-9_-]{43}$/);
  assert.match(first.hash, /^[a-f0-9]{64}$/);
  assert.equal(first.hash.includes(first.value), false);
  assert.equal(passkeyBrowserBindingMatches(first.value, first.hash), true);
  assert.equal(passkeyBrowserBindingMatches(second.value, first.hash), false);
  assert.equal(passkeyBrowserBindingMatches(undefined, first.hash), false);
  assert.equal(passkeyBrowserBindingMatches(first.value, "invalid"), false);
});

test("passkey browser mutations require exact Origin and JSON", () => {
  const request = (origin?: string, json = true) => ({
    headers: origin ? { origin } : {},
    is: () => json ? "application/json" : false,
  }) as never;
  assert.equal(isTrustedPasskeyMutation(
    request("https://app.example.com"),
    "https://app.example.com",
  ), true);
  assert.equal(isTrustedPasskeyMutation(
    request("https://attacker.example"),
    "https://app.example.com",
  ), false);
  assert.equal(isTrustedPasskeyMutation(
    request("https://app.example.com", false),
    "https://app.example.com",
  ), false);
  assert.equal(isTrustedPasskeyMutation(
    request(),
    "https://app.example.com",
  ), false);
});

test("passkey challenge rate limit closes at the configured boundary", () => {
  assert.equal(isPasskeyChallengeRateLimited(PASSKEY_MAX_CHALLENGES_PER_NETWORK - 1), false);
  assert.equal(isPasskeyChallengeRateLimited(PASSKEY_MAX_CHALLENGES_PER_NETWORK), true);
});

test("management step-up proof is bound to the current OTP-created session and customer", () => {
  const now = Date.parse("2030-01-01T00:00:00Z");
  const proof = { userId: "customer-1", verifiedAt: now - 1_000, method: "email_otp" };
  assert.equal(hasRecentEmailStepUp(proof, "customer-1", now), true);
  assert.equal(hasRecentEmailStepUp(undefined, "customer-1", now), false);
  assert.equal(hasRecentEmailStepUp({ ...proof, method: "oidc" }, "customer-1", now), false);
  assert.equal(hasRecentEmailStepUp({ ...proof, userId: "customer-2" }, "customer-1", now), false);
  assert.equal(hasRecentEmailStepUp({ ...proof, verifiedAt: now - 16 * 60 * 1000 }, "customer-1", now), false);
});

test("discoverable user handles require canonical UTF-8 owner IDs", () => {
  const encoded = Buffer.from("customer-1", "utf8").toString("base64url");
  assert.equal(passkeyUserHandleMatches(encoded, "customer-1"), true);
  assert.equal(passkeyUserHandleMatches(Buffer.from("customer-2").toString("base64url"), "customer-1"), false);
  assert.equal(passkeyUserHandleMatches("not base64!", "customer-1"), false);
  assert.equal(passkeyUserHandleMatches(null, "customer-1"), false);
});

test("challenge cleanup retains expired rows throughout the issuance rate window", () => {
  const now = new Date("2030-01-01T00:00:00Z");
  assert.equal(isPasskeyChallengeCleanupCandidate({
    expiresAt: new Date(now.getTime() - 60_000),
    createdAt: new Date(now.getTime() - 6 * 60_000),
    consumedAt: null,
  }, now), false);
  assert.equal(isPasskeyChallengeCleanupCandidate({
    expiresAt: new Date(now.getTime() - 5 * 60_000),
    createdAt: new Date(now.getTime() - 10 * 60_000),
    consumedAt: null,
  }, now), true);
  assert.equal(isPasskeyChallengeCleanupCandidate({
    expiresAt: new Date("2030-01-02"),
    createdAt: new Date("2029-12-30"),
    consumedAt: new Date("2029-12-30"),
  }, now), true);
  assert.equal(isPasskeyChallengeCleanupCandidate({
    expiresAt: new Date("2030-01-02"),
    createdAt: new Date("2029-12-31T12:00:00Z"),
    consumedAt: new Date("2029-12-31T12:00:00Z"),
  }, now), false);
});

test("passkey relying-party configuration is explicit except safe localhost development", () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    rpID: process.env.PASSKEY_RP_ID,
    origin: process.env.PASSKEY_ORIGIN,
    replitDevelopmentDomain: process.env.REPLIT_DEV_DOMAIN,
  };
  try {
    process.env.NODE_ENV = "development";
    delete process.env.PASSKEY_RP_ID;
    delete process.env.PASSKEY_ORIGIN;
    assert.deepEqual(getPasskeyConfig(request("localhost", 3000)), {
      rpID: "localhost",
      origin: "http://localhost:3000",
      rpName: "ezyRetire (development)",
    });
    process.env.REPLIT_DEV_DOMAIN = "preview.replit.dev";
    assert.deepEqual(getPasskeyConfig(request("preview.replit.dev")), {
      rpID: "preview.replit.dev",
      origin: "https://preview.replit.dev",
      rpName: "ezyRetire (development)",
    });
    assert.throws(() => getPasskeyConfig(request("preview.example.com")), /explicit/);
    process.env.NODE_ENV = "production";
    assert.throws(() => getPasskeyConfig(request("localhost")), /must both be configured/);
    process.env.PASSKEY_RP_ID = "example.com";
    process.env.PASSKEY_ORIGIN = "http://example.com";
    assert.throws(() => getPasskeyConfig(request("example.com")), /HTTPS/);
    process.env.PASSKEY_ORIGIN = "https://login.example.com";
    assert.equal(getPasskeyConfig(request("example.com")).origin, "https://login.example.com");
  } finally {
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.rpID === undefined) delete process.env.PASSKEY_RP_ID;
    else process.env.PASSKEY_RP_ID = previous.rpID;
    if (previous.origin === undefined) delete process.env.PASSKEY_ORIGIN;
    else process.env.PASSKEY_ORIGIN = previous.origin;
    if (previous.replitDevelopmentDomain === undefined) delete process.env.REPLIT_DEV_DOMAIN;
    else process.env.REPLIT_DEV_DOMAIN = previous.replitDevelopmentDomain;
  }
});