import {
  integer,
  pgTable,
  serial,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { adviceRequestsTable } from "./advice.js";
import { defaultIstNow, istTimestamp } from "./ist-timestamp.js";

export const whatsappNotificationEventsTable = pgTable(
  "whatsapp_notification_events",
  {
    id: serial("id").primaryKey(),
    adviceRequestId: integer("advice_request_id")
      .notNull()
      .references(() => adviceRequestsTable.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 32 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(1),
    providerMessageId: varchar("provider_message_id", { length: 160 }),
    error: text("error"),
    createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
    lastAttemptAt: istTimestamp("last_attempt_at").notNull().default(defaultIstNow),
    completedAt: istTimestamp("completed_at"),
  },
  (table) => [
    uniqueIndex("whatsapp_notification_request_event_unique").on(
      table.adviceRequestId,
      table.eventType,
    ),
  ],
);

export type WhatsappNotificationEvent = typeof whatsappNotificationEventsTable.$inferSelect;