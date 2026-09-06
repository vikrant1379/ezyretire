import pino from "pino";
import { getEnv } from "./env.js";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: getEnv("LOG_LEVEL") ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
