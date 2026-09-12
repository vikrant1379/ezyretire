import { timingSafeEqual } from "crypto";
import {
  db,
  storageBrokerNoncesTable,
  vaultDeletionJobsTable,
  vaultDocumentsTable,
  vaultUploadGrantsTable,
} from "@workspace/db";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import {
  MAX_VAULT_SIZE,
  brokerSignature,
  canonicalStorageBrokerBody,
  directSignedUrl,
  isLegacyVaultDocumentPath,
  isVaultDocumentPath,
  isVaultObjectPath,
  isVaultStagingPath,
  vaultFile,
} from "../lib/object-storage.js";

const router: IRouter = Router();
export const STORAGE_BROKER_WINDOW_MS = 60_000;
const REPLAY_RETENTION_MS = STORAGE_BROKER_WINDOW_MS * 2;
let nowHook: (() => number) | undefined;
export function setStorageBrokerNowForTests(hook?: () => number): void { nowHook = hook; }
const nowMs = () => nowHook?.() ?? Date.now();
const text = (value: unknown, max: number) =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
const reject = (res: Response, status = 401) =>
  res.status(status).json({ error: status === 404 ? "Not found" : "Invalid storage assertion" });
const purpose = (value: unknown) =>
  value === "vault_document" || value === "receipt_review" || value === "financial_restore"
    ? value : undefined;
const exactSize = (value: unknown) =>
  Number.isInteger(value) && Number(value) > 0 && Number(value) <= MAX_VAULT_SIZE
    ? Number(value) : undefined;

function operationShape(body: Record<string, unknown>, action: string): boolean {
  const path = text(body.objectPath, 1024);
  const type = text(body.expectedContentType, 120);
  const sizedGrant = Boolean(purpose(body.purpose) && exactSize(body.expectedSize) && type);
  if (action === "sign_upload") return Boolean(path && isVaultStagingPath(path) && sizedGrant);
  if (action === "metadata") return Boolean(path && isVaultObjectPath(path)
    && (!isVaultStagingPath(path) || sizedGrant));
  if (action === "mark_owner") return Boolean(path && isVaultStagingPath(path)
    && text(body.generation, 100) && sizedGrant);
  if (action === "promote") {
    const source = text(body.sourcePath, 1024);
    const destination = text(body.destinationPath, 1024);
    return Boolean(source && destination && isVaultStagingPath(source)
      && isVaultDocumentPath(destination) && text(body.sourceGeneration, 100) && sizedGrant);
  }
  if (action === "fence") return Boolean(path && isVaultDocumentPath(path));
  if (action === "delete") return Boolean(path && isVaultObjectPath(path));
  return action === "sign_read" && Boolean(path
    && (isVaultDocumentPath(path) || isLegacyVaultDocumentPath(path))
    && typeof body.inline === "boolean" && text(body.name, 240));
}

async function exactGrant(body: Record<string, unknown>) {
  const [grant] = await db.select().from(vaultUploadGrantsTable).where(and(
    eq(vaultUploadGrantsTable.userId, String(body.ownerId)),
    eq(vaultUploadGrantsTable.objectPath, String(body.objectPath ?? body.sourcePath)),
    eq(vaultUploadGrantsTable.purpose, String(body.purpose)),
    eq(vaultUploadGrantsTable.size, Number(body.expectedSize)),
    eq(vaultUploadGrantsTable.contentType, String(body.expectedContentType)),
    isNull(vaultUploadGrantsTable.consumedAt),
    gt(vaultUploadGrantsTable.expiresAt, new Date(nowMs())),
  ));
  return grant;
}
async function document(ownerId: string, path: string) {
  const [row] = await db.select().from(vaultDocumentsTable).where(and(
    eq(vaultDocumentsTable.userId, ownerId), eq(vaultDocumentsTable.objectPath, path),
  ));
  return row;
}
async function deletionJob(ownerId: string, path: string) {
  const [row] = await db.select().from(vaultDeletionJobsTable).where(and(
    eq(vaultDeletionJobsTable.userId, ownerId), eq(vaultDeletionJobsTable.objectPath, path),
  ));
  return row;
}
const customOwner = (metadata: Record<string, any>) => metadata.metadata?.["custom:owner"] as unknown;
const metadataMatches = (
  metadata: Record<string, any>, size: number, contentType: string,
) => Boolean(metadata.generation && Number(metadata.size) === size
  && typeof metadata.contentType === "string"
  && metadata.contentType.toLowerCase() === contentType.toLowerCase());

router.post("/internal/storage-broker", async (req, res): Promise<void> => {
  if (process.env.VERCEL) { reject(res, 404); return; }
  const timestamp = req.header("x-storage-timestamp");
  const nonce = req.header("x-storage-nonce");
  const signature = req.header("x-storage-signature");
  const body = req.body as Record<string, unknown>;
  const action = text(body?.action, 32);
  const ownerId = text(body?.ownerId, 160);
  const assertedTime = Number(timestamp);
  if (!timestamp || !nonce || !/^[0-9a-f-]{36}$/i.test(nonce) || !signature
    || !/^[0-9a-f]{64}$/i.test(signature) || !action || !ownerId
    || !Number.isFinite(assertedTime)
    || Math.abs(nowMs() - assertedTime) > STORAGE_BROKER_WINDOW_MS) {
    reject(res); return;
  }
  let expected: string;
  try {
    expected = brokerSignature(timestamp, nonce, canonicalStorageBrokerBody(body));
  } catch {
    reject(res); return;
  }
  if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) {
    reject(res); return;
  }
  if (!operationShape(body, action)) { reject(res, 400); return; }
  try {
    await db.transaction(async (tx) => {
      const freshNow = nowMs();
      if (Math.abs(freshNow - assertedTime) > STORAGE_BROKER_WINDOW_MS) throw new Error("STALE");
      await tx.delete(storageBrokerNoncesTable)
        .where(lt(storageBrokerNoncesTable.expiresAt, new Date(freshNow)));
      await tx.insert(storageBrokerNoncesTable).values({
        nonce, expiresAt: new Date(freshNow + REPLAY_RETENTION_MS),
      });
    });
  } catch {
    reject(res); return;
  }
  if (Math.abs(nowMs() - assertedTime) > STORAGE_BROKER_WINDOW_MS) {
    reject(res); return;
  }

  try {
    const objectPath = text(body.objectPath, 1024);
    if (action === "sign_upload") {
      const grant = await exactGrant(body);
      if (!grant) throw new Error();
      res.json({ signedUrl: await directSignedUrl(
        String(objectPath), "PUT", grant.expiresAt,
      ) });
      return;
    }
    if (action === "metadata") {
      if (!objectPath) throw new Error();
      if (isVaultStagingPath(objectPath)) {
        if (!await exactGrant(body)) throw new Error();
      } else {
        const doc = await document(ownerId, objectPath);
        const job = await deletionJob(ownerId, objectPath);
        if (!doc && job?.reason !== "promotion_rollback"
          && job?.reason !== "financial_restore_complete") throw new Error();
      }
      const file = vaultFile(objectPath);
      const [exists] = await file.exists();
      if (!exists) { res.json({ exists: false }); return; }
      const [metadata] = await file.getMetadata();
      const size = exactSize(body.expectedSize);
      const contentType = text(body.expectedContentType, 120);
      if (!metadata.generation || (size && contentType && !metadataMatches(metadata, size, contentType))) {
        throw new Error();
      }
      if (!isVaultStagingPath(objectPath)) {
        const owner = customOwner(metadata);
        if (isVaultDocumentPath(objectPath) ? owner !== ownerId : owner && owner !== ownerId) {
          throw new Error();
        }
      }
      res.json({
        exists: true, size: Number(metadata.size), contentType: metadata.contentType,
        generation: String(metadata.generation), owner: customOwner(metadata),
      });
      return;
    }
    if (action === "mark_owner") {
      if (!objectPath || !await exactGrant(body)) throw new Error();
      const generation = String(body.generation);
      const pinned = vaultFile(objectPath);
      const file = pinned.bucket.file(pinned.name, { generation });
      const [metadata] = await file.getMetadata();
      if (!metadataMatches(metadata, Number(body.expectedSize), String(body.expectedContentType))) throw new Error();
      const owner = customOwner(metadata);
      if (owner && owner !== ownerId) throw new Error();
      if (!owner) await file.setMetadata({ metadata: { "custom:owner": ownerId } });
      res.json({ ok: true }); return;
    }
    if (action === "promote") {
      const sourcePath = String(body.sourcePath);
      const destinationPath = String(body.destinationPath);
      const generation = String(body.sourceGeneration);
      if (!await exactGrant(body)) throw new Error();
      const job = await deletionJob(ownerId, destinationPath);
      if (job?.reason !== "promotion_rollback"
        || (job.finalizeAfter && job.finalizeAfter <= new Date(nowMs()))) throw new Error();
      const source = vaultFile(sourcePath);
      const pinned = source.bucket.file(source.name, { generation });
      const [metadata] = await pinned.getMetadata();
      if (!metadataMatches(metadata, Number(body.expectedSize), String(body.expectedContentType))
        || customOwner(metadata) !== ownerId) throw new Error();
      await pinned.copy(vaultFile(destinationPath), {
        preconditionOpts: { ifGenerationMatch: 0 }, metadata: { "custom:owner": ownerId },
      });
      res.json({ ok: true }); return;
    }
    if (action === "fence") {
      if (!objectPath) throw new Error();
      const job = await deletionJob(ownerId, objectPath);
      if (job?.reason !== "promotion_cleanup_settle") throw new Error();
      const file = vaultFile(objectPath);
      const [exists] = await file.exists();
      let ifGenerationMatch: number | string = 0;
      if (exists) {
        const [metadata] = await file.getMetadata();
        if (!metadata.generation || customOwner(metadata) !== ownerId) throw new Error();
        ifGenerationMatch = metadata.generation;
      }
      await file.save(Buffer.alloc(0), {
        resumable: false, contentType: "application/x-vault-tombstone",
        preconditionOpts: { ifGenerationMatch },
        metadata: {
          contentType: "application/x-vault-tombstone", cacheControl: "no-store, max-age=0",
          metadata: { "custom:vault-tombstone": "true", "custom:owner": ownerId },
        },
      });
      res.json({ ok: true }); return;
    }
    if (action === "delete") {
      if (!objectPath) throw new Error();
      const grant = isVaultStagingPath(objectPath)
        ? await db.select().from(vaultUploadGrantsTable).where(and(
            eq(vaultUploadGrantsTable.userId, ownerId),
            eq(vaultUploadGrantsTable.objectPath, objectPath),
          )).then((rows) => rows[0])
        : undefined;
      const doc = !isVaultStagingPath(objectPath) ? await document(ownerId, objectPath) : undefined;
      const job = await deletionJob(ownerId, objectPath);
      if (!grant && !doc && !job) throw new Error();
      const file = vaultFile(objectPath);
      const [exists] = await file.exists();
      if (exists) {
        const [metadata] = await file.getMetadata();
        if (!metadata.generation) throw new Error();
        const owner = customOwner(metadata);
        if (isVaultDocumentPath(objectPath) && owner !== ownerId) throw new Error();
        if (isLegacyVaultDocumentPath(objectPath) && owner && owner !== ownerId) throw new Error();
        if (isVaultStagingPath(objectPath) && owner && owner !== ownerId) throw new Error();
        await file.delete({
          ignoreNotFound: true,
          ifGenerationMatch: Number(metadata.generation),
        });
      }
      res.json({ ok: true }); return;
    }
    if (action === "sign_read") {
      if (!objectPath) throw new Error();
      const doc = await document(ownerId, objectPath);
      const job = await deletionJob(ownerId, objectPath);
      const activeTemp = (job?.reason === "promotion_rollback"
        && (!job.finalizeAfter || job.finalizeAfter > new Date(nowMs())))
        || job?.reason === "financial_restore_complete";
      if (!doc && !activeTemp) throw new Error();
      const [metadata] = await vaultFile(objectPath).getMetadata();
      const owner = customOwner(metadata);
      if (isVaultDocumentPath(objectPath) ? owner !== ownerId : owner && owner !== ownerId) throw new Error();
      res.json({ signedUrl: await directSignedUrl(
        objectPath, "GET", new Date(Date.now() + 5 * 60_000),
      ) });
      return;
    }
    throw new Error();
  } catch {
    res.status(400).json({ error: "Invalid storage operation" });
  }
});

export default router;