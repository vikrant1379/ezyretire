import { expect, test, type Page, type Route } from "@playwright/test";

const user = {
  id: "mobile-keyboard-user",
  email: "mobile-keyboard@example.com",
  profileImageUrl: null,
  fullName: "Mobile Keyboard",
  dateOfBirth: "1990-01-15",
  gender: "Prefer not to say",
  phone: "+919999999999",
  onboardingCompleted: true,
  isAdmin: false,
};

const financialData = {
  expenses: [],
  budgets: [],
  incomeSources: [],
  investments: [],
  loans: [],
  retirementInputs: {
    dateOfBirth: user.dateOfBirth,
    targetRetirementAge: 60,
    lifeExpectancy: 85,
    generalInflation: 6,
    salaryGrowth: 8,
    monthlyContributionOverride: 0,
    investSurplus: false,
  },
  profileInputs: {
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    gender: user.gender,
    dateOfBirth: user.dateOfBirth,
    targetRetirementAge: 60,
    lifeExpectancy: 85,
    riskPreference: "Balanced",
    onboardingCompleted: true,
  },
  uiPreferences: {},
};

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installFixture(page: Page, initialHeight: number) {
  await page.addInitScript((height) => {
    let mockInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      get: () => mockInnerHeight,
    });

    class MockVisualViewport extends EventTarget {
      height: number;
      offsetTop = 0;
      width = window.innerWidth;
      offsetLeft = 0;
      pageLeft = 0;
      pageTop = 0;
      scale = 1;
      onresize = null;
      onscroll = null;

      constructor(initialHeight: number) {
        super();
        this.height = initialHeight;
      }
    }

    const viewport = new MockVisualViewport(height);
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: viewport,
    });
    Object.defineProperty(window, "__setMockVisualViewport", {
      configurable: true,
      value: (nextHeight: number, offsetTop = 0, nextInnerHeight?: number) => {
        viewport.height = nextHeight;
        viewport.offsetTop = offsetTop;
        if (nextInnerHeight !== undefined) {
          mockInnerHeight = nextInnerHeight;
        }
        viewport.dispatchEvent(new Event("resize"));
      },
    });
  }, initialHeight);

  await page.route("**/api/auth/user", (route) => fulfillJson(route, { user }));
  await page.route("**/api/financial-data", (route) => fulfillJson(route, financialData));
  await page.route("**/api/entitlements", (route) =>
    fulfillJson(route, {
      plan: "free",
      premium: false,
      capabilities: {
        receiptOcr: false,
        bankStatementImport: false,
        documentVault: false,
        nomineeTracker: false,
        verifiedMobile: true,
      },
      mobileVerification: { hasMobile: true, verified: true },
    }),
  );
}

async function setVisualViewport(
  page: Page,
  height: number,
  offsetTop = 0,
  innerHeight?: number,
) {
  await page.evaluate(
    ({ nextHeight, nextOffsetTop, nextInnerHeight }) => {
      (
        window as unknown as {
          __setMockVisualViewport: (
            height: number,
            offsetTop?: number,
            innerHeight?: number,
          ) => void;
        }
      ).__setMockVisualViewport(nextHeight, nextOffsetTop, nextInnerHeight);
    },
    { nextHeight: height, nextOffsetTop: offsetTop, nextInnerHeight: innerHeight },
  );
}

const mobileCases = [
  {
    name: "iOS-sized viewport",
    layout: { width: 390, height: 844 },
    keyboard: { height: 430, offsetTop: 8 },
    resizeLayoutViewport: false,
    safeArea: { top: 12, right: 0, bottom: 20, left: 18 },
  },
  {
    name: "Android-sized viewport",
    layout: { width: 360, height: 800 },
    keyboard: { height: 408, offsetTop: 0 },
    resizeLayoutViewport: true,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  },
] as const;

for (const mobileCase of mobileCases) {
  test(`@touch ${mobileCase.name} keeps late dialog controls above the keyboard and restores`, async ({ page }) => {
    await page.setViewportSize(mobileCase.layout);
    await installFixture(page, mobileCase.layout.height);
    await page.goto("/transactions");
    await page.evaluate((safeArea) => {
      const root = document.documentElement;
      root.style.setProperty("--safe-area-inset-top", `${safeArea.top}px`);
      root.style.setProperty("--safe-area-inset-right", `${safeArea.right}px`);
      root.style.setProperty("--safe-area-inset-bottom", `${safeArea.bottom}px`);
      root.style.setProperty("--safe-area-inset-left", `${safeArea.left}px`);
    }, mobileCase.safeArea);

    await page.getByRole("button", { name: "Add Expense" }).click();
    const dialog = page.getByRole("dialog", { name: "Add Expense" });
    await expect(dialog).toBeVisible();

    const note = page.getByLabel("Note");
    await note.focus();
    const form = dialog.locator("form");
    await form.evaluate((element) => {
      element.scrollTop = 0;
    });
    await setVisualViewport(
      page,
      mobileCase.keyboard.height,
      mobileCase.keyboard.offsetTop,
      mobileCase.resizeLayoutViewport ? mobileCase.keyboard.height : mobileCase.layout.height,
    );

    await expect.poll(() =>
      page.evaluate(() => ({
        height: getComputedStyle(document.documentElement).getPropertyValue("--app-visual-height").trim(),
        offsetTop: getComputedStyle(document.documentElement).getPropertyValue("--app-visual-offset-top").trim(),
        width: getComputedStyle(document.documentElement).getPropertyValue("--app-visual-width").trim(),
        keyboardOpen: document.documentElement.hasAttribute("data-app-keyboard-open"),
      })),
    ).toEqual({
      height: `${mobileCase.keyboard.height}px`,
      offsetTop: `${mobileCase.keyboard.offsetTop}px`,
      width: `${mobileCase.layout.width}px`,
      keyboardOpen: true,
    });

    const visualBottom = mobileCase.keyboard.offsetTop + mobileCase.keyboard.height;
    const visualTop = mobileCase.keyboard.offsetTop + mobileCase.safeArea.top;
    const visualRight = mobileCase.layout.width - mobileCase.safeArea.right;
    const visualLeft = mobileCase.safeArea.left;
    await expect.poll(() => form.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect.poll(async () => {
      const bounds = await note.boundingBox();
      return bounds ? Math.ceil(bounds.y + bounds.height) : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(visualBottom - mobileCase.safeArea.bottom);

    const dialogBounds = await dialog.boundingBox();
    expect(dialogBounds).not.toBeNull();
    expect(Math.floor(dialogBounds!.y)).toBeGreaterThanOrEqual(visualTop);
    expect(Math.ceil(dialogBounds!.y + dialogBounds!.height))
      .toBeLessThanOrEqual(visualBottom - mobileCase.safeArea.bottom);

    const category = dialog.getByRole("combobox", { name: "Category" });
    await category.click();
    await expect(page.getByRole("listbox")).toBeVisible();
    const selectSurface = page.locator("[data-radix-popper-content-wrapper]").last();
    await expect.poll(async () => {
      const bounds = await selectSurface.boundingBox();
      return bounds
        ? bounds.y >= visualTop
          && bounds.y + bounds.height <= visualBottom - mobileCase.safeArea.bottom
          && bounds.x >= visualLeft
          && bounds.x + bounds.width <= visualRight
        : false;
    }).toBe(true);
    await page.keyboard.press("Escape");

    const openCalendar = dialog.getByRole("button", { name: "Open calendar" });
    await openCalendar.click();
    const calendar = page.getByRole("grid").last();
    await expect(calendar).toBeVisible();
    const calendarSurface = page.locator("[data-radix-popper-content-wrapper]").last();
    await expect.poll(async () => {
      const bounds = await calendarSurface.boundingBox();
      return bounds
        ? bounds.y >= visualTop
          && bounds.y + bounds.height <= visualBottom - mobileCase.safeArea.bottom
          && bounds.x >= visualLeft
          && bounds.x + bounds.width <= visualRight
        : false;
    }).toBe(true);
    await page.keyboard.press("Escape");

    await note.focus();
    await form.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const save = page.getByRole("button", { name: "Save Expense" });
    const saveBounds = await save.boundingBox();
    expect(saveBounds).not.toBeNull();
    expect(Math.ceil(saveBounds!.y + saveBounds!.height))
      .toBeLessThanOrEqual(visualBottom - mobileCase.safeArea.bottom);

    await setVisualViewport(
      page,
      mobileCase.layout.height,
      0,
      mobileCase.layout.height,
    );
    await note.blur();

    await expect.poll(() =>
      page.evaluate(() => ({
        height: getComputedStyle(document.documentElement).getPropertyValue("--app-visual-height").trim(),
        offsetTop: getComputedStyle(document.documentElement).getPropertyValue("--app-visual-offset-top").trim(),
        keyboardOpen: document.documentElement.hasAttribute("data-app-keyboard-open"),
        pageScrollTop: document.querySelector<HTMLElement>('[data-testid="page-scroll-container"]')?.scrollTop ?? -1,
      })),
    ).toEqual({
      height: `${mobileCase.layout.height}px`,
      offsetTop: "0px",
      keyboardOpen: false,
      pageScrollTop: 0,
    });

    const restoredDialogBounds = await dialog.boundingBox();
    expect(restoredDialogBounds).not.toBeNull();
    expect(restoredDialogBounds!.height).toBeGreaterThan(dialogBounds!.height);
    expect(Math.ceil(restoredDialogBounds!.y + restoredDialogBounds!.height))
      .toBeLessThanOrEqual(mobileCase.layout.height);
  });
}