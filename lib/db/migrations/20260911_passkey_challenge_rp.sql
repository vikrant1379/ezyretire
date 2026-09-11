-- Bind every persisted ceremony to the RP configuration used to create it.
BEGIN;
ALTER TABLE public.passkey_challenges ADD COLUMN IF NOT EXISTS rp_id varchar(255);
ALTER TABLE public.passkey_challenges ADD COLUMN IF NOT EXISTS rp_origin varchar(512);
-- Existing rows are unusable without ceremony context and are intentionally removed.
DELETE FROM public.passkey_challenges WHERE rp_id IS NULL OR rp_origin IS NULL;
ALTER TABLE public.passkey_challenges ALTER COLUMN rp_id SET NOT NULL;
ALTER TABLE public.passkey_challenges ALTER COLUMN rp_origin SET NOT NULL;
COMMIT;