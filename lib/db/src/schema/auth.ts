import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgTable, varchar } from "drizzle-orm/pg-core";
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
  profileImageUrl: varchar("profile_image_url"),
  fullName: varchar("full_name", { length: 100 }),
  dateOfBirth: date("date_of_birth", { mode: "string" }),
  gender: varchar("gender", { length: 32 }),
  phone: varchar("phone", { length: 24 }),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
  updatedAt: istTimestamp("updated_at")
    .notNull()
    .default(defaultIstNow)
    .$onUpdate(() => new Date()),
});

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
    check("login_activities_auth_method_check", sql`${table.authMethod} in ('email_otp', 'oidc')`),
    index("login_activities_created_idx").on(table.createdAt),
    index("login_activities_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export type UpsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;