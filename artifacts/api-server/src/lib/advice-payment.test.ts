import assert from "node:assert/strict";
import test from "node:test";
import {
  adviceRequestsTable,
  db,
  usersTable,
} from "@workspace/db";
import { getTableConfig } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import {
  isDatabaseUniqueViolation,
  submitAdvicePaymentReference,
} from "./advice-payment.js";

test("database update is owner-scoped and cannot overwrite admin approval", async () => {
  const unique = `${process.pid}-${Date.now()}`;
  const userId = `payment-test-${unique}`;
  await db.transaction(async (tx) => {
    try {
      await tx.insert(usersTable).values({
        id: userId,
        email: `${userId}@example.test`,
      });
      const [request] = await tx
        .insert(adviceRequestsTable)
        .values({
          userId,
          userName: "Payment Test",
          whatsappNumber: "+910000000001",
          topic: "financial",
          consent: true,
        })
        .returning();

      const otherUser = await submitAdvicePaymentReference({
        userId: `${userId}-other`,
        paymentReference: "UTR-OTHER",
        executor: tx,
      });
      assert.deepEqual(otherUser, { ok: false, reason: "state_conflict" });

      await tx
        .update(adviceRequestsTable)
        .set({ paymentStatus: "paid" })
        .where(eq(adviceRequestsTable.id, request.id));
      const staleCustomerWrite = await submitAdvicePaymentReference({
        userId,
        paymentReference: "UTR-LATE",
        executor: tx,
      });
      assert.deepEqual(staleCustomerWrite, {
        ok: false,
        reason: "state_conflict",
      });

      const [persisted] = await tx
        .select()
        .from(adviceRequestsTable)
        .where(eq(adviceRequestsTable.id, request.id));
      assert.equal(persisted.paymentStatus, "paid");
      assert.equal(persisted.paymentReference, null);
    } finally {
      await tx.delete(usersTable).where(eq(usersTable.id, userId));
    }
  });
});

test("database update trims valid references and supports rejected resubmission", async () => {
  const unique = `${process.pid}-${Date.now()}`;
  const userId = `payment-retry-${unique}`;
  const now = new Date("2026-09-02T12:00:00.000Z");
  await db.transaction(async (tx) => {
    try {
      await tx.insert(usersTable).values({
        id: userId,
        email: `${userId}@example.test`,
      });
      await tx.insert(adviceRequestsTable).values({
        userId,
        userName: "Payment Retry",
        whatsappNumber: "+910000000001",
        topic: "financial",
        consent: true,
        paymentStatus: "rejected",
      });

      const result = await submitAdvicePaymentReference({
        userId,
        paymentReference: "  UTR-1234  ",
        now,
        executor: tx,
      });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.request.paymentReference, "UTR-1234");
        assert.equal(result.request.paymentStatus, "submitted");
        assert.deepEqual(result.request.paymentSubmittedAt, now);
      }
    } finally {
      await tx.delete(usersTable).where(eq(usersTable.id, userId));
    }
  });
});

test("blank-after-trim references are rejected without changing database state", async () => {
  const result = await submitAdvicePaymentReference({
    userId: "unused",
    paymentReference: "       ",
  });
  assert.deepEqual(result, { ok: false, reason: "invalid_reference" });
});

test("database schema contains persisted payment reference fields", () => {
  const table = getTableConfig(adviceRequestsTable);
  const columns = table.columns.map((column) => column.name);
  assert.ok(columns.includes("payment_reference"));
  assert.ok(columns.includes("payment_submitted_at"));
  assert.ok(
    table.indexes.some(
      (index) => index.config.name === "advice_requests_one_active_per_user",
    ),
  );
});

test("simultaneous creation keeps one active request and one payment target", async () => {
  const unique = `${process.pid}-${Date.now()}`;
  const userId = `payment-concurrent-${unique}`;
  try {
    await db.insert(usersTable).values({
      id: userId,
      email: `${userId}@example.test`,
    });
    const createRequest = () =>
      db.insert(adviceRequestsTable).values({
        userId,
        userName: "Concurrent Payment",
        whatsappNumber: "+910000000001",
        topic: "financial",
        consent: true,
      });
    const creations = await Promise.allSettled([
      createRequest(),
      createRequest(),
    ]);
    assert.equal(
      creations.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      creations.filter(
        (result) =>
          result.status === "rejected" &&
          isDatabaseUniqueViolation(result.reason),
      ).length,
      1,
    );

    const submission = await submitAdvicePaymentReference({
      userId,
      paymentReference: "UTR-CONCURRENT",
    });
    assert.equal(submission.ok, true);
    const requests = await db
      .select()
      .from(adviceRequestsTable)
      .where(eq(adviceRequestsTable.userId, userId));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].paymentStatus, "submitted");
    assert.equal(requests[0].paymentReference, "UTR-CONCURRENT");
  } finally {
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});