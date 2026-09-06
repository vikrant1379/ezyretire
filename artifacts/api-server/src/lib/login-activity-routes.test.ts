import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { db, loginActivitiesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import express, { type Request } from "express";
import loginActivityRouter from "../routes/login-activity.js";

function createServer(authenticated: boolean, isAdmin: boolean) {
  const app = express();
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => authenticated) as Request["isAuthenticated"];
    if (authenticated) {
      req.user = {
        id: "login-activity-route-admin",
        email: "admin@example.test",
        isAdmin,
      } as Express.User;
    }
    next();
  });
  app.use("/api", loginActivityRouter);
  return app.listen(0);
}

async function urlFor(server: ReturnType<typeof createServer>) {
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}/api/admin/login-activity`;
}

test("login activity history is server-authorized", async () => {
  for (const [authenticated, isAdmin, expected] of [
    [false, false, 401],
    [true, false, 403],
  ] as const) {
    const server = createServer(authenticated, isAdmin);
    try {
      assert.equal((await fetch(await urlFor(server))).status, expected);
    } finally {
      server.close();
    }
  }
});

test("admin login activity paginates newest-first and purges expired records", async () => {
  const unique = `${process.pid}-${Date.now()}`;
  const userId = `login-activity-user-${unique}`;
  await db.insert(usersTable).values({
    id: userId,
    email: `${unique}@example.test`,
    fullName: "Login Activity User",
  });
  await db.insert(loginActivitiesTable).values([
    {
      id: `expired-${unique}`,
      userId,
      authMethod: "oidc",
      createdAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000),
    },
    {
      id: `older-${unique}`,
      userId,
      authMethod: "email_otp",
      deviceType: null,
      createdAt: new Date(Date.now() + 30 * 60 * 1000),
    },
    {
      id: `newer-${unique}`,
      userId,
      authMethod: "oidc",
      deviceType: "Desktop",
      browser: "Firefox 140",
      operatingSystem: "Linux",
      country: "IN",
      region: "KA",
      city: "Bengaluru",
      createdAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  ]);

  const server = createServer(true, true);
  try {
    const url = await urlFor(server);
    const firstResponse = await fetch(`${url}?page=1&pageSize=1`);
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json() as {
      items: Array<{ id: string; authMethod: string; deviceType: string | null }>;
      total: number;
      totalPages: number;
    };
    assert.equal(first.items[0].id, `newer-${unique}`);
    assert.equal(first.items[0].authMethod, "oidc");
    assert.ok(first.total >= 2);
    assert.equal(first.totalPages, first.total);

    const second = await (await fetch(`${url}?page=2&pageSize=1`)).json() as {
      items: Array<{ id: string; deviceType: string | null }>;
    };
    assert.equal(second.items[0].id, `older-${unique}`);
    assert.equal(second.items[0].deviceType, null);

    const expired = await db
      .select()
      .from(loginActivitiesTable)
      .where(eq(loginActivitiesTable.id, `expired-${unique}`));
    assert.equal(expired.length, 0);
  } finally {
    server.close();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});