CREATE TABLE IF NOT EXISTS storage_broker_nonces (
  nonce varchar(36) PRIMARY KEY,
  created_at timestamp NOT NULL DEFAULT timezone('Asia/Kolkata', now()),
  expires_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS storage_broker_nonces_expires_idx
  ON storage_broker_nonces (expires_at);