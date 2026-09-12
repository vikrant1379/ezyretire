import assert from "node:assert/strict";
import test from "node:test";
import {
  getPinAttemptCleanupHealth,
  runTrackedPinLoginAttemptCleanup,
} from "./account-pin-attempt-cleanup.js";

function createLogger() {
  const entries: Array<{ level: string; details: object; message: string }> = [];
  return {
    entries,
    logger: {
      info: (details: object, message: string) => entries.push({ level: "info", details, message }),
      warn: (details: object, message: string) => entries.push({ level: "warn", details, message }),
      error: (details: object, message: string) => entries.push({ level: "error", details, message }),
    },
  };
}

test("repeated PIN cleanup failures raise aggregate health and later success resolves it", async () => {
  const { entries, logger } = createLogger();
  const failure = async () => {
    throw new TypeError("database unavailable");
  };
  const base = new Date("2026-09-10T10:00:00.000Z");

  for (let index = 0; index < 3; index += 1) {
    await assert.rejects(
      runTrackedPinLoginAttemptCleanup(
        logger,
        new Date(base.getTime() + index * 60_000),
        failure,
      ),
      TypeError,
    );
  }

  assert.deepEqual(getPinAttemptCleanupHealth(), {
    status: "degraded",
    consecutiveFailures: 3,
    alertThreshold: 3,
    firstFailureAt: "2026-09-10T10:00:00.000Z",
    lastFailureAt: "2026-09-10T10:02:00.000Z",
    lastSuccessAt: null,
  });
  const alert = entries.find(({ level }) => level === "error");
  assert.deepEqual(alert, {
    level: "error",
    details: {
      cleanup: "pin-attempt-retention",
      consecutiveFailures: 3,
      errorName: "TypeError",
      status: "degraded",
    },
    message: "PIN attempt cleanup repeatedly failed",
  });
  assert.equal(JSON.stringify(entries).includes("database unavailable"), false);

  const recoveredAt = new Date("2026-09-10T10:03:00.000Z");
  assert.equal(
    await runTrackedPinLoginAttemptCleanup(logger, recoveredAt, async () => true),
    true,
  );
  assert.deepEqual(getPinAttemptCleanupHealth(), {
    status: "ok",
    consecutiveFailures: 0,
    alertThreshold: 3,
    firstFailureAt: null,
    lastFailureAt: null,
    lastSuccessAt: recoveredAt.toISOString(),
  });
  assert.equal(entries.at(-1)?.level, "info");
  assert.equal(entries.at(-1)?.message, "PIN attempt cleanup recovered");
});