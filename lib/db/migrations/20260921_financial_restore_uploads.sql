ALTER TABLE "vault_upload_grants"
  DROP CONSTRAINT IF EXISTS "vault_upload_grants_purpose_check";

ALTER TABLE "vault_upload_grants"
  ADD CONSTRAINT "vault_upload_grants_purpose_check"
  CHECK ("purpose" IN ('vault_document', 'receipt_review', 'financial_restore'));