import { access } from "node:fs/promises";
import { webkit } from "@playwright/test";

const setupMessage =
  "WebKit release-check setup is incomplete. Run `pnpm exec playwright install --with-deps webkit` on a Playwright-supported Linux host, then retry.";

async function verifyWebKitRuntime() {
  const executablePath = webkit.executablePath();

  try {
    await access(executablePath);
  } catch {
    throw new Error(`${setupMessage}\nExpected browser executable: ${executablePath}`);
  }

  let browser;
  try {
    browser = await webkit.launch({ headless: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${setupMessage}\nWebKit failed to launch:\n${detail}`);
  } finally {
    await browser?.close();
  }
}

verifyWebKitRuntime().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});