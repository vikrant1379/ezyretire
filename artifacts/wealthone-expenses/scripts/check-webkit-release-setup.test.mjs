import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

test("WebKit preflight gives an actionable setup message", async () => {
  const preflight = await readFile(
    new URL("./check-webkit-runtime.mjs", import.meta.url),
    "utf8",
  );

  assert.match(preflight, /WebKit release-check setup is incomplete/);
  assert.match(preflight, /playwright install --with-deps webkit/);
});