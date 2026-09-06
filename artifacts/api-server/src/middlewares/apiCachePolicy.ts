import type { RequestHandler } from "express";

export const apiCachePolicy: RequestHandler = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
};