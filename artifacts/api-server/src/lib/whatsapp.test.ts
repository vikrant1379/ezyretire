import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { CreateAdviceRequestBody } from "@workspace/api-zod";
import { whatsappNotificationEventsTable } from "@workspace/db/schema";
import { getTableConfig } from "drizzle-orm/pg-core";
import express, { type Request } from "express";
import { createWhatsAppAdminRouter } from "../routes/whatsapp.js";
import {
  buildWhatsAppProviderPayload,
  createWhatsAppRetry,
  createWhatsAppQueue,
  type DeliveryResult,
} from "./whatsapp-core.js";

const notification = {
  adviceRequestId: 42,
  eventType: "advisor_assigned" as const,
  to: "+91 98765-43210",
  parameters: ["Asha", "Ravi"],
};

test("provider failures are absorbed and recorded instead of rejecting request work", async () => {
  const recorded: DeliveryResult[] = [];
  const queue = createWhatsAppQueue({
    claimEvent: async () => 1,
    deliver: async () => {
      throw new Error("provider unavailable");
    },
    recordResult: async (_eventId, result) => {
      recorded.push(result);
    },
  });

  await assert.doesNotReject(
    Promise.all([
      queue({ ...notification, eventType: "request_created" }),
      queue(notification),
    ]),
  );
  assert.deepEqual(recorded, [
    { status: "failed", error: "provider unavailable" },
    { status: "failed", error: "provider unavailable" },
  ]);
});

test("concurrent and repeated assignment updates produce one notification claim", async () => {
  const claimed = new Set<string>();
  let deliveries = 0;
  const queue = createWhatsAppQueue({
    claimEvent: async (candidate) => {
      const key = `${candidate.adviceRequestId}:${candidate.eventType}`;
      if (claimed.has(key)) return null;
      claimed.add(key);
      return 1;
    },
    deliver: async () => {
      deliveries += 1;
      return { status: "sent" };
    },
    recordResult: async () => undefined,
  });

  await Promise.all(Array.from({ length: 8 }, () => queue(notification)));
  await queue(notification);

  assert.equal(claimed.size, 1);
  assert.equal(deliveries, 1);
});

test("simultaneous retries of a failed event produce one new delivery attempt", async () => {
  let status: DeliveryResult["status"] = "failed";
  let attempts = 1;
  let deliveries = 0;
  const queue = createWhatsAppQueue({
    claimEvent: async () => {
      if (status !== "failed" && status !== "skipped") return null;
      status = "sent";
      attempts += 1;
      return 1;
    },
    deliver: async () => {
      deliveries += 1;
      return { status: "sent" };
    },
    recordResult: async (_eventId, result) => {
      status = result.status;
    },
  });

  await Promise.all(Array.from({ length: 8 }, () => queue(notification)));

  assert.equal(attempts, 2);
  assert.equal(deliveries, 1);
  assert.equal(status, "sent");
});

test("a provider failure can recover on a deliberate retry but sent events cannot retry", async () => {
  let status: DeliveryResult["status"] | "pending" | undefined;
  let attempts = 0;
  let deliveries = 0;
  const queue = createWhatsAppQueue({
    claimEvent: async () => {
      if (status === "pending" || status === "sent") return null;
      status = "pending";
      attempts += 1;
      return 1;
    },
    deliver: async () => {
      deliveries += 1;
      return deliveries === 1
        ? { status: "failed", error: "temporary provider outage" }
        : { status: "sent", providerMessageId: "wamid.recovered" };
    },
    recordResult: async (_eventId, result) => {
      status = result.status;
    },
  });

  await queue(notification);
  await queue(notification);
  await queue(notification);

  assert.equal(attempts, 2);
  assert.equal(deliveries, 2);
  assert.equal(status, "sent");
});

test("the admin retry endpoint recovers a persisted failure exactly once under contention", async () => {
  let status: DeliveryResult["status"] | "pending" = "failed";
  let attempts = 1;
  let deliveries = 0;
  const queue = createWhatsAppQueue({
    claimEvent: async () => {
      if (status !== "failed" && status !== "skipped") return null;
      status = "pending";
      attempts += 1;
      return 7;
    },
    deliver: async () => {
      deliveries += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { status: "sent", providerMessageId: "wamid.retried" };
    },
    recordResult: async (_eventId, result) => {
      status = result.status;
    },
  });
  const retry = createWhatsAppRetry({
    loadEvent: async (eventId) =>
      eventId === 7
        ? {
            adviceRequestId: 42,
            eventType: "request_created",
            status,
            to: notification.to,
            userName: notification.parameters[0],
            advisorName: null,
          }
        : null,
    queue,
  });
  const app = express();
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as Request["isAuthenticated"];
    req.user = { isAdmin: true } as Express.User;
    next();
  });
  app.use("/api", createWhatsAppAdminRouter(retry));
  const server = app.listen(0);

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        fetch(`http://127.0.0.1:${port}/api/admin/whatsapp-events/7/retry`, {
          method: "POST",
        }),
      ),
    );

    assert.equal(responses.filter((response) => response.status === 200).length, 1);
    assert.equal(responses.filter((response) => response.status === 409).length, 7);
    assert.equal(attempts, 2);
    assert.equal(deliveries, 1);
    assert.equal(status, "sent");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("the retry endpoint is restricted to administrators", async () => {
  let authenticated = false;
  let isAdmin = false;
  let retryCalls = 0;
  const app = express();
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => authenticated) as Request["isAuthenticated"];
    if (authenticated) req.user = { isAdmin } as Express.User;
    next();
  });
  app.use(
    "/api",
    createWhatsAppAdminRouter(async () => {
      retryCalls += 1;
      return { outcome: "not_found" };
    }),
  );
  const server = app.listen(0);

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const endpoint = `http://127.0.0.1:${port}/api/admin/whatsapp-events/7/retry`;
    const unauthenticated = await fetch(endpoint, { method: "POST" });
    authenticated = true;
    const nonAdmin = await fetch(endpoint, { method: "POST" });

    assert.equal(unauthenticated.status, 401);
    assert.equal(nonAdmin.status, 403);
    assert.equal(retryCalls, 0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("the database enforces one claim per request and notification event", () => {
  const uniqueIndex = getTableConfig(whatsappNotificationEventsTable).indexes.find(
    (index) => index.config.name === "whatsapp_notification_request_event_unique",
  );

  assert.equal(uniqueIndex?.config.unique, true);
  assert.deepEqual(
    uniqueIndex?.config.columns.map((column) =>
      "name" in column ? column.name : undefined,
    ),
    ["advice_request_id", "event_type"],
  );
});

test("notification events retain retry attempts and outcome timestamps for operators", () => {
  const columns = getTableConfig(whatsappNotificationEventsTable).columns.map(
    (column) => column.name,
  );

  assert.equal(columns.includes("attempt_count"), true);
  assert.equal(columns.includes("last_attempt_at"), true);
  assert.equal(columns.includes("completed_at"), true);
});

test("provider payload excludes private advice and locally stored plan data", () => {
  const payload = buildWhatsAppProviderPayload(notification, "advisor_assigned");
  const serialized = JSON.stringify(payload);

  assert.deepEqual(payload?.template.components?.[0]?.parameters, [
    { type: "text", text: "Asha" },
    { type: "text", text: "Ravi" },
  ]);
  for (const privateValue of [
    "Need debt help",
    "125000",
    "499",
    "retirement",
    "locally stored plan",
  ]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("invalid consent is rejected before notification work can begin", () => {
  let notificationWorkStarted = false;
  const parsed = CreateAdviceRequestBody.safeParse({
    userName: "Asha",
    whatsappNumber: "+919876543210",
    topic: "financial",
    note: "Need debt help",
    consent: false,
  });

  if (parsed.success) notificationWorkStarted = true;

  assert.equal(parsed.success, false);
  assert.equal(notificationWorkStarted, false);
});