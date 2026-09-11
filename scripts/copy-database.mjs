/**
 * Copies every row from one Postgres database to another.
 *
 * Used when moving the Neon project between regions. The target must already
 * have the schema (`pnpm --filter @workspace/db run push` against its unpooled
 * URL). Re-running is safe: existing rows are left alone.
 *
 *   SOURCE_DATABASE_URL='...' TARGET_DATABASE_URL='...' node scripts/copy-database.mjs
 */
import pg from "pg";

const { Pool } = pg;

const sourceUrl = process.env.SOURCE_DATABASE_URL ?? process.env.DATABASE_URL;
const targetUrl = process.env.TARGET_DATABASE_URL;

if (!sourceUrl || !targetUrl) {
  console.error(
    "Set SOURCE_DATABASE_URL (or DATABASE_URL) and TARGET_DATABASE_URL before running.",
  );
  process.exit(1);
}

if (sourceUrl === targetUrl) {
  console.error("Source and target are the same database.");
  process.exit(1);
}

/**
 * Parents before children, so foreign keys always resolve. Login sessions are
 * deliberately absent: they are short lived and everyone signs in again.
 */
const TABLES_IN_DEPENDENCY_ORDER = [
  "users",
  "advisors",
  "advice_settings",
  "user_profiles",
  "retirement_plans",
  "financial_accounts",
  "dependents",
  "income_sources",
  "salary_details",
  "income_receipts",
  "loans",
  "expenses",
  "budgets",
  "investments",
  "advice_requests",
  "whatsapp_notification_events",
];

const source = new Pool({ connectionString: sourceUrl, max: 2 });
const target = new Pool({ connectionString: targetUrl, max: 2 });

async function columnsOf(pool, table) {
  const { rows } = await pool.query(
    `select column_name
       from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by ordinal_position`,
    [table],
  );
  return rows.map((row) => row.column_name);
}

async function copyTable(table) {
  const [sourceColumns, targetColumns] = await Promise.all([
    columnsOf(source, table),
    columnsOf(target, table),
  ]);

  if (sourceColumns.length === 0) return { table, skipped: "not in source" };
  if (targetColumns.length === 0) return { table, skipped: "not in target" };

  // Only columns both sides agree on, so a schema that moved on still loads.
  const shared = sourceColumns.filter((column) => targetColumns.includes(column));
  const dropped = sourceColumns.filter((column) => !targetColumns.includes(column));

  const quoted = shared.map((column) => `"${column}"`).join(", ");
  const { rows } = await source.query(`select ${quoted} from "${table}"`);
  if (rows.length === 0) return { table, copied: 0, dropped };

  const placeholders = shared.map((_column, index) => `$${index + 1}`).join(", ");
  let copied = 0;
  for (const row of rows) {
    const result = await target.query(
      `insert into "${table}" (${quoted}) values (${placeholders})
       on conflict do nothing`,
      shared.map((column) => row[column]),
    );
    copied += result.rowCount ?? 0;
  }

  return { table, copied, total: rows.length, dropped };
}

try {
  for (const table of TABLES_IN_DEPENDENCY_ORDER) {
    const result = await copyTable(table);
    if (result.skipped) {
      console.log(`${table.padEnd(30)} skipped (${result.skipped})`);
      continue;
    }
    const suffix =
      result.dropped.length > 0 ? `  [ignored columns: ${result.dropped.join(", ")}]` : "";
    console.log(
      `${table.padEnd(30)} copied ${result.copied} of ${result.total ?? 0}${suffix}`,
    );
  }
  console.log("\nDone. Point DATABASE_URL at the new database and sign in again.");
} finally {
  await source.end();
  await target.end();
}
