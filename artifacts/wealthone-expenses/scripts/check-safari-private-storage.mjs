import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.SAFARIDRIVER_PORT ?? 4444);
const baseUrl = process.env.PWA_CHECK_BASE_URL ?? "http://127.0.0.1:4174";
const webdriverUrl = `http://127.0.0.1:${port}`;
const warningSelector = '[data-testid="notice-offline-storage-unavailable"]';
const storageKey = "ezyretire:offline-storage-unavailable";
const evidenceDir = process.env.SAFARI_EVIDENCE_DIR
  ?? join(process.env.RUNNER_TEMP ?? "/tmp", "safari-release-evidence");

await mkdir(evidenceDir, { recursive: true });

async function webdriver(path, { method = "GET", body } = {}) {
  const response = await fetch(`${webdriverUrl}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok || result.value?.error) {
    throw new Error(result.value?.message ?? `SafariDriver request failed (${response.status})`);
  }
  return result.value;
}

async function waitForSafariDriver() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await webdriver("/status");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("SafariDriver did not become ready within 15 seconds.");
}

async function execute(sessionId, script, args = []) {
  return webdriver(`/session/${sessionId}/execute/sync`, {
    method: "POST",
    body: { script, args },
  });
}

async function executeAsync(sessionId, script, args = []) {
  return webdriver(`/session/${sessionId}/execute/async`, {
    method: "POST",
    body: { script, args },
  });
}

async function waitFor(sessionId, description, predicate, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await execute(sessionId, `return Boolean(${predicate});`)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function prepareSession(sessionId) {
  await webdriver(`/session/${sessionId}/url`, {
    method: "POST",
    body: { url: `${baseUrl}/safari-storage-check-setup.html` },
  });
  const cleanupError = await executeAsync(
    sessionId,
    `const done = arguments[arguments.length - 1];
    window.localStorage.clear();
    Promise.all([
      navigator.serviceWorker.getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister()))),
      window.caches.keys()
        .then((keys) => Promise.all(keys.map((key) => window.caches.delete(key)))),
    ]).then(() => done(null), (error) => done(error?.message || String(error)));`,
  );
  if (cleanupError) throw new Error(`Could not reset Safari storage state: ${cleanupError}`);
}

async function navigate(sessionId, scenario) {
  await webdriver(`/session/${sessionId}/url`, {
    method: "POST",
    body: { url: `${baseUrl}/?safari-storage-check=${scenario}` },
  });
  await waitFor(
    sessionId,
    "the ezyRetire page",
    'document.body.textContent.includes("Plan your retirement with confidence")',
  );
}

export function assertCurrentWarning(result) {
  if (!result.warningVisible || result.persisted === null) {
    throw new Error("The current offline-storage warning did not remain visible in Safari.");
  }
}

export function assertStaleWarningRemoved(result) {
  if (result.warningVisible || result.persisted !== null) {
    throw new Error("A warning record older than seven days revived in Safari.");
  }
}

export function assertNoRecordedPageErrors(errors) {
  if (errors.length) throw new Error(`Safari page errors: ${errors.join(" | ")}`);
}

async function assertNoPageErrors(sessionId) {
  const errors = await execute(
    sessionId,
    "return window.__safariStoragePageErrors || ['Safari error recorder was not installed'];",
  );
  assertNoRecordedPageErrors(errors);
}

async function captureFailureEvidence(sessionId, name) {
  const stem = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const captureErrors = [];

  try {
    const screenshot = await webdriver(`/session/${sessionId}/screenshot`);
    await writeFile(join(evidenceDir, `${stem}.png`), Buffer.from(screenshot, "base64"));
  } catch (error) {
    captureErrors.push(`screenshot: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const source = await webdriver(`/session/${sessionId}/source`);
    await writeFile(join(evidenceDir, `${stem}-page-source.html`), source);
  } catch (error) {
    captureErrors.push(`page source: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const state = await execute(
      sessionId,
      `return {
        url: window.location.href,
        title: document.title,
        readyState: document.readyState,
        bodyText: document.body?.innerText ?? null,
        pageErrors: window.__safariStoragePageErrors ?? null,
        warningVisible: Boolean(document.querySelector(arguments[0])),
        persistedWarning: (() => {
          try { return window.localStorage.getItem(arguments[1]); }
          catch (error) { return { inaccessible: error?.message || String(error) }; }
        })(),
      };`,
      [warningSelector, storageKey],
    );
    await writeFile(join(evidenceDir, `${stem}-page-state.json`), `${JSON.stringify(state, null, 2)}\n`);
  } catch (error) {
    captureErrors.push(`page state: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (captureErrors.length) {
    await writeFile(join(evidenceDir, `${stem}-capture-errors.txt`), `${captureErrors.join("\n")}\n`);
  }
}

async function withSafariSession(name, scenario) {
  const session = await webdriver("/session", {
    method: "POST",
    body: {
      capabilities: {
        alwaysMatch: {
          browserName: "safari",
          platformName: "macOS",
        },
      },
    },
  });
  const sessionId = session.sessionId;
  try {
    await prepareSession(sessionId);
    await scenario(sessionId);
    await assertNoPageErrors(sessionId);
    console.log(`✓ ${name}`);
  } catch (error) {
    await captureFailureEvidence(sessionId, name).catch((captureError) => {
      console.error(
        `Could not save Safari failure evidence for "${name}":`,
        captureError instanceof Error ? captureError.message : captureError,
      );
    });
    throw error;
  } finally {
    await webdriver(`/session/${sessionId}`, { method: "DELETE" }).catch(() => {});
  }
}

function verifyForbiddenOutcome(outcome) {
  if (outcome === "absent-current-warning") {
    assertCurrentWarning({ warningVisible: false, persisted: storageKey });
    return;
  }
  if (outcome === "revived-stale-state") {
    assertStaleWarningRemoved({ warningVisible: true, persisted: storageKey });
    return;
  }
  if (outcome === "recorded-page-error") {
    assertNoRecordedPageErrors(["controlled page error"]);
    return;
  }
  throw new Error(`Unknown forbidden Safari outcome: ${outcome}`);
}

async function runSafariCheck() {
  const safariDriverLog = createWriteStream(join(evidenceDir, "safaridriver.log"), { flags: "a" });
  const safariDriver = spawn("safaridriver", ["--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  safariDriver.stdout.pipe(safariDriverLog);
  safariDriver.stderr.pipe(safariDriverLog);

  try {
    await waitForSafariDriver();

  await withSafariSession("keeps a current warning visible", async (sessionId) => {
    await navigate(sessionId, "current");
    await waitFor(sessionId, "the current offline-storage warning", `document.querySelector('${warningSelector}')`);
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    const result = await execute(
      sessionId,
      `return {
        warningVisible: Boolean(document.querySelector('${warningSelector}')),
        persisted: window.localStorage.getItem(arguments[0]),
      };`,
      [storageKey],
    );
    assertCurrentWarning(result);
  });

  await withSafariSession("does not revive a stale warning", async (sessionId) => {
    await navigate(sessionId, "stale");
    const result = await execute(
      sessionId,
      `return {
        warningVisible: Boolean(document.querySelector('${warningSelector}')),
        persisted: window.localStorage.getItem(arguments[0]),
      };`,
      [storageKey],
    );
    assertStaleWarningRemoved(result);
  });

  await withSafariSession("removes malformed warning state", async (sessionId) => {
    await navigate(sessionId, "malformed");
    const result = await execute(
      sessionId,
      `return {
        warningVisible: Boolean(document.querySelector('${warningSelector}')),
        persisted: window.localStorage.getItem(arguments[0]),
      };`,
      [storageKey],
    );
    if (result.warningVisible || result.persisted !== null) {
      throw new Error("Malformed offline-storage state survived in Safari.");
    }
  });

  await withSafariSession("shows the warning when storage is denied", async (sessionId) => {
    await navigate(sessionId, "denied");
    await waitFor(sessionId, "the denied-storage warning", `document.querySelector('${warningSelector}')`);
  });
  } finally {
    safariDriver.kill("SIGTERM");
    safariDriverLog.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(process.argv[1], "file:"))) {
  const forbiddenOutcome = process.argv.find((argument) =>
    argument.startsWith("--verify-forbidden-outcome="),
  );
  if (forbiddenOutcome) {
    verifyForbiddenOutcome(forbiddenOutcome.split("=", 2)[1]);
  } else {
    await runSafariCheck();
  }
}
