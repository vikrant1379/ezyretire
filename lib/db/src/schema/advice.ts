import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { usersTable } from "./auth.js";
import { defaultIstNow, istTimestamp } from "./ist-timestamp.js";

export const adviceSettingsTable = pgTable("advice_settings", {
  id: integer("id").primaryKey().default(1),
  consultationFee: integer("consultation_fee").notNull().default(99),
  currency: varchar("currency", { length: 3 }).notNull().default("INR"),
  businessWhatsapp: varchar("business_whatsapp", { length: 24 }).notNull().default(""),
  upiId: varchar("upi_id", { length: 160 }).notNull().default(""),
  updatedAt: istTimestamp("updated_at")
    .notNull()
    .default(defaultIstNow)
    .$onUpdate(() => new Date()),
});

export const advisorsTable = pgTable("advisors", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  credentials: text("credentials").notNull().default(""),
  bio: text("bio").notNull().default(""),
  specialties: text("specialties").array().notNull().default([]),
  languages: text("languages").array().notNull().default([]),
  availability: text("availability").notNull().default(""),
  whatsapp: varchar("whatsapp", { length: 24 }).notNull(),
  phone: varchar("phone", { length: 24 }).notNull().default(""),
  bookingUrl: text("booking_url").notNull().default(""),
  photoUrl: text("photo_url").notNull().default(""),
  active: boolean("active").notNull().default(true),
  createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
  updatedAt: istTimestamp("updated_at")
    .notNull()
    .default(defaultIstNow)
    .$onUpdate(() => new Date()),
});

export const adviceRequestsTable = pgTable(
  "advice_requests",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    userName: varchar("user_name", { length: 160 }).notNull(),
    userEmail: varchar("user_email", { length: 320 }).notNull().default(""),
    whatsappNumber: varchar("whatsapp_number", { length: 24 }).notNull(),
    topic: varchar("topic", { length: 32 }).notNull(),
    note: text("note").notNull().default(""),
    consent: boolean("consent").notNull(),
    feeAmount: integer("fee_amount").notNull().default(99),
    paymentStatus: varchar("payment_status", { length: 24 }).notNull().default("pending"),
    paymentReference: varchar("payment_reference", { length: 160 }),
    paymentSubmittedAt: istTimestamp("payment_submitted_at"),
    status: varchar("status", { length: 24 }).notNull().default("submitted"),
    advisorId: integer("advisor_id").references(() => advisorsTable.id, {
      onDelete: "set null",
    }),
    createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
    updatedAt: istTimestamp("updated_at")
      .notNull()
      .default(defaultIstNow)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("advice_requests_one_active_per_user")
      .on(
        table.userId,
        sql`(case when ${table.status} not in ('completed', 'cancelled') then 1 else null end)`,
      ),
  ],
);