import { db, pinLoginAttemptsTable } from "@workspace/db";
import { lt, sql } from "drizzle-orm";

const PIN_ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;
const PIN_ATTEMPT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
export const PIN_ATTEMPT_CLEANUP_LOCK_NAMESPACE = 781443;
export const PIN_ATTEMPT_CLEANUP_LOCK_ID = 20260909;

const PIN_ATTEMPT_CLEANUP_ALERT_THRESHOLD = 3;
let nextCleanupAt = 0;

let cleanupHealth = {
  consecutiveFailures: 0,
  firstFailureAt: null as Date | null,
  lastFailureAt: null as Date | null,
  lastSuccessAt: null as Date | null,
};
export async function cleanExpiredPinLoginAttempts(now = new Date()): Promise<boolean> {
  return db.transaction(async (tx) => {
    const lockResult = await tx.execute<{ acquired: boolean }>(sql`
      select pg_try_advisory_xact_lock(
        ${PIN_ATTEMPT_CLEANUP_LOCK_NAMESPACE},
        ${PIN_ATTEMPT_CLEANUP_LOCK_ID}
      ) as acquired
    `);
    if (!lockResult.rows[0]?.acquired) return false;

    await tx.delete(pinLoginAttemptsTable).where(lt(
      pinLoginAttemptsTable.createdAt,
      new Date(now.getTime() - PIN_ATTEMPT_RETENTION_MS),
    ));
    return true;
  });
}

export async function runTrackedPinLoginAttemptCleanup(
  log: CleanupLogger,
  now = new Date(),
  cleanup: (at: Date) => Promise<boolean> = cleanExpiredPinLoginAttempts,
): Promise<boolean> {
  try {
    const acquired = await cleanup(now);
    if (!acquired) return false;

    const recoveredAfterFailures = cleanupHealth.consecutiveFailures
      >= PIN_ATTEMPT_CLEANUP_ALERT_THRESHOLD;
    cleanupHealth = {
      consecutiveFailures: 0,
      firstFailureAt: null,
      lastFailureAt: null,
      lastSuccessAt: now,
    };
    if (recoveredAfterFailures) {
      log.info(
        { cleanup: "pin-attempt-retention", status: "resolved" },
        "PIN attempt cleanup recovered",
      );
    }
    return true;
  } catch (error) {
    const previousFailures = cleanupHealth.consecutiveFailures;
    cleanupHealth = {
      ...cleanupHealth,
      consecutiveFailures: previousFailures + 1,
      firstFailureAt: cleanupHealth.firstFailureAt ?? now,
      lastFailureAt: now,
    };
    const details = {
      cleanup: "pin-attempt-retention",
      consecutiveFailures: cleanupHealth.consecutiveFailures,
      errorName: error instanceof Error ? error.name : "Unknown",
    };
    if (cleanupHealth.consecutiveFailures === PIN_ATTEMPT_CLEANUP_ALERT_THRESHOLD) {
      log.error(
        { ...details, status: "degraded" },
        "PIN attempt cleanup repeatedly failed",
      );
    } else {
      log.warn(details, "Expired PIN login attempts could not be cleaned");
    }
    throw error;
  }
}
export function schedulePinLoginAttemptCleanup(
  log: CleanupLogger,
  now = new Date(),
): void {
  if (now.getTime() < nextCleanupAt) return;
  nextCleanupAt = now.getTime() + PIN_ATTEMPT_CLEANUP_INTERVAL_MS;

  void runTrackedPinLoginAttemptCleanup(log, now).catch(() => undefined);
}

export function getPinAttemptCleanupHealth(): PinAttemptCleanupHealth {
  return {
    status: cleanupHealth.consecutiveFailures >= PIN_ATTEMPT_CLEANUP_ALERT_THRESHOLD
      ? "degraded"
      : "ok",
    consecutiveFailures: cleanupHealth.consecutiveFailures,
    alertThreshold: PIN_ATTEMPT_CLEANUP_ALERT_THRESHOLD,
    firstFailureAt: cleanupHealth.firstFailureAt?.toISOString() ?? null,
    lastFailureAt: cleanupHealth.lastFailureAt?.toISOString() ?? null,
    lastSuccessAt: cleanupHealth.lastSuccessAt?.toISOString() ?? null,
  };
}

type CleanupLogger = {
  info: (details: object, message: string) => void;
  warn: (details: object, message: string) => void;
  error: (details: object, message: string) => void;
};

export type PinAttemptCleanupHealth = {
  status: "ok" | "degraded";
  consecutiveFailures: number;
  alertThreshold: number;
  firstFailureAt: string | null;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
};
