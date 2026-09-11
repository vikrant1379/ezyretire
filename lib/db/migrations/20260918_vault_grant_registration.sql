ALTER TABLE vault_upload_grants
  ADD COLUMN IF NOT EXISTS purpose varchar(32) NOT NULL DEFAULT 'vault_document',
  ADD COLUMN IF NOT EXISTS promoted_object_path varchar(1024),
  ADD COLUMN IF NOT EXISTS document_id varchar REFERENCES vault_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at timestamp;
ALTER TABLE vault_upload_grants DROP CONSTRAINT IF EXISTS vault_upload_grants_purpose_check;
ALTER TABLE vault_upload_grants ADD CONSTRAINT vault_upload_grants_purpose_check
  CHECK (purpose IN ('vault_document', 'receipt_review'));