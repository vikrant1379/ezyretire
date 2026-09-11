import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { defaultIstNow, istTimestamp } from "./ist-timestamp.js";

export const sessionsTable = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: istTimestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

export const usersTable = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  emailVerifiedAt: istTimestamp("email_verified_at"),
  passwordHash: varchar("password_hash"),
  pinHash: varchar("pin_hash", { length: 255 }),
  pinFailedAttempts: integer("pin_failed_attempts").notNull().default(0),
  pinLockedUntil: istTimestamp("pin_locked_until"),
  profileImageUrl: varchar("profile_image_url"),
  fullName: varchar("full_name", { length: 100 }),
  dateOfBirth: date("date_of_birth", { mode: "string" }),
  gender: varchar("gender", { length: 32 }),
  phone: varchar("phone", { length: 24 }),
  phoneVerifiedAt: istTimestamp("phone_verified_at"),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
  updatedAt: istTimestamp("updated_at")
    .notNull()
    .default(defaultIstNow)
    .$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("users_verified_phone_unique_idx").on(table.phone)
    .where(sql`${table.phone} is not null and ${table.phoneVerifiedAt} is not null`),
]);

export const pinLoginAttemptsTable = pgTable(
  "pin_login_attempts",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    accountHash: varchar("account_hash", { length: 64 }).notNull(),
    requesterHash: varchar("requester_hash", { length: 64 }).notNull(),
    succeeded: boolean("succeeded").notNull().default(false),
    createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
  },
  (table) => [
    index("pin_login_attempts_account_created_idx").on(table.accountHash, table.createdAt),
    index("pin_login_attempts_requester_created_idx").on(table.requesterHash, table.createdAt),
    index("pin_login_attempts_created_idx").on(table.createdAt),
  ],
);

export const emailOtpChallengesTable = pgTable(
  "email_otp_challenges",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    email: varchar("email", { length: 320 }).notNull(),
    requesterHash: varchar("requester_hash", { length: 64 }).notNull(),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    expiresAt: istTimestamp("expires_at").notNull(),
    deliveredAt: istTimestamp("delivered_at"),
    consumedAt: istTimestamp("consumed_at"),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    resendAvailableAt: istTimestamp("resend_available_at").notNull(),
    createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
  },
  (table) => [
    index("email_otp_challenges_email_created_idx").on(table.email, table.createdAt),
    index("email_otp_challenges_requester_created_idx").on(table.requesterHash, table.createdAt),
    index("email_otp_challenges_expires_idx").on(table.expiresAt),
  ],
);

export const mobileOtpChallengesTable = pgTable(
  "mobile_otp_challenges",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    phone: varchar("phone", { length: 24 }).notNull(),
    requesterHash: varchar("requester_hash", { length: 64 }).notNull(),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    deliveryChannel: varchar("delivery_channel", { length: 16 }).notNull(),
    expiresAt: istTimestamp("expires_at").notNull(),
    deliveredAt: istTimestamp("delivered_at"),
    consumedAt: istTimestamp("consumed_at"),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    resendAvailableAt: istTimestamp("resend_available_at").notNull(),
    deliveryAttemptId: varchar("delivery_attempt_id", { length: 36 }),
    deliveryLeaseUntil: istTimestamp("delivery_lease_until"),
    createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
  },
  (table) => [
    check("mobile_otp_delivery_channel_check", sql`${table.deliveryChannel} in ('sms', 'email')`),
    index("mobile_otp_user_created_idx").on(table.userId, table.createdAt),
    index("mobile_otp_requester_created_idx").on(table.requesterHash, table.createdAt),
    index("mobile_otp_expires_idx").on(table.expiresAt),
  ],
);

export const mobileOtpDeliveryAttemptsTable = pgTable(
  "mobile_otp_delivery_attempts",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    challengeId: varchar("challenge_id")
      .notNull()
      .references(() => mobileOtpChallengesTable.id, { onDelete: "cascade" }),
    requesterHash: varchar("requester_hash", { length: 128 }).notNull(),
    createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
  },
  (table) => [
    index("mobile_otp_delivery_attempts_user_created_idx").on(table.userId, table.createdAt),
    index("mobile_otp_delivery_attempts_requester_created_idx").on(table.requesterHash, table.createdAt),
    index("mobile_otp_delivery_attempts_challenge_idx").on(table.challengeId),
  ],
);

export const passkeyCredentialsTable = pgTable(
  "passkey_credentials",
  {
    id: varchar("id", { length: 1024 }).primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    publicKey: varchar("public_key", { length: 4096 }).notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: jsonb("transports").$type<string[]>().notNull().default([]),
    deviceType: varchar("device_type", { length: 32 }),
    backedUp: boolean("backed_up").notNull().default(false),
    lastUsedAt: istTimestamp("last_used_at"),
    revokedAt: istTimestamp("revoked_at"),
    createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
    updatedAt: istTimestamp("updated_at").notNull().default(defaultIstNow),
  },
  (table) => [
    index("passkey_credentials_user_created_idx").on(table.userId, table.createdAt),
    index("passkey_credentials_active_idx").on(table.userId, table.revokedAt),
  ],
);

export const passkeyChallengesTable = pgTable(
  "passkey_challenges",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    type: varchar("type", { length: 16 }).notNull(),
    challenge: varchar("challenge", { length: 512 }).notNull(),
    rpId: varchar("rp_id", { length: 255 }).notNull(),
    rpOrigin: varchar("rp_origin", { length: 512 }).notNull(),
    userId: varchar("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
    requesterHash: varchar("requester_hash", { length: 64 }).notNull(),
    browserBindingHash: varchar("browser_binding_hash", { length: 64 }).notNull(),
    expiresAt: istTimestamp("expires_at").notNull(),
    consumedAt: istTimestamp("consumed_at"),
    createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
  },
  (table) => [
    check("passkey_challenges_type_check", sql`${table.type} in ('registration', 'authentication')`),
    index("passkey_challenges_requester_created_idx").on(table.requesterHash, table.createdAt),
    index("passkey_challenges_expires_idx").on(table.expiresAt),
  ],
);

export const passkeyAuditEventsTable = pgTable(
  "passkey_audit_events",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    credentialId: varchar("credential_id", { length: 1024 }),
    event: varchar("event", { length: 24 }).notNull(),
    createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
  },
  (table) => [
    check("passkey_audit_events_event_check", sql`${table.event} in ('registered', 'renamed', 'revoked', 'authenticated')`),
    index("passkey_audit_events_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const loginActivitiesTable = pgTable(
  "login_activities",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    authMethod: varchar("auth_method", { length: 16 }).notNull(),
    deviceType: varchar("device_type", { length: 32 }),
    browser: varchar("browser", { length: 80 }),
    operatingSystem: varchar("operating_system", { length: 80 }),
    country: varchar("country", { length: 2 }),
    region: varchar("region", { length: 100 }),
    city: varchar("city", { length: 100 }),
    createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
  },
  (table) => [
    check("login_activities_auth_method_check", sql`${table.authMethod} in ('email_otp', 'oidc', 'passkey', 'pin')`),
    index("login_activities_created_idx").on(table.createdAt),
    index("login_activities_user_created_idx").on(table.userId, table.createdAt),
  ],
);

/**
 * Compliance lifecycle metadata is deliberately separate from the customer
 * row and has no FK.  A minimal audit record therefore survives account
 * erasure without preventing the customer row and all of its children from
 * being deleted.
 */
export const accountDataExportsTable = pgTable(
  "account_data_exports",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull(),
    formatVersion: varchar("format_version", { length: 16 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("started"),
    recordCounts: jsonb("record_counts").$type<Record<string, number>>().notNull().default({}),
    requestedAt: istTimestamp("requested_at").notNull().default(defaultIstNow),
    completedAt: istTimestamp("completed_at"),
  },
  (table) => [
    check("account_data_exports_status_check", sql`${table.status} in ('started', 'complete', 'failed')`),
    index("account_data_exports_user_requested_idx").on(table.userId, table.requestedAt),
  ],
);

export const accountDeletionRequestsTable = pgTable(
  "account_deletion_requests",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull(),
    accountHash: varchar("account_hash", { length: 64 }).notNull(),
    emailHash: varchar("email_hash", { length: 64 }),
    status: varchar("status", { length: 24 }).notNull().default("cooling_off"),
    requestedAt: istTimestamp("requested_at").notNull().default(defaultIstNow),
    scheduledFor: istTimestamp("scheduled_for").notNull(),
    cancelledAt: istTimestamp("cancelled_at"),
    processingStartedAt: istTimestamp("processing_started_at"),
    processingLeaseUntil: istTimestamp("processing_lease_until"),
    processingLeaseToken: varchar("processing_lease_token", { length: 64 }),
    nextAttemptAt: istTimestamp("next_attempt_at"),
    inventoryPhase: varchar("inventory_phase", { length: 32 }).notNull().default("vault_documents"),
    inventoryCursor: varchar("inventory_cursor", { length: 1024 }),
    inventoryCompletedAt: istTimestamp("inventory_completed_at"),
    completedAt: istTimestamp("completed_at"),
    lastError: text("last_error"),
    attempts: integer("attempts").notNull().default(0),
    retainedUntil: istTimestamp("retained_until").notNull(),
  },
  (table) => [
    check("account_deletion_status_check", sql`${table.status} in ('cooling_off', 'cancelled', 'processing', 'blocked', 'completed')`),
    uniqueIndex("account_deletion_active_user_idx").on(table.userId)
      .where(sql`${table.status} in ('cooling_off', 'processing', 'blocked')`),
    index("account_deletion_scheduled_idx").on(table.status, table.scheduledFor),
    index("account_deletion_hash_idx").on(table.accountHash),
    index("account_deletion_email_hash_idx").on(table.emailHash),
  ],
);

export const planningSchedulerStateTable = pgTable("planning_scheduler_state", {
  id: varchar("id", { length: 32 }).primaryKey(),
  cursorUserId: varchar("cursor_user_id"),
  updatedAt: istTimestamp("updated_at").notNull().default(defaultIstNow),
});

export const accountDeletionObjectsTable = pgTable(
  "account_deletion_objects",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    requestId: varchar("request_id").notNull()
      .references(() => accountDeletionRequestsTable.id, { onDelete: "cascade" }),
    userId: varchar("user_id").notNull(),
    objectPath: varchar("object_path", { length: 1024 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: varchar("last_error", { length: 500 }),
    lastAttemptAt: istTimestamp("last_attempt_at"),
    completedAt: istTimestamp("completed_at"),
    createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
  },
  (table) => [
    check("account_deletion_objects_status_check", sql`${table.status} in ('pending', 'complete')`),
    uniqueIndex("account_deletion_objects_request_path_idx").on(table.requestId, table.objectPath),
    index("account_deletion_objects_pending_idx").on(table.requestId, table.status, table.createdAt),
  ],
);

export type UpsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;
