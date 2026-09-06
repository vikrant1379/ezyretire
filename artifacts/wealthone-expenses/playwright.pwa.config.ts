import { defineConfig } from "@playwright/test";

const port = 4174;
const privateStorageWarningChecks = /expires a stale confirmed offline storage warning|keeps a current confirmed offline storage warning visible when local storage is blocked|removes a malformed persisted offline storage warning/;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "pwa.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  outputDir: "../../test-results/pwa",
  preserveOutput: "failures-only",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        launchOptions: {
          executablePath:
            process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
            ?? "/repl/tools/bin/chromium",
        },
      },
    },
    {
      name: "firefox-storage-blocked-recovery",
      grep: /offline recovery works when privacy settings block session storage/,
      use: {
        browserName: "firefox",
      },
    },
    {
      name: "firefox-private-storage-warning",
      grep: privateStorageWarningChecks,
      use: {
        browserName: "firefox",
      },
    },
    {
      // Keep this as a dedicated project rather than folding WebKit into the
      // Chromium suite: Playwright WebKit is the closest automated proxy for
      // Safari, but it is not Safari and does not support every Safari-specific
      // service-worker or storage behavior.
      name: "webkit-storage-blocked-recovery",
      grep: /offline recovery works when privacy settings block session storage/,
      use: {
        browserName: "webkit",
      },
    },
    {
      name: "webkit-private-storage-warning",
      grep: privateStorageWarningChecks,
      use: {
        browserName: "webkit",
      },
    },
  ],
  webServer: {
    command: `PORT=${port} BASE_PATH=/ pnpm run build && PORT=${port} node scripts/serve-pwa-check.mjs`,
    port,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});