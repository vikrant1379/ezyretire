import * as schema from "./schema/index.js";
export declare const databaseUrlVariableName: import("../database-url.mjs").DatabaseVariableName, databaseUrl: string;
export declare const poolMax: number;
export declare const pool: import("pg").Pool;
export declare const db: import("drizzle-orm/node-postgres").NodePgDatabase<typeof schema> & {
    $client: import("pg").Pool;
};
/**
 * Opens a few connections up front. A page load fans out into several queries
 * at once, and without warm connections each one waits for its own handshake,
 * which turns a parallel read into a serial one.
 */
export declare function warmPool(connections?: number): void;
export * from "./schema/index.js";
//# sourceMappingURL=index.d.ts.map