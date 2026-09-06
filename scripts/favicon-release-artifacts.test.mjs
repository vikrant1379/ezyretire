import assert from "node:assert/strict";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { acquireSnapshotLock } from "./favicon-snapshot-lock.mjs";
import {
  createActiveFaviconEvidence,
  pruneFaviconEvidence,
  retention,
} from "./favicon-release-check.mjs";

const root = resolve(import.meta.dirname, "..");
const resultsDir = join(root, "test-results");
const browserResultsDir = join(resultsDir, "playwright");
const snapshot = join(
  root,
  "artifacts/wealthone-expenses/e2e/favicon-visual.spec.ts-snapshots",
  "favicon-browser-sizes-desktop-chromium-linux.png",
);
const snapshotLock = `${snapshot}.release-check.lock`;

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForFile(file, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(file)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${file}`);
    await sleep(25);
  }
}

async function waitForUrl(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The development server is still starting.
    }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${url}`);
    await sleep(50);
  }
}

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (status, signal) =>
      resolve({ status, signal, stdout, stderr }),
    );
  });
}

async function runLockWorker() {
  const directory = process.env.FAVICON_LOCK_TEST_DIRECTORY;
  const name = process.env.FAVICON_LOCK_TEST_NAME;
  const approved = readFileSync(join(directory, "approved.png"));
  const releaseLock = await acquireSnapshotLock(snapshotLock, {
    timeoutMs: 10_000,
  });
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    writeFileSync(snapshot, approved);
    releaseLock();
  };
  const interrupt = () => {
    restore();
    process.exit(130);
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);

  try {
    assert.deepEqual(
      readFileSync(snapshot),
      approved,
      `${name} acquired the lock while another worker's bytes remained`,
    );
    appendFileSync(join(directory, "order"), `${name}\n`);
    writeFileSync(snapshot, Buffer.from(`temporary snapshot from ${name}`));
    writeFileSync(join(directory, `${name}.ready`), "");
    await waitForFile(join(directory, `${name}.release`));
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    restore();
  }
}

async function runAbandonedLockOwner() {
  const directory = process.env.FAVICON_LOCK_TEST_DIRECTORY;
  await acquireSnapshotLock(snapshotLock, { timeoutMs: 10_000 });
  writeFileSync(join(directory, "owner.ready"), "");
  await new Promise((resolve) => setInterval(resolve, 60_000));
}

if (process.argv.includes("--lock-worker")) {
  await runLockWorker();
  process.exit(0);
}

if (process.argv.includes("--abandoned-lock-owner")) {
  await runAbandonedLockOwner();
}

function run(command, env = {}) {
  return spawnSync(command, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
    shell: true,
  });
}

function filesBelow(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

test("favicon evidence cleanup retains live active and recent checks", () => {
  const directory = mkdtempSync(join(tmpdir(), "favicon-retention-test-"));
  const now = Date.now();
  const createDirectory = (name, ageMs) => {
    const path = join(directory, name);
    mkdirSync(path);
    writeFileSync(join(path, ".keep"), "");
    const modified = new Date(now - ageMs);
    utimesSync(path, modified, modified);
    return path;
  };

  try {
    const active = createActiveFaviconEvidence(directory);
    const old = new Date(now - retention.activeGraceMs - 1);
    utimesSync(active, old, old);
    const recent = createDirectory(
      "favicon-visual.failed.recent",
      retention.recentGraceMs / 2,
    );
    const expired = createDirectory(
      "favicon-visual.failed.expired",
      retention.maxAgeMs + 1,
    );

    const removed = pruneFaviconEvidence(directory, { now });
    assert.deepEqual(removed, [expired]);
    assert.equal(existsSync(active), true, "Cleanup touched an active comparison.");
    assert.equal(existsSync(recent), true, "Cleanup removed recent evidence.");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("favicon evidence cleanup reclaims a hard-killed owner only after its grace period", {
  timeout: 30_000,
}, async () => {
  rmSync(resultsDir, { recursive: true, force: true });
  mkdirSync(resultsDir, { recursive: true });
  const owner = spawn(process.execPath, ["scripts/favicon-release-check.mjs"], {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const ownerResult = waitForChild(owner);
  let active;

  try {
    const deadline = Date.now() + 20_000;
    while (!active) {
      active = readdirSync(resultsDir, { withFileTypes: true })
        .find(
          (entry) =>
            entry.isDirectory()
            && entry.name.startsWith("favicon-visual.active.")
            && existsSync(join(resultsDir, entry.name, "evidence")),
        );
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for Playwright to initialize evidence.");
      }
      if (!active) await sleep(25);
    }
    active = join(resultsDir, active.name);
    const old = new Date(Date.now() - retention.activeGraceMs - 1);
    utimesSync(active, old, old);

    pruneFaviconEvidence(resultsDir);
    assert.equal(existsSync(active), true, "Cleanup removed a live owner.");

    process.kill(-owner.pid, "SIGKILL");
    const killed = await ownerResult;
    assert.equal(killed.signal, "SIGKILL");

    const recent = new Date();
    utimesSync(active, recent, recent);
    pruneFaviconEvidence(resultsDir);
    assert.equal(
      existsSync(active),
      true,
      "Cleanup ignored the abandoned owner's safety grace period.",
    );

    utimesSync(active, old, old);
    assert.deepEqual(pruneFaviconEvidence(resultsDir), [active]);
    assert.equal(existsSync(active), false);
  } finally {
    if (owner.exitCode === null && owner.signalCode === null) {
      process.kill(-owner.pid, "SIGKILL");
    }
    rmSync(resultsDir, { recursive: true, force: true });
  }
});

test("favicon evidence cleanup enforces its count limit without touching concurrent active runs", () => {
  const directory = mkdtempSync(join(tmpdir(), "favicon-count-test-"));
  const now = Date.now();

  try {
    const active = createActiveFaviconEvidence(directory);
    writeFileSync(join(active, "in-progress"), "");
    for (let index = 0; index < retention.maxCompleted + 3; index += 1) {
      const completed = join(
        directory,
        `favicon-visual.failed.${String(index).padStart(2, "0")}`,
      );
      mkdirSync(completed);
      writeFileSync(join(completed, "evidence"), "");
      const modified = new Date(
        now - retention.recentGraceMs - 1_000 - index * 1_000,
      );
      utimesSync(completed, modified, modified);
    }

    pruneFaviconEvidence(directory, { now });
    const remainingCompleted = readdirSync(directory).filter((name) =>
      name.startsWith("favicon-visual.failed."),
    );
    assert.equal(remainingCompleted.length, retention.maxCompleted);
    assert.equal(
      existsSync(join(active, "in-progress")),
      true,
      "Cleanup racing a comparison removed its active evidence.",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("concurrent release checks serialize approved snapshot changes", {
  timeout: 20_000,
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "favicon-lock-test-"));
  const original = readFileSync(snapshot);
  writeFileSync(join(directory, "approved.png"), original);
  const startWorker = (name) =>
    spawn(process.execPath, [import.meta.filename, "--lock-worker"], {
      cwd: root,
      env: {
        ...process.env,
        FAVICON_LOCK_TEST_DIRECTORY: directory,
        FAVICON_LOCK_TEST_NAME: name,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

  try {
    const first = startWorker("first");
    const firstResult = waitForChild(first);
    await waitForFile(join(directory, "first.ready"));

    const second = startWorker("second");
    const secondResult = waitForChild(second);
    await sleep(200);
    assert.equal(
      existsSync(join(directory, "second.ready")),
      false,
      "The second invocation changed the snapshot before the first released it.",
    );

    first.kill("SIGTERM");
    await waitForFile(join(directory, "second.ready"));
    writeFileSync(join(directory, "second.release"), "");

    const interrupted = await firstResult;
    assert.equal(
      interrupted.status,
      130,
      `Interrupted worker did not cleanly release its lock.\n${interrupted.stdout}\n${interrupted.stderr}`,
    );
    const completed = await secondResult;
    assert.equal(
      completed.status,
      0,
      `Second worker failed.\n${completed.stdout}\n${completed.stderr}`,
    );
    assert.equal(readFileSync(join(directory, "order"), "utf8"), "first\nsecond\n");
    assert.deepEqual(readFileSync(snapshot), original);
  } finally {
    writeFileSync(snapshot, original);
    rmSync(snapshotLock, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a release check reclaims a lock abandoned by SIGKILL", {
  timeout: 20_000,
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "favicon-sigkill-lock-test-"));
  const original = readFileSync(snapshot);
  writeFileSync(join(directory, "approved.png"), original);
  const startChild = (argument, name) =>
    spawn(process.execPath, [import.meta.filename, argument], {
      cwd: root,
      env: {
        ...process.env,
        FAVICON_LOCK_TEST_DIRECTORY: directory,
        FAVICON_LOCK_TEST_NAME: name,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

  try {
    const owner = startChild("--abandoned-lock-owner", "owner");
    const ownerResult = waitForChild(owner);
    await waitForFile(join(directory, "owner.ready"));

    owner.kill("SIGKILL");
    const killed = await ownerResult;
    assert.equal(killed.signal, "SIGKILL");
    assert.deepEqual(
      readFileSync(snapshot),
      original,
      "The hard-killed lock owner changed the approved favicon snapshot.",
    );

    const later = startChild("--lock-worker", "later");
    const laterResult = waitForChild(later);
    await waitForFile(join(directory, "later.ready"));
    writeFileSync(join(directory, "later.release"), "");

    const completed = await laterResult;
    assert.equal(
      completed.status,
      0,
      `Later worker did not reclaim the abandoned lock.\n${completed.stdout}\n${completed.stderr}`,
    );
    assert.deepEqual(readFileSync(snapshot), original);
  } finally {
    writeFileSync(snapshot, original);
    rmSync(snapshotLock, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
  }
});

test("favicon release wrapper keeps evidence only for failures", {
  timeout: 120_000,
}, async () => {
  rmSync(resultsDir, { recursive: true, force: true });
  const releaseLock = await acquireSnapshotLock(snapshotLock);
  const successful = run("pnpm check:favicon-visual");
  assert.equal(
    successful.status,
    0,
    `Approved favicon comparison failed.\n${successful.stdout}\n${successful.stderr}`,
  );
  assert.equal(
    filesBelow(resultsDir).length,
    0,
    "A successful comparison must remove its output artifacts.",
  );

  const backupDir = mkdtempSync(join(tmpdir(), "favicon-snapshot-"));
  const backup = join(backupDir, "approved.png");
  cpSync(snapshot, backup);
  let restored = false;
  let devServer;

  const restore = () => {
    if (restored) return;
    writeFileSync(snapshot, readFileSync(backup));
    restored = true;
  };
  const interrupt = () => {
    restore();
    releaseLock();
    process.exit(130);
  };

  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);

  try {
    const update = run(
      "pnpm --filter @workspace/wealthone-expenses exec playwright test e2e/favicon-visual.spec.ts --config playwright.config.ts --project desktop-chromium --update-snapshots",
      { FAVICON_VISUAL_FORCE_MISMATCH: "1" },
    );
    assert.equal(
      update.status,
      0,
      `Could not prepare controlled mismatch.\n${update.stdout}\n${update.stderr}`,
    );

    devServer = spawn("pnpm", ["run", "dev"], {
      cwd: join(root, "artifacts/wealthone-expenses"),
      env: { ...process.env, PORT: "4173", BASE_PATH: "/" },
      stdio: "ignore",
      detached: true,
    });
    await waitForUrl("http://127.0.0.1:4173/");

    const staleEvidence = join(resultsDir, "favicon-visual.failed.stale");
    mkdirSync(staleEvidence);
    writeFileSync(join(staleEvidence, "old-evidence"), "");
    const staleDate = new Date(Date.now() - retention.maxAgeMs - 1_000);
    utimesSync(staleEvidence, staleDate, staleDate);

    const startMismatch = () =>
      spawn("pnpm", ["check:favicon-visual"], {
        cwd: root,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    const [firstMismatch, secondMismatch] = await Promise.all([
      waitForChild(startMismatch()),
      waitForChild(startMismatch()),
    ]);
    for (const mismatch of [firstMismatch, secondMismatch]) {
      assert.notEqual(
        mismatch.status,
        0,
        `A controlled favicon mismatch unexpectedly passed.\n${mismatch.stdout}\n${mismatch.stderr}`,
      );
    }
    assert.equal(
      existsSync(staleEvidence),
      false,
      "Concurrent checks did not prune stale completed evidence.",
    );

    const invocationDirs = readdirSync(resultsDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && entry.name.startsWith("favicon-visual."),
      )
      .map((entry) => join(resultsDir, entry.name));
    assert.equal(
      invocationDirs.length,
      2,
      `Expected separate evidence from two failed checks. Found: ${invocationDirs.join(", ")}`,
    );
    for (const invocationDir of invocationDirs) {
      const evidence = filesBelow(invocationDir).map((file) =>
        file.slice(invocationDir.length + 1),
      );
      for (const artifact of [
        /favicon-browser-sizes-expected\.png$/,
        /favicon-browser-sizes-actual\.png$/,
        /favicon-browser-sizes-diff\.png$/,
        /error-context\.md$/,
      ]) {
        assert.ok(
          evidence.some((file) => artifact.test(file)),
          `Missing ${artifact} from ${invocationDir}. Found: ${evidence.join(", ")}`,
        );
      }
    }

    const retainedEvidence = invocationDirs.flatMap(filesBelow);
    const staleBrowserArtifact = join(browserResultsDir, "stale-artifact.txt");
    mkdirSync(browserResultsDir, { recursive: true });
    writeFileSync(staleBrowserArtifact, "remove me", { flag: "w" });
    const browserRun = run(
      "pnpm --filter @workspace/wealthone-expenses run test:e2e -- e2e/favicon-visual.spec.ts --project desktop-chromium",
    );
    assert.notEqual(
      browserRun.status,
      0,
      `The controlled mismatch should also fail in a regular browser run.\n${browserRun.stdout}\n${browserRun.stderr}`,
    );
    assert.equal(
      existsSync(staleBrowserArtifact),
      false,
      "A regular browser run must still clean its own previous output.",
    );
    for (const artifact of retainedEvidence) {
      assert.equal(
        existsSync(artifact),
        true,
        `A regular browser run removed retained favicon evidence: ${artifact}`,
      );
    }
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    if (devServer && devServer.exitCode === null) {
      process.kill(-devServer.pid, "SIGTERM");
    }
    restore();
    releaseLock();
    rmSync(backupDir, { recursive: true, force: true });
    rmSync(resultsDir, { recursive: true, force: true });
  }
});