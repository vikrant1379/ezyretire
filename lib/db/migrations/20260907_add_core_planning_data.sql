ALTER TABLE "user_profiles"
  ADD COLUMN IF NOT EXISTS "planning_data" jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "loans"
  ADD COLUMN IF NOT EXISTS "repayment_type" varchar(32) NOT NULL DEFAULT 'emi';