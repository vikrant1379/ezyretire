import type { ErrorRequestHandler } from "express";
import { logger } from "../lib/logger.js";

/**
 * Converts unhandled route and middleware failures into a stable public response.
 * Express 5 forwards rejected async handlers here automatically.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, next): void => {
  if (res.headersSent) {
    next(error);
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