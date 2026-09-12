import assert from "node:assert/strict";
import test from "node:test";
import { focusManager, QueryObserver } from "@tanstack/react-query";
import {
  FINANCIAL_DATA_KEY,
  FINANCIAL_DATA_STALE_TIME_MS,
  createAppQueryClient,
  synchronizeAccountQueryCache,
} from "../lib/query-policy.ts";

test("concurrent financial consumers share one request and remount while fresh", async () => {
  const client = createAppQueryClient();
  let requests = 0;
  const queryFn = async () => {
    requests += 1;
    return { account: "a" };
  };
  const options = {
    queryKey: FINANCIAL_DATA_KEY,
    queryFn,
    staleTime: FINANCIAL_DATA_STALE_TIME_MS,
  };
  const first = new QueryObserver(client, options);
  const second = new QueryObserver(client, options);
  const unsubscribeFirst = first.subscribe(() => undefined);
  const unsubscribeSecond = second.subscribe(() => undefined);
  await Promise.all([first.refetch(), second.refetch()]);
  assert.equal(requests, 1);
  unsubscribeFirst();
  unsubscribeSecond();

  const remounted = new QueryObserver(client, options);
  const unsubscribeRemounted = remounted.subscribe(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requests, 1, "fresh remount must use the in-memory response");
  unsubscribeRemounted();
  client.clear();
});

test("account changes remove private financial, advice, and admin data", () => {
  const client = createAppQueryClient();
  synchronizeAccountQueryCache(client, "account-a");
  client.setQueryData(FINANCIAL_DATA_KEY, { account: "a" });
  client.setQueryData(["/api/advice"], { account: "a" });
  client.setQueryData(["/api/admin/advice"], { account: "a" });
  client.setQueryData(["public-reference"], { safe: true });

  assert.equal(synchronizeAccountQueryCache(client, "account-b"), true);
  assert.equal(client.getQueryData(FINANCIAL_DATA_KEY), undefined);
  assert.equal(client.getQueryData(["/api/advice"]), undefined);
  assert.equal(client.getQueryData(["/api/admin/advice"]), undefined);
  assert.deepEqual(client.getQueryData(["public-reference"]), { safe: true });
  assert.equal(synchronizeAccountQueryCache(client, "account-b"), false);
  client.clear();
});

test("window focus reuses fresh financial data and refreshes stale data", async () => {
  const client = createAppQueryClient();
  client.mount();
  let requests = 0;
  const observer = new QueryObserver(client, {
    queryKey: FINANCIAL_DATA_KEY,
    queryFn: async () => ({ request: ++requests }),
    staleTime: FINANCIAL_DATA_STALE_TIME_MS,
    refetchOnWindowFocus: true,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  await observer.refetch();

  focusManager.setFocused(false);
  focusManager.setFocused(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requests, 1);

  client.setQueryData(FINANCIAL_DATA_KEY, { request: requests }, {
    updatedAt: Date.now() - FINANCIAL_DATA_STALE_TIME_MS - 1,
  });
  focusManager.setFocused(false);
  focusManager.setFocused(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requests, 2);

  unsubscribe();
  client.unmount();
  client.clear();
  focusManager.setFocused(undefined);
});