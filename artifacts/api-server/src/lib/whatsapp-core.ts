export type NotificationEventType = "request_created" | "advisor_assigned";

export type TemplateNotification = {
  adviceRequestId: number;
  eventType: NotificationEventType;
  to: string;
  parameters: string[];
};

export type DeliveryResult = {
  status: "sent" | "failed" | "skipped";
  providerMessageId?: string;
  error?: string;
};

export type QueueResult =
  | { claimed: false }
  | { claimed: true; result: DeliveryResult };

export type RetryableEvent = {
  adviceRequestId: number;
  eventType: string;
  status: string;
  to: string;
  userName: string;
  advisorName: string | null;
};

export type WhatsAppRetryResult =
  | { outcome: "not_found" }
  | { outcome: "not_retryable"; status: string }
  | { outcome: "invalid_event" }
  | { outcome: "attempted"; delivery: DeliveryResult };

type NotificationDependencies = {
  claimEvent: (notification: TemplateNotification) => Promise<number | null>;
  deliver: (notification: TemplateNotification) => Promise<DeliveryResult>;
  recordResult: (eventId: number, result: DeliveryResult) => Promise<void>;
  onQueueError?: (notification: TemplateNotification, error: unknown) => void;
  onRecordError?: (notification: TemplateNotification, error: unknown) => void;
  onResult?: (notification: TemplateNotification, result: DeliveryResult) => void;
};

type RetryDependencies = {
  loadEvent: (eventId: number) => Promise<RetryableEvent | null>;
  queue: (notification: TemplateNotification) => Promise<QueueResult>;
};

function normalizePhone(phone: string) {
  return phone.replace(/[^\d]/g, "");
}

export function buildWhatsAppProviderPayload(
  notification: TemplateNotification,
  templateName: string,
  language = "en_US",
) {
  return {
    messaging_product: "whatsapp",
    to: normalizePhone(notification.to),
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      ...(notification.parameters.length > 0
        ? {
            components: [
              {
                type: "body",
                parameters: notification.parameters.map((text) => ({
                  type: "text",
                  text,
                })),
              },
            ],
          }
        : {}),
    },
  };
}

export function createWhatsAppQueue(dependencies: NotificationDependencies) {
  return async (notification: TemplateNotification): Promise<QueueResult> => {
    let eventId: number | null;
    try {
      eventId = await dependencies.claimEvent(notification);
      if (eventId === null) return { claimed: false };
    } catch (error) {
      dependencies.onQueueError?.(notification, error);
      return { claimed: false };
    }

    let result: DeliveryResult;
    try {
      result = await dependencies.deliver(notification);
    } catch (error) {
      result = {
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 500) : "Unknown delivery error",
      };
    }

    try {
      await dependencies.recordResult(eventId, result);
    } catch (error) {
      dependencies.onRecordError?.(notification, error);
    }
    dependencies.onResult?.(notification, result);
    return { claimed: true, result };
  };
}

export function createWhatsAppRetry(dependencies: RetryDependencies) {
  return async (eventId: number): Promise<WhatsAppRetryResult> => {
    const event = await dependencies.loadEvent(eventId);
    if (!event) return { outcome: "not_found" };
    if (event.status !== "failed" && event.status !== "skipped") {
      return { outcome: "not_retryable", status: event.status };
    }

    let notification: TemplateNotification;
    if (event.eventType === "request_created") {
      notification = {
        adviceRequestId: event.adviceRequestId,
        eventType: "request_created",
        to: event.to,
        parameters: [event.userName, String(event.adviceRequestId)],
      };
    } else if (event.eventType === "advisor_assigned" && event.advisorName) {
      notification = {
        adviceRequestId: event.adviceRequestId,
        eventType: "advisor_assigned",
        to: event.to,
        parameters: [event.userName, event.advisorName],
      };
    } else {
      return { outcome: "invalid_event" };
    }

    const queued = await dependencies.queue(notification);
    if (!queued.claimed) {
      return { outcome: "not_retryable", status: "pending_or_sent" };
    }
    return { outcome: "attempted", delivery: queued.result };
  };
}