import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageJsonUrl = new URL("../package.json", import.meta.url);
const workflowUrl = new URL("../../../.github/workflows/release-webkit-pwa.yml", import.meta.url);

test("release automation installs and runs the dedicated WebKit project", async () => {
  const [packageJson, workflow] = await Promise.all([
    readFile(packageJsonUrl, "utf8").then(JSON.parse),
    readFile(workflowUrl, "utf8"),
  ]);

  assert.match(
    packageJson.scripts["check:pwa:webkit-release"],
    /check-webkit-runtime\.mjs.*--project webkit-private-storage-warning/,
  );
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /playwright install --with-deps webkit/);
  assert.match(workflow, /check:pwa:webkit-release/);
});

test("release automation gates pull requests before main is published", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.match(workflow, /pull_request:\s*\n\s+branches:\s*\n\s+- main/);
  assert.doesNotMatch(workflow, /release:\s*\n\s+types:\s*\[published\]/);
  assert.match(workflow, /name: WebKit private-storage warning/);
});

test("release automation runs the same warning contract in Apple Safari on macOS", async () => {
  const [packageJson, workflow, safariCheck, publishWorkflow] = await Promise.all([
    readFile(packageJsonUrl, "utf8").then(JSON.parse),
    readFile(workflowUrl, "utf8"),
    readFile(new URL("./check-safari-private-storage.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../../.github/workflows/publish-release.yml", import.meta.url), "utf8"),
  ]);

  assert.match(packageJson.scripts["check:pwa:safari-release"], /check-safari-private-storage\.mjs/);
  assert.match(workflow, /name: Safari private-storage warning/);
  assert.match(workflow, /runs-on: macos-15/);
  assert.match(workflow, /sudo safaridriver --enable/);
  assert.match(workflow, /check:pwa:safari-release/);
  assert.match(safariCheck, /keeps a current warning visible/);
  assert.match(safariCheck, /does not revive a stale warning/);
  assert.match(safariCheck, /removes malformed warning state/);
  assert.match(safariCheck, /shows the warning when storage is denied/);
  assert.match(safariCheck, /__safariStoragePageErrors/);
  assert.match(publishWorkflow, /const requiredCheck = "Safari private-storage warning"/);
});

test("Safari gate fails closed for every forbidden warning outcome without Safari", () => {
  const safariCheckUrl = new URL("./check-safari-private-storage.mjs", import.meta.url);
  const forbiddenOutcomes = [
    ["absent-current-warning", /current offline-storage warning did not remain visible/],
    ["revived-stale-state", /older than seven days revived/],
    ["recorded-page-error", /controlled page error/],
  ];

  for (const [outcome, expectedError] of forbiddenOutcomes) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(safariCheckUrl), `--verify-forbidden-outcome=${outcome}`],
      { encoding: "utf8" },
    );

    assert.notEqual(result.status, 0, `${outcome} unexpectedly passed the Safari gate`);
    assert.match(`${result.stdout}\n${result.stderr}`, expectedError);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /safaridriver.*ENOENT/i);
  }
});

test("WebKit preflight gives an actionable setup message", async () => {
  const preflight = await readFile(
    new URL("./check-webkit-runtime.mjs", import.meta.url),
    "utf8",
  );

  assert.match(preflight, /WebKit host setup failed before any app regression check ran/);
  assert.match(preflight, /playwright install --with-deps webkit/);
});