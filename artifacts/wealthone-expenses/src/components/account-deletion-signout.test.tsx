import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  completeAccountDeletionSignOut,
} from "../pages/profile.tsx";

test("successful account deletion clears private query state and replaces with the signed-out route", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let requestWasCancelled = false;
  const pendingQuery = queryClient.fetchQuery({
    queryKey: ["financial-data"],
    queryFn: ({ signal }) => new Promise<never>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        requestWasCancelled = true;
        reject(new Error("cancelled"));
      });
    }),
  }).catch(() => undefined);
  queryClient.setQueryData(["/api/advice/private"], { recommendation: "private" });

  const replacements: string[] = [];
  await completeAccountDeletionSignOut(
    queryClient,
    (path) => replacements.push(path),
    "/artifacts/ezyretire/",
  );
  await pendingQuery;

  assert.equal(requestWasCancelled, true);
  assert.equal(queryClient.getQueryCache().getAll().length, 0);
  assert.equal(queryClient.getMutationCache().getAll().length, 0);
  assert.deepEqual(replacements, [
    "/artifacts/ezyretire/login?accountDeletion=scheduled&returnTo=%2Fsettings",
  ]);
});

test("account deletion success uses the cache-clearing signed-out flow", async () => {
  const settingsPage = await readFile(
    new URL("../pages/settings.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    settingsPage,
    /requestDeletion\.mutate\([\s\S]*?onSuccess:\s*async\s*\(\)\s*=>\s*\{[\s\S]*?await completeAccountDeletionSignOut\(queryClient\)/,
  );
});