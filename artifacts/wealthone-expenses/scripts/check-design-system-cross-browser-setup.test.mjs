import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const appRoot = new URL("../", import.meta.url);

test("design-system visual checks keep a small Firefox and WebKit release subset", async () => {
  const [config, spec, packageJson, rootPackageJson, workflow, preflight] = await Promise.all([
    readFile(new URL("playwright.config.ts", appRoot), "utf8"),
    readFile(new URL("e2e/design-system-visual.spec.ts", appRoot), "utf8"),
    readFile(new URL("package.json", appRoot), "utf8").then(JSON.parse),
    readFile(new URL("../../package.json", appRoot), "utf8").then(JSON.parse),
    readFile(new URL("../../.github/workflows/release-webkit-pwa.yml", appRoot), "utf8"),
    readFile(new URL("scripts/check-webkit-runtime.mjs", appRoot), "utf8"),
  ]);

  assert.match(config, /name: "cross-browser-firefox"[\s\S]*grep: \/@cross-browser\/[\s\S]*Desktop Firefox/);
  assert.match(config, /name: "cross-browser-webkit"[\s\S]*grep: \/@cross-browser\/[\s\S]*Desktop Safari/);
  assert.match(spec, /viewport\.name === "desktop" \? " @cross-browser" : ""/);
  assert.match(spec, /signed-in desktop card and expense form @cross-browser/);
  assert.match(spec, /signed-in mobile cards and responsive navigation @touch @cross-browser/);
  assert.match(spec, /maxDiffPixelRatio: projectName\.startsWith\("cross-browser-"\) \? 0\.01/);
  assert.match(
    packageJson.scripts["check:design-system-cross-browser"],
    /check-webkit-runtime\.mjs.*--project cross-browser-firefox --project cross-browser-webkit/,
  );
  assert.equal(rootPackageJson.devDependencies["@playwright/test"], "1.62.1");
  assert.match(workflow, /name: Design system \(\$\{\{ matrix\.browser \}\}\)/);
  assert.match(workflow, /browser:\s*\n\s+- firefox\s*\n\s+- webkit/);
  assert.match(workflow, /matrix\.browser.*webkit[\s\S]*check-webkit-runtime\.mjs/);
  assert.match(workflow, /--project cross-browser-\$\{\{ matrix\.browser \}\}/);
  assert.match(workflow, /design-system-\$\{\{ matrix\.browser \}\}-visual-failure/);
  assert.match(preflight, /host setup failed before any app regression check ran/);
  assert.match(preflight, /browser\/runtime dependency failure, not an application test failure/);

  const snapshotDirectory = new URL("e2e/design-system-visual.spec.ts-snapshots/", appRoot);
  await Promise.all(
    ["firefox", "webkit"].flatMap((browser) =>
      [
        "design-system-signed-out-desktop",
        "design-system-signed-in-desktop-form",
        "design-system-signed-in-mobile-navigation",
      ].map((state) => access(new URL(`${state}-cross-browser-${browser}-linux.png`, snapshotDirectory))),
    ),
  );
});