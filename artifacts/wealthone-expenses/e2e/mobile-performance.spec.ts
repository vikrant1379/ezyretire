import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const thresholds = {
  domContentLoadedMs: 4_000,
  contentVisibleMs: 5_000,
  initialJsCssRequests: 12,
  // The deterministic local preview does not apply HTTP compression. The
  // build report separately enforces gzip/Brotli budgets.
  initialJsCssEncodedBytes: 700 * 1024,
};

test("mobile cold navigation stays within measured performance proxies", async ({ page }, testInfo) => {
  await page.goto("/", { waitUntil: "load" });
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  const contentVisibleMs = await page.evaluate(() => Math.round(performance.now()));

  const browserMetrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    const initialAssets = (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
      .filter((entry) => /\.(?:js|css)(?:$|\?)/.test(new URL(entry.name).pathname));
    return {
      domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
      loadMs: Math.round(navigation.loadEventEnd),
      firstContentfulPaintMs: paint ? Math.round(paint.startTime) : null,
      initialJsCssRequests: initialAssets.length,
      initialJsCssEncodedBytes: initialAssets.reduce(
        (total, entry) => total + entry.encodedBodySize,
        0,
      ),
      assets: initialAssets.map((entry) => ({
        path: new URL(entry.name).pathname,
        encodedBodySize: entry.encodedBodySize,
      })),
    };
  });
  const metrics = { ...browserMetrics, contentVisibleMs };

  const evidence = `${JSON.stringify({
      schemaVersion: 1,
      proxy: "Playwright Chromium mobile viewport, production build, localhost cold context",
      measuredAt: new Date().toISOString(),
      thresholds,
      metrics,
    }, null, 2)}\n`;
  const evidencePath = testInfo.outputPath("mobile-performance-evidence.json");
  await writeFile(evidencePath, evidence);
  await testInfo.attach("mobile-performance-evidence.json", {
    path: evidencePath,
    contentType: "application/json",
  });

  expect(metrics.domContentLoadedMs).toBeLessThanOrEqual(thresholds.domContentLoadedMs);
  expect(metrics.contentVisibleMs).toBeLessThanOrEqual(thresholds.contentVisibleMs);
  expect(metrics.initialJsCssRequests).toBeLessThanOrEqual(thresholds.initialJsCssRequests);
  expect(metrics.initialJsCssEncodedBytes).toBeLessThanOrEqual(
    thresholds.initialJsCssEncodedBytes,
  );
});