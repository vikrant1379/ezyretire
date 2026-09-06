import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";

const retryDelayMs = 50;
const incompleteLockGraceMs = 5_000;

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function removeAbandonedLock(lockDirectory) {
  try {
    const owner = JSON.parse(readFileSync(`${lockDirectory}/owner.json`, "utf8"));
    if (Number.isInteger(owner.pid) && processIsRunning(owner.pid)) return false;
  } catch {
    try {
      const ageMs = Date.now() - statSync(lockDirectory).mtimeMs;
      if (ageMs < incompleteLockGraceMs) return false;
    } catch {
      return true;
    }
  }

  rmSync(lockDirectory, { recursive: true, force: true });
  return true;
}

export async function acquireSnapshotLock(
  lockDirectory,
  { timeoutMs = 120_000 } = {},
) {
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      mkdirSync(lockDirectory);
      writeFileSync(
        `${lockDirectory}/owner.json`,
        JSON.stringify({ pid: process.pid }),
        { flag: "wx" },
      );
      let released = false;
      return () => {
        if (released) return;
        released = true;
        rmSync(lockDirectory, { recursive: true, force: true });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        rmSync(lockDirectory, { recursive: true, force: true });
        throw error;
      }
      if (removeAbandonedLock(lockDirectory)) continue;
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for favicon snapshot lock: ${lockDirectory}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}