import { db } from "@workspace/db";
import {
  adviceRequestsTable,
  advisorsTable,
  whatsappNotificationEventsTable,
} from "@workspace/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import {
  buildWhatsAppProviderPayload,
  createWhatsAppRetry,
  createWhatsAppQueue,
  type DeliveryResult,
  type NotificationEventType,
  type TemplateNotification,
} from "./whatsapp-core.js";
import { getEnv } from "./env.js";
const graphApiVersion = getEnv("WHATSAPP_GRAPH_API_VERSION") ?? "v20.0";
const graphApiBaseUrl = `https://graph.facebook.com/${graphApiVersion}`;

function getTemplateName(eventType: NotificationEventType) {
  return eventType === "request_created"
    ? getEnv("WHATSAPP_REQUEST_TEMPLATE_NAME")
    : getEnv("WHATSAPP_ASSIGNMENT_TEMPLATE_NAME");
}

async function sendTemplate(notification: TemplateNotification): Promise<DeliveryResult> {
  const accessToken = getEnv("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = getEnv("WHATSAPP_PHONE_NUMBER_ID");
  const templateName = getTemplateName(notification.eventType);

  if (!accessToken || !phoneNumberId || !templateName) {
    return {
      status: "skipped",
      error: "WhatsApp Business delivery is not configured",
    };
  }

  const response = await fetch(`${graphApiBaseUrl}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      buildWhatsAppProviderPayload(
        notification,
        templateName,
        getEnv("WHATSAPP_TEMPLATE_LANGUAGE"),
      ),
    ),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    return {
      status: "failed",
      error: `WhatsApp provider returned HTTP ${response.status}`,
    };
  }

  const body = (await response.json()) as {
    messages?: Array<{ id?: string }>;
  };
  return {
    status: "sent",
    providerMessageId: body.messages?.[0]?.id,
  };
}

export const queueWhatsAppTemplate = createWhatsAppQueue({
  async claimEvent(notification) {
    const [event] = await db
      .insert(whatsappNotificationEventsTable)
      .values({
        adviceRequestId: notification.adviceRequestId,
        eventType: notification.eventType,
        status: "pending",
      })
      .onConflictDoUpdate({
        target: [
          whatsappNotificationEventsTable.adviceRequestId,
          whatsappNotificationEventsTable.eventType,
        ],
        set: {
          status: "pending",
          attemptCount: sql`${whatsappNotificationEventsTable.attemptCount} + 1`,
          providerMessageId: null,
          error: null,
          lastAttemptAt: sql`timezone('Asia/Kolkata', now())`,
          completedAt: null,
        },
        setWhere: inArray(whatsappNotificationEventsTable.status, ["failed", "skipped"]),
      })
      .returning({ id: whatsappNotificationEventsTable.id });
    return event?.id ?? null;
  },
  deliver: sendTemplate,
  async recordResult(eventId, result) {
    await db
      .update(whatsappNotificationEventsTable)
      .set({
        status: result.status,
        providerMessageId: result.providerMessageId ?? null,
        error: result.error ?? null,
        completedAt: new Date(),
      })
      .where(eq(whatsappNotificationEventsTable.id, eventId));
  },
  onQueueError(notification, error) {
    logger.error(
      {
        adviceRequestId: notification.adviceRequestId,
        eventType: notification.eventType,
        error: error instanceof Error ? error.message : "Unknown persistence error",
      },
      "Failed to queue WhatsApp delivery event",
    );
  },
  onRecordError(notification, error) {
    logger.error(
      {
        adviceRequestId: notification.adviceRequestId,
        eventType: notification.eventType,
        error: error instanceof Error ? error.message : "Unknown persistence error",
      },
      "Failed to record WhatsApp delivery event",
    );
  },
  onResult(notification, result) {
    if (result.status === "failed") {
      logger.warn(
        {
          adviceRequestId: notification.adviceRequestId,
          eventType: notification.eventType,
          error: result.error,
        },
        "WhatsApp notification delivery failed",
      );
    } else if (result.status === "skipped") {
      logger.info(
        {
          adviceRequestId: notification.adviceRequestId,
          eventType: notification.eventType,
        },
        "WhatsApp notification skipped because delivery is not configured",
      );
    }
  },
});

export const retryWhatsAppNotification = createWhatsAppRetry({
  async loadEvent(eventId) {
    const [event] = await db
      .select({
        adviceRequestId: whatsappNotificationEventsTable.adviceRequestId,
        eventType: whatsappNotificationEventsTable.eventType,
        status: whatsappNotificationEventsTable.status,
        to: adviceRequestsTable.whatsappNumber,
        userName: adviceRequestsTable.userName,
        advisorName: advisorsTable.name,
      })
      .from(whatsappNotificationEventsTable)
      .innerJoin(
        adviceRequestsTable,
        eq(whatsappNotificationEventsTable.adviceRequestId, adviceRequestsTable.id),
      )
      .leftJoin(advisorsTable, eq(adviceRequestsTable.advisorId, advisorsTable.id))
      .where(eq(whatsappNotificationEventsTable.id, eventId))
      .limit(1);
    return event ?? null;
  },
  queue: queueWhatsAppTemplate,
});
export async function scheduleWhatsAppTemplate(
  notification: TemplateNotification,
): Promise<void> {
  await queueWhatsAppTemplate(notification).catch((error) => {
    logger.error(
      {
        adviceRequestId: notification.adviceRequestId,
        eventType: notification.eventType,
        error: error instanceof Error ? error.message : "Unknown notification error",
      },
      "Unexpected WhatsApp notification failure",
    );
  });
}
