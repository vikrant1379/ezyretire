import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import type { AdviceAdminDashboard } from "@workspace/api-client-react";
import { getGetAdviceAdminDashboardQueryKey } from "@workspace/api-client-react";
import {
  addAdminAdvisor,
  replaceAdminAdviceRequest,
  replaceAdminAdvisor,
  setAdminAdviceSettings,
} from "../lib/advice-query-cache.ts";
import {
  capturePrivateQueryGeneration,
  synchronizeAccountQueryCache,
} from "../lib/query-policy.ts";

const dashboard = {
  settings: {
    consultationFee: 100,
    currency: "INR",
    businessWhatsapp: "",
    upiId: "",
  },
  advisors: [{ id: 1, name: "First" }],
  requests: [{ id: 10, status: "submitted" }],
} as AdviceAdminDashboard;

test("admin mutation responses reconcile only their dashboard slice", () => {
  const client = new QueryClient();
  const key = getGetAdviceAdminDashboardQueryKey();
  synchronizeAccountQueryCache(client, "admin-a");
  const generation = capturePrivateQueryGeneration(client);
  client.setQueryData(key, dashboard);

  setAdminAdviceSettings(client, generation, {
    ...dashboard.settings,
    consultationFee: 250,
  });
  addAdminAdvisor(client, generation, { id: 2, name: "Second" } as AdviceAdminDashboard["advisors"][number]);
  replaceAdminAdvisor(client, generation, { id: 1, name: "Updated" } as AdviceAdminDashboard["advisors"][number]);
  replaceAdminAdviceRequest(client, generation, {
    id: 10,
    status: "completed",
  } as AdviceAdminDashboard["requests"][number]);

  const updated = client.getQueryData<AdviceAdminDashboard>(key);
  assert.equal(updated?.settings.consultationFee, 250);
  assert.deepEqual(updated?.advisors.map(({ id, name }) => ({ id, name })), [
    { id: 2, name: "Second" },
    { id: 1, name: "Updated" },
  ]);
  assert.equal(updated?.requests[0]?.status, "completed");
  client.clear();
});

test("mutation responses do not synthesize an unfetched admin dashboard", () => {
  const client = new QueryClient();
  synchronizeAccountQueryCache(client, "admin-a");
  const generation = capturePrivateQueryGeneration(client);
  setAdminAdviceSettings(client, generation, dashboard.settings);
  assert.equal(
    client.getQueryData(getGetAdviceAdminDashboardQueryKey()),
    undefined,
  );
  client.clear();
});

test("an old-account mutation cannot recreate private cache after a switch", () => {
  const client = new QueryClient();
  const key = getGetAdviceAdminDashboardQueryKey();
  synchronizeAccountQueryCache(client, "admin-a");
  const oldGeneration = capturePrivateQueryGeneration(client);
  client.setQueryData(key, dashboard);

  synchronizeAccountQueryCache(client, "admin-b");
  setAdminAdviceSettings(client, oldGeneration, {
    ...dashboard.settings,
    consultationFee: 999,
  });

  assert.equal(client.getQueryData(key), undefined);
  client.clear();
});