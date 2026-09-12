import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeReceipt,
  confirmReceiptReview,
  downloadVaultDocument,
  uploadVaultDocument,
  deleteVaultDocument,
  getVaultCleanupStatus,
  retryVaultCleanup,
  listNominees,
  saveNominee,
} from "./feature-api.ts";

test("vault download preserves the original filename, authenticates the API path, and revokes its URL", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const link = { href: "", download: "", clickCount: 0, click() { this.clickCount += 1; } };
  const revoked: string[] = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(new Blob(["private bytes"], { type: "application/pdf" }), {
      headers: { "content-type": "application/pdf" },
    });
  }) as typeof fetch;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => link },
  });
  URL.createObjectURL = () => "blob:private-document";
  URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    await downloadVaultDocument({ id: "private/id", name: "Original policy ₹.pdf" });
    assert.deepEqual(calls.map(({ url, init }) => [
      url,
      init?.method,
      init?.credentials,
      init?.redirect,
    ]), [[
      "/api/vault/documents/private%2Fid/download",
      "GET",
      "same-origin",
      "follow",
    ]]);
    assert.equal(link.href, "blob:private-document");
    assert.equal(link.download, "Original policy ₹.pdf");
    assert.equal(link.clickCount, 1);
    assert.deepEqual(revoked, ["blob:private-document"]);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test("vault download reports oversized and click failures while cleaning up created URLs", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let createCount = 0;
  const revoked: string[] = [];
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => ({ href: "", download: "", click: () => { throw new Error("click failed"); } }) },
  });
  URL.createObjectURL = () => {
    createCount += 1;
    return "blob:error";
  };
  URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    globalThis.fetch = (async () => new Response("small")) as typeof fetch;
    await assert.rejects(
      downloadVaultDocument({ id: "click", name: "click.pdf" }),
      /click failed/,
    );
    assert.deepEqual(revoked, ["blob:error"]);

    globalThis.fetch = (async () => new Response(null, {
      headers: { "content-length": String(20 * 1024 * 1024 + 1) },
    })) as typeof fetch;
    await assert.rejects(
      downloadVaultDocument({ id: "large", name: "large.pdf" }),
      /larger than the 20 MiB download limit/,
    );
    assert.equal(createCount, 1, "oversized responses must not create an object URL");
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

test("a committed registration with a lost response cleans up by staging path without reusing the aborted signal", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let registrationCommitted = false;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "/api/vault/uploads/request-url") {
      return new Response(JSON.stringify({ uploadURL: "https://uploads.example/unconfirmed", objectPath: "private/account/unconfirmed" }));
    }
    if (url === "https://uploads.example/unconfirmed") {
      return new Response(null, { status: 200 });
    }
    if (url === "/api/vault/documents") {
      registrationCommitted = true;
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    }
    if (url === "/api/vault/cleanup") return new Response(JSON.stringify({}), { status: 200 });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  try {
    await assert.rejects(
      uploadVaultDocument(new File(["abc"], "receipt.png", { type: "image/png" }), "Receipt", undefined, controller.signal),
      /Aborted/,
    );
    assert.equal(registrationCommitted, true);
    const grant = calls.find((call) => call.url === "/api/vault/uploads/request-url");
    assert.equal(JSON.parse(String(grant?.init?.body)).purpose, "vault_document");
    const cleanup = calls.find((call) => call.url === "/api/vault/cleanup");
    assert.equal(cleanup?.init?.method, "POST");
    assert.equal(cleanup?.init?.credentials, "include");
    assert.equal(cleanup?.init?.signal, undefined);
    assert.deepEqual(JSON.parse(String(cleanup?.init?.body)), { objectPath: "private/account/unconfirmed" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("receipt analysis deletes its temporary document with account credentials when OCR fails", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "/api/vault/uploads/request-url") {
      return new Response(JSON.stringify({ uploadURL: "https://uploads.example/receipt", objectPath: "private/account/receipt" }));
    }
    if (url === "https://uploads.example/receipt") return new Response(null, { status: 200 });
    if (url === "/api/vault/documents") {
      return new Response(JSON.stringify({ document: { id: "temporary-document-1", name: "receipt.png", category: "Receipt", size: 3, createdAt: "2026-01-01" } }));
    }
    if (url === "/api/receipts/reviews") {
      return new Response(JSON.stringify({ error: "OCR provider unavailable" }), { status: 503 });
    }
    if (url === "/api/vault/documents/temporary-document-1") {
      return new Response(JSON.stringify({}), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  try {
    await assert.rejects(analyzeReceipt(new File(["abc"], "receipt.png", { type: "image/png" })), /OCR provider unavailable/);
    const grant = calls.find((call) => call.url === "/api/vault/uploads/request-url");
    assert.equal(JSON.parse(String(grant?.init?.body)).purpose, "receipt_review");
    const cleanup = calls.find((call) => call.url === "/api/vault/documents/temporary-document-1");
    assert.equal(cleanup?.init?.method, "DELETE");
    assert.equal(cleanup?.init?.credentials, "include");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("nominee client uses authenticated collection and item contracts", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({ url: String(input), init });
    if (String(input) === "/api/nominees" && !init?.method) {
      return new Response(JSON.stringify({ nominees: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      nominee: {
        id: "nominee-1",
        name: "Asha",
        relationship: "Spouse",
        allocationPercent: 100,
        accounts: ["NPS"],
      },
    }), { status: 200 });
  }) as typeof fetch;
  try {
    assert.deepEqual(await listNominees(), []);
    const saved = await saveNominee({
      name: "Asha",
      relationship: "Spouse",
      allocationPercent: 100,
      coverageType: "investment",
      coverageLabel: "NPS retirement account",
      institution: "Example Pension Fund",
      status: "active",
      reviewStatus: "reviewed",
      reminderOn: "2027-09-09",
      dateOfBirth: null,
      contact: null,
      notes: null,
    });
    assert.equal(saved.id, "nominee-1");
    assert.equal(requests[1].url, "/api/nominees");
    assert.equal(requests[1].init?.method, "POST");
    assert.equal(requests[1].init?.credentials, "include");
    assert.deepEqual(JSON.parse(String(requests[1].init?.body)), {
      name: "Asha",
      relationship: "Spouse",
      allocationPercent: 100,
      coverageType: "investment",
      coverageLabel: "NPS retirement account",
      institution: "Example Pension Fund",
      status: "active",
      reviewStatus: "reviewed",
      reminderOn: "2027-09-09",
      dateOfBirth: null,
      contact: null,
      notes: null,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("receipt confirmation sends explicit original-retention consent", async () => {
  const originalFetch = globalThis.fetch;
  let body: unknown;
  globalThis.fetch = (async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      saved: true,
      status: "confirmed",
      retainedOriginal: true,
      cleanupPending: true,
      expense: {
        id: "server-expense-1",
        date: "2026-09-09",
        amount: "125.00",
        category: "Shopping",
        merchant: "Example Shop",
        paymentMethod: "Other",
        note: null,
        reimbursable: false,
        recurring: false,
        createdAt: "2026-09-09T12:00:00.000Z",
      },
    }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await confirmReceiptReview({
      reviewId: "review-1",
      merchant: "Example Shop",
      amount: 125,
      date: "2026-09-09",
      category: "Shopping",
      lineItems: [{ description: "Household supplies", amount: 125 }],
    }, true);
    assert.deepEqual(body, {
      values: {
        merchant: "Example Shop",
        amount: 125,
        date: "2026-09-09",
        category: "Shopping",
        lineItems: [{ description: "Household supplies", amount: 125 }],
        retainOriginal: true,
      },
    });
    assert.equal(result.cleanupPending, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("vault cleanup status and retry use authenticated account-scoped contracts", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({ path: String(input), init });
    return new Response(JSON.stringify(
      String(input).endsWith("cleanup-status")
        ? { pending: 2, failed: 1, scheduled: 1 }
        : { cleaned: 1, failed: 0, retryRequired: false, cleanupPending: false },
    ));
  }) as typeof fetch;
  try {
    assert.deepEqual(await getVaultCleanupStatus(), { pending: 2, failed: 1, scheduled: 1 });
    assert.equal((await retryVaultCleanup()).cleanupPending, false);
    assert.deepEqual(calls.map(({ path, init }) => [path, init?.method ?? "GET", init?.credentials]), [
      ["/api/vault/cleanup-status", "GET", "include"],
      ["/api/vault/cleanup", "POST", "include"],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("vault errors surface the server message instead of pretending deletion succeeded", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "Document is locked" }), { status: 423 })
  ) as typeof fetch;
  try {
    await assert.rejects(
      deleteVaultDocument("private/id"),
      /Document is locked/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});