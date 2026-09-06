import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { adviceRequestsTable, db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import express, { type Request } from "express";
import adviceRouter from "../routes/advice.js";

test("customer advice writes are paused without changing stored requests", async () => {
  const unique = `${process.pid}-${Date.now()}`;
  const customerId = `paused-advice-${unique}`;
  await db.insert(usersTable).values({
    id: customerId,
    email: `${customerId}@example.test`,
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as Request["isAuthenticated"];
    req.user = {
      id: customerId,
      email: `${customerId}@example.test`,
      isAdmin: false,
    } as Express.User;
    next();
  });
  app.use("/api", adviceRouter);
  const server = app.listen(0);

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const adviceUrl = `http://127.0.0.1:${port}/api/advice`;

    const createResponse = await fetch(adviceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userName: "Paused Customer",
        whatsappNumber: "+919999999999",
        topic: "financial",
        consent: true,
      }),
    });
    assert.equal(createResponse.status, 503);
    const createBody = (await createResponse.json()) as { error?: unknown };
    assert.match(
      String(createBody.error),
      /temporarily unavailable.*hello@ezyretire\.com/i,
    );

    const paymentResponse = await fetch(`${adviceUrl}/payment-reference`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentReference: "UTR-PAUSED-1234" }),
    });
    assert.equal(paymentResponse.status, 503);

    const requests = await db
      .select()
      .from(adviceRequestsTable)
      .where(eq(adviceRequestsTable.userId, customerId));
    assert.equal(requests.length, 0);
  } finally {
    server.close();
    await db.delete(usersTable).where(eq(usersTable.id, customerId));
  }
});

test("admin payment endpoint rejects pending approval and accepts submitted approval", async () => {
  const unique = `${process.pid}-${Date.now()}`;
  const customerId = `payment-route-${unique}`;
  await db.insert(usersTable).values({
    id: customerId,
    email: `${customerId}@example.test`,
  });
  const [request] = await db
    .insert(adviceRequestsTable)
    .values({
      userId: customerId,
      userName: "Payment Route",
      whatsappNumber: "+910000000001",
      topic: "financial",
      consent: true,
    })
    .returning();

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as Request["isAuthenticated"];
    req.user = {
      id: "route-test-admin",
      email: "route-admin@example.test",
      isAdmin: true,
    } as Express.User;
    next();
  });
  app.use("/api", adviceRouter);
  const server = app.listen(0);

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const updatePayment = (paymentStatus: string) =>
      fetch(
        `http://127.0.0.1:${port}/api/admin/advice-requests/${request.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentStatus }),
        },
      );

    const pendingApproval = await updatePayment("paid");
    assert.equal(pendingApproval.status, 409);
    const pendingRejection = await updatePayment("rejected");
    assert.equal(pendingRejection.status, 409);

    await db
      .update(adviceRequestsTable)
      .set({
        paymentStatus: "submitted",
        paymentReference: "UTR-ROUTE-1234",
        paymentSubmittedAt: new Date(),
      })
      .where(eq(adviceRequestsTable.id, request.id));

    const submittedApproval = await updatePayment("paid");
    assert.equal(submittedApproval.status, 200);
    const [persisted] = await db
      .select()
      .from(adviceRequestsTable)
      .where(eq(adviceRequestsTable.id, request.id));
    assert.equal(persisted.paymentStatus, "paid");
    assert.equal(persisted.paymentReference, "UTR-ROUTE-1234");
  } finally {
    server.close();
    await db.delete(usersTable).where(eq(usersTable.id, customerId));
  }
});