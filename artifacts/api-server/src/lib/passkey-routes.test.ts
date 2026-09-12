import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import {
  db,
  passkeyAuditEventsTable,
  passkeyChallengesTable,
  passkeyCredentialsTable,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  PASSKEY_CEREMONY_COOKIE,
  passkeyBrowserBindingMatches,
} from "./passkeys.js";
import { createSession } from "./auth.js";

process.env.SESSION_SECRET ??= "test-only-session-secret-that-is-at-least-32-characters";
process.env.NODE_ENV = "test";

const { default: app } = await import("../app.js");

test("invalid passkey configuration returns a controlled service response", async () => {
  const previousRpId = process.env.PASSKEY_RP_ID;
  const previousOrigin = process.env.PASSKEY_ORIGIN;
  process.env.PASSKEY_RP_ID = "example.test";
  process.env.PASSKEY_ORIGIN = "not-an-origin";
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/passkeys/authentication/options`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.test",
      },
      body: "{}",
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Passkey setup is temporarily unavailable. Please use email or PIN sign-in and try again later.",
      reason: "passkey_configuration_unavailable",
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    if (previousRpId === undefined) delete process.env.PASSKEY_RP_ID;
    else process.env.PASSKEY_RP_ID = previousRpId;
    if (previousOrigin === undefined) delete process.env.PASSKEY_ORIGIN;
    else process.env.PASSKEY_ORIGIN = previousOrigin;
  }
});

test("missing passkey schema returns a controlled service response", async () => {
  const previousRpId = process.env.PASSKEY_RP_ID;
  const previousOrigin = process.env.PASSKEY_ORIGIN;
  const mutableDb = db as unknown as { transaction: typeof db.transaction };
  const originalTransaction = mutableDb.transaction;
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  process.env.PASSKEY_RP_ID = "127.0.0.1";
  process.env.PASSKEY_ORIGIN = origin;
  mutableDb.transaction = (async () => {
    const error = new Error("sensitive missing relation detail") as Error & { code: string };
    error.code = "42P01";
    throw error;
  }) as typeof db.transaction;
  try {
    const response = await fetch(`${origin}/api/auth/passkeys/authentication/options`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: "{}",
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Passkey setup is temporarily unavailable. Please use email or PIN sign-in and try again later.",
      reason: "passkey_schema_unavailable",
    });
  } finally {
    mutableDb.transaction = originalTransaction;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    if (previousRpId === undefined) delete process.env.PASSKEY_RP_ID;
    else process.env.PASSKEY_RP_ID = previousRpId;
    if (previousOrigin === undefined) delete process.env.PASSKEY_ORIGIN;
    else process.env.PASSKEY_ORIGIN = previousOrigin;
  }
});

function base64url(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function createValidAssertion({
  challenge,
  counter = 1,
  credentialId,
  origin,
  privateKey,
  rpID,
  userId,
}: {
  challenge: string;
  counter?: number;
  credentialId: string;
  origin: string;
  privateKey: crypto.KeyObject;
  rpID: string;
  userId: string;
}) {
  const clientDataJSON = Buffer.from(JSON.stringify({
    type: "webauthn.get",
    challenge,
    origin,
    crossOrigin: false,
  }));
  const authenticatorData = Buffer.alloc(37);
  crypto.createHash("sha256").update(rpID).digest().copy(authenticatorData);
  authenticatorData[32] = 0x05;
  authenticatorData.writeUInt32BE(counter, 33);
  const signedData = Buffer.concat([
    authenticatorData,
    crypto.createHash("sha256").update(clientDataJSON).digest(),
  ]);
  const signature = crypto.sign("sha256", signedData, {
    key: privateKey,
    dsaEncoding: "der",
  });
  return {
    id: credentialId,
    rawId: credentialId,
    type: "public-key",
    clientExtensionResults: {},
    authenticatorAttachment: "platform",
    response: {
      authenticatorData: base64url(authenticatorData),
      clientDataJSON: base64url(clientDataJSON),
      signature: base64url(signature),
      userHandle: base64url(userId),
    },
  };
}

function createSyntheticCredential() {
  const id = base64url(crypto.randomBytes(32));
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const publicJwk = publicKey.export({ format: "jwk" });
  assert.ok(publicJwk.x && publicJwk.y);
  const credentialPublicKey = isoCBOR.encode(new Map<number, number | Uint8Array>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, Buffer.from(publicJwk.x, "base64url")],
    [-3, Buffer.from(publicJwk.y, "base64url")],
  ]));
  return { id, privateKey, publicKey: base64url(credentialPublicKey) };
}

function createValidRegistration({
  challenge,
  credential,
  origin,
  rpID,
}: {
  challenge: string;
  credential: ReturnType<typeof createSyntheticCredential>;
  origin: string;
  rpID: string;
}) {
  const credentialId = Buffer.from(credential.id, "base64url");
  const credentialPublicKey = Buffer.from(credential.publicKey, "base64url");
  const clientDataJSON = Buffer.from(JSON.stringify({
    type: "webauthn.create",
    challenge,
    origin,
    crossOrigin: false,
  }));
  const authenticatorData = Buffer.concat([
    crypto.createHash("sha256").update(rpID).digest(),
    Buffer.from([0x45]),
    Buffer.alloc(4),
    Buffer.alloc(16),
    Buffer.from([(credentialId.byteLength >> 8) & 0xff, credentialId.byteLength & 0xff]),
    credentialId,
    credentialPublicKey,
  ]);
  const attestationStatement = new Map<never, never>();
  const attestationObject = isoCBOR.encode(new Map<
    string | number,
    string | Uint8Array | Map<never, never>
  >([
    ["fmt", "none"],
    ["attStmt", attestationStatement],
    ["authData", new Uint8Array(authenticatorData)],
  ]));
  return {
    id: credential.id,
    rawId: credential.id,
    type: "public-key",
    clientExtensionResults: {},
    authenticatorAttachment: "platform",
    response: {
      clientDataJSON: base64url(clientDataJSON),
      attestationObject: base64url(attestationObject),
      transports: ["internal"],
    },
  };
}

test("authenticated passkey requests classify pre-router schema failures", async () => {
  const mutableDb = db as unknown as { select: typeof db.select };
  const originalSelect = mutableDb.select;
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  mutableDb.select = (() => {
    const error = new Error("sensitive sessions table detail") as Error & { code: string };
    error.code = "42P01";
    throw error;
  }) as typeof db.select;
  try {
    const response = await fetch(`${origin}/api/auth/passkeys/registration/options`, {
      method: "POST",
      headers: {
        cookie: "sid=missing-schema-session",
        "content-type": "application/json",
        origin,
      },
      body: "{}",
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Passkey setup is temporarily unavailable. Please use email or PIN sign-in and try again later.",
      reason: "passkey_schema_unavailable",
    });
  } finally {
    mutableDb.select = originalSelect;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("valid assertions are browser-bound and revocation leaves other credentials usable", async () => {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  const api = `${origin}/api`;
  const rpID = "127.0.0.1";
  process.env.PASSKEY_RP_ID = "127.0.0.1";
  process.env.PASSKEY_ORIGIN = origin;
  let challengeId = "";
  const extraChallengeIds: string[] = [];
  const sessionIds: string[] = [];
  const userId = crypto.randomUUID();
  const firstCredential = createSyntheticCredential();
  const secondCredential = createSyntheticCredential();
  const authUser = {
    id: userId,
    email: `passkey-route-${userId}@example.test`,
    profileImageUrl: null,
    fullName: "Passkey Route Test",
    dateOfBirth: null,
    gender: null,
    phone: null,
    onboardingCompleted: true,
    isAdmin: false,
  };

  try {
    await db.insert(usersTable).values({
      id: userId,
      email: authUser.email,
      emailVerifiedAt: new Date(),
      fullName: "Passkey Route Test",
      onboardingCompleted: true,
    });
    const managementSessionId = await createSession({
      user: authUser,
      emailStepUp: {
        userId,
        verifiedAt: Date.now(),
        method: "email_otp",
      },
    });
    sessionIds.push(managementSessionId);
    const registrationOptions = await fetch(`${api}/auth/passkeys/registration/options`, {
      method: "POST",
      headers: {
        cookie: `sid=${managementSessionId}`,
        "content-type": "application/json",
        origin,
      },
      body: "{}",
    });
    assert.equal(registrationOptions.status, 200);
    const registrationBody = await registrationOptions.json() as {
      challengeId: string;
      options: { challenge: string };
    };
    extraChallengeIds.push(registrationBody.challengeId);
    const registrationCookie = (registrationOptions.headers.get("set-cookie") ?? "").split(";")[0];
    const registration = await fetch(`${api}/auth/passkeys/registration/verify`, {
      method: "POST",
      headers: {
        cookie: `sid=${managementSessionId}; ${registrationCookie}`,
        "content-type": "application/json",
        origin,
      },
      body: JSON.stringify({
        challengeId: registrationBody.challengeId,
        name: "First synthetic authenticator",
        response: createValidRegistration({
          challenge: registrationBody.options.challenge,
          credential: firstCredential,
          origin,
          rpID,
        }),
      }),
    });
    assert.equal(registration.status, 201);
    const [registeredCredential] = await db
      .select()
      .from(passkeyCredentialsTable)
      .where(eq(passkeyCredentialsTable.id, firstCredential.id));
    assert.equal(registeredCredential.userId, userId);
    assert.equal(registeredCredential.name, "First synthetic authenticator");
    const [registrationAudit] = await db
      .select()
      .from(passkeyAuditEventsTable)
      .where(eq(passkeyAuditEventsTable.credentialId, firstCredential.id));
    assert.equal(registrationAudit.event, "registered");

    await db.insert(passkeyCredentialsTable).values([
      {
        id: secondCredential.id,
        userId,
        name: "Second synthetic authenticator",
        publicKey: secondCredential.publicKey,
        counter: 0,
        transports: ["internal"],
        deviceType: "singleDevice",
        backedUp: false,
      },
    ]);

    const crossSiteOptions = await fetch(`${api}/auth/passkeys/authentication/options`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://attacker.example",
      },
      body: "",
    });
    assert.equal(crossSiteOptions.status, 403);
    assert.equal(crossSiteOptions.headers.get("set-cookie"), null);

    const options = await fetch(`${api}/auth/passkeys/authentication/options`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: "{}",
    });
    assert.equal(options.status, 200);
    const body = await options.json() as { challengeId: string };
    challengeId = body.challengeId;
    assert.ok(challengeId);
    const cookie = (options.headers.get("set-cookie") ?? "").split(";")[0];
    assert.match(cookie, new RegExp(`^${PASSKEY_CEREMONY_COOKIE}=`));
    assert.match(options.headers.get("set-cookie") ?? "", /HttpOnly/i);
    assert.match(options.headers.get("set-cookie") ?? "", /SameSite=Strict/i);
    assert.match(options.headers.get("set-cookie") ?? "", /Secure/i);

    const [stored] = await db
      .select()
      .from(passkeyChallengesTable)
      .where(eq(passkeyChallengesTable.id, challengeId));
    assert.ok(stored);
    const cookieValue = cookie.slice(cookie.indexOf("=") + 1);
    assert.notEqual(stored.browserBindingHash, cookieValue);
    assert.equal(passkeyBrowserBindingMatches(cookieValue, stored.browserBindingHash), true);

    const validAssertion = {
      challengeId,
      response: createValidAssertion({
        challenge: stored.challenge,
        credentialId: firstCredential.id,
        origin,
        privateKey: firstCredential.privateKey,
        rpID,
        userId,
      }),
    };
    const crossSiteForm = await fetch(`${api}/auth/passkeys/authentication/verify`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://attacker.example",
      },
      body: new URLSearchParams({
        challengeId,
        response: JSON.stringify(validAssertion.response),
      }),
      redirect: "manual",
    });
    assert.equal(crossSiteForm.status, 403);
    assert.doesNotMatch(crossSiteForm.headers.get("set-cookie") ?? "", /sid=/);

    const anotherBrowser = await fetch(`${api}/auth/passkeys/authentication/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(validAssertion),
      redirect: "manual",
    });
    assert.equal(anotherBrowser.status, 401);
    assert.doesNotMatch(anotherBrowser.headers.get("set-cookie") ?? "", /sid=/);
    const [afterOtherBrowser] = await db
      .select()
      .from(passkeyChallengesTable)
      .where(eq(passkeyChallengesTable.id, challengeId));
    assert.equal(afterOtherBrowser.consumedAt, null);

    const initiatingBrowser = await fetch(`${api}/auth/passkeys/authentication/verify`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", origin },
      body: JSON.stringify(validAssertion),
      redirect: "manual",
    });
    assert.equal(initiatingBrowser.status, 200);
    const responseCookies = initiatingBrowser.headers.getSetCookie();
    assert.ok(responseCookies.some((value) => value.startsWith("sid=")));
    assert.match(
      responseCookies.find((value) => value.startsWith(`${PASSKEY_CEREMONY_COOKIE}=`)) ?? "",
      new RegExp(`^${PASSKEY_CEREMONY_COOKIE}=;`),
    );
    const sidCookie = responseCookies.find((value) => value.startsWith("sid="));
    assert.ok(sidCookie);
    const signedSessionId = decodeURIComponent(sidCookie.slice(4).split(";")[0]);
    assert.ok(signedSessionId);
    sessionIds.push(signedSessionId);
    const [afterInitiator] = await db
      .select()
      .from(passkeyChallengesTable)
      .where(eq(passkeyChallengesTable.id, challengeId));
    assert.ok(afterInitiator.consumedAt);

    const revoked = await fetch(`${api}/auth/passkeys/${encodeURIComponent(firstCredential.id)}`, {
      method: "DELETE",
      headers: {
        cookie: `sid=${managementSessionId}`,
        "content-type": "application/json",
        origin,
      },
      body: "{}",
    });
    assert.equal(revoked.status, 204);
    const [revokedCredential] = await db
      .select()
      .from(passkeyCredentialsTable)
      .where(eq(passkeyCredentialsTable.id, firstCredential.id));
    const [remainingCredential] = await db
      .select()
      .from(passkeyCredentialsTable)
      .where(eq(passkeyCredentialsTable.id, secondCredential.id));
    assert.ok(revokedCredential.revokedAt);
    assert.equal(remainingCredential.revokedAt, null);

    const revokedOptions = await fetch(`${api}/auth/passkeys/authentication/options`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: "{}",
    });
    assert.equal(revokedOptions.status, 200);
    const revokedOptionsBody = await revokedOptions.json() as { challengeId: string };
    extraChallengeIds.push(revokedOptionsBody.challengeId);
    const [revokedChallenge] = await db
      .select()
      .from(passkeyChallengesTable)
      .where(eq(passkeyChallengesTable.id, revokedOptionsBody.challengeId));
    assert.ok(revokedChallenge);
    const revokedLogin = await fetch(`${api}/auth/passkeys/authentication/verify`, {
      method: "POST",
      headers: {
        cookie: (revokedOptions.headers.get("set-cookie") ?? "").split(";")[0],
        "content-type": "application/json",
        origin,
      },
      body: JSON.stringify({
        challengeId: revokedOptionsBody.challengeId,
        response: createValidAssertion({
          challenge: revokedChallenge.challenge,
          counter: 2,
          credentialId: firstCredential.id,
          origin,
          privateKey: firstCredential.privateKey,
          rpID,
          userId,
        }),
      }),
    });
    assert.equal(revokedLogin.status, 401);
    assert.doesNotMatch(revokedLogin.headers.get("set-cookie") ?? "", /sid=/);

    const remainingOptions = await fetch(`${api}/auth/passkeys/authentication/options`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: "{}",
    });
    assert.equal(remainingOptions.status, 200);
    const remainingOptionsBody = await remainingOptions.json() as { challengeId: string };
    extraChallengeIds.push(remainingOptionsBody.challengeId);
    const [remainingChallenge] = await db
      .select()
      .from(passkeyChallengesTable)
      .where(eq(passkeyChallengesTable.id, remainingOptionsBody.challengeId));
    assert.ok(remainingChallenge);
    const remainingLogin = await fetch(`${api}/auth/passkeys/authentication/verify`, {
      method: "POST",
      headers: {
        cookie: (remainingOptions.headers.get("set-cookie") ?? "").split(";")[0],
        "content-type": "application/json",
        origin,
      },
      body: JSON.stringify({
        challengeId: remainingOptionsBody.challengeId,
        response: createValidAssertion({
          challenge: remainingChallenge.challenge,
          credentialId: secondCredential.id,
          origin,
          privateKey: secondCredential.privateKey,
          rpID,
          userId,
        }),
      }),
    });
    assert.equal(remainingLogin.status, 200);
    const remainingSidCookie = remainingLogin.headers
      .getSetCookie()
      .find((value) => value.startsWith("sid="));
    assert.ok(remainingSidCookie);
    sessionIds.push(decodeURIComponent(remainingSidCookie.slice(4).split(";")[0]));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    for (const sessionId of sessionIds) {
      await db.delete(sessionsTable).where(eq(sessionsTable.sid, sessionId));
    }
    if (challengeId) {
      await db.delete(passkeyChallengesTable).where(eq(passkeyChallengesTable.id, challengeId));
    }
    for (const extraChallengeId of extraChallengeIds) {
      await db.delete(passkeyChallengesTable).where(eq(passkeyChallengesTable.id, extraChallengeId));
    }
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    delete process.env.PASSKEY_RP_ID;
    delete process.env.PASSKEY_ORIGIN;
  }
});