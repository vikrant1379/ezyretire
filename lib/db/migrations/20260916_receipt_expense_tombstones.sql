ALTER TABLE receipt_reviews
  ADD COLUMN IF NOT EXISTS confirmed_expense_deleted_id varchar,
  ADD COLUMN IF NOT EXISTS confirmed_expense_deleted_at timestamp;