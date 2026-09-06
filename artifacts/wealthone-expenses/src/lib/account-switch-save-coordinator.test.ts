import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { beginAccountSwitchSave } from "./account-switch-save-coordinator.ts";

function beginLatestSave(scope: object) {
  return beginAccountSwitchSave(
    scope,
    { account: undefined, visibleData: undefined },
    "latest",
  );
}

test("latest-save ordering is isolated between query clients", () => {
  const firstClient = new QueryClient();
  const secondClient = new QueryClient();

  const olderFirstClientSave = beginLatestSave(firstClient);
  const newerFirstClientSave = beginLatestSave(firstClient);
  const secondClientSave = beginLatestSave(secondClient);

  assert.equal(
    olderFirstClientSave.finish(),
    false,
    "an older overlapping save must not publish its response",
  );
  assert.equal(
    secondClientSave.finish(),
    true,
    "a save in an independent client must publish despite another client's pending save",
  );
  assert.equal(
    newerFirstClientSave.finish(),
    true,
    "the newest overlapping save must publish after the older save completes",
  );
});

test("older failure cannot roll back a newer optimistic preference", () => {
  const client = new QueryClient();
  const olderSave = beginLatestSave(client);
  const newerSave = beginLatestSave(client);

  assert.equal(olderSave.finish(), false, "the older failure must not roll back");
  assert.equal(newerSave.finish(), true, "the newer success must publish");
});

test("older success cannot replace a newer preference that fails first", () => {
  const client = new QueryClient();
  const olderSave = beginLatestSave(client);
  const newerSave = beginLatestSave(client);

  assert.equal(
    newerSave.finish(),
    true,
    "the latest failure must restore its prior preference",
  );
  assert.equal(
    olderSave.finish(),
    false,
    "the older success must not publish after that rollback",
  );
});

test("different save policies share one account-switch notice claim", () => {
  const client = new QueryClient();
  const snapshot = { account: undefined, visibleData: undefined };
  const completionOrderSave = beginAccountSwitchSave(
    client,
    snapshot,
    "completion",
  );
  const latestSave = beginAccountSwitchSave(client, snapshot, "latest");

  assert.equal(completionOrderSave.claimAccountSwitchNotice(), true);
  assert.equal(latestSave.claimAccountSwitchNotice(), false);
});