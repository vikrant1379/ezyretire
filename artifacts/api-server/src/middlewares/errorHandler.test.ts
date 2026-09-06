import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { errorHandler } from "./errorHandler.js";

async function withServer(
  configure: (app: express.Express) => void,
  run: (origin: string) => Promise<void>,
): Promise<void> {
  const app = express();
  configure(app);
  const server = app.listen(0);

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("normalizes unhandled synchronous and asynchronous failures to bounded JSON", async () => {
  await withServer(
    (app) => {
      app.get("/sync", () => {
        throw new Error("sensitive synchronous failure details");
      });
      app.get("/async", async () => {
        throw new Error("sensitive asynchronous failure details");
      });
      app.use(errorHandler);
    },
    async (origin) => {
      for (const path of ["/sync", "/async"]) {
        const response = await fetch(`${origin}${path}`);
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), { error: "Internal server error" });
      }
    },
  );
});

test("does not replace explicit route responses", async () => {
  await withServer(
    (app) => {
      app.get("/explicit", (_req, res) => {
        res.status(418).json({ error: "Expected response" });
      });
      app.use(errorHandler);
    },
    async (origin) => {
      const response = await fetch(`${origin}/explicit`);
      assert.equal(response.status, 418);
      assert.deepEqual(await response.json(), { error: "Expected response" });
    },
  );
});