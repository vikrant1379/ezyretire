import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { db, loginActivitiesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import express from "express";
import internalMaintenanceRouter from "../routes/internal-maintenance.js";

process.env.CRON_SECRET = "test-only-cron-secret-with-sufficient-entropy";

test("Vercel invokes the login activity retention purge every day", async () => {
  const config = JSON.parse(
    await readFile(new URL("../../vercel.json", `file://${process.cwd()}/`), "utf8"),
  ) as { crons?: Array<{ path: string; schedule: string }> };
  const cron = config.crons?.find(({ path }) => path === "/api/internal/purge-login-activities");
  assert.ok(cron);
  assert.match(cron.schedule, /^\d+ \d+ \* \* \*$/);
});

test("scheduled retention purge requires its secret and removes only expired login activity", async () => {
  const unique = `${process.pid}-${Date.now()}`;
  const userId = `retention-user-${unique}`;
  await db.insert(usersTable).values({ id: userId, email: `${unique}@example.test` });
  await db.insert(loginActivitiesTable).values([
    {
      id: `retention-expired-${unique}`,
      userId,
      authMethod: "oidc",
      createdAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000),
    },
    {
      id: `retention-fresh-${unique}`,
      userId,
      authMethod: "email_otp",
      createdAt: new Date(),
    },
  ]);

  const app = express();
  app.use("/api", internalMaintenanceRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/api/internal/purge-login-activities`;

  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { authorization: "Bearer incorrect" } })).status, 401);
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    assert.equal(response.status, 200);
    assert.ok(((await response.json()) as { deleted: number }).deleted >= 1);

    const expired = await db.select().from(loginActivitiesTable)
      .where(eq(loginActivitiesTable.id, `retention-expired-${unique}`));
    const fresh = await db.select().from(loginActivitiesTable)
      .where(eq(loginActivitiesTable.id, `retention-fresh-${unique}`));
    assert.equal(expired.length, 0);
    assert.equal(fresh.length, 1);
  } finally {
    server.close();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});