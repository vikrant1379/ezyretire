ALTER TABLE mobile_otp_challenges
  ADD COLUMN IF NOT EXISTS delivery_attempt_id varchar(36),
  ADD COLUMN IF NOT EXISTS delivery_lease_until timestamp;