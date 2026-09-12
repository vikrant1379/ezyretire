import { defineConfig, devices } from "@playwright/test";

const port = 4175;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "mobile-performance.spec.ts",
  workers: 1,
  retries: 0,
  reporter: "line",
  outputDir: "../../test-results/mobile-performance",
  preserveOutput: "always",
  use: {
    ...devices["Pixel 7"],
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    serviceWorkers: "block",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ?? "/repl/tools/bin/chromium",
    },
  },
  webServer: {
    command: `PORT=${port} BASE_PATH=/ pnpm run build && PORT=${port} node scripts/serve-pwa-check.mjs`,
    port,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});