import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const artifactRoot = new URL("../../", import.meta.url);
const workspaceRoot = new URL("../../", artifactRoot);

test("production registers the service worker from the configured base path", async () => {
  const main = await readFile(new URL("src/main.tsx", artifactRoot), "utf8");

  assert.match(main, /import\.meta\.env\.PROD/);
  assert.match(main, /import\.meta\.env\.BASE_URL/);
  assert.match(main, /\.register\(`\$\{basePath\}sw\.js`/);
});

test("service worker never intercepts API or cross-origin requests", async () => {
  const worker = await readFile(new URL("public/sw.js", artifactRoot), "utf8");

  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /url\.origin !== self\.location\.origin/);
  assert.doesNotMatch(worker, /api-cache|cache\.put\(request, clone\)/);
});

test("offline and service-worker files bypass the Vercel SPA fallback", async () => {
  const vercel = JSON.parse(
    await readFile(new URL("vercel.json", workspaceRoot), "utf8"),
  ) as { rewrites: Array<{ source: string }> };

  const source = vercel.rewrites[0]?.source ?? "";
  assert.ok(source.includes("sw\\.js"));
  assert.ok(source.includes("offline\\.html"));
  assert.ok(source.includes("site\\.webmanifest"));
});