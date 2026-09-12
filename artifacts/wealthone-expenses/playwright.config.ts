import { defineConfig, devices } from "@playwright/test";

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
      name: "mobile-touch-chromium",
      grep: /@touch/,
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        launchOptions: {
          executablePath:
            process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
            ?? "/repl/tools/bin/chromium",
        },
      },
    },
    {
      name: "cross-browser-firefox",
      grep: /@cross-browser/,
      use: {
        ...devices["Desktop Firefox"],
      },
    },
    {
      // Playwright WebKit is the closest automated Linux proxy for Safari.
      // Keep its snapshots separate from real Safari and Chromium baselines.
      name: "cross-browser-webkit",
      grep: /@cross-browser/,
      use: {
        ...devices["Desktop Safari"],
      },
    },
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
  },
  webServer: {
    command: `PORT=${port} BASE_PATH=/ pnpm run dev`,
    port,
    reuseExistingServer: true,
  },
});