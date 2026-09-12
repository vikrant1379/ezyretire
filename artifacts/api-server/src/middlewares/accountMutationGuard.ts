import type { NextFunction, Request, Response } from "express";
import {
  acquireAccountWriteFence, accountDeletionBlocksMutation, runWithAccountFenceOwnership,
} from "../lib/account-compliance.js";

const ACCOUNT_MUTATION_ADMISSION_TIMEOUT_MS = 5_000;
let admissionTimeoutForTests: number | undefined;
export function setAccountMutationAdmissionTimeoutForTests(milliseconds?: number): void {
  admissionTimeoutForTests = milliseconds;
}

/**
 * A cooling/processing account is immutable. This is deliberately mounted
 * after authentication and before the route tree so new mutation routes do
 * not accidentally create a write-after-snapshot path.
 */
export async function accountMutationGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user || req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  if (
    req.path.includes("/internal/")
    || req.path.endsWith("/auth/logout")
    || req.path.endsWith("/auth/otp/verify")
    || req.path.endsWith("/auth/passkeys/authentication/verify")
  ) {
    next();
    return;
  }
  const admission = new AbortController();
  const admissionTimeout = setTimeout(
    () => admission.abort(new Error("Account write admission timed out")),
    admissionTimeoutForTests ?? ACCOUNT_MUTATION_ADMISSION_TIMEOUT_MS,
  );
  admissionTimeout.unref();
  const cancelAdmission = () => {
    admission.abort(new Error("Request closed while waiting for account write admission"));
  };
  const cancelOnRequestClose = () => {
    if (req.aborted || req.complete === false) cancelAdmission();
  };
  req.once?.("aborted", cancelAdmission);
  req.once?.("close", cancelOnRequestClose);
  res.once?.("close", cancelAdmission);
  const clearAdmissionWait = () => {
    clearTimeout(admissionTimeout);
    req.removeListener?.("aborted", cancelAdmission);
    req.removeListener?.("close", cancelOnRequestClose);
    res.removeListener?.("close", cancelAdmission);
  };
  let release: Awaited<ReturnType<typeof acquireAccountWriteFence>>;
  try {
    release = await acquireAccountWriteFence(req.user.id, { signal: admission.signal });
  } catch {
    clearAdmissionWait();
    if (!res.destroyed) {
      res.setHeader("Retry-After", "1");
      res.status(503).json({
        error: "Account write admission is temporarily busy; retry the request",
        code: "ACCOUNT_WRITE_ADMISSION_BUSY",
        retryable: true,
      });
    }
    return;
  }
  clearAdmissionWait();
  let blocked: boolean;
  try {
    blocked = await accountDeletionBlocksMutation(req.user.id);
  } catch (error) {
    await release();
    next(error);
    return;
  }
  if (blocked && !req.path.endsWith("/account/deletion")) {
    await release();
    res.status(423).json({ error: "Account is locked for deletion", code: "ACCOUNT_DELETION_IN_PROGRESS" });
    return;
  }
  let released = false;
  const finish = () => {
    if (released) return;
    released = true;
    void release().catch((error: unknown) => {
      try {
        req.log.error(
          {
            errorName: error instanceof Error ? error.name : "Unknown",
            errorCategory: "account_fence_release_failed",
          },
          "Account fence release failed after response settlement",
        );
      } catch {
        // Response settlement must never create another rejected async path.
      }
    });
  };
  res.locals.accountFenceSettle = finish;
  res.once("finish", finish);
  res.once("error", finish);
  res.once("close", () => {
    if (res.writableEnded) finish();
  });
  const originalEnd = res.end.bind(res);
  res.end = ((...args: Parameters<Response["end"]>) => {
    try {
      return originalEnd(...args);
    } finally {
      finish();
    }
  }) as Response["end"];
  runWithAccountFenceOwnership(req.user.id, next);
}