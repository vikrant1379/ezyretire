CREATE TABLE IF NOT EXISTS "vault_deletion_jobs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "object_path" varchar(1024) NOT NULL,
  "reason" varchar(64) NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" varchar(500),
  "last_attempt_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT timezone('Asia/Kolkata', now()),
  "updated_at" timestamp NOT NULL DEFAULT timezone('Asia/Kolkata', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS "vault_deletion_jobs_object_idx"
  ON "vault_deletion_jobs" ("object_path");

CREATE INDEX IF NOT EXISTS "vault_deletion_jobs_user_created_idx"
  ON "vault_deletion_jobs" ("user_id", "created_at");