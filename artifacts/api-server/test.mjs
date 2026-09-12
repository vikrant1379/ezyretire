import { build } from "esbuild";
import { readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { requireDatabaseUrl } from "@workspace/db/database-url";

const requestedTests = new Set(process.argv.slice(2));
const focusedMonthlyReportLayout = requestedTests.size === 1
  && requestedTests.has("monthly-report-email.test");

if (focusedMonthlyReportLayout) {
  try {
    await import("@napi-rs/canvas");
  } catch (error) {
    console.error(
      `Monthly report layout checks require the native @napi-rs/canvas package for ${process.platform}-${process.arch}. `
      + "Run pnpm install --frozen-lockfile on this release architecture before retrying.",
    );
    console.error(error);
    process.exit(1);
  }
}

const { Client } = pg;
if (!focusedMonthlyReportLayout) {
  const { url: databaseUrl } = requireDatabaseUrl(process.env);
  const schemaClient = new Client({ connectionString: databaseUrl });
  await schemaClient.connect();
  try {
  const incomeReceiptMigration = await readFile(
    new URL("../../lib/db/migrations/20260909_add_income_receipts.sql", import.meta.url),
    "utf8",
  );
  await schemaClient.query(incomeReceiptMigration);
  const vaultDeletionJobsMigration = await readFile(
    new URL("../../lib/db/migrations/20260913_add_vault_deletion_jobs.sql", import.meta.url),
    "utf8",
  );
  await schemaClient.query(vaultDeletionJobsMigration);
  const mobileOtpDeliveryAttemptsMigration = await readFile(
    new URL("../../lib/db/migrations/20260914_add_mobile_otp_delivery_attempts.sql", import.meta.url),
    "utf8",
  );
  await schemaClient.query(mobileOtpDeliveryAttemptsMigration);
  const receiptRecoveryMigration = await readFile(
    new URL("../../lib/db/migrations/20260915_receipt_recovery.sql", import.meta.url),
    "utf8",
  );
  await schemaClient.query(receiptRecoveryMigration);
  const receiptExpenseTombstonesMigration = await readFile(
    new URL("../../lib/db/migrations/20260916_receipt_expense_tombstones.sql", import.meta.url),
    "utf8",
  );
  await schemaClient.query(receiptExpenseTombstonesMigration);
  const uniqueReceiptDocumentMigration = await readFile(
    new URL("../../lib/db/migrations/20260917_unique_receipt_review_document.sql", import.meta.url),
    "utf8",
  );
  await schemaClient.query(uniqueReceiptDocumentMigration);
  const vaultGrantRegistrationMigration = await readFile(
    new URL("../../lib/db/migrations/20260918_vault_grant_registration.sql", import.meta.url), "utf8",
  );
  await schemaClient.query(vaultGrantRegistrationMigration);
  const mobileDeliveryLeaseMigration = await readFile(
    new URL("../../lib/db/migrations/20260919_mobile_delivery_lease.sql", import.meta.url), "utf8",
  );
  await schemaClient.query(mobileDeliveryLeaseMigration);
  const storageBrokerNoncesMigration = await readFile(
    new URL("../../lib/db/migrations/20260920_storage_broker_nonces.sql", import.meta.url), "utf8",
  );
  await schemaClient.query(storageBrokerNoncesMigration);
  const financialRestoreUploadsMigration = await readFile(
    new URL("../../lib/db/migrations/20260921_financial_restore_uploads.sql", import.meta.url), "utf8",
  );
  await schemaClient.query(financialRestoreUploadsMigration);
  const accountComplianceMigration = await readFile(
    new URL("../../lib/db/migrations/20260922_account_compliance.sql", import.meta.url), "utf8",
  );
  await schemaClient.query(accountComplianceMigration);
  const bankStatementImportMigration = await readFile(
    new URL("../../lib/db/migrations/20260923_bank_statement_import_provenance.sql", import.meta.url),
    "utf8",
  );
  await schemaClient.query(bankStatementImportMigration);
  const accountDeletionObjectsMigration = await readFile(
    new URL("../../lib/db/migrations/20260924_account_deletion_objects.sql", import.meta.url),
    "utf8",
  );
  await schemaClient.query(accountDeletionObjectsMigration);
  const accountPinMigration = await readFile(
    new URL("../../lib/db/migrations/20260925_add_account_pins.sql", import.meta.url),
    "utf8",
  );
  await schemaClient.query(accountPinMigration);
  } finally {
    await schemaClient.end();
  }
}

const outputDir = new URL("./.test-dist/", import.meta.url);
const outputs = [
  new URL("whatsapp.test.mjs", outputDir),
  new URL("whatsapp-support.test.mjs", outputDir),
  new URL("auth-redirect.test.mjs", outputDir),
  new URL("email-otp.test.mjs", outputDir),
  new URL("email-otp-routes.test.mjs", outputDir),
  new URL("auth-response.test.mjs", outputDir),
  new URL("error-handler.test.mjs", outputDir),
  new URL("api-cache-policy.test.mjs", outputDir),
  new URL("app-body-limits.test.mjs", outputDir),
  new URL("advice-payment.test.mjs", outputDir),
  new URL("advice-routes.test.mjs", outputDir),
  new URL("finance-routes.test.mjs", outputDir),
  new URL("login-activity.test.mjs", outputDir),
  new URL("login-activity-routes.test.mjs", outputDir),
  new URL("login-activity-boundaries.test.mjs", outputDir),
  new URL("internal-maintenance-routes.test.mjs", outputDir),
  new URL("planning-jobs.test.mjs", outputDir),
  new URL("monthly-report-email.test.mjs", outputDir),
  new URL("auth-profile-input.test.mjs", outputDir),
  new URL("passkeys.test.mjs", outputDir),
  new URL("passkey-routes.test.mjs", outputDir),
  new URL("premium-tools.test.mjs", outputDir),
  new URL("storage-broker.test.mjs", outputDir),
  new URL("account-compliance.test.mjs", outputDir),
  new URL("account-pin.test.mjs", outputDir),
  new URL("account-pin-attempt-cleanup.test.mjs", outputDir),
  new URL("account-pin-routes.test.mjs", outputDir),
];
const selectedOutputs = requestedTests.size === 0
  ? outputs
  : outputs.filter((output) => requestedTests.has(output.pathname.split("/").at(-1)?.replace(".mjs", "")));

if (selectedOutputs.length !== (requestedTests.size || outputs.length)) {
  const available = outputs.map((output) => output.pathname.split("/").at(-1)?.replace(".mjs", "")).join(", ");
  throw new Error(`Unknown test target. Available targets: ${available}`);
}

await rm(outputDir, { recursive: true, force: true });
await build({
  entryPoints: {
    "whatsapp.test": new URL("./src/lib/whatsapp.test.ts", import.meta.url).pathname,
    "whatsapp-support.test": new URL(
      "./src/lib/whatsapp-support.test.ts",
      import.meta.url,
    ).pathname,
    "auth-redirect.test": new URL("./src/lib/auth-redirect.test.ts", import.meta.url).pathname,
    "email-otp.test": new URL("./src/lib/email-otp.test.ts", import.meta.url).pathname,
    "email-otp-routes.test": new URL("./src/lib/email-otp-routes.test.ts", import.meta.url).pathname,
    "auth-response.test": new URL("./src/lib/auth-response.test.ts", import.meta.url).pathname,
    "error-handler.test": new URL(
      "./src/middlewares/errorHandler.test.ts",
      import.meta.url,
    ).pathname,
    "api-cache-policy.test": new URL(
      "./src/middlewares/apiCachePolicy.test.ts",
      import.meta.url,
    ).pathname,
    "app-body-limits.test": new URL(
      "./src/lib/app-body-limits.test.ts",
      import.meta.url,
    ).pathname,
    "advice-payment.test": new URL("./src/lib/advice-payment.test.ts", import.meta.url).pathname,
    "advice-routes.test": new URL("./src/lib/advice-routes.test.ts", import.meta.url).pathname,
    "finance-routes.test": new URL("./src/lib/finance-routes.test.ts", import.meta.url).pathname,
    "login-activity.test": new URL("./src/lib/login-activity.test.ts", import.meta.url).pathname,
    "login-activity-routes.test": new URL("./src/lib/login-activity-routes.test.ts", import.meta.url).pathname,
    "login-activity-boundaries.test": new URL("./src/lib/login-activity-boundaries.test.ts", import.meta.url).pathname,
    "internal-maintenance-routes.test": new URL("./src/lib/internal-maintenance-routes.test.ts", import.meta.url).pathname,
    "planning-jobs.test": new URL("./src/lib/planning-jobs.test.ts", import.meta.url).pathname,
    "monthly-report-email.test": new URL(
      "./src/lib/monthly-report-email.test.ts",
      import.meta.url,
    ).pathname,
    "auth-profile-input.test": new URL("./src/lib/auth-profile-input.test.ts", import.meta.url).pathname,
    "passkeys.test": new URL("./src/lib/passkeys.test.ts", import.meta.url).pathname,
    "passkey-routes.test": new URL("./src/lib/passkey-routes.test.ts", import.meta.url).pathname,
    "premium-tools.test": new URL("./src/lib/premium-tools.test.ts", import.meta.url).pathname,
    "storage-broker.test": new URL("./src/lib/storage-broker.test.ts", import.meta.url).pathname,
    "account-compliance.test": new URL("./src/lib/account-compliance.test.ts", import.meta.url).pathname,
    "account-pin.test": new URL("./src/lib/account-pin.test.ts", import.meta.url).pathname,
    "account-pin-attempt-cleanup.test": new URL(
      "./src/lib/account-pin-attempt-cleanup.test.ts",
      import.meta.url,
    ).pathname,
    "account-pin-routes.test": new URL("./src/lib/account-pin-routes.test.ts", import.meta.url).pathname,
  },
  outdir: outputDir.pathname,
  outExtension: { ".js": ".mjs" },
  loader: { ".ttf": "base64" },
  bundle: true,
  platform: "node",
  format: "esm",
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  external: ["@napi-rs/canvas", "express", "harfbuzzjs", "pg-native", "pino"],
});

const result = spawnSync(process.execPath, ["--test", ...selectedOutputs.map((output) => output.pathname)], {
  stdio: "inherit",
});
await rm(outputDir, { recursive: true, force: true });
process.exitCode = result.status ?? 1;