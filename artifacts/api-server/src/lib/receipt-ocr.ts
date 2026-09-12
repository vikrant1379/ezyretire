import type { File } from "@google-cloud/storage";
import { getEnv } from "./env.js";
import { MAX_VAULT_SIZE, readVaultObjectBytes } from "./object-storage.js";

export type ReceiptCandidate = {
  merchant: string;
  amount: number;
  date: string;
  category: string;
  lineItems: Array<{ description: string; amount: number }>;
};

function string(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function amount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : 0;
}

export function normalizeReceiptCandidates(value: unknown): ReceiptCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const merchant = string(record.merchant, 160);
    const total = amount(record.amount);
    const date = string(record.date, 10);
    const lineItems = Array.isArray(record.lineItems)
      ? record.lineItems.slice(0, 100).flatMap((line) => {
          if (!line || typeof line !== "object" || Array.isArray(line)) return [];
          const entry = line as Record<string, unknown>;
          const description = string(entry.description, 240);
          return description ? [{ description, amount: amount(entry.amount) }] : [];
        })
      : [];
    if (!merchant && total === 0 && lineItems.length === 0) return [];
    return [{
      merchant,
      amount: total,
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
      category: string(record.category, 64),
      lineItems,
    }];
  });
}

export async function extractReceiptCandidates(
  ownerOrFile: string | File,
  pathOrContentType: string,
  maybeContentType?: string,
): Promise<ReceiptCandidate[]> {
  const endpoint = getEnv("RECEIPT_OCR_URL");
  const apiKey = getEnv("RECEIPT_OCR_API_KEY");
  if (!endpoint || !apiKey) throw new Error("RECEIPT_OCR_NOT_CONFIGURED");
  let bytes: Buffer;
  let contentType: string;
  if (typeof ownerOrFile === "string") {
    bytes = await readVaultObjectBytes(ownerOrFile, pathOrContentType, MAX_VAULT_SIZE);
    contentType = maybeContentType ?? "application/octet-stream";
  } else {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of ownerOrFile.createReadStream({ end: MAX_VAULT_SIZE })) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += part.length;
      if (total > MAX_VAULT_SIZE) throw new Error("RECEIPT_OCR_FILE_TOO_LARGE");
      chunks.push(part);
    }
    bytes = Buffer.concat(chunks, total);
    contentType = pathOrContentType;
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": contentType,
      accept: "application/json",
    },
    body: bytes,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("RECEIPT_OCR_FAILED");
  const payload = await response.json() as { candidates?: unknown };
  const candidates = normalizeReceiptCandidates(payload.candidates);
  if (candidates.length === 0) throw new Error("RECEIPT_OCR_EMPTY");
  return candidates;
}