-- Additive transition for databases created before lifetime budget plans.
-- Apply before deploying API code that reads budgets.details.
BEGIN;

ALTER TABLE public.budgets
  ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;