import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mergeConfirmedReceiptExpense, publishReceiptExtraction } from "./receipt-expense-import.tsx";
import type { ReceiptDraft } from "../lib/feature-api.ts";
import type { FinancialData } from "../lib/financial-api.ts";

test("retrying a confirmed receipt result dedupes the same server expense id", () => {
  const initial = { expenses: [] } as unknown as FinancialData;
  const result = { cleanupPending: false, expense: { id: "server-expense-1", date: "2026-01-01", amount: "12.50", category: "Food", merchant: "Cafe", paymentMethod: "Other", note: "Receipt", reimbursable: false, recurring: false, createdAt: "2026-01-01T00:00:00.000Z" } };
  const once = mergeConfirmedReceiptExpense(initial, result);
  const twice = mergeConfirmedReceiptExpense(once, result);
  assert.equal(twice.expenses.length, 1);
  assert.equal(twice.expenses[0]?.id, "server-expense-1");
  assert.equal(twice.expenses[0]?.amount, 12.5);
});

test("closing during extraction prevents an ignored late result from publishing", async () => {
  const controller = new AbortController();
  let resolve!: (draft: ReceiptDraft) => void;
  const pending = new Promise<ReceiptDraft>((done) => { resolve = done; });
  let published = false;
  let discardedReviewId = "";
  const extraction = publishReceiptExtraction(
    new File(["abc"], "receipt.png", { type: "image/png" }),
    controller.signal,
    () => { published = true; },
    async () => pending,
    async (reviewId) => { discardedReviewId = reviewId; },
  );
  controller.abort();
  resolve({ reviewId: "late", merchant: "Late", amount: 1, date: "2026-01-01", category: "Other", lineItems: [] });
  assert.equal(await extraction, false);
  assert.equal(published, false);
  assert.equal(discardedReviewId, "late");
});

test("receipt import keeps separate mobile-camera and desktop-file controls", async () => {
  const source = await readFile(new URL("./receipt-expense-import.tsx", import.meta.url), "utf8");

  assert.match(source, /type="file" accept="image\/\*" capture="environment"/);
  assert.match(source, /type="file" accept="image\/jpeg,image\/png,image\/webp,application\/pdf"/);
  assert.match(source, /data-testid="button-take-receipt-photo"/);
  assert.match(source, /data-testid="button-choose-receipt-file"/);
  assert.match(source, /data-testid="checkbox-confirm-receipt"/);
  assert.match(source, /data-testid="checkbox-keep-original-receipt"/);
});

test("receipt import confirms before publishing the saved-expense callback", async () => {
  const source = await readFile(new URL("./receipt-expense-import.tsx", import.meta.url), "utf8");
  const coordinatedWrite = source.indexOf("await performFinancialCacheUpdate(");
  const confirmCall = source.indexOf("() => confirmReceiptReview(draft, keepOriginal)", coordinatedWrite);
  const serverExpense = source.indexOf("mergeConfirmedReceiptExpense", confirmCall);
  const publishCall = source.indexOf("onUseDraft(draft)", confirmCall);

  assert.ok(coordinatedWrite >= 0);
  assert.ok(confirmCall > coordinatedWrite);
  assert.ok(serverExpense > confirmCall);
  assert.ok(publishCall > confirmCall);
  assert.doesNotMatch(source, /receipt-\$\{draft\.reviewId\}/);
});

test("cleanup-pending results are surfaced and protection wires account cleanup status", async () => {
  const receiptSource = await readFile(new URL("./receipt-expense-import.tsx", import.meta.url), "utf8");
  const protectionSource = await readFile(new URL("../pages/protection.tsx", import.meta.url), "utf8");
  assert.match(receiptSource, /Expense saved; private cleanup pending/);
  assert.match(receiptSource, /vault-cleanup-status/);
  assert.match(protectionSource, /queryFn: getVaultCleanupStatus/);
  assert.match(protectionSource, /Private file cleanup is pending/);
  assert.match(protectionSource, /Retry cleanup/);
  assert.match(protectionSource, /Private-byte cleanup remains pending/);
});