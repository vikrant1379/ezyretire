import pg from "pg";
import { pathToFileURL } from "node:url";
import {
  requireDatabaseUrl,
  selectDatabaseVariableName,
} from "../database-url.mjs";
import { validatePasskeyConfiguration } from "../passkey-config.mjs";

const REQUIRED_QUEUE_COLUMNS = [
  "id",
  "advice_request_id",
  "event_type",
  "status",
  "attempt_count",
  "provider_message_id",
  "error",
  "created_at",
  "last_attempt_at",
  "completed_at",
];
const REQUIRED_QUEUE_UNIQUE_INDEX = "whatsapp_notification_request_event_unique";
const REQUIRED_QUEUE_INDEX_COLUMNS = ["advice_request_id", "event_type"];
const QUEUE_TABLE_NAME = "whatsapp_notification_events";
const REQUIRED_ADVICE_COLUMNS = [
  "id",
  "user_id",
  "user_name",
  "user_email",
  "whatsapp_number",
  "topic",
  "note",
  "consent",
  "fee_amount",
  "payment_status",
  "payment_reference",
  "payment_submitted_at",
  "status",
  "advisor_id",
  "created_at",
  "updated_at",
];
const REQUIRED_ACTIVE_REQUEST_INDEX = "advice_requests_one_active_per_user";
const ADVICE_TABLE_NAME = "advice_requests";
const OTP_TABLE_NAME = "email_otp_challenges";
const USERS_TABLE_NAME = "users";
const REQUIRED_OTP_COLUMNS = [
  "id",
  "email",
  "requester_hash",
  "code_hash",
  "expires_at",
  "delivered_at",
  "consumed_at",
  "failed_attempts",
  "max_attempts",
  "resend_available_at",
  "created_at",
];
const REQUIRED_OTP_INDEXES = [
  "email_otp_challenges_email_created_idx",
  "email_otp_challenges_requester_created_idx",
  "email_otp_challenges_expires_idx",
];
const REQUIRED_BUDGET_COLUMNS = [
  "id",
  "user_id",
  "category",
  "monthly_limit",
  "details",
  "updated_at",
];
const BUDGET_TABLE_NAME = "budgets";
const LOGIN_ACTIVITY_TABLE_NAME = "login_activities";
const REQUIRED_LOGIN_ACTIVITY_COLUMNS = [
  "id",
  "user_id",
  "auth_method",
  "device_type",
  "browser",
  "operating_system",
  "country",
  "region",
  "city",
  "created_at",
];
const REQUIRED_LOGIN_ACTIVITY_INDEXES = [
  "login_activities_created_idx",
  "login_activities_user_created_idx",
];
const INCOME_RECEIPTS_TABLE_NAME = "income_receipts";
const REQUIRED_INCOME_RECEIPT_COLUMNS = [
  "id",
  "user_id",
  "income_source_id",
  "received_date",
  "amount",
  "note",
  "created_at",
  "updated_at",
];
const REQUIRED_INCOME_RECEIPT_INDEXES = [
  "income_receipts_user_date_idx",
  "income_receipts_source_idx",
];
const REQUIRED_INCOME_RECEIPT_OWNER_FK = "income_receipts_owner_source_fk";
const REQUIRED_TIMESTAMP_TYPE = "timestamp without time zone";
const REQUIRED_PASSKEY_TABLE_COLUMNS = {
  passkey_credentials: [
    "id", "user_id", "name", "public_key", "counter", "transports", "device_type",
    "backed_up", "last_used_at", "revoked_at", "created_at", "updated_at",
  ],
  passkey_challenges: [
    "id", "type", "challenge", "rp_id", "rp_origin", "user_id", "requester_hash",
    "browser_binding_hash", "expires_at", "consumed_at", "created_at",
  ],
  passkey_audit_events: ["id", "user_id", "credential_id", "event", "created_at"],
};
const REQUIRED_PASSKEY_USER_COLUMNS = ["id", "email", "email_verified_at"];
const REQUIRED_PASSKEY_SESSION_COLUMNS = ["sid", "sess", "expire"];

export { selectDatabaseVariableName };

let databaseUrlVariableName;

try {
  databaseUrlVariableName = selectDatabaseVariableName(process.env);
} catch (error) {
  console.error(`Schema compatibility check failed: ${error.message}`);
  process.exit(1);
}

let databaseUrl;

if (databaseUrlVariableName) {
  try {
    databaseUrl = requireDatabaseUrl(process.env).url;
  } catch {
    databaseUrl = undefined;
  }
}

function normalizeColumnNames(columnNames) {
  if (Array.isArray(columnNames)) {
    return columnNames;
  }

  if (typeof columnNames === "string" && columnNames.startsWith("{") && columnNames.endsWith("}")) {
    return columnNames.slice(1, -1).split(",");
  }

  return [];
}

export function assessProductionSchema(columns, indexes) {
  const presentColumns = new Set(columns.map((row) => row.column_name));
  const missingColumns = REQUIRED_QUEUE_COLUMNS.filter((column) => !presentColumns.has(column));
  const requiredIndex = indexes.find((index) => index.index_name === REQUIRED_QUEUE_UNIQUE_INDEX);
  const validIndex =
    requiredIndex?.is_unique === true &&
    JSON.stringify(normalizeColumnNames(requiredIndex.column_names)) ===
      JSON.stringify(REQUIRED_QUEUE_INDEX_COLUMNS);

  const invalidTimestampColumns = columns
    .filter((row) => ["created_at", "last_attempt_at", "completed_at"].includes(row.column_name))
    .filter((row) => row.data_type !== REQUIRED_TIMESTAMP_TYPE)
    .map((row) => row.column_name);

  return { missingColumns, invalidTimestampColumns, validIndex };
}

export function assessAdviceProductionSchema(columns, indexes) {
  const presentColumns = new Set(columns.map((row) => row.column_name));
  const missingColumns = REQUIRED_ADVICE_COLUMNS.filter(
    (column) => !presentColumns.has(column),
  );
  const requiredIndex = indexes.find(
    (index) => index.index_name === REQUIRED_ACTIVE_REQUEST_INDEX,
  );
  const indexColumns = normalizeColumnNames(requiredIndex?.column_names);
  const expression = String(requiredIndex?.index_expression ?? "").toLowerCase();
  const validIndex =
    requiredIndex?.is_unique === true &&
    indexColumns[0] === "user_id" &&
    expression.includes("status") &&
    expression.includes("completed") &&
    expression.includes("cancelled");

  const invalidTimestampColumns = columns
    .filter((row) => ["payment_submitted_at", "created_at", "updated_at"].includes(row.column_name))
    .filter((row) => row.data_type !== REQUIRED_TIMESTAMP_TYPE)
    .map((row) => row.column_name);

  return { missingColumns, invalidTimestampColumns, validIndex };
}

export function assessOtpProductionSchema(columns, indexes, userColumns) {
  const presentColumns = new Set(columns.map((row) => row.column_name));
  const presentIndexes = new Set(indexes.map((row) => row.index_name));
  const missingColumns = REQUIRED_OTP_COLUMNS.filter((column) => !presentColumns.has(column));
  const missingIndexes = REQUIRED_OTP_INDEXES.filter((index) => !presentIndexes.has(index));
  const missingUserColumns = new Set(userColumns.map((row) => row.column_name)).has("email_verified_at")
    ? []
    : ["email_verified_at"];
  const invalidTimestampColumns = columns
    .filter((row) => ["expires_at", "delivered_at", "consumed_at", "resend_available_at", "created_at"].includes(row.column_name))
    .filter((row) => row.data_type !== REQUIRED_TIMESTAMP_TYPE)
    .map((row) => row.column_name);
  return { missingColumns, missingIndexes, missingUserColumns, invalidTimestampColumns };
}

export function assessBudgetProductionSchema(columns) {
  const presentColumns = new Set(columns.map((row) => row.column_name));
  const missingColumns = REQUIRED_BUDGET_COLUMNS.filter(
    (column) => !presentColumns.has(column),
  );
  const details = columns.find((row) => row.column_name === "details");
  const validDetailsColumn = details?.data_type === "jsonb"
    && details?.is_nullable === "NO"
    && String(details?.column_default ?? "").includes("'{}'::jsonb");
  return { missingColumns, validDetailsColumn };
}

export function assessLoginActivityProductionSchema(columns, indexes) {
  const presentColumns = new Set(columns.map((row) => row.column_name));
  const presentIndexes = new Set(indexes.map((row) => row.index_name));
  const missingColumns = REQUIRED_LOGIN_ACTIVITY_COLUMNS.filter(
    (column) => !presentColumns.has(column),
  );
  const missingIndexes = REQUIRED_LOGIN_ACTIVITY_INDEXES.filter(
    (index) => !presentIndexes.has(index),
  );
  const createdAt = columns.find((row) => row.column_name === "created_at");
  const validTimestamp = createdAt?.data_type === REQUIRED_TIMESTAMP_TYPE;
  return { missingColumns, missingIndexes, validTimestamp };
}

export function assessIncomeReceiptsProductionSchema(columns, indexes, constraints) {
  const presentColumns = new Set(columns.map((row) => row.column_name));
  const presentIndexes = new Set(indexes.map((row) => row.index_name));
  const missingColumns = REQUIRED_INCOME_RECEIPT_COLUMNS.filter(
    (column) => !presentColumns.has(column),
  );
  const missingIndexes = REQUIRED_INCOME_RECEIPT_INDEXES.filter(
    (index) => !presentIndexes.has(index),
  );
  const ownerConstraint = constraints.find(
    (constraint) => constraint.constraint_name === REQUIRED_INCOME_RECEIPT_OWNER_FK,
  );
  const definition = String(ownerConstraint?.definition ?? "")
    .toLowerCase()
    .replaceAll('"', "")
    .replace(/\s+/g, " ");
  const validOwnerSourceForeignKey =
    definition.includes("foreign key (user_id, income_source_id)")
    && definition.includes("references income_sources(user_id, id)")
    && definition.includes("on delete cascade");
  const invalidTimestampColumns = columns
    .filter((row) => ["created_at", "updated_at"].includes(row.column_name))
    .filter((row) => row.data_type !== REQUIRED_TIMESTAMP_TYPE)
    .map((row) => row.column_name);
  return {
    missingColumns,
    missingIndexes,
    invalidTimestampColumns,
    validOwnerSourceForeignKey,
  };
}

export function assessPasskeyProductionSchema(tableColumns) {
  const missing = [];
  for (const [table, requiredColumns] of Object.entries(REQUIRED_PASSKEY_TABLE_COLUMNS)) {
    const present = new Set((tableColumns[table] ?? []).map((row) => row.column_name));
    const absent = requiredColumns.filter((column) => !present.has(column));
    if (absent.length > 0) missing.push(`${table} missing columns: ${absent.join(", ")}`);
  }
  for (const [table, requiredColumns] of Object.entries({
    users: REQUIRED_PASSKEY_USER_COLUMNS,
    sessions: REQUIRED_PASSKEY_SESSION_COLUMNS,
  })) {
    const present = new Set((tableColumns[table] ?? []).map((row) => row.column_name));
    const absent = requiredColumns.filter((column) => !present.has(column));
    if (absent.length > 0) missing.push(`${table} missing passkey prerequisite columns: ${absent.join(", ")}`);
  }
  return { missing };
}

export function assessPasskeyProductionConfig(env) {
  const { problems } = validatePasskeyConfiguration({
    rpID: env.PASSKEY_RP_ID,
    origin: env.PASSKEY_ORIGIN,
    requireHttps: true,
  });
  if (!env.RESEND_API_KEY?.trim()) problems.push("RESEND_API_KEY is not configured");
  if (!env.AUTH_EMAIL_FROM?.trim()) problems.push("AUTH_EMAIL_FROM is not configured");
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    problems.push("SESSION_SECRET must contain at least 32 characters");
  }
  return { problems };
}

async function inspectTable(pool, tableName) {
  return Promise.all([
    pool.query(
      `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
        where table_schema = current_schema()
          and table_name = $1`,
      [tableName],
    ),
    pool.query(
      `select
         index_class.relname as index_name,
         index_meta.indisunique as is_unique,
         array_agg(attribute.attname::text order by index_column.ordinality)
           filter (
             where index_column.ordinality <= index_meta.indnkeyatts
               and attribute.attname is not null
           ) as column_names,
         pg_get_expr(index_meta.indexprs, index_meta.indrelid) as index_expression
       from pg_catalog.pg_index index_meta
       join pg_catalog.pg_class table_class
         on table_class.oid = index_meta.indrelid
       join pg_catalog.pg_namespace table_namespace
         on table_namespace.oid = table_class.relnamespace
       join pg_catalog.pg_class index_class
         on index_class.oid = index_meta.indexrelid
       join lateral unnest(index_meta.indkey)
         with ordinality as index_column(attribute_number, ordinality) on true
       left join pg_catalog.pg_attribute attribute
         on attribute.attrelid = table_class.oid
        and attribute.attnum = index_column.attribute_number
      where table_namespace.nspname = current_schema()
        and table_class.relname = $1
      group by
        index_class.relname,
        index_meta.indisunique,
        index_meta.indexprs,
        index_meta.indrelid`,
      [tableName],
    ),
    pool.query(
      `select
          constraint_meta.conname as constraint_name,
          pg_get_constraintdef(constraint_meta.oid) as definition
         from pg_catalog.pg_constraint constraint_meta
         join pg_catalog.pg_class table_class
           on table_class.oid = constraint_meta.conrelid
         join pg_catalog.pg_namespace table_namespace
           on table_namespace.oid = table_class.relnamespace
        where table_namespace.nspname = current_schema()
          and table_class.relname = $1
          and constraint_meta.contype = 'f'`,
      [tableName],
    ),
  ]);
}

async function checkProductionSchema() {
  if (!databaseUrl) {
    console.error(
      `Schema compatibility check failed: set ${databaseUrlVariableName}, the selected database variable.`,
    );
    process.exitCode = 1;
    return;
  }

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });

  try {
    const [
      [queueColumnsResult, queueIndexesResult],
      [adviceColumnsResult, adviceIndexesResult],
      [otpColumnsResult, otpIndexesResult],
      [userColumnsResult],
      [budgetColumnsResult],
      [loginActivityColumnsResult, loginActivityIndexesResult],
      [incomeReceiptColumnsResult, incomeReceiptIndexesResult, incomeReceiptConstraintsResult],
      [passkeyCredentialColumnsResult],
      [passkeyChallengeColumnsResult],
      [passkeyAuditColumnsResult],
      [sessionColumnsResult],
    ] = await Promise.all([
      inspectTable(pool, QUEUE_TABLE_NAME),
      inspectTable(pool, ADVICE_TABLE_NAME),
      inspectTable(pool, OTP_TABLE_NAME),
      inspectTable(pool, USERS_TABLE_NAME),
      inspectTable(pool, BUDGET_TABLE_NAME),
      inspectTable(pool, LOGIN_ACTIVITY_TABLE_NAME),
      inspectTable(pool, INCOME_RECEIPTS_TABLE_NAME),
      inspectTable(pool, "passkey_credentials"),
      inspectTable(pool, "passkey_challenges"),
      inspectTable(pool, "passkey_audit_events"),
      inspectTable(pool, "sessions"),
    ]);

    const queueAssessment = assessProductionSchema(
      queueColumnsResult.rows,
      queueIndexesResult.rows,
    );
    const adviceAssessment = assessAdviceProductionSchema(
      adviceColumnsResult.rows,
      adviceIndexesResult.rows,
    );
    const otpAssessment = assessOtpProductionSchema(
      otpColumnsResult.rows,
      otpIndexesResult.rows,
      userColumnsResult.rows,
    );
    const budgetAssessment = assessBudgetProductionSchema(
      budgetColumnsResult.rows,
    );
    const loginActivityAssessment = assessLoginActivityProductionSchema(
      loginActivityColumnsResult.rows,
      loginActivityIndexesResult.rows,
    );
    const incomeReceiptAssessment = assessIncomeReceiptsProductionSchema(
      incomeReceiptColumnsResult.rows,
      incomeReceiptIndexesResult.rows,
      incomeReceiptConstraintsResult.rows,
    );
    const passkeyAssessment = assessPasskeyProductionSchema({
      passkey_credentials: passkeyCredentialColumnsResult.rows,
      passkey_challenges: passkeyChallengeColumnsResult.rows,
      passkey_audit_events: passkeyAuditColumnsResult.rows,
      users: userColumnsResult.rows,
      sessions: sessionColumnsResult.rows,
    });
    const passkeyConfigAssessment = assessPasskeyProductionConfig(process.env);

    if (
      queueAssessment.missingColumns.length > 0 ||
      queueAssessment.invalidTimestampColumns.length > 0 ||
      !queueAssessment.validIndex ||
      adviceAssessment.missingColumns.length > 0 ||
      adviceAssessment.invalidTimestampColumns.length > 0 ||
      !adviceAssessment.validIndex ||
      otpAssessment.missingColumns.length > 0 ||
      otpAssessment.missingIndexes.length > 0 ||
      otpAssessment.missingUserColumns.length > 0 ||
      otpAssessment.invalidTimestampColumns.length > 0 ||
      budgetAssessment.missingColumns.length > 0 ||
      !budgetAssessment.validDetailsColumn ||
      loginActivityAssessment.missingColumns.length > 0 ||
      loginActivityAssessment.missingIndexes.length > 0 ||
      !loginActivityAssessment.validTimestamp ||
      incomeReceiptAssessment.missingColumns.length > 0 ||
      incomeReceiptAssessment.missingIndexes.length > 0 ||
      incomeReceiptAssessment.invalidTimestampColumns.length > 0 ||
      !incomeReceiptAssessment.validOwnerSourceForeignKey ||
      passkeyAssessment.missing.length > 0 ||
      passkeyConfigAssessment.problems.length > 0
    ) {
      const problems = [];
      if (queueAssessment.missingColumns.length > 0) {
        problems.push(
          `${QUEUE_TABLE_NAME} missing columns: ${queueAssessment.missingColumns.join(", ")}`,
        );
      }
      if (!queueAssessment.validIndex) {
        problems.push(
          `missing unique index ${REQUIRED_QUEUE_UNIQUE_INDEX} (${REQUIRED_QUEUE_INDEX_COLUMNS.join(", ")})`,
        );
      }
      if (queueAssessment.invalidTimestampColumns.length > 0) {
        problems.push(
          `${QUEUE_TABLE_NAME} timestamp columns not stored as literal IST: ${queueAssessment.invalidTimestampColumns.join(", ")}`,
        );
      }
      if (adviceAssessment.missingColumns.length > 0) {
        problems.push(
          `${ADVICE_TABLE_NAME} missing columns: ${adviceAssessment.missingColumns.join(", ")}`,
        );
      }
      if (!adviceAssessment.validIndex) {
        problems.push(
          `missing unique index ${REQUIRED_ACTIVE_REQUEST_INDEX} with its active-status expression`,
        );
      }
      if (adviceAssessment.invalidTimestampColumns.length > 0) {
        problems.push(
          `${ADVICE_TABLE_NAME} timestamp columns not stored as literal IST: ${adviceAssessment.invalidTimestampColumns.join(", ")}`,
        );
      }
      if (otpAssessment.missingColumns.length > 0) {
        problems.push(`${OTP_TABLE_NAME} missing columns: ${otpAssessment.missingColumns.join(", ")}`);
      }
      if (otpAssessment.missingIndexes.length > 0) {
        problems.push(`${OTP_TABLE_NAME} missing indexes: ${otpAssessment.missingIndexes.join(", ")}`);
      }
      if (otpAssessment.missingUserColumns.length > 0) {
        problems.push(`${USERS_TABLE_NAME} missing columns: ${otpAssessment.missingUserColumns.join(", ")}`);
      }
      if (otpAssessment.invalidTimestampColumns.length > 0) {
        problems.push(`${OTP_TABLE_NAME} timestamp columns not stored as literal IST: ${otpAssessment.invalidTimestampColumns.join(", ")}`);
      }
      if (budgetAssessment.missingColumns.length > 0) {
        problems.push(
          `${BUDGET_TABLE_NAME} missing columns: ${budgetAssessment.missingColumns.join(", ")}`,
        );
      } else if (!budgetAssessment.validDetailsColumn) {
        problems.push(
          `${BUDGET_TABLE_NAME}.details must be non-null jsonb with an empty-object default`,
        );
      }
      if (loginActivityAssessment.missingColumns.length > 0) {
        problems.push(
          `${LOGIN_ACTIVITY_TABLE_NAME} missing columns: ${loginActivityAssessment.missingColumns.join(", ")}`,
        );
      }
      if (loginActivityAssessment.missingIndexes.length > 0) {
        problems.push(
          `${LOGIN_ACTIVITY_TABLE_NAME} missing indexes: ${loginActivityAssessment.missingIndexes.join(", ")}`,
        );
      }
      if (
        loginActivityAssessment.missingColumns.length === 0 &&
        !loginActivityAssessment.validTimestamp
      ) {
        problems.push(
          `${LOGIN_ACTIVITY_TABLE_NAME}.created_at must be stored as literal IST`,
        );
      }
      if (incomeReceiptAssessment.missingColumns.length > 0) {
        problems.push(
          `${INCOME_RECEIPTS_TABLE_NAME} missing columns: ${incomeReceiptAssessment.missingColumns.join(", ")}`,
        );
      }
      if (incomeReceiptAssessment.missingIndexes.length > 0) {
        problems.push(
          `${INCOME_RECEIPTS_TABLE_NAME} missing indexes: ${incomeReceiptAssessment.missingIndexes.join(", ")}`,
        );
      }
      if (incomeReceiptAssessment.invalidTimestampColumns.length > 0) {
        problems.push(
          `${INCOME_RECEIPTS_TABLE_NAME} timestamp columns not stored as literal IST: ${incomeReceiptAssessment.invalidTimestampColumns.join(", ")}`,
        );
      }
      if (!incomeReceiptAssessment.validOwnerSourceForeignKey) {
        problems.push(
          `${INCOME_RECEIPTS_TABLE_NAME} missing same-owner source foreign key ${REQUIRED_INCOME_RECEIPT_OWNER_FK}`,
        );
      }
      problems.push(...passkeyAssessment.missing);
      problems.push(...passkeyConfigAssessment.problems);

      console.error(`Production schema is incompatible with application services: ${problems.join("; ")}.`);
      console.error(
        "Apply the current schema from a trusted environment with DATABASE_URL set: pnpm --filter @workspace/db run push",
      );
      process.exitCode = 1;
    } else {
      console.info(
        `Production schema is compatible with authentication, login audit, finance, advice, and notification services (using ${databaseUrlVariableName}).`,
      );
    }
  } catch {
    console.error(
      "Schema compatibility check could not inspect the production database. Verify the database URL, network access, and read permissions.",
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await checkProductionSchema();
}
