CREATE TABLE IF NOT EXISTS bank_statement_import_provenance (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  import_id varchar(128) NOT NULL,
  source_row_id varchar(256) NOT NULL,
  bank varchar(32) NOT NULL,
  parser_version varchar(64) NOT NULL,
  expense_id varchar NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT timezone('Asia/Kolkata', now()),
  CONSTRAINT bank_statement_import_provenance_key UNIQUE (user_id, import_id, source_row_id)
);
CREATE INDEX IF NOT EXISTS bank_statement_import_provenance_user_idx
  ON bank_statement_import_provenance(user_id);