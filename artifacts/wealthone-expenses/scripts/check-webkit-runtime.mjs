import { access } from "node:fs/promises";
import { webkit } from "@playwright/test";

const setupMessage =
  "WebKit host setup failed before any app regression check ran. Run `pnpm exec playwright install --with-deps webkit` on the supported Ubuntu validation host, then retry.";

async function verifyWebKitRuntime() {
  const executablePath = webkit.executablePath();

  try {
    await access(executablePath);
  } catch {
    throw new Error(
      `${setupMessage}\nReason: the Playwright-pinned WebKit executable is missing.\nExpected browser executable: ${executablePath}`,
    );
  }

  let browser;
  try {
    browser = await webkit.launch({ headless: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${setupMessage}\nReason: WebKit could not launch; this is a browser/runtime dependency failure, not an application test failure.\nLaunch details:\n${detail}`,
    );
  } finally {
    await browser?.close();
  }
}

verifyWebKitRuntime().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});