import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const fixtureUrl = new URL("./fixtures/favicon-visual.html", import.meta.url);

test("favicon remains legible at browser tab and bookmark sizes", async ({ page }) => {
  await page.setViewportSize({ width: 392, height: 192 });
  await page.goto("/");
  await page.setContent(await readFile(fixtureUrl, "utf8"));

  const fixture = page.getByRole("main", {
    name: "Favicon visual regression fixture",
  });
  await expect(fixture.locator("img")).toHaveCount(4);
  if (process.env.FAVICON_VISUAL_FORCE_MISMATCH === "1") {
    await fixture.evaluate((element) => {
      element.style.background = "rgb(255, 0, 255)";
    });
  }
  await expect
    .poll(() =>
      fixture.locator("img").evaluateAll((images) =>
        images.every(
          (image) =>
            image instanceof HTMLImageElement
            && image.complete
            && image.naturalWidth > 0,
        ),
      ),
    )
    .toBe(true);

  await expect(fixture).toHaveScreenshot("favicon-browser-sizes.png", {
    animations: "disabled",
    scale: "css",
  });
});