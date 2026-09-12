// Keep request-parser limits in a dependency-free module so persistence code
// can enforce the same lifecycle invariant without importing the Express app.
export const RESTORE_JSON_LIMIT = 12 * 1024 * 1024;
export const MONTHLY_REPORT_JSON_LIMIT = 512 * 1024;
export const BANK_STATEMENT_IMPORT_JSON_LIMIT = 4 * 1024 * 1024;
export const FINANCIAL_SAVE_JSON_LIMIT = BANK_STATEMENT_IMPORT_JSON_LIMIT;
// Admission happens before a server-side mutation creates a document that the
// browser must later normalize and PUT. Keep explicit room for normalization
// defaults and JSON representation differences while retaining the hard 4 MiB
// middleware ceiling as the independently tested transport limit.
export const FINANCIAL_DOCUMENT_ADMISSION_JSON_LIMIT =
  FINANCIAL_SAVE_JSON_LIMIT - 64 * 1024;
export const DEFAULT_API_JSON_LIMIT = 1024 * 1024;
export const DEFAULT_URLENCODED_LIMIT = 1024 * 1024;