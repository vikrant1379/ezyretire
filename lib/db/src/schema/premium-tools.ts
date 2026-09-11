import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { defaultIstNow, istTimestamp } from "./ist-timestamp.js";
import { usersTable } from "./auth.js";
import { expensesTable } from "./finance.js";

export const premiumEntitlementsTable = pgTable("premium_entitlements", {
  userId: varchar("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  plan: varchar("plan", { length: 16 }).notNull().default("free"),
  active: boolean("active").notNull().default(false),
  source: varchar("source", { length: 32 }).notNull().default("none"),
  validUntil: istTimestamp("valid_until"),
  updatedAt: istTimestamp("updated_at").notNull().default(defaultIstNow).$onUpdate(() => new Date()),
}, (table) => [
  check("premium_entitlements_plan_check", sql`${table.plan} in ('free', 'premium')`),
]);

export const vaultDocumentsTable = pgTable("vault_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  objectPath: varchar("object_path", { length: 1024 }).notNull(),
  name: varchar("name", { length: 240 }).notNull(),
  contentType: varchar("content_type", { length: 120 }).notNull(),
  size: integer("size").notNull(),
  category: varchar("category", { length: 64 }).notNull().default("other"),
  expiresOn: date("expires_on", { mode: "string" }),
  archivedAt: istTimestamp("archived_at"),
  createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
  updatedAt: istTimestamp("updated_at").notNull().default(defaultIstNow).$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("vault_documents_object_path_idx").on(table.objectPath),
  index("vault_documents_user_created_idx").on(table.userId, table.createdAt),
]);

export const vaultUploadGrantsTable = pgTable("vault_upload_grants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  objectPath: varchar("object_path", { length: 1024 }).notNull(),
  name: varchar("name", { length: 240 }).notNull(),
  contentType: varchar("content_type", { length: 120 }).notNull(),
  size: integer("size").notNull(),
  expiresAt: istTimestamp("expires_at").notNull(),
  consumedAt: istTimestamp("consumed_at"),
  purpose: varchar("purpose", { length: 32 }).notNull().default("vault_document"),
  promotedObjectPath: varchar("promoted_object_path", { length: 1024 }),
  documentId: varchar("document_id").references(() => vaultDocumentsTable.id, { onDelete: "set null" }),
  claimedAt: istTimestamp("claimed_at"),
  createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
}, (table) => [
  uniqueIndex("vault_upload_grants_object_idx").on(table.objectPath),
  index("vault_upload_grants_user_expires_idx").on(table.userId, table.expiresAt),
  check("vault_upload_grants_purpose_check", sql`${table.purpose} in ('vault_document', 'receipt_review', 'financial_restore')`),
]);

export const vaultDeletionJobsTable = pgTable("vault_deletion_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  objectPath: varchar("object_path", { length: 1024 }).notNull(),
  reason: varchar("reason", { length: 64 }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastError: varchar("last_error", { length: 500 }),
  lastAttemptAt: istTimestamp("last_attempt_at"),
  finalizeAfter: istTimestamp("finalize_after"),
  createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
  updatedAt: istTimestamp("updated_at").notNull().default(defaultIstNow).$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("vault_deletion_jobs_object_idx").on(table.objectPath),
  index("vault_deletion_jobs_user_created_idx").on(table.userId, table.createdAt),
]);

export const receiptReviewsTable = pgTable("receipt_reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  documentId: varchar("document_id").references(() => vaultDocumentsTable.id, { onDelete: "set null" }),
  confirmedExpenseId: varchar("confirmed_expense_id").references(() => expensesTable.id, { onDelete: "restrict" }),
  confirmedExpenseDeletedId: varchar("confirmed_expense_deleted_id"),
  confirmedExpenseDeletedAt: istTimestamp("confirmed_expense_deleted_at"),
  cleanupObjectPath: varchar("cleanup_object_path", { length: 1024 }),
  candidates: jsonb("candidates").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  confirmedValues: jsonb("confirmed_values"),
  retainOriginal: boolean("retain_original").notNull().default(false),
  expiresAt: istTimestamp("expires_at").notNull(),
  confirmedAt: istTimestamp("confirmed_at"),
  createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
}, (table) => [
  check("receipt_reviews_status_check", sql`${table.status} in ('pending', 'confirmed', 'discarded')`),
  index("receipt_reviews_user_created_idx").on(table.userId, table.createdAt),
  index("receipt_reviews_expires_idx").on(table.expiresAt),
  uniqueIndex("receipt_reviews_document_unique_idx").on(table.documentId)
    .where(sql`${table.documentId} is not null`),
]);

export const storageBrokerNoncesTable = pgTable("storage_broker_nonces", {
  nonce: varchar("nonce", { length: 36 }).primaryKey(),
  createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
  expiresAt: istTimestamp("expires_at").notNull(),
}, (table) => [
  index("storage_broker_nonces_expires_idx").on(table.expiresAt),
]);

export const nomineesTable = pgTable("nominees", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  relationship: varchar("relationship", { length: 64 }).notNull(),
  allocationPercent: integer("allocation_percent").notNull(),
  coverageType: varchar("coverage_type", { length: 32 }).notNull().default("other"),
  coverageLabel: varchar("coverage_label", { length: 160 }).notNull().default("General"),
  institution: varchar("institution", { length: 160 }),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  reviewStatus: varchar("review_status", { length: 24 }).notNull().default("not_reviewed"),
  reminderOn: date("reminder_on", { mode: "string" }),
  dateOfBirth: date("date_of_birth", { mode: "string" }),
  contact: varchar("contact", { length: 160 }),
  notes: varchar("notes", { length: 1000 }),
  createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
  updatedAt: istTimestamp("updated_at").notNull().default(defaultIstNow).$onUpdate(() => new Date()),
}, (table) => [
  check("nominees_allocation_check", sql`${table.allocationPercent} between 0 and 100`),
  check("nominees_coverage_type_check", sql`${table.coverageType} in ('life', 'health', 'investment', 'other')`),
  check("nominees_status_check", sql`${table.status} in ('active', 'needs_review', 'inactive')`),
  check("nominees_review_status_check", sql`${table.reviewStatus} in ('not_reviewed', 'reviewed', 'needs_update')`),
  index("nominees_user_created_idx").on(table.userId, table.createdAt),
]);

export const insertVaultDocumentSchema = createInsertSchema(vaultDocumentsTable)
  .omit({ id: true, createdAt: true, updatedAt: true, archivedAt: true });
export const insertNomineeSchema = createInsertSchema(nomineesTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type VaultDocument = typeof vaultDocumentsTable.$inferSelect;
export type InsertVaultDocument = z.infer<typeof insertVaultDocumentSchema>;
export type Nominee = typeof nomineesTable.$inferSelect;
export type InsertNominee = z.infer<typeof insertNomineeSchema>;