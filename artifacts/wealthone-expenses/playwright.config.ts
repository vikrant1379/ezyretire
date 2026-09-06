import { defineConfig } from "@playwright/test";

const port = 4173;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  outputDir:
    process.env.FAVICON_VISUAL_OUTPUT_DIR
    ?? "../../test-results/playwright",
  preserveOutput: "failures-only",
  projects: [
    {
      name: "desktop-chromium",
      grepInvert: /@touch/,
    },
    {
      name: "mobile-touch-chromium",
      grep: /@touch/,
      use: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ?? "/repl/tools/bin/chromium",
    },
  },
  webServer: {
    command: `PORT=${port} BASE_PATH=/ pnpm run dev`,
    port,
    reuseExistingServer: true,
  },
});