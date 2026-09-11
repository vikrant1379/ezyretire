CREATE TABLE IF NOT EXISTS "mobile_otp_delivery_attempts" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "challenge_id" varchar NOT NULL REFERENCES "mobile_otp_challenges" ("id") ON DELETE CASCADE,
  "requester_hash" varchar(128) NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT timezone('Asia/Kolkata', now())
);

CREATE INDEX IF NOT EXISTS "mobile_otp_delivery_attempts_user_created_idx"
  ON "mobile_otp_delivery_attempts" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "mobile_otp_delivery_attempts_requester_created_idx"
  ON "mobile_otp_delivery_attempts" ("requester_hash", "created_at");

CREATE INDEX IF NOT EXISTS "mobile_otp_delivery_attempts_challenge_idx"
  ON "mobile_otp_delivery_attempts" ("challenge_id");