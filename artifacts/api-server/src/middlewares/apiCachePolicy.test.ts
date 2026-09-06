import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { apiCachePolicy } from "./apiCachePolicy.js";

test("API responses forbid storage in browser and intermediary caches", async (t) => {
  const app = express();
  app.use("/api", apiCachePolicy);
  app.get("/api/financial-data", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const response = await fetch(`http://127.0.0.1:${address.port}/api/financial-data`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
});