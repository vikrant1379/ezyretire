import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { hostname } from "node:os";
import { join, resolve } from "node:path";

// Keep the newest 20 completed failures for diagnosis, never delete evidence
// from the last 24 hours, and expire completed evidence after 30 days.
const activeOwnerFile = ".favicon-release-owner.json";

export const retention = Object.freeze({
  maxCompleted: 20,
  recentGraceMs: 24 * 60 * 60 * 1000,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  activeGraceMs: 10 * 60 * 1000,
});

function processStartIdentity(pid) {
  try {
    // Field 22 is the process start time. The command field can contain spaces
    // and parentheses, so parse fields only after its final closing parenthesis.
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ESRCH") return null;
    throw error;
  }
}

export function createActiveFaviconEvidence(parentDirectory) {
  const directory = mkdtempSync(
    join(parentDirectory, "favicon-visual.active."),
  );
  const processStart = processStartIdentity(process.pid);
  if (processStart === null) {
    rmSync(directory, { recursive: true, force: true });
    throw new Error("Could not identify the favicon release-check owner.");
  }
  writeFileSync(
    join(directory, activeOwnerFile),
    `${JSON.stringify({
      version: 1,
      hostname: hostname(),
      pid: process.pid,
      processStart,
    })}\n`,
    { flag: "wx" },
  );
  return directory;
}

function activeOwnerIsGone(directory) {
  let owner;
  try {
    owner = JSON.parse(readFileSync(join(directory, activeOwnerFile), "utf8"));
  } catch {
    return false;
  }
  if (
    owner?.version !== 1 ||
    owner.hostname !== hostname() ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid <= 0 ||
    typeof owner.processStart !== "string" ||
    owner.processStart.length === 0
  ) {
    return false;
  }

  try {
    const currentStart = processStartIdentity(owner.pid);
    return currentStart === null || currentStart !== owner.processStart;
  } catch {
    // If ownership cannot be proved dead, preserve the active evidence.
    return false;
  }
}

export function pruneFaviconEvidence(
  parentDirectory,
  { now = Date.now(), ...policy } = {},
) {
  const limits = { ...retention, ...policy };
  let entries;
  try {
    entries = readdirSync(parentDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const path = join(parentDirectory, entry.name);
        try {
          return [{ path, name: entry.name, modifiedAt: statSync(path).mtimeMs }];
        } catch (error) {
          if (error.code === "ENOENT") return [];
          throw error;
        }
      });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const removed = [];
  for (const entry of entries.filter(({ name }) =>
    name.startsWith("favicon-visual.active."),
  )) {
    const graceElapsed = now - entry.modifiedAt >= limits.activeGraceMs;
    if (graceElapsed && activeOwnerIsGone(entry.path)) {
      rmSync(entry.path, { recursive: true, force: true });
      removed.push(entry.path);
    }
  }

  const completed = entries
    .filter(({ name }) => name.startsWith("favicon-visual.failed."))
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  for (const [index, entry] of completed.entries()) {
    const age = now - entry.modifiedAt;
    const isRecent = age < limits.recentGraceMs;
    const isExpired = age > limits.maxAgeMs;
    const exceedsCount = index >= limits.maxCompleted;
    if (!isRecent && (isExpired || exceedsCount)) {
      rmSync(entry.path, { recursive: true, force: true });
      removed.push(entry.path);
    }
  }
  return removed;
}

export function runFaviconReleaseCheck({
  root = resolve(import.meta.dirname, ".."),
  now = Date.now(),
} = {}) {
  const parentDirectory = join(root, "test-results");
  mkdirSync(parentDirectory, { recursive: true });
  pruneFaviconEvidence(parentDirectory, { now });

  const activeDirectory = createActiveFaviconEvidence(parentDirectory);
  const evidenceDirectory = join(activeDirectory, "evidence");
  const result = spawnSync(
    "pnpm",
    [
      "--filter",
      "@workspace/wealthone-expenses",
      "run",
      "check:favicon-visual",
    ],
    {
      cwd: root,
      env: { ...process.env, FAVICON_VISUAL_OUTPUT_DIR: evidenceDirectory },
      stdio: "inherit",
    },
  );

  if (result.status === 0) {
    rmSync(activeDirectory, { recursive: true, force: true });
  } else {
    const failedDirectory = activeDirectory.replace(
      "favicon-visual.active.",
      "favicon-visual.failed.",
    );
    renameSync(activeDirectory, failedDirectory);
    console.error(
      `Favicon comparison evidence is available in ${failedDirectory.slice(root.length + 1)}.`,
    );
    pruneFaviconEvidence(parentDirectory);
  }

  return result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = runFaviconReleaseCheck();
}