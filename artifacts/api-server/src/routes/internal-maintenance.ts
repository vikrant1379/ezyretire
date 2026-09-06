import crypto from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { getEnv } from "../lib/env.js";
import { purgeExpiredLoginActivities } from "../lib/login-activity.js";

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

export default router;