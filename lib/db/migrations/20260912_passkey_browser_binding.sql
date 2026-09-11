-- Prevent one browser from redeeming another browser's WebAuthn ceremony.
BEGIN;
ALTER TABLE public.passkey_challenges ADD COLUMN IF NOT EXISTS browser_binding_hash varchar(64);
-- Challenges issued before browser binding cannot be redeemed safely.
DELETE FROM public.passkey_challenges WHERE browser_binding_hash IS NULL;
ALTER TABLE public.passkey_challenges ALTER COLUMN browser_binding_hash SET NOT NULL;
COMMIT;