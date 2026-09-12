import crypto from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { getEnv } from "../lib/env.js";
import { purgeExpiredLoginActivities } from "../lib/login-activity.js";
import { evaluatePlanning } from "../lib/planning-jobs.js";
import { runVaultDeletionMaintenance } from "./premium-tools.js";
import { runAccountComplianceMaintenance } from "../lib/account-compliance.js";
import {
  getPinAttemptCleanupHealth,
  runTrackedPinLoginAttemptCleanup,
} from "../lib/account-pin-attempt-cleanup.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

function hasCronAuthorization(req: Request): boolean {
  const secret = getEnv("CRON_SECRET");
  const supplied = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice("Bearer ".length)
    : "";
  if (!secret || !supplied) return false;
  const expectedHash = crypto.createHash("sha256").update(secret).digest();
  const suppliedHash = crypto.createHash("sha256").update(supplied).digest();
  return crypto.timingSafeEqual(expectedHash, suppliedHash);
}

router.get("/internal/purge-login-activities", async (req, res): Promise<void> => {
  if (!getEnv("CRON_SECRET")) {
    res.status(503).json({ error: "Scheduled maintenance is not configured" });
    return;
  }
  if (!hasCronAuthorization(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const deleted = await purgeExpiredLoginActivities();
  res.json({ deleted });
});

router.get("/internal/evaluate-planning", async (req, res): Promise<void> => {
  if (!getEnv("CRON_SECRET")) {
    res.status(503).json({ error: "Scheduled planning is not configured" });
    return;
  }
  if (!hasCronAuthorization(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json(await evaluatePlanning());
});

router.get("/internal/cleanup-vault-deletions", async (req, res): Promise<void> => {
  if (!getEnv("CRON_SECRET")) {
    res.status(503).json({ error: "Scheduled maintenance is not configured" });
    return;
  }
  if (!hasCronAuthorization(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json(await runVaultDeletionMaintenance(100));
});

router.get("/internal/process-account-deletions", async (req, res): Promise<void> => {
  if (!getEnv("CRON_SECRET")) {
    res.status(503).json({ error: "Scheduled maintenance is not configured" });
    return;
  }
  if (!hasCronAuthorization(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json(await runAccountComplianceMaintenance());
});

router.get("/internal/cleanup-pin-attempts", async (req, res): Promise<void> => {
  if (!getEnv("CRON_SECRET")) {
    res.status(503).json({ error: "Scheduled maintenance is not configured" });
    return;
  }
  if (!hasCronAuthorization(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const acquired = await runTrackedPinLoginAttemptCleanup(logger);
  res.json({ acquired, health: getPinAttemptCleanupHealth() });
});

export default router;
