import app from "./app.js";
import { logger } from "./lib/logger.js";
import { databaseUrlVariableName, warmPool } from "@workspace/db";
import { evaluatePlanning } from "./lib/planning-jobs.js";
import { runVaultDeletionMaintenance } from "./routes/premium-tools.js";
import { schedulePinLoginAttemptCleanup } from "./lib/account-pin-attempt-cleanup.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  warmPool();
  schedulePinLoginAttemptCleanup(logger);
  setInterval(
    () => schedulePinLoginAttemptCleanup(logger),
    60 * 60_000,
  ).unref();
  if (process.env["NODE_ENV"] === "production") {
    let cleanupRunning = false;
    const cleanup = async () => {
      if (cleanupRunning) return;
      cleanupRunning = true;
      try {
        const result = await runVaultDeletionMaintenance();
        logger.info(result, "Vault deletion maintenance completed");
      } catch (error) {
        logger.warn({ err: error }, "Vault deletion maintenance failed");
      } finally {
        cleanupRunning = false;
      }
    };
    void cleanup();
    setInterval(() => void cleanup(), 5 * 60_000).unref();
    // Delivery runs only in production so local development never sends an
    // account email or push unexpectedly. Each account's consent/preferences
    // and the provider's idempotency keys still gate the production run.
    void evaluatePlanning().catch((error) => logger.warn({ err: error }, "Initial planning evaluation failed"));
    setInterval(() => {
      void evaluatePlanning().catch((error) => logger.warn({ err: error }, "Planning evaluation failed"));
    }, 60 * 60_000).unref();
  }

  logger.info(
    { port, databaseUrlVariableName },
    "Server listening",
  );
});
