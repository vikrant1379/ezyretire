-- Four-digit account PINs are stored as salted scrypt verifiers. Attempt
-- counters and hashed account/network audit rows limit online guessing.
BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS pin_hash varchar(255),
  ADD COLUMN IF NOT EXISTS pin_failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until timestamp without time zone;

CREATE TABLE IF NOT EXISTS public.pin_login_attempts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  account_hash varchar(64) NOT NULL,
  requester_hash varchar(64) NOT NULL,
  succeeded boolean NOT NULL DEFAULT false,
  created_at timestamp without time zone NOT NULL DEFAULT timezone('Asia/Kolkata', now())
);

CREATE INDEX IF NOT EXISTS pin_login_attempts_account_created_idx
  ON public.pin_login_attempts (account_hash, created_at);
CREATE INDEX IF NOT EXISTS pin_login_attempts_requester_created_idx
  ON public.pin_login_attempts (requester_hash, created_at);
CREATE INDEX IF NOT EXISTS pin_login_attempts_created_idx
  ON public.pin_login_attempts (created_at);

ALTER TABLE public.login_activities
  DROP CONSTRAINT IF EXISTS login_activities_auth_method_check;
ALTER TABLE public.login_activities
  ADD CONSTRAINT login_activities_auth_method_check
  CHECK (auth_method IN ('email_otp', 'oidc', 'passkey', 'pin'));

COMMIT;