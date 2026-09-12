import { createHash, createHmac, randomUUID } from "crypto";
import { Storage, type File } from "@google-cloud/storage";

const SIDECAR = "http://127.0.0.1:1106";
const BROKER_PATH = "/api/internal/storage-broker";
export const MAX_VAULT_SIZE = 20 * 1024 * 1024;

export type VaultObjectHandle = {
  path: string;
  generation: string;
  purpose?: string;
  size?: number;
  contentType?: string;
  file?: File;
};

type BrokerAction =
  | "sign_upload" | "metadata" | "mark_owner" | "promote"
  | "fence" | "delete" | "sign_read";

let directClient: Storage | undefined;
function isVercel(): boolean {
  return Boolean(process.env.VERCEL);
}
function storageClient(): Storage {
  if (isVercel()) throw new Error("STORAGE_BROKER_REQUIRED");
  directClient ??= new Storage({
    credentials: {
      audience: "replit",
      subject_token_type: "access_token",
      token_url: `${SIDECAR}/token`,
      type: "external_account",
      credential_source: {
        url: `${SIDECAR}/credential`,
        format: { type: "json", subject_token_field_name: "access_token" },
      },
      universe_domain: "googleapis.com",
    },
    projectId: "",
  });
  return directClient;
}

function privateDir(): string {
  const value = process.env.PRIVATE_OBJECT_DIR;
  if (!value) throw new Error("PRIVATE_OBJECT_DIR is not configured");
  return value.replace(/\/+$/, "");
}
function parsePath(path: string): { bucket: string; object: string } {
  const parts = path.replace(/^\/+/, "").split("/");
  if (parts.length < 2 || parts.some((part) => !part)) throw new Error("Invalid object path");
  return { bucket: parts[0], object: parts.slice(1).join("/") };
}
export function isVaultStagingPath(path: string): boolean {
  return /^\/objects\/vault-staging\/[0-9a-f-]{36}$/i.test(path);
}
export function isVaultDocumentPath(path: string): boolean {
  return /^\/objects\/vault-documents\/[0-9a-f-]{36}$/i.test(path);
}
export function isLegacyVaultDocumentPath(path: string): boolean {
  return /^\/objects\/vault\/[0-9a-f-]{36}$/i.test(path);
}
export function isVaultObjectPath(path: string): boolean {
  return isVaultStagingPath(path) || isVaultDocumentPath(path) || isLegacyVaultDocumentPath(path);
}
export function createVaultStagingPath(): string {
  return `/objects/vault-staging/${randomUUID()}`;
}
export function createVaultDocumentPath(): string {
  return `/objects/vault-documents/${randomUUID()}`;
}
let vaultFileHook: ((path: string) => File) | undefined;
export function setVaultFileForTests(hook?: (path: string) => File): void { vaultFileHook = hook; }
export function vaultFile(objectPath: string): File {
  if (!isVaultObjectPath(objectPath)) throw new Error("Invalid vault object path");
  if (vaultFileHook) return vaultFileHook(objectPath);
  const target = parsePath(`${privateDir()}/${objectPath.slice("/objects/".length)}`);
  return storageClient().bucket(target.bucket).file(target.object);
}

export function canonicalStorageBrokerBody(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalStorageBrokerBody).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalStorageBrokerBody(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export function storageBrokerSecret(): string {
  const dedicated = process.env.STORAGE_BROKER_SECRET;
  if (dedicated) {
    if (Buffer.byteLength(dedicated) < 32) throw new Error("STORAGE_BROKER_SECRET is too short");
    return dedicated;
  }
  const session = process.env.SESSION_SECRET;
  if (!session) throw new Error("STORAGE_BROKER_SECRET is not configured");
  if (Buffer.byteLength(session) < 32) throw new Error("SESSION_SECRET is too short for storage broker use");
  return createHmac("sha256", session).update("wealthone:storage-broker:v1").digest("hex");
}
export function brokerSignature(
  timestamp: string,
  nonce: string,
  body: string,
): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const assertion = ["v1", timestamp, nonce, "POST", BROKER_PATH, bodyHash].join("\n");
  return createHmac("sha256", storageBrokerSecret()).update(assertion).digest("hex");
}
function brokerOrigin(): string {
  const raw = process.env.REPLIT_STORAGE_BROKER_ORIGIN;
  if (!raw) throw new Error("REPLIT_STORAGE_BROKER_ORIGIN is not configured");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || url.pathname !== "/") throw new Error("Invalid REPLIT_STORAGE_BROKER_ORIGIN");
  return url.origin;
}
function validGoogleSignedUrl(value: string): boolean {
  const url = new URL(value);
  return url.protocol === "https:"
    && !url.username && !url.password && !url.port && !url.hash
    && (url.hostname === "storage.googleapis.com" || url.hostname.endsWith(".storage.googleapis.com"));
}
async function brokerCall<T>(action: BrokerAction, payload: Record<string, unknown>): Promise<T> {
  const body = canonicalStorageBrokerBody({ action, ...payload });
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const target = new URL(BROKER_PATH, brokerOrigin());
  const bypass = process.env.PUBLISHED_SITE_ACCESS_TOKEN;
  const response = await fetch(target, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      "x-storage-timestamp": timestamp,
      "x-storage-nonce": nonce,
      "x-storage-signature": brokerSignature(timestamp, nonce, body),
      ...(bypass ? { authorization: `Bearer ${bypass}` } : {}),
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status >= 300 && response.status < 400) throw new Error("Storage broker redirect rejected");
  if (!response.ok) throw new Error("Storage broker unavailable");
  return response.json() as Promise<T>;
}

export async function directSignedUrl(
  objectPath: string,
  method: "PUT" | "GET",
  expiresAt: Date,
): Promise<string> {
  const target = parsePath(`${privateDir()}/${objectPath.slice("/objects/".length)}`);
  const response = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      bucket_name: target.bucket, object_name: target.object, method,
      expires_at: expiresAt.toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("Could not create signed object URL");
  const result = await response.json() as { signed_url?: unknown };
  if (typeof result.signed_url !== "string") throw new Error("Invalid storage response");
  return result.signed_url;
}

export async function createVaultUploadUrl(
  ownerId = "",
  purpose = "vault_document",
  expectedSize?: number,
  expectedContentType?: string,
  exactObjectPath = createVaultStagingPath(),
  expiresAt = new Date(Date.now() + 15 * 60_000),
): Promise<{ uploadURL: string; objectPath: string }> {
  const objectPath = exactObjectPath;
  if (!isVaultStagingPath(objectPath)) throw new Error("Invalid staging object path");
  const uploadURL = isVercel()
    ? (await brokerCall<{ signedUrl: string }>("sign_upload", {
        ownerId, purpose, objectPath, expectedSize, expectedContentType,
      })).signedUrl
    : await directSignedUrl(objectPath, "PUT", expiresAt);
  if (!validGoogleSignedUrl(uploadURL)) throw new Error("Invalid signed storage URL");
  return { uploadURL, objectPath };
}

let vaultObjectAssertion:
  ((path: string, size: number, type?: string) => Promise<File>) | undefined;
export function setVaultObjectAssertionForTests(
  assertion?: (path: string, size: number, type?: string) => Promise<File>,
): void { vaultObjectAssertion = assertion; }
export async function assertVaultObject(
  objectPath: string, expectedSize: number, expectedContentType?: string,
  candidateFile?: File, ownerId = "", purpose = "vault_document",
): Promise<VaultObjectHandle> {
  if (!isVaultStagingPath(objectPath)) throw new Error("Invalid staging object path");
  if (vaultObjectAssertion) {
    const file = await vaultObjectAssertion(objectPath, expectedSize, expectedContentType);
    return Object.assign(file, {
      path: objectPath,
      generation: String((file as unknown as { generation?: string }).generation ?? "test"),
      purpose,
      size: expectedSize,
      contentType: expectedContentType,
    }) as unknown as VaultObjectHandle;
  }
  if (isVercel()) {
    const result = await brokerCall<{ generation: string }>("metadata", {
      ownerId, purpose, objectPath, expectedSize, expectedContentType,
    });
    return {
      path: objectPath, generation: result.generation,
      purpose, size: expectedSize, contentType: expectedContentType,
    };
  }
  const file = candidateFile ?? vaultFile(objectPath);
  const [exists] = await file.exists();
  if (!exists) throw new Error("Uploaded object was not found");
  const [metadata] = await file.getMetadata();
  if (!metadata.generation) throw new Error("Uploaded object generation is unavailable");
  if (Number(metadata.size) !== expectedSize) throw new Error("Uploaded object size does not match");
  if (expectedContentType && metadata.contentType
    && metadata.contentType.toLowerCase() !== expectedContentType.toLowerCase()) {
    throw new Error("Uploaded object content type does not match");
  }
  const storedOwner = metadata.metadata?.["custom:owner"];
  if (storedOwner && ownerId && storedOwner !== ownerId) {
    throw new Error("Uploaded object owner does not match");
  }
  const pinned = file.bucket.file(file.name, { generation: metadata.generation });
  return Object.assign(pinned, {
    path: objectPath,
    generation: String(metadata.generation),
    purpose,
    size: expectedSize,
    contentType: expectedContentType,
  }) as unknown as VaultObjectHandle;
}

let promotedAssertion: ((path: string, size: number, type: string) => Promise<File>) | undefined;
export function setPromotedVaultObjectAssertionForTests(
  assertion?: (path: string, size: number, type: string) => Promise<File>,
): void { promotedAssertion = assertion; }
export async function assertPromotedVaultObject(
  path: string, size: number, contentType: string, ownerId = "",
): Promise<VaultObjectHandle> {
  if (!isVaultDocumentPath(path)) throw new Error("Invalid promoted object path");
  if (promotedAssertion) {
    const file = await promotedAssertion(path, size, contentType);
    return { path, generation: "test", file };
  }
  if (isVercel()) {
    const result = await brokerCall<{ generation: string }>("metadata", {
      ownerId, objectPath: path, expectedSize: size, expectedContentType: contentType,
    });
    return { path, generation: result.generation };
  }
  const file = vaultFile(path);
  const [metadata] = await file.getMetadata();
  if (!metadata.generation || Number(metadata.size) !== size
    || metadata.contentType?.toLowerCase() !== contentType.toLowerCase()
    || (ownerId && metadata.metadata?.["custom:owner"] !== ownerId)) {
    throw new Error("Promoted object metadata does not match");
  }
  return { path, generation: String(metadata.generation), file: file.bucket.file(file.name, { generation: metadata.generation }) };
}

let promotion: ((source: string, destination: string, user: string) => Promise<void>) | undefined;
export function setVaultObjectPromotionForTests(
  value?: (source: string, destination: string, user: string) => Promise<void>,
): void { promotion = value; }
export async function promoteVaultObject(
  source: VaultObjectHandle | File, sourcePath: string, destinationPath: string, ownerId: string,
): Promise<void> {
  if (!isVaultStagingPath(sourcePath) || !isVaultDocumentPath(destinationPath)) throw new Error("Invalid vault promotion paths");
  if (promotion) return promotion(sourcePath, destinationPath, ownerId);
  if (isVercel()) {
    await brokerCall("promote", {
      ownerId, sourcePath, destinationPath,
      sourceGeneration: "generation" in source ? source.generation : undefined,
      purpose: "purpose" in source ? source.purpose : undefined,
      expectedSize: "size" in source ? source.size : undefined,
      expectedContentType: "contentType" in source ? source.contentType : undefined,
    });
    return;
  }
  const sourceFile = ((source as VaultObjectHandle).file ?? source) as File;
  if (!sourceFile || typeof sourceFile.copy !== "function") throw new Error("Storage copy is unavailable");
  await sourceFile.copy(vaultFile(destinationPath), {
    preconditionOpts: { ifGenerationMatch: 0 }, metadata: { "custom:owner": ownerId },
  });
}
let fenceHook: ((path: string) => Promise<void>) | undefined;
export function setVaultObjectFenceForTests(value?: (path: string) => Promise<void>): void { fenceHook = value; }
export async function fenceVaultObjectPath(
  path: string, ownerOrFile: string | File = "", candidateFile?: File,
): Promise<void> {
  const ownerId = typeof ownerOrFile === "string" ? ownerOrFile : "";
  const file = typeof ownerOrFile === "string" ? candidateFile : ownerOrFile;
  if (!isVaultDocumentPath(path)) throw new Error("Invalid vault fence path");
  if (fenceHook) return fenceHook(path);
  if (isVercel()) { await brokerCall("fence", { ownerId, objectPath: path }); return; }
  const target = file ?? vaultFile(path);
  let preconditionOpts: { ifGenerationMatch: string | number } | undefined;
  if (ownerId && typeof target.exists === "function") {
    const [exists] = await target.exists();
    if (exists) {
      const [metadata] = await target.getMetadata();
      if (!metadata.generation || metadata.metadata?.["custom:owner"] !== ownerId) {
        throw new Error("Storage object owner does not match");
      }
      preconditionOpts = { ifGenerationMatch: metadata.generation };
    } else preconditionOpts = { ifGenerationMatch: 0 };
  }
  await target.save(Buffer.alloc(0), {
    resumable: false, contentType: "application/x-vault-tombstone",
    ...(preconditionOpts ? { preconditionOpts } : {}),
    metadata: { contentType: "application/x-vault-tombstone", cacheControl: "no-store, max-age=0",
      metadata: {
        "custom:vault-tombstone": "true",
        ...(ownerId ? { "custom:owner": ownerId } : {}),
      } },
  });
}
export async function markVaultOwner(handle: VaultObjectHandle, ownerId: string): Promise<void> {
  if (isVercel()) {
    await brokerCall("mark_owner", {
      ownerId, objectPath: handle.path, generation: handle.generation,
      purpose: handle.purpose, expectedSize: handle.size, expectedContentType: handle.contentType,
    });
  } else {
    const file = handle.file ?? handle as unknown as File;
    if (typeof file.setMetadata !== "function") throw new Error("Storage object unavailable");
    if (typeof file.getMetadata === "function") {
      const [metadata] = await file.getMetadata();
      const storedOwner = metadata.metadata?.["custom:owner"];
      if (storedOwner && storedOwner !== ownerId) throw new Error("Storage object owner does not match");
      if (handle.size !== undefined && Number(metadata.size) !== handle.size) {
        throw new Error("Storage object size does not match");
      }
      if (handle.contentType && metadata.contentType?.toLowerCase() !== handle.contentType.toLowerCase()) {
        throw new Error("Storage object content type does not match");
      }
      if (storedOwner === ownerId) return;
    }
    await file.setMetadata({ metadata: { "custom:owner": ownerId } });
  }
}
let deletion: ((path: string) => Promise<void>) | undefined;
export function setVaultObjectDeletionForTests(value?: (path: string) => Promise<void>): void { deletion = value; }
export async function deleteVaultObject(path: string, ownerId = ""): Promise<void> {
  if (!isVaultObjectPath(path)) throw new Error("Invalid vault object path");
  if (deletion) return deletion(path);
  if (isVercel()) { await brokerCall("delete", { ownerId, objectPath: path }); return; }
  const file = vaultFile(path);
  const [exists] = await file.exists();
  if (!exists) return;
  const [metadata] = await file.getMetadata();
  const storedOwner = metadata.metadata?.["custom:owner"];
  if (isVaultDocumentPath(path) && storedOwner !== ownerId) throw new Error("Storage object owner does not match");
  if ((isVaultStagingPath(path) || isLegacyVaultDocumentPath(path))
    && storedOwner && storedOwner !== ownerId) throw new Error("Storage object owner does not match");
  if (!metadata.generation) throw new Error("Storage object generation is unavailable");
  await file.delete({ ignoreNotFound: true, ifGenerationMatch: Number(metadata.generation) });
}
export async function signedVaultReadUrl(
  ownerId: string, path: string, inline = true, name = "document",
): Promise<string> {
  if (!isVaultDocumentPath(path) && !isLegacyVaultDocumentPath(path)) {
    throw new Error("Invalid vault document path");
  }
  const safeName = name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 240) || "document";
  const url = isVercel()
    ? (await brokerCall<{ signedUrl: string }>("sign_read", {
        ownerId, objectPath: path, inline, name: safeName,
      })).signedUrl
    : await directSignedUrl(path, "GET", new Date(Date.now() + 5 * 60_000));
  if (!validGoogleSignedUrl(url)) throw new Error("Invalid signed storage URL");
  return url;
}
function vaultReadAbortError(): Error {
  return Object.assign(new Error("Vault object read aborted"), { name: "AbortError" });
}

export async function readVaultObjectBytes(
  ownerId: string, path: string, limit: number, signal?: AbortSignal,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  let stream: ReadableStream<Uint8Array> | NodeJS.ReadableStream | null;
  if (signal?.aborted) throw vaultReadAbortError();
  if (isVercel()) {
    const response = await fetch(await signedVaultReadUrl(ownerId, path), {
      redirect: "error",
      signal,
    });
    if (!response.ok) throw new Error("Storage object unavailable");
    stream = response.body;
  } else {
    stream = vaultFile(path).createReadStream({ end: limit });
  }
  if (!stream) throw new Error("Storage object unavailable");
  const abort = () => {
    const error = vaultReadAbortError();
    if ("destroy" in stream! && typeof stream.destroy === "function") stream.destroy(error);
    else if ("cancel" in stream! && typeof stream.cancel === "function") {
      void stream.cancel(error).catch(() => undefined);
    }
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      const bytes = Buffer.from(chunk);
      total += bytes.length;
      if (total > limit) throw new Error("RECEIPT_OCR_FILE_TOO_LARGE");
      chunks.push(bytes);
    }
  } finally {
    signal?.removeEventListener("abort", abort);
  }
  return Buffer.concat(chunks, total);
}
export async function streamVaultObject(
  ownerId: string, path: string, contentType: string, name: string,
  res: import("express").Response, inline = false,
): Promise<void> {
  res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  if (isVercel()) {
    res.redirect(307, await signedVaultReadUrl(ownerId, path, inline, name));
    return;
  }
  res.set({
    "Content-Type": contentType,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
  });
  vaultFile(path).createReadStream().on("error", (error) => res.destroy(error)).pipe(res);
}