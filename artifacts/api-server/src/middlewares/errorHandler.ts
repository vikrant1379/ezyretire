import type { ErrorRequestHandler } from "express";
import { logger } from "../lib/logger.js";
import {
  isPasskeyPrerequisiteError,
  passkeyUnavailableReason,
  PASSKEY_UNAVAILABLE_MESSAGE,
} from "../lib/passkeys.js";

/**
 * Converts unhandled route and middleware failures into a stable public response.
 * Express 5 forwards rejected async handlers here automatically.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, next): void => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const bodyError = error as {
    status?: unknown;
    statusCode?: unknown;
    type?: unknown;
    code?: unknown;
    message?: unknown;
    limitBytes?: unknown;
  };
  if (bodyError.code === "FINANCIAL_SAVE_SIZE_LIMIT") {
    res.status(413).json({
      error: typeof bodyError.message === "string"
        ? bodyError.message
        : "This change would make your financial data too large to save.",
      code: bodyError.code,
      ...(typeof bodyError.limitBytes === "number"
        ? { limitBytes: bodyError.limitBytes }
        : {}),
    });
    return;
  }
  if (
    bodyError.status === 413
    || bodyError.statusCode === 413
    || bodyError.type === "entity.too.large"
  ) {
    res.status(413).json({ error: "Request body is too large" });
    return;
  }
  if (req.path.startsWith("/api/auth/passkeys") && isPasskeyPrerequisiteError(error)) {
    const errorRecord = error as { code?: unknown; name?: unknown };
    logger.error(
      {
        errorName: typeof errorRecord.name === "string" ? errorRecord.name : "Error",
        errorCode: typeof errorRecord.code === "string" ? errorRecord.code : undefined,
        method: req.method,
        path: req.path,
      },
      "Passkey prerequisite unavailable",
    );
    res.status(503).json({
      error: PASSKEY_UNAVAILABLE_MESSAGE,
      reason: passkeyUnavailableReason(error),
    });
    return;
  }

  logger.error(
    {
      err: error,
      method: req.method,
      path: req.path,
    },
    "Unhandled API request error",
  );
  res.status(500).json({ error: "Internal server error" });
};