import { Router, type IRouter, type Request, type Response } from "express";
import type { WhatsAppRetryResult } from "../lib/whatsapp-core.js";

type RetryNotification = (eventId: number) => Promise<WhatsAppRetryResult>;

function requireAdmin(req: Request, res: Response): req is Request & Express.AuthedRequest {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Login required" });
    return false;
  }
  if (!req.user.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  return true;
}

export function createWhatsAppAdminRouter(
  retryNotification: RetryNotification,
): IRouter {
  const router: IRouter = Router();

  router.post("/admin/whatsapp-events/:id/retry", async (req, res): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    const eventId = Number(req.params.id);
    if (!Number.isSafeInteger(eventId) || eventId <= 0) {
      res.status(400).json({ error: "Invalid notification event" });
      return;
    }

    const result = await retryNotification(eventId);
    if (result.outcome === "not_found") {
      res.status(404).json({ error: "Notification event not found" });
      return;
    }
    if (result.outcome === "invalid_event") {
      res.status(409).json({ error: "Notification event cannot be reconstructed" });
      return;
    }
    if (result.outcome === "not_retryable") {
      res.status(409).json({
        error: "Notification event is not retryable",
        status: result.status,
      });
      return;
    }
    res.json({
      status: result.delivery.status,
      providerMessageId: result.delivery.providerMessageId ?? null,
      error: result.delivery.error ?? null,
    });
  });

  return router;
}