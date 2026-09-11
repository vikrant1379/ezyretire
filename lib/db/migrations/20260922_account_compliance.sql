CREATE TABLE IF NOT EXISTS "account_data_exports" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar NOT NULL,
  "format_version" varchar(16) NOT NULL,
  "status" varchar(16) DEFAULT 'started' NOT NULL,
  "record_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "requested_at" timestamp DEFAULT timezone('Asia/Kolkata', now()) NOT NULL,
  "completed_at" timestamp,
  CONSTRAINT "account_data_exports_status_check"
    CHECK ("status" IN ('started', 'complete', 'failed'))
);

CREATE INDEX IF NOT EXISTS "account_data_exports_user_requested_idx"
  ON "account_data_exports" ("user_id", "requested_at");

CREATE TABLE IF NOT EXISTS "account_deletion_requests" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar NOT NULL,
  "account_hash" varchar(64) NOT NULL,
  "email_hash" varchar(64),
  "status" varchar(24) DEFAULT 'cooling_off' NOT NULL,
  "requested_at" timestamp DEFAULT timezone('Asia/Kolkata', now()) NOT NULL,
  "scheduled_for" timestamp NOT NULL,
  "cancelled_at" timestamp,
  "processing_started_at" timestamp,
  "completed_at" timestamp,
  "last_error" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "retained_until" timestamp NOT NULL,
  CONSTRAINT "account_deletion_status_check"
    CHECK ("status" IN ('cooling_off', 'cancelled', 'processing', 'blocked', 'completed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "account_deletion_active_user_idx"
  ON "account_deletion_requests" ("user_id")
  WHERE "status" IN ('cooling_off', 'processing', 'blocked');

CREATE INDEX IF NOT EXISTS "account_deletion_scheduled_idx"
  ON "account_deletion_requests" ("status", "scheduled_for");

CREATE INDEX IF NOT EXISTS "account_deletion_hash_idx"
  ON "account_deletion_requests" ("account_hash");

CREATE INDEX IF NOT EXISTS "account_deletion_email_hash_idx"
  ON "account_deletion_requests" ("email_hash");

ALTER TABLE "account_deletion_requests"
  ADD COLUMN IF NOT EXISTS "processing_lease_until" timestamp;
ALTER TABLE "account_deletion_requests"
  ADD COLUMN IF NOT EXISTS "processing_lease_token" varchar(64);