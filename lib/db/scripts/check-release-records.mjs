import pg from "pg";
import {
  requireDatabaseUrl,
  selectDatabaseVariableName,
} from "../database-url.mjs";

let databaseUrlVariableName;

try {
  databaseUrlVariableName = selectDatabaseVariableName(process.env);
} catch (error) {
  console.error(
    `Release record check failed: ${error.message}.`,
  );
  process.exitCode = 1;
}

let databaseUrl;

if (databaseUrlVariableName) {
  try {
    databaseUrl = requireDatabaseUrl(process.env).url;
  } catch {
    console.error(
      `Release record check failed: set ${databaseUrlVariableName}, the selected database variable.`,
    );
    process.exitCode = 1;
  }
}

const releaseCheckEmail = process.env.RELEASE_CHECK_EMAIL?.trim();

if (databaseUrl && !releaseCheckEmail) {
  console.error(
    "Release record check failed: set RELEASE_CHECK_EMAIL to the account used for the release login and advice request.",
  );
  process.exitCode = 1;
}

const pool = databaseUrl && releaseCheckEmail ? new pg.Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: true,
}) : undefined;

if (pool) try {
  const result = await pool.query(
    `select
       exists(
         select 1
           from users
          where lower(email) = lower($1)
       ) as login_record_found,
       exists(
         select 1
           from advice_requests advice
           join users account on account.id = advice.user_id
          where lower(account.email) = lower($1)
       ) as advice_record_found`,
    [releaseCheckEmail],
  );
  const recordStatus = result.rows[0];

  if (!recordStatus?.login_record_found || !recordStatus.advice_record_found) {
    const missingRecords = [
      !recordStatus?.login_record_found && "login account",
      !recordStatus?.advice_record_found && "advice request",
    ].filter(Boolean);

    console.error(
      `Release record check failed using ${databaseUrlVariableName}: missing ${missingRecords.join(" and ")} for the release-check account.`,
    );
    process.exitCode = 1;
  } else {
    console.info(
      `Release record check passed using ${databaseUrlVariableName}: login and advice records were found.`,
    );
  }
} catch {
  console.error(
    `Release record check could not inspect ${databaseUrlVariableName}. Verify the selected URL, schema, network access, and read permissions.`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}