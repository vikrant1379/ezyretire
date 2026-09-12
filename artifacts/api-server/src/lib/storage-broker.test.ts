import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import {
  db, usersTable, vaultDeletionJobsTable, vaultDocumentsTable, vaultUploadGrantsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import storageBrokerRouter, { setStorageBrokerNowForTests } from "../routes/storage-broker.js";
import { runVaultDeletionMaintenance } from "../routes/premium-tools.js";
import {
  assertVaultObject,
  brokerSignature,
  canonicalStorageBrokerBody,
  createVaultUploadUrl,
  deleteVaultObject,
  fenceVaultObjectPath,
  markVaultOwner,
  promoteVaultObject,
  setVaultFileForTests,
  signedVaultReadUrl,
} from "./object-storage.js";

test("storage broker assertions expire, reject tampering, and consume nonces once", async () => {
  const previousSecret = process.env.STORAGE_BROKER_SECRET;
  const previousVercel = process.env.VERCEL;
  process.env.STORAGE_BROKER_SECRET = "broker-test-secret-with-sufficient-entropy";
  delete process.env.VERCEL;
  const ownerId = `broker-owner-${randomUUID()}`;
  await db.insert(usersTable).values({ id: ownerId });
  const objectPath = `/objects/vault-documents/${randomUUID()}`;
  await db.insert(vaultDeletionJobsTable).values({
    userId: ownerId, objectPath, reason: "promotion_cleanup_settle",
    finalizeAfter: new Date(Date.now() + 10 * 60_000),
  });
  let fenceWrites = 0;
  setVaultFileForTests(() => ({
    exists: async () => [false],
    save: async () => { fenceWrites += 1; },
  } as never));
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use("/api", storageBrokerRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/api/internal/storage-broker`;
  const request = (body: Record<string, unknown>, timestamp: string, nonce: string, signature?: string) => {
    const canonical = canonicalStorageBrokerBody(body);
    return fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-storage-timestamp": timestamp,
        "x-storage-nonce": nonce,
        ...(signature ? { "x-storage-signature": signature } : {}),
      },
      body: canonical,
    });
  };
  try {
    const body = {
      action: "fence",
      ownerId,
      objectPath,
    };
    const timestamp = String(Date.now());
    const nonce = randomUUID();
    const signature = brokerSignature(timestamp, nonce, canonicalStorageBrokerBody(body));
    assert.equal((await request(body, timestamp, nonce)).status, 401);
    assert.equal((await request({ ...body, ownerId: "tampered" }, timestamp, nonce, signature)).status, 401);
    const expiredTime = String(Date.now() - 61_000);
    const expiredNonce = randomUUID();
    assert.equal((await request(body, expiredTime, expiredNonce,
      brokerSignature(expiredTime, expiredNonce, canonicalStorageBrokerBody(body)))).status, 401);

    const concurrentNonce = randomUUID();
    const concurrentTime = String(Date.now());
    const concurrentSignature = brokerSignature(
      concurrentTime, concurrentNonce, canonicalStorageBrokerBody(body),
    );
    const statuses = await Promise.all([
      request(body, concurrentTime, concurrentNonce, concurrentSignature),
      request(body, concurrentTime, concurrentNonce, concurrentSignature),
    ]);
    assert.deepEqual(statuses.map(({ status }) => status).sort(), [200, 401]);
    assert.equal((await request(body, concurrentTime, concurrentNonce, concurrentSignature)).status, 401);
    assert.equal(fenceWrites, 1);

    const delayedTime = Date.now();
    const delayedNonce = randomUUID();
    const delayedSignature = brokerSignature(
      String(delayedTime), delayedNonce, canonicalStorageBrokerBody(body),
    );
    const clock = [delayedTime, delayedTime, delayedTime + 61_000];
    setStorageBrokerNowForTests(() => clock.shift() ?? delayedTime + 61_000);
    assert.equal((await request(body, String(delayedTime), delayedNonce, delayedSignature)).status, 401);
    setStorageBrokerNowForTests(() => delayedTime);
    assert.equal((await request(body, String(delayedTime), delayedNonce, delayedSignature)).status, 401);
    const freshNonce = randomUUID();
    assert.equal((await request(body, String(delayedTime), freshNonce,
      brokerSignature(String(delayedTime), freshNonce, canonicalStorageBrokerBody(body)))).status, 200);
    assert.equal(fenceWrites, 2);
    setStorageBrokerNowForTests();

    process.env.VERCEL = "1";
    const disabledNonce = randomUUID();
    const disabledTime = String(Date.now());
    assert.equal((await request(body, disabledTime, disabledNonce,
      brokerSignature(disabledTime, disabledNonce, canonicalStorageBrokerBody(body)))).status, 404);
  } finally {
    server.close();
    setVaultFileForTests();
    setStorageBrokerNowForTests();
    await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    if (previousSecret === undefined) delete process.env.STORAGE_BROKER_SECRET;
    else process.env.STORAGE_BROKER_SECRET = previousSecret;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});

test("Vercel storage adapter uses only the signed HTTPS broker", async () => {
  const previous = {
    vercel: process.env.VERCEL,
    origin: process.env.REPLIT_STORAGE_BROKER_ORIGIN,
    token: process.env.PUBLISHED_SITE_ACCESS_TOKEN,
    secret: process.env.STORAGE_BROKER_SECRET,
  };
  const originalFetch = globalThis.fetch;
  process.env.VERCEL = "1";
  process.env.REPLIT_STORAGE_BROKER_ORIGIN = "https://broker.example";
  process.env.PUBLISHED_SITE_ACCESS_TOKEN = "private-bypass-token";
  process.env.STORAGE_BROKER_SECRET = "adapter-test-secret-with-sufficient-entropy";
  const calls: Array<{
    url: string;
    body: Record<string, unknown>;
    headers: Record<string, string>;
  }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({
      url,
      body,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    const payload = body.action === "metadata"
      ? { generation: "123" }
      : body.action === "sign_upload" || body.action === "sign_read"
        ? { signedUrl: "https://storage.googleapis.com/private-bucket/signed-object?signature=test" }
        : { ok: true };
    return new Response(JSON.stringify(payload), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const ownerId = "adapter-owner";
    const upload = await createVaultUploadUrl(ownerId, "receipt_review", 123, "image/png");
    const handle = await assertVaultObject(
      upload.objectPath, 123, "image/png", undefined, ownerId, "receipt_review",
    );
    await markVaultOwner(handle, ownerId);
    const destination = `/objects/vault-documents/${randomUUID()}`;
    await promoteVaultObject(handle, upload.objectPath, destination, ownerId);
    await fenceVaultObjectPath(destination, ownerId);
    await deleteVaultObject(destination, ownerId);
    await signedVaultReadUrl(ownerId, destination);
    assert.ok(calls.every(({ url }) =>
      url === "https://broker.example/api/internal/storage-broker"));
    assert.ok(calls.every(({ url }) => !url.includes("127.0.0.1:1106")));
    assert.deepEqual(calls.map(({ body }) => body.action), [
      "sign_upload", "metadata", "mark_owner", "promote", "fence", "delete", "sign_read",
    ]);
    assert.ok(calls.every(({ body }) => body.ownerId === ownerId));
    assert.equal(JSON.stringify(calls.map(({ body }) => body)).includes("private-bypass-token"), false);
    assert.ok(calls.every(({ headers }) =>
      headers.authorization === "Bearer private-bypass-token"));

    delete process.env.PUBLISHED_SITE_ACCESS_TOKEN;
    await signedVaultReadUrl(ownerId, destination);
    assert.equal(calls.at(-1)?.headers.authorization, undefined);

    globalThis.fetch = (async () => new Response(null, {
      status: 302, headers: { location: "https://hostile.example/" },
    })) as typeof fetch;
    await assert.rejects(
      createVaultUploadUrl(ownerId, "vault_document", 1, "image/png"),
      /redirect rejected/,
    );
    for (const hostile of [
      "https://user@storage.googleapis.com/bucket/object",
      "https://storage.googleapis.com:444/bucket/object",
      "https://storage.googleapis.com/bucket/object#fragment",
      "https://storage.googleapis.com.evil.example/bucket/object",
    ]) {
      globalThis.fetch = (async () => new Response(JSON.stringify({ signedUrl: hostile }), {
        status: 200, headers: { "content-type": "application/json" },
      })) as typeof fetch;
      await assert.rejects(signedVaultReadUrl(ownerId, destination), /Invalid signed storage URL/);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (previous.vercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous.vercel;
    if (previous.origin === undefined) delete process.env.REPLIT_STORAGE_BROKER_ORIGIN;
    else process.env.REPLIT_STORAGE_BROKER_ORIGIN = previous.origin;
    if (previous.token === undefined) delete process.env.PUBLISHED_SITE_ACCESS_TOKEN;
    else process.env.PUBLISHED_SITE_ACCESS_TOKEN = previous.token;
    if (previous.secret === undefined) delete process.env.STORAGE_BROKER_SECRET;
    else process.env.STORAGE_BROKER_SECRET = previous.secret;
  }
});

test("broker DB authority prevents cross-owner storage attacks and pins mutations", async () => {
  const previousSecret = process.env.STORAGE_BROKER_SECRET;
  process.env.STORAGE_BROKER_SECRET = "authoritative-broker-test-secret-32-bytes";
  delete process.env.VERCEL;
  const ownerA = `owner-a-${randomUUID()}`;
  const ownerB = `owner-b-${randomUUID()}`;
  await db.insert(usersTable).values([{ id: ownerA }, { id: ownerB }]);
  const staging = `/objects/vault-staging/${randomUUID()}`;
  const nearExpiryStaging = `/objects/vault-staging/${randomUUID()}`;
  const nearExpiry = new Date(Date.now() + 500);
  const immutable = `/objects/vault-documents/${randomUUID()}`;
  const ownerless = `/objects/vault-documents/${randomUUID()}`;
  const fenced = `/objects/vault-documents/${randomUUID()}`;
  await db.insert(vaultUploadGrantsTable).values([
    {
      userId: ownerA, objectPath: staging, name: "a.png", contentType: "image/png",
      size: 10, purpose: "vault_document", expiresAt: new Date(Date.now() + 60_000),
    },
    {
      userId: ownerA, objectPath: nearExpiryStaging, name: "near.png",
      contentType: "image/png", size: 10, purpose: "vault_document",
      expiresAt: nearExpiry,
    },
  ]);
  await db.insert(vaultDocumentsTable).values([
    { userId: ownerA, objectPath: immutable, name: "a.png", contentType: "image/png", size: 10 },
    { userId: ownerA, objectPath: ownerless, name: "old.png", contentType: "image/png", size: 10 },
  ]);
  await db.insert(vaultDeletionJobsTable).values({
    userId: ownerA, objectPath: fenced, reason: "promotion_cleanup_settle",
    finalizeAfter: new Date(Date.now() + 10 * 60_000),
  });
  const objects = new Map<string, Record<string, any>>([
    [staging, { generation: "11", size: "10", contentType: "image/png", metadata: {} }],
    [immutable, {
      generation: "12", size: "10", contentType: "image/png",
      metadata: { "custom:owner": ownerA },
    }],
    [ownerless, { generation: "13", size: "10", contentType: "image/png", metadata: {} }],
    [fenced, {
      generation: "14", size: "10", contentType: "image/png",
      metadata: { "custom:owner": ownerA },
    }],
  ]);
  let fenceOptions: Record<string, unknown> | undefined;
  let deleteOptions: Record<string, unknown> | undefined;
  setVaultFileForTests((path) => {
    const metadata = objects.get(path);
    const file: Record<string, any> = {
      name: path,
      exists: async () => [Boolean(metadata)],
      getMetadata: async () => {
        if (!metadata) throw new Error("missing");
        return [metadata];
      },
      setMetadata: async () => undefined,
      save: async (_data: unknown, options: Record<string, unknown>) => { fenceOptions = options; },
      delete: async (options: Record<string, unknown>) => { deleteOptions = options; },
      copy: async () => [],
    };
    file.bucket = { file: () => file };
    return file as never;
  });
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use("/api", storageBrokerRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
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
  const invoke = (body: Record<string, unknown>) => {
    const timestamp = String(Date.now());
    const nonce = randomUUID();
    const canonical = canonicalStorageBrokerBody(body);
    return fetch(`http://127.0.0.1:${port}/api/internal/storage-broker`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-storage-timestamp": timestamp,
        "x-storage-nonce": nonce,
        "x-storage-signature": brokerSignature(timestamp, nonce, canonical),
      },
      body: canonical,
    });
  };
  try {
    const grantFields = {
      purpose: "vault_document", expectedSize: 10, expectedContentType: "image/png",
    };
    const delayedSigningNow = nearExpiry.getTime() - 100;
    setStorageBrokerNowForTests(() => delayedSigningNow);
    assert.equal((await invoke({
      action: "sign_upload", ownerId: ownerA, objectPath: nearExpiryStaging, ...grantFields,
    })).status, 200);
    assert.equal(signedExpiry, nearExpiry.toISOString());
    setStorageBrokerNowForTests();
    await new Promise((resolve) => setTimeout(resolve, 550));
    await runVaultDeletionMaintenance();
    const [nearExpiryCleanup] = await db.select().from(vaultDeletionJobsTable)
      .where(eq(vaultDeletionJobsTable.objectPath, nearExpiryStaging));
    assert.ok(nearExpiryCleanup?.finalizeAfter);
    assert.ok(nearExpiryCleanup.finalizeAfter.getTime()
      >= new Date(signedExpiry!).getTime() + 5 * 60_000);
    assert.equal((await invoke({
      action: "mark_owner", ownerId: ownerB, objectPath: staging, generation: "11", ...grantFields,
    })).status, 400);
    assert.equal((await invoke({
      action: "promote", ownerId: ownerB, sourcePath: staging,
      destinationPath: immutable, sourceGeneration: "11", ...grantFields,
    })).status, 400);
    assert.equal((await invoke({ action: "delete", ownerId: ownerB, objectPath: staging })).status, 400);
    assert.equal((await invoke({ action: "fence", ownerId: ownerB, objectPath: fenced })).status, 400);
    assert.equal((await invoke({
      action: "sign_read", ownerId: ownerB, objectPath: immutable, inline: true, name: "a.png",
    })).status, 400);
    assert.equal((await invoke({ action: "delete", ownerId: ownerB, objectPath: immutable })).status, 400);
    assert.equal((await invoke({ action: "delete", ownerId: ownerA, objectPath: ownerless })).status, 400);
    assert.equal((await invoke({
      action: "metadata", ownerId: ownerA, objectPath: staging,
      ...grantFields, purpose: "receipt_review",
    })).status, 400);
    assert.equal((await invoke({
      action: "metadata", ownerId: ownerA, objectPath: staging,
      ...grantFields, expectedSize: 11,
    })).status, 400);
    assert.equal((await invoke({
      action: "metadata", ownerId: ownerA, objectPath: staging,
      ...grantFields, expectedContentType: "image/jpeg",
    })).status, 400);

    assert.equal((await invoke({ action: "fence", ownerId: ownerA, objectPath: fenced })).status, 200);
    assert.deepEqual((fenceOptions as any)?.preconditionOpts, { ifGenerationMatch: "14" });
    assert.equal((await invoke({ action: "delete", ownerId: ownerA, objectPath: immutable })).status, 200);
    assert.equal((deleteOptions as any)?.ifGenerationMatch, 12);
  } finally {
    server.close();
    globalThis.fetch = originalFetch;
    setStorageBrokerNowForTests();
    setVaultFileForTests();
    await db.delete(usersTable).where(eq(usersTable.id, ownerA));
    await db.delete(usersTable).where(eq(usersTable.id, ownerB));
    if (previousSecret === undefined) delete process.env.STORAGE_BROKER_SECRET;
    else process.env.STORAGE_BROKER_SECRET = previousSecret;
  }
});