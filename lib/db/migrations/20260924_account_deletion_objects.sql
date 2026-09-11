CREATE TABLE IF NOT EXISTS "account_deletion_objects" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" varchar NOT NULL REFERENCES "account_deletion_requests" ("id") ON DELETE CASCADE,
  "user_id" varchar NOT NULL,
  "object_path" varchar(1024) NOT NULL,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" varchar(500),
  "last_attempt_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT timezone('Asia/Kolkata', now()) NOT NULL,
  CONSTRAINT "account_deletion_objects_status_check"
    CHECK ("status" IN ('pending', 'complete'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "account_deletion_objects_request_path_idx"
  ON "account_deletion_objects" ("request_id", "object_path");
CREATE INDEX IF NOT EXISTS "account_deletion_objects_pending_idx"
  ON "account_deletion_objects" ("request_id", "status", "created_at");

ALTER TABLE "account_deletion_requests"
  ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamp;
ALTER TABLE "account_deletion_requests"
  ADD COLUMN IF NOT EXISTS "inventory_phase" varchar(32) DEFAULT 'vault_documents' NOT NULL;
ALTER TABLE "account_deletion_requests"
  ADD COLUMN IF NOT EXISTS "inventory_cursor" varchar(1024);
ALTER TABLE "account_deletion_requests"
  ADD COLUMN IF NOT EXISTS "inventory_completed_at" timestamp;

CREATE INDEX IF NOT EXISTS "account_deletion_next_attempt_idx"
  ON "account_deletion_requests" ("status", "next_attempt_at", "scheduled_for");

CREATE TABLE IF NOT EXISTS "planning_scheduler_state" (
  "id" varchar(32) PRIMARY KEY NOT NULL,
  "cursor_user_id" varchar,
  "updated_at" timestamp DEFAULT timezone('Asia/Kolkata', now()) NOT NULL
);