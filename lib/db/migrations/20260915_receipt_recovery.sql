ALTER TABLE "receipt_reviews"
  ADD COLUMN IF NOT EXISTS "confirmed_expense_id" varchar REFERENCES "expenses" ("id") ON DELETE RESTRICT;
ALTER TABLE "receipt_reviews"
  ADD COLUMN IF NOT EXISTS "cleanup_object_path" varchar(1024);

ALTER TABLE "vault_deletion_jobs"
  ADD COLUMN IF NOT EXISTS "finalize_after" timestamp;

CREATE INDEX IF NOT EXISTS "vault_deletion_jobs_finalize_idx"
  ON "vault_deletion_jobs" ("finalize_after");