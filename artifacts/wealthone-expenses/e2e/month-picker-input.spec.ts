import { expect, test } from "@playwright/test";

test.describe("shared month picker input", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/__date-picker-test");
  });

  test("selects and clears local calendar months", async ({ page }) => {
    const input = page.getByLabel("Budget month");
    await expect(input).toHaveValue("March 2026");
    await input.click();
    await page.getByRole("gridcell", { name: "Nov", exact: true }).click();
    await expect(input).toHaveValue("November 2026");
    await expect(page.getByTestId("budget-month-value")).toHaveText("2026-11-01");

    await input.locator("xpath=..").getByRole("button", { name: "Clear month" }).click();
    await expect(input).toHaveValue("");
    await expect(page.getByTestId("budget-month-value")).toHaveText("empty");
  });

  test("supports keyboard navigation and valid boundary years", async ({ page }) => {
    const input = page.getByLabel("Budget month");
    await input.focus();
    await input.press("Enter");
    const march = page.getByRole("gridcell", { name: "Mar", exact: true });
    await march.focus();
    await march.press("ArrowRight");
    await expect(page.getByRole("gridcell", { name: "Apr", exact: true })).toBeFocused();
    await page.keyboard.press("PageDown");
    await expect(page.getByText("2027", { exact: true })).toBeVisible();
    await page.getByRole("gridcell", { name: "Oct", exact: true }).click();
    await expect(input).toHaveValue("October 2027");

    await input.locator("xpath=..").getByRole("button", { name: "Open month calendar" }).click();
    const maximumYear = page.getByRole("grid", { name: "2027" });
    await expect(maximumYear).toBeVisible();
    await expect(maximumYear.getByRole("gridcell", { name: "Nov", exact: true })).toBeDisabled();
    await expect(maximumYear.getByRole("gridcell", { name: "Dec", exact: true })).toBeDisabled();
  });
});