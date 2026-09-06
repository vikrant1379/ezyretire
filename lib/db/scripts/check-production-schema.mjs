import pg from "pg";
import { pathToFileURL } from "node:url";
import {
  requireDatabaseUrl,
  selectDatabaseVariableName,
} from "../database-url.mjs";

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
const REQUIRED_TIMESTAMP_TYPE = "timestamp without time zone";

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
    ] = await Promise.all([
      inspectTable(pool, QUEUE_TABLE_NAME),
      inspectTable(pool, ADVICE_TABLE_NAME),
      inspectTable(pool, OTP_TABLE_NAME),
      inspectTable(pool, USERS_TABLE_NAME),
      inspectTable(pool, BUDGET_TABLE_NAME),
      inspectTable(pool, LOGIN_ACTIVITY_TABLE_NAME),
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
      !loginActivityAssessment.validTimestamp
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
