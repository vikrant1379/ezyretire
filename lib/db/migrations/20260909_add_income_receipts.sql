DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'income_sources_user_id_id_unique'
       AND conrelid = 'income_sources'::regclass
  ) THEN
    IF to_regclass('income_receipts') IS NOT NULL THEN
      ALTER TABLE "income_receipts"
        DROP CONSTRAINT IF EXISTS "income_receipts_owner_source_fk";
    END IF;
    DROP INDEX IF EXISTS "income_sources_user_id_id_unique";
    ALTER TABLE "income_sources"
      ADD CONSTRAINT "income_sources_user_id_id_unique"
      UNIQUE ("user_id", "id");
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "income_receipts" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "income_source_id" varchar NOT NULL,
  "received_date" date NOT NULL,
  "amount" numeric(14,2) NOT NULL DEFAULT 0,
  "note" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT timezone('Asia/Kolkata', now()),
  "updated_at" timestamp NOT NULL DEFAULT timezone('Asia/Kolkata', now()),
  CONSTRAINT "income_receipts_owner_source_fk"
    FOREIGN KEY ("user_id", "income_source_id")
    REFERENCES "income_sources" ("user_id", "id")
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "income_receipts_user_date_idx"
  ON "income_receipts" ("user_id", "received_date");

CREATE INDEX IF NOT EXISTS "income_receipts_source_idx"
  ON "income_receipts" ("income_source_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'income_receipts_owner_source_fk'
       AND conrelid = 'income_receipts'::regclass
  ) THEN
    ALTER TABLE "income_receipts"
      ADD CONSTRAINT "income_receipts_owner_source_fk"
      FOREIGN KEY ("user_id", "income_source_id")
      REFERENCES "income_sources" ("user_id", "id")
      ON DELETE CASCADE;
  END IF;
END
$$;