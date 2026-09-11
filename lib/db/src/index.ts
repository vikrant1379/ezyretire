import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { getEnvironmentValue, requireDatabaseUrl } from "../database-url.mjs";
import * as schema from "./schema/index.js";

const { Pool } = pg;

export const {
  variableName: databaseUrlVariableName,
  url: databaseUrl,
} = requireDatabaseUrl(process.env);


pg.types.setTypeParser(1114, (value) => value);
const configuredPoolMax = Number(
  getEnvironmentValue(process.env, "DB_POOL_MAX") ??
    (process.env.VERCEL ? "3" : "10"),
);
export const poolMax = configuredPoolMax;

if (!Number.isInteger(configuredPoolMax) || configuredPoolMax <= 0) {
  throw new Error("DB_POOL_MAX must be a positive integer");
}

// Opening a connection costs a TCP and TLS handshake, which is the dominant
// cost when the app and the database sit in different regions. Serverless
// invocations are short lived and should release connections quickly, but a
// long running server keeps them warm and reuses them.
const isServerless = Boolean(process.env.VERCEL);

export const pool = new Pool({
  connectionString: databaseUrl,
  max: configuredPoolMax,
  idleTimeoutMillis: isServerless ? 10_000 : 120_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  allowExitOnIdle: true,
});

/**
 * A pooled connection sitting idle can be dropped by the network or by the
 * database suspending itself. Without this listener that arrives as an
 * unhandled 'error' event and takes the whole process down. The pool discards
 * the broken client on its own, so recording it is enough.
 */
pool.on("error", (error) => {
  console.error("Idle database connection failed and was discarded:", error.message);
});
export const db = drizzle(pool, { schema });

/**
 * Opens a few connections up front. A page load fans out into several queries
 * at once, and without warm connections each one waits for its own handshake,
 * which turns a parallel read into a serial one.
 */
export function warmPool(connections = Math.min(6, configuredPoolMax)): void {
  if (isServerless) return;
  for (let index = 0; index < connections; index += 1) {
    pool
      .connect()
      .then((client) => client.release())
      .catch(() => undefined);
  }
}

export * from "./schema/index.js";
