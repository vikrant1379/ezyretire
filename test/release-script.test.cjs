const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { readFile: readFileAsync } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const releaseWorkflow = readFileSync(
  path.join(__dirname, "..", ".github", "workflows", "publish-release.yml"),
  "utf8",
);
const webkitWorkflow = readFileSync(
  path.join(__dirname, "..", ".github", "workflows", "release-webkit-pwa.yml"),
  "utf8",
);
const releaseDocumentation = readFileSync(
  path.join(__dirname, "..", "README.md"),
  "utf8",
);

test("WebKit release gate runs on the exact post-merge main commit", () => {
  assert.match(webkitWorkflow, /push:\s*\n\s+branches:\s*\n\s+- main/);
});

test("guarded release verifies main ancestry before publication", () => {
  assert.match(releaseWorkflow, /compareCommitsWithBasehead/);
  assert.match(releaseWorkflow, /\$\{targetSha\}\.\.\.\$\{mainSha\}/);
  assert.match(releaseWorkflow, /\["ahead", "identical"\]/);
  assert.ok(
    releaseWorkflow.indexOf("compareCommitsWithBasehead") <
      releaseWorkflow.indexOf("gh release create"),
  );
});

test("guarded release requires the exact successful WebKit check", () => {
  assert.match(releaseWorkflow, /WebKit private-storage warning/);
  assert.match(releaseWorkflow, /check\.status === "completed"/);
  assert.match(releaseWorkflow, /check\.conclusion === "success"/);
  assert.ok(
    releaseWorkflow.indexOf("checks.listForRef") <
      releaseWorkflow.indexOf("gh release create"),
  );
});

test("guarded release cannot reuse a tag from another commit", () => {
  assert.match(releaseWorkflow, /context\.payload\.inputs\.tag_name/);
  assert.match(releaseWorkflow, /existingTag\.data\.sha !== targetSha/);
  assert.ok(
    releaseWorkflow.indexOf("existingTag.data.sha !== targetSha") <
      releaseWorkflow.indexOf("gh release create"),
  );
});

test("release procedure requires immutable guarded tags", () => {
  assert.match(releaseDocumentation, /Restrict creations/);
  assert.match(releaseDocumentation, /Restrict updates/);
  assert.match(releaseDocumentation, /Restrict\s+deletions/);
  assert.match(releaseDocumentation, /Squash-merge a pull request/);
});
const mandatoryReleaseGates = [
  "test:release-contract",
  "check:pdf-ua",
  "check:release-records",
  "check:favicon-visual",
  "check:design-system-visual",
  "check:pwa",
  "check:published-favicons",
  "check:published-fonts",
  "check:published-auth-analytics",
];

test("root release check runs every mandatory gate in order", async () => {
  const workspacePackage = JSON.parse(
    await readFileAsync(
      new URL("../package.json", `file://${__filename}`),
      "utf8",
    ),
  );
  const releaseCommand = workspacePackage.scripts?.["check:release"];

  assert.equal(
    typeof releaseCommand,
    "string",
    "root check:release script must exist",
  );
  assert.deepEqual(
    releaseCommand.split(/\s*&&\s*/),
    mandatoryReleaseGates.map((gate) => `pnpm ${gate}`),
    "update mandatoryReleaseGates only when the required release contract intentionally changes",
  );
});
