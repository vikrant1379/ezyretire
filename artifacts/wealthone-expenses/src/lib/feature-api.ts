export type ReceiptLineItem = {
  description: string;
  amount: number;
};

export type ReceiptDraft = {
  reviewId: string;
  merchant: string;
  amount: number;
  date: string;
  category: string;
  lineItems: ReceiptLineItem[];
};

export type ConfirmedReceiptExpense = {
  id: string;
  date: string;
  amount: string | number;
  category: string;
  merchant: string;
  paymentMethod: string;
  note: string | null;
  reimbursable: boolean;
  recurring: boolean;
  createdAt: string;
};

export type VaultCleanupStatus = {
  pending: number;
  failed: number;
  scheduled: number;
};

export type VaultCleanupResult = {
  cleaned: number;
  failed: number;
  retryRequired: boolean;
  cleanupPending: boolean;
};

export type VaultDocument = {
  id: string;
  name: string;
  category: string;
  size: number;
  createdAt: string;
  contentType?: string;
  updatedAt?: string;
  expiresOn?: string | null;
  archivedAt?: string | null;
};

export type Nominee = {
  id: string;
  name: string;
  relationship: string;
  allocationPercent: number;
  dateOfBirth?: string | null;
  contact?: string | null;
  notes?: string | null;
  coverageType: "life" | "health" | "investment" | "other";
  coverageLabel: string;
  institution?: string;
  status: "active" | "needs_review" | "inactive";
  reviewStatus: "not_reviewed" | "reviewed" | "needs_update";
  reminderOn?: string | null;
  gapStatus?: "complete" | "incomplete";
  createdAt?: string;
  updatedAt?: string;
};

export type Entitlements = {
  plan: "free" | "premium";
  premium: boolean;
  capabilities: {
    receiptOcr: boolean;
    bankStatementImport: boolean;
    documentVault: boolean;
    nomineeTracker: boolean;
    verifiedMobile: boolean;
  };
  mobileVerification: { hasMobile: boolean; verified: boolean };
};

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "include", ...init });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error || "The request could not be completed");
  }
  return body;
}

export function getEntitlements() {
  return apiRequest<Entitlements>("/api/entitlements");
}

export async function analyzeReceipt(file: File, signal?: AbortSignal): Promise<ReceiptDraft> {
  const document = await uploadVaultDocument(file, "Receipt", undefined, signal, "receipt_review");
  let body: { review: { id: string; candidates: Array<Partial<ReceiptDraft>> } };
  try {
    body = await apiRequest("/api/receipts/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documentId: document.id, candidates: [] }),
      signal,
    });
  } catch (error) {
    // Cleanup must not inherit an already-aborted extraction signal.
    await deleteVaultDocument(document.id).catch(() => undefined);
    throw error;
  }
  const candidate = body.review.candidates[0] ?? {};
  return {
    reviewId: body.review.id,
    merchant: candidate.merchant ?? "",
    amount: Number(candidate.amount) || 0,
    date: candidate.date ?? new Date().toISOString().slice(0, 10),
    category: candidate.category ?? "",
    lineItems: Array.isArray(candidate.lineItems) ? candidate.lineItems : [],
  };
}

export function confirmReceiptReview(draft: ReceiptDraft, keepOriginal = false) {
  const { reviewId, ...values } = draft;
  return apiRequest<{ saved: true; status: "confirmed"; retainedOriginal: boolean; cleanupPending: boolean; expense: ConfirmedReceiptExpense }>(`/api/receipts/reviews/${encodeURIComponent(reviewId)}/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ values: { ...values, retainOriginal: keepOriginal } }),
  });
}

export function discardReceiptReview(reviewId: string) {
  return apiRequest<void>(`/api/receipts/reviews/${encodeURIComponent(reviewId)}`, { method: "DELETE" });
}

export function listVaultDocuments() {
  return apiRequest<{ documents: VaultDocument[] }>("/api/vault/documents")
    .then((body) => body.documents);
}

const MAX_VAULT_DOWNLOAD_BYTES = 20 * 1024 * 1024;

async function readBoundedBlob(response: Response): Promise<Blob> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_VAULT_DOWNLOAD_BYTES) {
    throw new Error("This document is larger than the 20 MiB download limit.");
  }
  if (!response.body) {
    throw new Error("The document download returned no content.");
  }

  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_VAULT_DOWNLOAD_BYTES) {
        await reader.cancel();
        throw new Error("This document is larger than the 20 MiB download limit.");
      }
      const chunk = new Uint8Array(value.byteLength);
      chunk.set(value);
      chunks.push(chunk.buffer);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, {
    type: response.headers.get("content-type") || "application/octet-stream",
  });
}

export async function downloadVaultDocument(
  document: Pick<VaultDocument, "id" | "name">,
): Promise<void> {
  // Authenticate the same-origin API hop without requesting credentials after
  // its 307 redirect to GCS, which would trigger credentialed CORS handling.
  const response = await fetch(
    `/api/vault/documents/${encodeURIComponent(document.id)}/download`,
    { method: "GET", credentials: "same-origin", redirect: "follow" },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "The document could not be downloaded.");
  }

  const blob = await readBoundedBlob(response);
  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = globalThis.document.createElement("a");
    link.href = objectUrl;
    link.download = document.name;
    link.click();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function cleanupUnconfirmedVaultUpload(objectPath: string): Promise<void> {
  // This authenticated endpoint is the intended cleanup contract for a grant
  // whose object was uploaded but never registered as a document.
  await apiRequest<void>("/api/vault/cleanup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ objectPath }),
  });
}

export async function uploadVaultDocument(
  file: File,
  category: string,
  expiresOn?: string,
  signal?: AbortSignal,
  purpose: "vault_document" | "receipt_review" = "vault_document",
) {
  const metadata = { name: file.name, contentType: file.type, size: file.size };
  const upload = await apiRequest<{ uploadURL: string; objectPath: string }>("/api/vault/uploads/request-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...metadata, purpose }),
    signal,
  });
  try {
    const uploadResponse = await fetch(upload.uploadURL, {
      method: "PUT",
      headers: { "content-type": file.type },
      body: file,
      signal,
    });
    if (!uploadResponse.ok) throw new Error("The encrypted document upload did not complete");
    const body = await apiRequest<{ document: VaultDocument }>("/api/vault/documents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...metadata, objectPath: upload.objectPath, category, expiresOn: expiresOn || null }),
      signal,
    });
    return body.document;
  } catch (error) {
    await cleanupUnconfirmedVaultUpload(upload.objectPath).catch(() => undefined);
    throw error;
  }
}

export async function replaceVaultDocument(id: string, file: File, category: string) {
  const metadata = { name: file.name, contentType: file.type, size: file.size };
  const upload = await apiRequest<{ uploadURL: string; objectPath: string }>("/api/vault/uploads/request-url", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...metadata, purpose: "vault_document" }),
  });
  const result = await fetch(upload.uploadURL, { method: "PUT", headers: { "content-type": file.type }, body: file });
  if (!result.ok) throw new Error("The replacement upload did not complete");
  const body = await apiRequest<{ document: VaultDocument; cleanupPending: boolean }>(`/api/vault/documents/${encodeURIComponent(id)}`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...metadata, objectPath: upload.objectPath, category }),
  });
  return body;
}

export function updateVaultDocumentLifecycle(id: string, archived: boolean) {
  return apiRequest<{ document: VaultDocument }>(`/api/vault/documents/${encodeURIComponent(id)}/lifecycle`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived }),
  });
}

export function deleteVaultDocument(id: string) {
  return apiRequest<{ cleanupPending: boolean }>(`/api/vault/documents/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function getVaultCleanupStatus() {
  return apiRequest<VaultCleanupStatus>("/api/vault/cleanup-status");
}

export function retryVaultCleanup() {
  return apiRequest<VaultCleanupResult>("/api/vault/cleanup", { method: "POST" });
}

export function listNominees() {
  return apiRequest<{ nominees: Nominee[] }>("/api/nominees")
    .then((body) => body.nominees);
}

export async function saveNominee(nominee: Omit<Nominee, "id"> & { id?: string }) {
  const path = nominee.id ? `/api/nominees/${encodeURIComponent(nominee.id)}` : "/api/nominees";
  const body = await apiRequest<{ nominee: Nominee }>(path, {
    method: nominee.id ? "PUT" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: nominee.name,
      relationship: nominee.relationship,
      allocationPercent: nominee.allocationPercent,
      coverageType: nominee.coverageType,
      coverageLabel: nominee.coverageLabel,
      institution: nominee.institution || null,
      status: nominee.status,
      reviewStatus: nominee.reviewStatus,
      reminderOn: nominee.reminderOn || null,
      dateOfBirth: nominee.dateOfBirth ?? null,
      contact: nominee.contact ?? null,
      notes: nominee.notes ?? null,
    }),
  });
  return body.nominee;
}

export function deleteNominee(id: string) {
  return apiRequest<void>(`/api/nominees/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}