-- WebAuthn credentials and short-lived, single-use ceremony challenges.
BEGIN;

CREATE TABLE IF NOT EXISTS public.passkey_credentials (
  id varchar(1024) PRIMARY KEY,
  user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name varchar(80) NOT NULL,
  public_key varchar(4096) NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports jsonb NOT NULL DEFAULT '[]'::jsonb,
  device_type varchar(32),
  backed_up boolean NOT NULL DEFAULT false,
  last_used_at timestamp without time zone,
  revoked_at timestamp without time zone,
  created_at timestamp without time zone NOT NULL DEFAULT timezone('Asia/Kolkata', now()),
  updated_at timestamp without time zone NOT NULL DEFAULT timezone('Asia/Kolkata', now())
);
CREATE INDEX IF NOT EXISTS passkey_credentials_user_created_idx ON public.passkey_credentials(user_id, created_at);
CREATE INDEX IF NOT EXISTS passkey_credentials_active_idx ON public.passkey_credentials(user_id, revoked_at);

CREATE TABLE IF NOT EXISTS public.passkey_challenges (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  type varchar(16) NOT NULL CHECK (type IN ('registration', 'authentication')),
  challenge varchar(512) NOT NULL,
  rp_id varchar(255) NOT NULL,
  rp_origin varchar(512) NOT NULL,
  user_id varchar REFERENCES public.users(id) ON DELETE CASCADE,
  requester_hash varchar(64) NOT NULL,
  browser_binding_hash varchar(64) NOT NULL,
  expires_at timestamp without time zone NOT NULL,
  consumed_at timestamp without time zone,
  created_at timestamp without time zone NOT NULL DEFAULT timezone('Asia/Kolkata', now())
);
CREATE INDEX IF NOT EXISTS passkey_challenges_requester_created_idx ON public.passkey_challenges(requester_hash, created_at);
CREATE INDEX IF NOT EXISTS passkey_challenges_expires_idx ON public.passkey_challenges(expires_at);

CREATE TABLE IF NOT EXISTS public.passkey_audit_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  credential_id varchar(1024),
  event varchar(24) NOT NULL CHECK (event IN ('registered', 'renamed', 'revoked', 'authenticated')),
  created_at timestamp without time zone NOT NULL DEFAULT timezone('Asia/Kolkata', now())
);
CREATE INDEX IF NOT EXISTS passkey_audit_events_user_created_idx ON public.passkey_audit_events(user_id, created_at);

ALTER TABLE public.login_activities DROP CONSTRAINT IF EXISTS login_activities_auth_method_check;
ALTER TABLE public.login_activities ADD CONSTRAINT login_activities_auth_method_check
  CHECK (auth_method IN ('email_otp', 'oidc', 'passkey'));

COMMIT;