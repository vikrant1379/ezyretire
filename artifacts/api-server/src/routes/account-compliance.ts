import {
  accountDeletionRequestsTable, db, usersTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { getSession, getSessionId } from "../lib/auth.js";
import {
  streamAccountExportZip,
  processAccountDeletion,
  scheduleAccountDeletion,
} from "../lib/account-compliance.js";

const router: IRouter = Router();
const RECENT_AUTH_MS = 15 * 60_000;

function requireUser(req: Request, res: Response): req is Request & Express.AuthedRequest {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Login required" });
    return false;
  }
  return true;
}

async function hasRecentAuthentication(req: Request): Promise<boolean> {
  const sid = getSessionId(req);
  if (!sid) return false;
  const session = await getSession(sid);
  const stepUp = session?.emailStepUp;
  let emailStepUpAt = 0;
  if (stepUp && stepUp.userId === req.user?.id) emailStepUpAt = stepUp.verifiedAt;
  const verifiedAt = Math.max(
    session?.authenticatedAt ?? 0,
    emailStepUpAt,
  );
  return verifiedAt >= Date.now() - RECENT_AUTH_MS;
}

async function currentDeletion(userId: string) {
  const [row] = await db.select().from(accountDeletionRequestsTable)
    .where(eq(accountDeletionRequestsTable.userId, userId))
    .orderBy(desc(accountDeletionRequestsTable.requestedAt)).limit(1);
  return row;
}

function deletionJson(row: typeof accountDeletionRequestsTable.$inferSelect | undefined) {
  if (!row) return { status: "none" as const };
  return {
    id: row.id,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    scheduledFor: row.scheduledFor.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    attempts: row.attempts,
    retryingObjectCleanup: row.status === "blocked",
  };
}

router.get("/account/export", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  res.setHeader("cache-control", "no-store, private, max-age=0");
  res.setHeader("pragma", "no-cache");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("content-disposition", `attachment; filename="ezyretire-personal-data-${new Date().toISOString().slice(0, 10)}.zip"`);
  res.type("application/zip");
  try {
    const found = await streamAccountExportZip(req.user.id, res);
    if (!found && !res.headersSent) res.status(404).json({ error: "Account not found" });
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ error: "Personal data export failed" });
    else res.destroy(error instanceof Error ? error : undefined);
    return;
  }
});

router.get("/account/deletion", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const current = await currentDeletion(req.user.id);
  if (current && ["cooling_off", "processing", "blocked"].includes(current.status)
    && current.scheduledFor <= new Date()) {
    const result = await processAccountDeletion(req.user.id);
    if (result === "completed") {
      const [completed] = await db.select().from(accountDeletionRequestsTable)
        .where(eq(accountDeletionRequestsTable.id, current.id)).limit(1);
      res.setHeader("cache-control", "no-store");
      res.setHeader("clear-site-data", '"cache", "cookies", "storage"');
      res.clearCookie("sid", { path: "/" });
      res.json(deletionJson(completed));
      return;
    }
  }
  res.setHeader("cache-control", "no-store");
  res.json(deletionJson(await currentDeletion(req.user.id)));
});

router.post("/account/deletion", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  if (!await hasRecentAuthentication(req)) {
    res.status(403).json({
      error: "Recent authentication is required. Sign in again before deleting your account.",
      code: "RECENT_AUTH_REQUIRED",
    });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id)).limit(1);
  const confirmation = typeof req.body?.confirmation === "string" ? req.body.confirmation.trim() : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!user || confirmation !== "DELETE MY ACCOUNT"
    || !user.email || email !== user.email.toLowerCase()) {
    res.status(400).json({ error: "Enter your account email and DELETE MY ACCOUNT exactly." });
    return;
  }
  const scheduled = await scheduleAccountDeletion(req.user.id, user.email);
  res.setHeader("clear-site-data", '"cache", "cookies", "storage"');
  res.clearCookie("sid", { path: "/" });
  res.status(scheduled.created ? 202 : 200).json(deletionJson(scheduled.request));
});

router.delete("/account/deletion", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const [cancelled] = await db.update(accountDeletionRequestsTable).set({
    status: "cancelled", cancelledAt: new Date(), lastError: null,
  }).where(and(
    eq(accountDeletionRequestsTable.userId, req.user.id),
    eq(accountDeletionRequestsTable.status, "cooling_off"),
  )).returning();
  if (!cancelled) {
    res.status(409).json({ error: "Deletion can no longer be cancelled." });
    return;
  }
  res.json(deletionJson(cancelled));
});

export default router;