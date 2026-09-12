import assert from "node:assert/strict";
import test from "node:test";
import { createDraftIdentity, runSingleSubmission } from "./form-submission.ts";

test("a delayed double submission runs once and a later retry can run", async () => {
  const gate = { current: false };
  let release!: () => void;
  let calls = 0;
  const first = runSingleSubmission(gate, async () => {
    calls += 1;
    await new Promise<void>((resolve) => { release = resolve; });
  });
  const duplicate = await runSingleSubmission(gate, async () => { calls += 1; });
  assert.equal(duplicate, false);
  assert.equal(calls, 1);
  release();
  assert.equal(await first, true);
  assert.equal(await runSingleSubmission(gate, async () => { calls += 1; }), true);
  assert.equal(calls, 2);
});

test("draft identity remains stable until the caller starts a new draft", () => {
  const identity = createDraftIdentity(
    () => "stable-id",
    () => new Date("2025-03-01T00:00:00Z"),
  );
  assert.deepEqual(identity, { id: "stable-id", createdAt: "2025-03-01T00:00:00.000Z" });
});