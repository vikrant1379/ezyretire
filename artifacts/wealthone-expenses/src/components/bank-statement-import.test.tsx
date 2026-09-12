import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  reviewForActiveBankStatementAccount,
  type AccountBoundBankStatementReview,
} from "./bank-statement-import.tsx";
import {
  capturePrivateQueryGeneration,
  synchronizeAccountQueryCache,
} from "../lib/query-policy.ts";
import type { BankStatementReview } from "../lib/bank-statement-import.ts";
import { commitBankStatementImport } from "../lib/financial-api.ts";

const review = {
  bank: "HDFC",
  version: "hdfc-v1-csv",
  importId: "a".repeat(64),
  confidence: 0.94,
  rows: [],
  issues: [],
} satisfies BankStatementReview;

test("an account switch invalidates a component's parsed bank statement review", () => {
  const queryClient = new QueryClient();
  synchronizeAccountQueryCache(queryClient, "account-a");
  const bound = {
    accountId: "account-a",
    generation: capturePrivateQueryGeneration(queryClient),
    review,
  } satisfies AccountBoundBankStatementReview;

  assert.equal(reviewForActiveBankStatementAccount(bound, "account-a", queryClient), review);
  synchronizeAccountQueryCache(queryClient, "account-b");
  assert.equal(reviewForActiveBankStatementAccount(bound, "account-b", queryClient), null);
  assert.equal(reviewForActiveBankStatementAccount(bound, "account-a", queryClient), null);
});

test("the review UI visibly lists parser omissions", async () => {
  const source = await readFile(new URL("./bank-statement-import.tsx", import.meta.url), "utf8");
  assert.match(source, /data-testid="bank-statement-review-issues"/);
  assert.match(source, /Row \{issue\.row\}: \{issue\.message\}/);
});

test("the bank import client sends the account captured with the review", async () => {
  const originalFetch = globalThis.fetch;
  let payload: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input, init) => {
    payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      added: [],
      duplicateCount: 0,
      data: {},
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    await commitBankStatementImport([], "account-a");
    assert.equal(payload?.expectedAccountId, "account-a");
    assert.deepEqual(payload?.rows, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});