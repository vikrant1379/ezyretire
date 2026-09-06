-- Login audit records contain bounded device and approximate geography metadata.
-- Rows older than 90 days are deleted by the daily scheduled application purge,
-- with login writes and admin reads providing defense-in-depth cleanup.
BEGIN;

CREATE TABLE IF NOT EXISTS public.login_activities (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  auth_method varchar(16) NOT NULL,
  device_type varchar(32),
  browser varchar(80),
  operating_system varchar(80),
  country varchar(2),
  region varchar(100),
  city varchar(100),
  created_at timestamp without time zone NOT NULL DEFAULT timezone('Asia/Kolkata', now()),
  CONSTRAINT login_activities_auth_method_check CHECK (auth_method IN ('email_otp', 'oidc'))
);

CREATE INDEX IF NOT EXISTS login_activities_created_idx
  ON public.login_activities (created_at);
CREATE INDEX IF NOT EXISTS login_activities_user_created_idx
  ON public.login_activities (user_id, created_at);

COMMIT;