import { expect, test, type Page, type Route } from "@playwright/test";

const SLOW_MOBILE_FONT_DELAY_MS = 1_500;
const FONT_SWAP_TIMEOUT_MS = 6_000;
const MAX_FONT_SWAP_SHIFT_PX = 24;
const SLOW_MOBILE_DOWNLOAD_BYTES_PER_SECOND = 50 * 1024;
const SLOW_MOBILE_LATENCY_MS = 150;
const LOCAL_FONT_ROUTE = "**/fonts/ezyretire-v3/*.woff2";

async function areBrandedFontsLoaded(page: Page) {
  return page.evaluate(() => document.fonts.check('400 15px "Inter"'));
}

async function installSlowLocalFontGate(page: Page) {
  const browserName = page.context().browser()?.browserType().name();
  const cdp = browserName === "chromium"
    ? await page.context().newCDPSession(page)
    : null;
  if (cdp) {
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  }

  let releaseFonts = () => {};
  const fontGate = new Promise<void>((resolve) => {
    releaseFonts = resolve;
  });
  let delayedFontRequests = 0;
  await page.route(LOCAL_FONT_ROUTE, async (route) => {
    delayedFontRequests += 1;
    await fontGate;
    await route.continue();
  });

  return {
    cdp,
    async expectRequest() {
      await expect.poll(() => delayedFontRequests).toBeGreaterThan(0);
    },
    async expectPending(message: string) {
      expect(await areBrandedFontsLoaded(page), message).toBe(false);
    },
    async releaseAndExpectReady(message: string) {
      // Hold requests long enough to prove fallback rendering, then constrain
      // only the font transfers to the production slow-network budget.
      await page.waitForTimeout(SLOW_MOBILE_FONT_DELAY_MS);
      if (cdp) {
        await cdp.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: SLOW_MOBILE_LATENCY_MS,
          downloadThroughput: SLOW_MOBILE_DOWNLOAD_BYTES_PER_SECOND,
          uploadThroughput: 20 * 1024,
          connectionType: "cellular3g",
        });
      }
      const swapStartedAt = Date.now();
      releaseFonts();
      await expect.poll(() => areBrandedFontsLoaded(page), {
        message,
        timeout: FONT_SWAP_TIMEOUT_MS,
      }).toBe(true);
      expect(
        Date.now() - swapStartedAt,
        `${message}; elapsed time exceeded the slow-font deadline`,
      ).toBeLessThan(FONT_SWAP_TIMEOUT_MS);
    },
  };
}

const testUser = {
  id: "design-system-visual-user",
  email: "visual@example.com",
  profileImageUrl: null,
  fullName: "Visual Regression",
  dateOfBirth: "1990-01-15",
  gender: "Prefer not to say",
  phone: "+919999999999",
  onboardingCompleted: true,
  isAdmin: false,
};

const financialData = {
  expenses: [{
    id: "visual-expense",
    date: "2026-09-05",
    amount: 2450,
    category: "Food & Dining",
    merchant: "Neighbourhood Market",
    paymentMethod: "UPI",
    reimbursable: false,
    recurring: false,
    createdAt: "2026-09-05T09:00:00.000Z",
  }],
  budgets: [{ category: "Food & Dining", monthlyLimit: 12000 }],
  incomeSources: [],
  investments: [],
  loans: [],
  retirementInputs: {
    dateOfBirth: "1990-01-15",
    targetRetirementAge: 60,
    lifeExpectancy: 85,
    generalInflation: 6,
    salaryGrowth: 8,
    monthlyContributionOverride: 0,
    investSurplus: false,
  },
  profileInputs: {
    fullName: testUser.fullName,
    email: testUser.email,
    phone: testUser.phone,
    gender: testUser.gender,
    dateOfBirth: testUser.dateOfBirth,
    targetRetirementAge: 60,
    lifeExpectancy: 85,
    riskPreference: "Balanced",
    onboardingCompleted: true,
  },
  uiPreferences: {},
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockSignedOut(page: Page) {
  await page.route("**/api/auth/user", (route) => fulfillJson(route, { user: null }));
}

async function mockSignedIn(page: Page, user = testUser) {
  await page.route("**/api/auth/user", (route) => fulfillJson(route, { user }));
  await page.route("**/api/auth/passkeys", (route) => fulfillJson(route, { credentials: [] }));
  await page.route("**/api/account/deletion", (route) => fulfillJson(route, { status: "none" }));
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
        verifiedMobile: false,
      },
      mobileVerification: { hasMobile: true, verified: false },
    }),
  );
  await page.route("**/api/whatsapp/support", (route) =>
    fulfillJson(route, { available: false, whatsappUrl: null }),
  );
}

async function injectSafeArea(page: Page, insets: { top: number; right: number; bottom: number; left: number }) {
  await page.evaluate((safeArea) => {
    const root = document.documentElement;
    root.style.setProperty("--app-safe-top", `${safeArea.top}px`);
    root.style.setProperty("--app-safe-right", `${safeArea.right}px`);
    root.style.setProperty("--app-safe-bottom", `${safeArea.bottom}px`);
    root.style.setProperty("--app-safe-left", `${safeArea.left}px`);
  }, insets);
}

async function expectDesignSystemTypography(page: Page) {
  const interGlyphSample = "₹ $ € £ ¥ 1,234.56 — “Résumé” Español";
  const headingGlyphSample = "Plan — “Résumé” Español";
  await page.evaluate(async ({ interSample, headingSample }) => {
    await Promise.all([
      document.fonts.load('400 15px "Inter"', interSample),
      document.fonts.load('500 15px "Inter"', interSample),
      document.fonts.load('600 15px "Inter"', interSample),
      document.fonts.load('700 15px "Inter"', interSample),
      document.fonts.load('700 28px "Inter"', headingSample),
    ]);
    await document.fonts.ready;
  }, { interSample: interGlyphSample, headingSample: headingGlyphSample });

  const typography = await page.evaluate(({ interSample, headingSample }) => {
    const visibleTextElements = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => {
        const checkVisibility = (
          element as HTMLElement & {
            checkVisibility?: (options?: { checkOpacity?: boolean; checkVisibilityCSS?: boolean }) => boolean;
          }
        ).checkVisibility;
        if (checkVisibility) {
          try {
            if (!checkVisibility.call(element, { checkOpacity: true, checkVisibilityCSS: true })) {
              return false;
            }
          } catch {
            if (!checkVisibility.call(element)) return false;
          }
        }
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          return false;
        }
        const style = getComputedStyle(element);
        if (Number(style.opacity) === 0) {
          return false;
        }
        return [...element.childNodes].some(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        );
      });
    const undersized = visibleTextElements
      .map((element) => ({
        text: element.innerText.trim().replace(/\s+/g, " ").slice(0, 80),
        size: Number.parseFloat(getComputedStyle(element).fontSize),
      }))
      .filter(({ size }) => size < 11);

    return {
      interLoaded: document.fonts.check('15px "Inter"'),
      headingLoaded: document.fonts.check('700 28px "Inter"'),
      interWeightsLoaded: [400, 500, 600, 700].every((weight) =>
        document.fonts.check(`${weight} 15px "Inter"`, interSample)
      ),
      headingGlyphsLoaded: document.fonts.check('700 28px "Inter"', headingSample),
      localFontUrls: [...document.styleSheets].flatMap((sheet) => {
        try {
          return [...sheet.cssRules].flatMap((rule) => {
            if (!(rule instanceof CSSFontFaceRule)) return [];
            const family = rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
            if (family !== "Inter") return [];
            const source = rule.style.getPropertyValue("src").match(/url\(["']?([^)"']+)/)?.[1];
            return source ? [new URL(source, sheet.href).href] : [];
          });
        } catch {
          return [];
        }
      }).filter((url) => url.includes("/fonts/ezyretire-") && url.endsWith(".woff2")),
      bodyFamily: getComputedStyle(document.body).fontFamily,
      headingFamily: getComputedStyle(document.querySelector("h1")!).fontFamily,
      undersized,
    };
  }, { interSample: interGlyphSample, headingSample: headingGlyphSample });

  expect(typography.interLoaded, "Inter failed to load; body text would use a fallback font").toBe(true);
  expect(
    typography.headingLoaded,
    "Inter 700 failed to load; display headings would use a fallback font",
  ).toBe(true);
  expect(
    typography.interWeightsLoaded,
    "Inter weights or required financial and supported-language glyphs failed to load",
  ).toBe(true);
  expect(
    typography.headingGlyphsLoaded,
    "Inter 700 required financial and supported-language glyphs failed to load",
  ).toBe(true);
  expect(typography.localFontUrls).toHaveLength(4);
  expect(
    typography.localFontUrls.every(
      (url) => url.includes("/fonts/ezyretire-v3/") && url.endsWith(".woff2"),
    ),
    `typography must load only versioned WOFF2 faces: ${JSON.stringify(typography.localFontUrls)}`,
  ).toBe(true);
  expect(typography.bodyFamily, "body must use the EzyRetire sans token").toContain("Inter");
  expect(typography.headingFamily, "page heading must use the EzyRetire heading token").toContain(
    "Inter",
  );
  expect(
    typography.undersized,
    `visible text dropped below the EzyRetire 11px minimum: ${JSON.stringify(typography.undersized)}`,
  ).toEqual([]);
}

async function expectStableScreenshot(page: Page, name: string) {
  await expectDesignSystemTypography(page);
  const projectName = test.info().project.name;
  const viewport = page.viewportSize();
  const visualState = `${projectName} ${viewport?.width ?? "auto"}x${viewport?.height ?? "auto"} ${name}`;
  await expect(page, visualState).toHaveScreenshot(name, {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    maxDiffPixelRatio: projectName.startsWith("cross-browser-") ? 0.01 : undefined,
    scale: "css",
  });
}

async function installPaletteTheme(page: Page, theme: "light" | "dark") {
  await page.clock.setFixedTime(new Date("2026-09-10T10:00:00.000Z"));
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.addInitScript((selectedTheme) => {
    localStorage.setItem("ezyretire-theme", JSON.stringify(selectedTheme));
  }, theme);
}

test.describe("EzyRetire design-system visual contract", () => {
  test.beforeEach(async ({ page }) => {
    // Restricted networks commonly block both Google Fonts endpoints. Keep this
    // gate under the same condition so screenshots prove local faces are enough.
    await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.abort());
  });

  for (const viewport of [
    { name: "mobile", width: 390, height: 844 },
    { name: "desktop", width: 1440, height: 1000 },
  ] as const) {
    const crossBrowserTag = viewport.name === "desktop" ? " @cross-browser" : "";
    test(`signed-out ${viewport.name} authentication${crossBrowserTag}`, async ({ page }) => {
      await mockSignedOut(page);
      await page.setViewportSize(viewport);
      await page.goto("/");

      await expect(
        page.getByRole("heading", { name: "Welcome back" }),
      ).toBeVisible();
      await expect(page.getByLabel("Email address")).toBeVisible();
      await expect(page.getByRole("button", { name: "Email me a code" })).toBeVisible();
      await expect(
        page.getByText(
          "We’ll email you a 6-digit code. New here? Your account will be created after verification.",
        ),
      ).toBeVisible();
      await expect(page.locator('img[alt="ezyRetire"]:visible')).toHaveCount(1);
      await expectStableScreenshot(page, `design-system-signed-out-${viewport.name}.png`);
    });
  }

  test("signed-out authentication keeps later states focused and accessible", async ({ page }) => {
    await mockSignedOut(page);
    await page.route("**/api/auth/otp/request", (route) =>
      fulfillJson(route, { challengeId: "visual-challenge", resendAfterSeconds: 60 }),
    );
    await page.route("**/api/auth/otp/verify", (route) =>
      fulfillJson(route, { needsProfile: true }),
    );
    await page.goto("/");

    await page.getByLabel("Email address").fill("new.account@example.com");
    await page.getByRole("button", { name: "Email me a code" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(page.getByLabel("6-digit sign-in code")).toBeFocused();
    await expect(page.getByRole("button", { name: "Use a different email" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Resend in 60s/ })).toBeDisabled();
    await expect(page.locator('img[alt="ezyRetire"]:visible')).toHaveCount(1);
    await expectStableScreenshot(page, "design-system-signed-out-code-desktop.png");

    await page.getByLabel("6-digit sign-in code").fill("123456");
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page.getByRole("heading", { name: "Complete your profile" })).toBeVisible();
    await expect(page.getByLabel("Full name")).toBeVisible();
    await expect(page.getByLabel("Date of birth")).toBeVisible();
    await expect(page.getByLabel("Gender")).toBeVisible();
    await expect(page.locator('img[alt="ezyRetire"]:visible')).toHaveCount(1);
    await expectStableScreenshot(page, "design-system-signed-out-profile-completion-desktop.png");
  });

  test("remembered-account PIN sign-in keeps one focused authentication surface", async ({ page }) => {
    await mockSignedOut(page);
    await page.addInitScript(() => {
      localStorage.setItem("ezyretire:remembered-account:v1", JSON.stringify({
        email: "visual@example.com",
        fullName: "Visual Regression",
      }));
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Hi, Visual Regression" })).toBeVisible();
    await expect(page.getByLabel("0 of 4 PIN digits entered")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    await expectStableScreenshot(page, "design-system-signed-out-remembered-pin-mobile.png");
  });

  for (const accountPage of [
    { name: "profile", path: "/profile", heading: "Your Profile" },
    { name: "settings", path: "/settings", heading: "Settings" },
  ] as const) {
    for (const viewport of [
      { name: "mobile", width: 390, height: 844 },
      { name: "desktop", width: 1440, height: 1000 },
    ] as const) {
      test(`${accountPage.name} account information architecture on ${viewport.name}`, async ({ page }) => {
        await mockSignedIn(page);
        await page.setViewportSize(viewport);
        await page.goto(accountPage.path);

        if (viewport.name === "mobile") {
          await expect(page.getByTestId("mobile-page-title")).toHaveText(
            accountPage.name === "profile" ? "Profile" : "Settings",
          );
        } else {
          if (accountPage.name === "profile") {
            await expect(page.getByTestId("text-profile-display-name")).toBeVisible();
          } else {
            await expect(page.getByTestId("heading-settings")).toBeAttached();
          }
        }
        if (accountPage.name === "profile") {
          await expect(page.getByRole("link", { name: /Personal details/i })).toHaveAttribute(
            "href",
            "/profile?section=personal",
          );
          await expect(page.getByTestId("text-profile-display-name")).toBeVisible();
        } else {
          await expect(page.getByTestId("heading-settings")).toBeAttached();
          await expect(page.getByRole("link", { name: "Appearance", exact: true })).toHaveAttribute(
            "href",
            "/settings?section=appearance",
          );
        }
        await expectStableScreenshot(page, `design-system-account-${accountPage.name}-${viewport.name}.png`);
      });
    }
  }

  for (const theme of ["light", "dark"] as const) {
    for (const viewport of [
      { name: "narrow-320", width: 320, height: 844, tag: " @touch" },
      { name: "desktop", width: 1440, height: 1000, tag: "" },
    ] as const) {
      test(`account identity remains legible with enlarged text in ${theme} ${viewport.name}${viewport.tag}`, async ({ page }) => {
        const longIdentityUser = {
          ...testUser,
          fullName: "Dr. Ananya Krishnamurthy — Senior Vice President of International Strategy",
        };
        await installPaletteTheme(page, theme);
        await mockSignedIn(page, longIdentityUser);
        await page.route("**/api/financial-data", (route) =>
          fulfillJson(route, {
            ...financialData,
            profileInputs: {
              ...financialData.profileInputs,
              fullName: longIdentityUser.fullName,
            },
          }),
        );
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto("/profile");
        await injectSafeArea(page, {
          top: viewport.width < 400 ? 59 : 0,
          right: viewport.width < 400 ? 7 : 0,
          bottom: viewport.width < 400 ? 34 : 0,
          left: viewport.width < 400 ? 7 : 0,
        });
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "125%";
        });

        if (viewport.width < 768) {
          await expect(page.getByTestId("mobile-page-title")).toHaveText("Profile");
          const legacyHeading = page.getByTestId("heading-your-profile");
          if (await legacyHeading.count()) {
            await expect(legacyHeading).toBeAttached();
          } else {
            await expect(page.getByTestId("text-profile-display-name")).toBeVisible();
          }
        } else {
          await expect(page.getByTestId("heading-your-profile")).toBeAttached();
        }
        await expect(page.getByTestId("text-profile-display-name")).toContainText("Dr. Ananya");
        await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*dark)/);
        await expect(page.getByTestId("profile-summary")).toBeVisible();
        await expect(page.getByRole("link", { name: /Personal details/i })).toBeVisible();

        const overflow = await page.evaluate(() => ({
          document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          body: document.body.scrollWidth - document.body.clientWidth,
          content: (() => {
            const element = document.querySelector<HTMLElement>('[data-testid="page-content"]');
            return element ? element.scrollWidth - element.clientWidth : null;
          })(),
        }));
        expect(overflow.document, "enlarged identity must not create document overflow").toBeLessThanOrEqual(1);
        expect(overflow.body, "enlarged identity must not create body overflow").toBeLessThanOrEqual(1);
        expect(overflow.content, "enlarged identity must fit the account page").toBeLessThanOrEqual(1);

        await expectStableScreenshot(
          page,
          `design-system-account-identity-${theme}-${viewport.name}.png`,
        );
        const signOut = page.getByTestId("button-sign-out");
        await signOut.scrollIntoViewIfNeeded();
        const contrast = await signOut.evaluate((button) => {
          const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
          const luminance = (color: number[]) => color.map((value) => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
          const background = luminance(rgb(getComputedStyle(button.parentElement!).backgroundColor));
          const ratio = (element: Element) => {
            const foreground = luminance(rgb(getComputedStyle(element).color));
            return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
          };
          return { text: ratio(button.querySelector("span")!), icon: ratio(button.querySelector("svg")!) };
        });
        expect(contrast.text, "Sign out must have readable danger text").toBeGreaterThanOrEqual(4.5);
        expect(contrast.icon, "Sign out icon must contrast with its card").toBeGreaterThanOrEqual(3);
        await expectStableScreenshot(page, `design-system-account-signout-${theme}-${viewport.name}.png`);
      });
    }
  }

  test("signed-out authentication remains focused in dark theme", async ({ page }) => {
    await mockSignedOut(page);
    await page.addInitScript(() => localStorage.setItem("ezyretire-theme", JSON.stringify("dark")));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");

    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByTestId("auth-content")).toBeVisible();
    await expectStableScreenshot(page, "design-system-signed-out-dark-desktop.png");
  });

  test("signed-out short iPhone keeps authentication clear of simulated safe areas @touch", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 659 });
    await mockSignedOut(page);
    await page.goto("/");
    await injectSafeArea(page, { top: 59, right: 7, bottom: 34, left: 7 });

    const logo = page.locator('img[alt="ezyRetire"]:visible');
    const heading = page.getByRole("heading", {
      name: "Welcome back",
    });
    const submit = page.getByRole("button", { name: "Email me a code" });
    await expect(logo).toBeVisible();
    await expect(heading).toBeVisible();
    await expect(submit).toBeVisible();

    expect((await logo.boundingBox())!.y).toBeGreaterThanOrEqual(59);
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
    const container = page.getByTestId("auth-scroll-container");
    expect(await container.evaluate((element) => element.scrollHeight >= element.clientHeight)).toBe(true);
  });

  test("signed-in mobile shell clears simulated Dynamic Island and home indicator @touch", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 740 });
    await mockSignedIn(page);
    await page.goto("/");
    await injectSafeArea(page, { top: 59, right: 12, bottom: 34, left: 12 });
    await expect(page.getByRole("heading", { name: "One more input and your projection goes live" })).toBeVisible();

    const header = page.getByTestId("mobile-header");
    const navigation = page.getByTestId("mobile-bottom-navigation");
    const content = page.getByTestId("page-content");
    await expect(header).toBeVisible();
    await expect(navigation).toBeVisible();

    const geometry = await Promise.all([header, navigation, content].map((locator) =>
      locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      }),
    ));
    expect(geometry[0].bottom - geometry[0].top).toBeGreaterThanOrEqual(56 + 59);
    expect(740 - geometry[1].bottom).toBeLessThanOrEqual(1);
    expect(geometry[1].bottom - geometry[1].top).toBeGreaterThanOrEqual(64 + 34);
    const titleBox = await page.getByTestId("mobile-page-title").boundingBox();
    const profileBox = await page.getByRole("link", { name: "Profile" }).boundingBox();
    expect(titleBox!.x).toBeGreaterThanOrEqual(12 + 16);
    expect(profileBox!.x + profileBox!.width).toBeLessThanOrEqual(430 - 12);

    await page.getByTestId("page-scroll-container").evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    const lastContentBottom = await content.evaluate((element) =>
      (element.lastElementChild as HTMLElement).getBoundingClientRect().bottom,
    );
    expect(lastContentBottom).toBeLessThanOrEqual((await navigation.boundingBox())!.y);
  });

  test("signed-in landscape shell preserves asymmetric notch insets @touch", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await mockSignedIn(page);
    await page.goto("/");
    await injectSafeArea(page, { top: 0, right: 59, bottom: 21, left: 47 });
    await expect(page.getByRole("heading", { name: "One more input and your projection goes live" })).toBeVisible();

    const contentPadding = await page.getByTestId("page-content").evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        left: Number.parseFloat(style.paddingLeft),
        right: Number.parseFloat(style.paddingRight),
      };
    });
    const titleBox = await page.getByTestId("mobile-page-title").boundingBox();
    const profileBox = await page.getByRole("link", { name: "Profile" }).boundingBox();
    expect(contentPadding.left).toBeGreaterThanOrEqual(47 + 32);
    expect(contentPadding.right).toBeGreaterThanOrEqual(59 + 32);
    expect(titleBox!.x).toBeGreaterThanOrEqual(47 + 16);
    expect(profileBox!.x + profileBox!.width).toBeLessThanOrEqual(844 - 59);
  });

  test("investment form stays within simulated iPhone safe areas @touch", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 659 });
    await mockSignedIn(page);
    await page.goto("/investments");
    await injectSafeArea(page, { top: 59, right: 7, bottom: 34, left: 7 });
    await page.getByRole("button", { name: "Add Investment" }).click();

    const dialog = page.getByRole("dialog", { name: "Add Investment" });
    await expect(dialog).toBeVisible();
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox!.y).toBeGreaterThanOrEqual(59);
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(659 - 34);
    const submit = dialog.getByRole("button", { name: "Add Investment" });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
  });

  test("add expense form stays reachable with short landscape safe areas @touch", async ({ page }) => {
    await page.setViewportSize({ width: 667, height: 375 });
    await mockSignedIn(page);
    await page.goto("/transactions");
    await injectSafeArea(page, { top: 0, right: 59, bottom: 21, left: 47 });
    await page.getByRole("button", { name: "Add Expense" }).click();

    const dialog = page.getByRole("dialog", { name: "Add Expense" });
    const close = dialog.getByRole("button", { name: "Close" });
    const save = dialog.getByRole("button", { name: "Save Expense" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Add Expense", { exact: true })).toHaveClass(/\bsr-only\b/);
    await expect(dialog.getByText("Quickly record a new transaction.")).toHaveCount(0);
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(47);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(667 - 59);
    expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(375 - 21);
    await expect(close).toBeInViewport();
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport();
    expect((await save.boundingBox())!.y + (await save.boundingBox())!.height).toBeLessThanOrEqual(375 - 21);
  });

  test("transaction delete actions clear the simulated home indicator @touch", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 659 });
    await mockSignedIn(page);
    await page.goto("/transactions");
    await injectSafeArea(page, { top: 59, right: 7, bottom: 34, left: 7 });
    await page.getByRole("button", { name: `More actions for ${financialData.expenses[0].merchant}` }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    const dialog = page.getByRole("alertdialog", { name: "Delete transaction?" });
    const keep = dialog.getByRole("button", { name: "Keep it" });
    const remove = dialog.getByRole("button", { name: "Delete" });
    await expect(dialog).toBeVisible();
    const [keepBox, removeBox] = await Promise.all([keep.boundingBox(), remove.boundingBox()]);
    expect(keepBox!.y + keepBox!.height).toBeLessThanOrEqual(659 - 34);
    expect(removeBox!.y + removeBox!.height).toBeLessThanOrEqual(659 - 34);
  });

  for (const landscape of [
    { name: "zero-inset short landscape", width: 568, height: 320, insets: { top: 0, right: 0, bottom: 0, left: 0 } },
    { name: "asymmetric-inset landscape", width: 667, height: 375, insets: { top: 0, right: 59, bottom: 21, left: 47 } },
  ] as const) {
    test(`transaction delete actions remain reachable in ${landscape.name} @touch`, async ({ page }) => {
      await page.setViewportSize({ width: landscape.width, height: landscape.height });
      await mockSignedIn(page);
      await page.goto("/transactions");
      await injectSafeArea(page, landscape.insets);
      await page.getByRole("button", { name: `More actions for ${financialData.expenses[0].merchant}` }).click();
      await page.getByRole("menuitem", { name: "Delete" }).click();

      const dialog = page.getByRole("alertdialog", { name: "Delete transaction?" });
      const keep = dialog.getByRole("button", { name: "Keep it" });
      const remove = dialog.getByRole("button", { name: "Delete" });
      await expect(dialog).toBeVisible();
      await remove.scrollIntoViewIfNeeded();
      await expect(keep).toBeInViewport();
      await expect(remove).toBeInViewport();

      const [dialogBox, keepBox, removeBox] = await Promise.all([
        dialog.boundingBox(),
        keep.boundingBox(),
        remove.boundingBox(),
      ]);
      const safeBottom = landscape.height - landscape.insets.bottom;
      expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(safeBottom);
      expect(keepBox!.y + keepBox!.height).toBeLessThanOrEqual(safeBottom);
      expect(removeBox!.y + removeBox!.height).toBeLessThanOrEqual(safeBottom);
      expect(keepBox!.height).toBeGreaterThanOrEqual(44);
      expect(removeBox!.height).toBeGreaterThanOrEqual(44);
    });
  }

  test("signed-out mobile keeps text usable while local fonts load slowly @touch", async ({ page }) => {
    const slowFonts = await installSlowLocalFontGate(page);

    await mockSignedOut(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const heading = page.getByRole("heading", {
      name: "Welcome back",
    });
    const signIn = page.getByRole("button", { name: "Email me a code" });
    await expect(heading).toBeVisible();
    await expect(signIn).toBeVisible();
    await slowFonts.expectRequest();

    const fallbackState = await page.evaluate(() => ({
      bodyText: document.body.innerText,
      interLoaded: document.fonts.check('400 15px "Inter"'),
    }));
    expect(fallbackState.bodyText).toContain("Welcome back");
    expect(fallbackState.bodyText).toContain("Email me a code");
    expect(
      fallbackState.interLoaded,
      "local faces should still be pending while readable fallback text is shown",
    ).toBe(false);

    const fallbackHeadingBox = await heading.boundingBox();
    const fallbackButtonBox = await signIn.boundingBox();
    expect(fallbackHeadingBox).not.toBeNull();
    expect(fallbackButtonBox).not.toBeNull();
    const fallbackHeadingCapture = await slowFonts.cdp!.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      clip: {
        x: fallbackHeadingBox!.x,
        y: fallbackHeadingBox!.y,
        width: fallbackHeadingBox!.width,
        height: fallbackHeadingBox!.height,
        scale: 1,
      },
    });
    expect(
      Buffer.from(fallbackHeadingCapture.data, "base64"),
      "fallback heading glyphs must be painted while local faces are pending",
    ).toMatchSnapshot("design-system-slow-font-fallback-heading.png");

    await slowFonts.releaseAndExpectReady(
      "branded faces did not replace signed-out fallbacks within the slow-mobile budget",
    );

    const brandedHeadingBox = await heading.boundingBox();
    const brandedButtonBox = await signIn.boundingBox();
    expect(brandedHeadingBox).not.toBeNull();
    expect(brandedButtonBox).not.toBeNull();
    expect(Math.abs(brandedHeadingBox!.x - fallbackHeadingBox!.x)).toBeLessThanOrEqual(
      MAX_FONT_SWAP_SHIFT_PX,
    );
    expect(Math.abs(brandedHeadingBox!.y - fallbackHeadingBox!.y)).toBeLessThanOrEqual(
      MAX_FONT_SWAP_SHIFT_PX,
    );
    expect(Math.abs(brandedButtonBox!.x - fallbackButtonBox!.x)).toBeLessThanOrEqual(
      MAX_FONT_SWAP_SHIFT_PX,
    );
    expect(Math.abs(brandedButtonBox!.y - fallbackButtonBox!.y)).toBeLessThanOrEqual(
      MAX_FONT_SWAP_SHIFT_PX,
    );
    await expect(heading).toBeVisible();
    await expect(signIn).toBeVisible();
  });

  test("signed-in desktop expense dialog stays usable while local fonts load slowly", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const slowFonts = await installSlowLocalFontGate(page);

    await mockSignedIn(page);
    await page.goto("/transactions", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Add Expense" }).click();

    const dialog = page.getByRole("dialog", { name: "Add Expense" });
    const amount = page.getByLabel("Amount (₹) *");
    const criticalElements = {
      dateLabel: dialog.getByText("Date *", { exact: true }),
      dateField: dialog.getByRole("button", { name: "Open calendar" }),
      amountLabel: dialog.getByText("Amount (₹) *", { exact: true }),
      amount,
      categoryLabel: dialog.getByText("Category *", { exact: true }),
      category: page.getByLabel("Category *"),
      merchantLabel: dialog.getByText("Merchant", { exact: true }),
      merchant: page.getByLabel("Merchant"),
      paymentLabel: dialog.getByText("Payment Method", { exact: true }),
      payment: page.getByLabel("Payment Method"),
      noteLabel: dialog.getByText("Note", { exact: true }),
      note: page.getByLabel("Note"),
      reimbursable: page.getByLabel("Mark as Reimbursable"),
      cancel: dialog.getByRole("button", { name: "Cancel" }),
      save: dialog.getByRole("button", { name: "Save Expense" }),
    };

    for (const element of Object.values(criticalElements)) {
      await expect(element).toBeVisible();
    }
    await expect(amount).toBeFocused();
    await expect(dialog.getByText("Essential details")).toBeVisible();
    await expect(dialog.getByText("Optional transaction details")).toBeVisible();
    const essentialOrder = await Promise.all([
      amount,
      criticalElements.category,
      criticalElements.dateField,
    ].map((field) => field.evaluate((element) => element.getBoundingClientRect().top)));
    expect(essentialOrder[0]).toBeLessThan(essentialOrder[1]);
    expect(essentialOrder[1]).toBeLessThan(essentialOrder[2]);
    expect(essentialOrder[2]).toBeLessThan(
      await criticalElements.merchant.evaluate((element) => element.getBoundingClientRect().top),
    );
    await slowFonts.expectRequest();

    const captureLayout = async () => {
      const entries = await Promise.all(
        Object.entries(criticalElements).map(async ([name, locator]) => [
          name,
          await locator.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return {
              x: rect.x,
              y: rect.y,
              right: rect.right,
              bottom: rect.bottom,
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth,
              scrollHeight: element.scrollHeight,
              clientHeight: element.clientHeight,
            };
          }),
        ] as const),
      );
      return Object.fromEntries(entries);
    };

    const expectUsableLayout = (
      layout: Awaited<ReturnType<typeof captureLayout>>,
      state: "fallback" | "branded",
    ) => {
      for (const [name, box] of Object.entries(layout)) {
        expect(box.x, `${name} must remain inside the left edge with ${state} fonts`).toBeGreaterThanOrEqual(-1);
        expect(box.right, `${name} must remain inside the right edge with ${state} fonts`).toBeLessThanOrEqual(1441);
        expect(box.y, `${name} must remain inside the top edge with ${state} fonts`).toBeGreaterThanOrEqual(-1);
        expect(box.bottom, `${name} must remain inside the bottom edge with ${state} fonts`).toBeLessThanOrEqual(1001);
        expect(
          box.scrollWidth - box.clientWidth,
          `${name} must not clip horizontally with ${state} fonts`,
        ).toBeLessThanOrEqual(1);
        expect(
          box.scrollHeight - box.clientHeight,
          `${name} must not clip vertically with ${state} fonts`,
        ).toBeLessThanOrEqual(1);
      }
    };

    await slowFonts.expectPending(
      "local faces should still be pending while the desktop expense dialog uses fallbacks",
    );
    const fallbackLayout = await captureLayout();
    expectUsableLayout(fallbackLayout, "fallback");

    await slowFonts.releaseAndExpectReady(
      "branded faces did not replace desktop expense-dialog fallbacks within the slow-font budget",
    );

    const brandedLayout = await captureLayout();
    expectUsableLayout(brandedLayout, "branded");
    for (const name of Object.keys(criticalElements)) {
      expect(
        Math.abs(brandedLayout[name].x - fallbackLayout[name].x),
        `${name} moved too far horizontally during the desktop font swap`,
      ).toBeLessThanOrEqual(MAX_FONT_SWAP_SHIFT_PX);
      expect(
        Math.abs(brandedLayout[name].y - fallbackLayout[name].y),
        `${name} moved too far vertically during the desktop font swap`,
      ).toBeLessThanOrEqual(MAX_FONT_SWAP_SHIFT_PX);
    }
  });

  test("signed-in mobile expense dialog stays usable while local fonts load slowly @touch @cross-browser", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const slowFonts = await installSlowLocalFontGate(page);

    await mockSignedIn(page);
    await page.goto("/transactions", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Add Expense" }).click();

    const dialog = page.getByRole("dialog", { name: "Add Expense" });
    const amount = page.getByLabel("Amount (₹) *");
    const criticalElements = {
      dateLabel: dialog.getByText("Date *", { exact: true }),
      dateField: dialog.getByRole("button", { name: "Open calendar" }),
      amountLabel: dialog.getByText("Amount (₹) *", { exact: true }),
      amount,
      categoryLabel: dialog.getByText("Category *", { exact: true }),
      category: page.getByLabel("Category *"),
      merchantLabel: dialog.getByText("Merchant", { exact: true }),
      merchant: page.getByLabel("Merchant"),
      paymentLabel: dialog.getByText("Payment Method", { exact: true }),
      payment: page.getByLabel("Payment Method"),
      noteLabel: dialog.getByText("Note", { exact: true }),
      note: page.getByLabel("Note"),
      reimbursable: page.getByLabel("Mark as Reimbursable"),
      cancel: dialog.getByRole("button", { name: "Cancel" }),
      save: dialog.getByRole("button", { name: "Save Expense" }),
    };

    await expect(dialog).toBeVisible();
    await slowFonts.expectRequest();
    await expect(amount).toBeFocused();

    const expectDialogControlsUsable = async (state: "fallback" | "branded") => {
      for (const [name, element] of Object.entries(criticalElements)) {
        await element.scrollIntoViewIfNeeded();
        await expect(element, `${name} must remain visible with ${state} fonts`).toBeVisible();
        const geometry = await element.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const dialogRect = node.closest('[role="dialog"]')!.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            dialogLeft: dialogRect.left,
            dialogRight: dialogRect.right,
            dialogTop: dialogRect.top,
            dialogBottom: dialogRect.bottom,
            scrollWidth: node.scrollWidth,
            clientWidth: node.clientWidth,
            scrollHeight: node.scrollHeight,
            clientHeight: node.clientHeight,
            display: getComputedStyle(node).display,
          };
        });
        expect(geometry.left, `${name} must not clip at the dialog's left edge`).toBeGreaterThanOrEqual(
          geometry.dialogLeft - 1,
        );
        expect(geometry.right, `${name} must not clip at the dialog's right edge`).toBeLessThanOrEqual(
          geometry.dialogRight + 1,
        );
        expect(geometry.top, `${name} must not clip at the dialog's top edge`).toBeGreaterThanOrEqual(
          geometry.dialogTop - 1,
        );
        expect(geometry.bottom, `${name} must not clip at the dialog's bottom edge`).toBeLessThanOrEqual(
          geometry.dialogBottom + 1,
        );
        if (geometry.display !== "inline") {
          expect(
            geometry.scrollWidth - geometry.clientWidth,
            `${name} text must not clip horizontally with ${state} fonts`,
          ).toBeLessThanOrEqual(1);
          expect(
            geometry.scrollHeight - geometry.clientHeight,
            `${name} text must not clip vertically with ${state} fonts`,
          ).toBeLessThanOrEqual(1);
        }
      }
    };

    await slowFonts.expectPending(
      "local faces should still be pending while the open expense dialog uses fallbacks",
    );
    await expectDialogControlsUsable("fallback");
    await expect(amount).toBeFocused();

    await slowFonts.releaseAndExpectReady(
      "branded faces did not replace expense-dialog fallbacks within the slow-mobile budget",
    );

    await expect(dialog).toBeVisible();
    await expectDialogControlsUsable("branded");
    await expect(amount).toBeFocused();
  });

  test("signed-in desktop navigation preserves the supplied logo when collapsed and expanded", async ({
    page,
  }) => {
    await mockSignedIn(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/transactions");

    const sidebar = page.getByTestId("desktop-sidebar");
    const sidebarPanel = page.getByTestId("desktop-sidebar-panel");
    const sidebarLogo = page.getByTestId("desktop-sidebar-logo");
    await expect(sidebar).toBeVisible();
    const compactLogo = sidebarLogo.locator('img[alt="ezyRetire"]:visible');
    await expect(compactLogo).toHaveAttribute("src", /brand-logo-compact\.png$/);
    await expect(compactLogo).toHaveCSS("object-fit", "contain");
    const collapsedLogoBox = await compactLogo.boundingBox();
    expect(collapsedLogoBox).not.toBeNull();
    expect(collapsedLogoBox!.height).toBe(36);
    expect(Math.abs(collapsedLogoBox!.x - 24)).toBeLessThanOrEqual(1);

    await sidebar.hover();
    await expect(sidebarPanel).toHaveCSS("width", "240px");
    const expandedLogoBox = await compactLogo.boundingBox();
    expect(expandedLogoBox).not.toBeNull();
    expect(expandedLogoBox).toEqual(collapsedLogoBox);

    await page.evaluate(() => document.documentElement.classList.add("dark"));
    const darkCompactLogo = sidebarLogo.locator('img[src$="brand-logo-compact-dark.png"]');
    await expect(darkCompactLogo).toBeVisible();
    await expect(darkCompactLogo).toHaveCSS("object-fit", "contain");
  });

  test("signed-in desktop card and expense form @cross-browser", async ({ page }) => {
    await mockSignedIn(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/transactions");

    const sidebar = page.getByTestId("desktop-sidebar");
    const sidebarPanel = page.getByTestId("desktop-sidebar-panel");
    const sidebarLogo = page.getByTestId("desktop-sidebar-logo");
    await expect(sidebar).toBeVisible();
    const compactLogo = sidebarLogo.locator('img[alt="ezyRetire"]:visible');
    await expect(compactLogo).toHaveAttribute("src", /brand-logo-compact\.png$/);
    await expect(compactLogo).toHaveCSS("object-fit", "contain");
    const collapsedLogoBox = await compactLogo.boundingBox();
    expect(collapsedLogoBox).not.toBeNull();
    expect(collapsedLogoBox!.height).toBe(36);
    expect(Math.abs(collapsedLogoBox!.x - 24)).toBeLessThanOrEqual(1);

    await sidebar.hover();
    await expect(sidebarPanel).toHaveCSS("width", "240px");
    const expandedLogoBox = await compactLogo.boundingBox();
    expect(expandedLogoBox).not.toBeNull();
    expect(expandedLogoBox).toEqual(collapsedLogoBox);

    await page.evaluate(() => document.documentElement.classList.add("dark"));
    const darkCompactLogo = sidebarLogo.locator('img[src$="brand-logo-compact-dark.png"]');
    await expect(darkCompactLogo).toBeVisible();
    await expect(darkCompactLogo).toHaveCSS("object-fit", "contain");
    await page.evaluate(() => document.documentElement.classList.remove("dark"));

    await page.getByRole("button", { name: "Add Expense" }).click();
    await expect(page.getByRole("dialog", { name: "Add Expense" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save Expense" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expectStableScreenshot(page, "design-system-signed-in-desktop-form.png");
  });

  test("add expense keeps required validation, optional details, and EMI choice behavior", async ({ page }) => {
    await page.route("**/api/auth/user", (route) => fulfillJson(route, { user: testUser }));
    await page.route("**/api/entitlements", (route) =>
      fulfillJson(route, {
        plan: "free",
        premium: false,
        capabilities: {
          receiptOcr: false,
          bankStatementImport: false,
          documentVault: false,
          nomineeTracker: false,
          verifiedMobile: false,
        },
        mobileVerification: { hasMobile: true, verified: false },
      }),
    );
    await page.route("**/api/financial-data", (route) => fulfillJson(route, {
      ...financialData,
      loans: [{
        id: "home-loan",
        type: "Home",
        name: "Home loan",
        sanctionedPrincipal: 2_000_000,
        outstandingPrincipal: 1_500_000,
        annualInterestRate: 8,
        interestType: "Fixed",
        totalTenureMonths: 240,
        startDate: "2025-01-01",
        emi: 25_000,
        prepayments: 0,
        createdAt: "2025-01-01T00:00:00.000Z",
      }],
    }));
    await page.route("**/api/whatsapp/support", (route) =>
      fulfillJson(route, { available: false, whatsappUrl: null }),
    );
    await page.goto("/transactions");
    await page.getByRole("button", { name: "Add Expense" }).click();

    const dialog = page.getByRole("dialog", { name: "Add Expense" });
    const save = dialog.getByRole("button", { name: "Save Expense" });
    await expect(save).toBeDisabled();
    await expect(page.getByLabel("Merchant")).toBeVisible();
    await expect(page.getByLabel("Payment Method")).toHaveText(/UPI/);
    await expect(page.getByLabel("Note")).toBeVisible();
    await expect(page.getByLabel("Mark as Reimbursable")).toBeVisible();

    await page.getByLabel("Amount (₹) *").fill("25000");
    await page.getByLabel("Category *").click();
    await page.getByRole("option").first().click();
    await expect(dialog.getByText("Possible duplicate loan EMI")).toBeVisible();
    await expect(save).toBeDisabled();
    await dialog.getByRole("button", { name: "This is a separate expense" }).click();
    await expect(save).toBeEnabled();
  });

  test("signed-in mobile cards and responsive navigation @touch @cross-browser", async ({ page }) => {
    await mockSignedIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/transactions");

    await expect(page.getByText("Neighbourhood Market").first()).toBeVisible();
    await expect(page.getByTestId("mobile-bottom-navigation")).toBeVisible();
    await page.getByTestId("button-mobile-nav-more").click();
    await expect(page.getByTestId("link-mobile-nav-profile")).toBeVisible();
    await expectStableScreenshot(page, "design-system-signed-in-mobile-navigation.png");
  });

  for (const theme of ["light", "dark"] as const) {
    for (const paletteViewport of [
      { name: "mobile", width: 390, height: 844, tag: " @touch" },
      { name: "desktop", width: 1440, height: 1000, tag: "" },
    ] as const) {
      test(`rendered semantic palette is coherent in ${theme} ${paletteViewport.name}${paletteViewport.tag}`, async ({
        page,
      }) => {
        await installPaletteTheme(page, theme);
        await page.setViewportSize(paletteViewport);
        await mockSignedIn(page);
        await page.goto("/transactions");

        await expect(page.getByRole("heading", { name: "Expenses", exact: true })).toBeVisible();
        await expect(page.getByText("Neighbourhood Market").filter({ visible: true }).first()).toBeVisible();
        await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*dark)/);

        const colors = await page.evaluate((viewportName) => {
          const colorOf = (selector: string, pseudo?: "::after") => {
            const element = document.querySelector<HTMLElement>(selector);
            if (!element) return "";
            return getComputedStyle(element, pseudo).color;
          };
          const backgroundOf = (selector: string, pseudo?: "::after") => {
            const element = document.querySelector<HTMLElement>(selector);
            if (!element) return "";
            return getComputedStyle(element, pseudo).backgroundColor;
          };
          const primaryButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
            .find((button) => button.textContent?.includes("Add Expense"));
          const bodySample = [...document.querySelectorAll<HTMLElement>("p")]
            .find((paragraph) => paragraph.textContent?.includes("Track daily spending"));
          return {
            primaryButton: primaryButton ? getComputedStyle(primaryButton).backgroundColor : "",
            activeDesktopLink: colorOf('[data-testid="link-desktop-nav-expenses"]'),
            activeMobileLink: colorOf('[data-testid="button-mobile-nav-expenses"]'),
            activeMobileIndicator: backgroundOf('[data-testid="button-mobile-nav-expenses"]', "::after"),
            navigationSurface: backgroundOf(
              viewportName === "desktop"
                ? '[data-testid="desktop-sidebar-panel"]'
                : '[data-testid="mobile-bottom-navigation"]',
            ),
            headingSize: Number.parseFloat(getComputedStyle(document.querySelector("h1")!).fontSize),
            subheadingSize: Number.parseFloat(getComputedStyle(document.querySelector("h2")!).fontSize),
            bodySize: bodySample
              ? Number.parseFloat(getComputedStyle(bodySample).fontSize)
              : Number.parseFloat(getComputedStyle(document.body).fontSize),
            headingWeight: Number.parseInt(getComputedStyle(document.querySelector("h1")!).fontWeight, 10),
            bodyFamily: getComputedStyle(document.body).fontFamily,
            headingFamily: getComputedStyle(document.querySelector("h1")!).fontFamily,
          };
        }, paletteViewport.name);
        const primary = await resolvedThemeColor(page, "--primary");
        const foreground = await resolvedThemeColor(page, "--foreground");
        const ring = await resolvedThemeColor(page, "--ring");
        const navigationSurface = await resolvedThemeColor(
          page,
          paletteViewport.name === "desktop" ? "--sidebar" : "--card",
        );

        expect(colors.primaryButton, "primary actions must render the primary semantic color").toBe(primary);
        if (paletteViewport.name === "desktop") {
          expect(colors.activeDesktopLink, "active navigation links must use primary").toBe(primary);
          expect(colors.navigationSurface, "desktop navigation must use the app navigation surface").toBe(
            navigationSurface,
          );
        } else {
          expect(colors.activeMobileIndicator, "active mobile navigation must use primary").toBe(primary);
          expect(colors.navigationSurface, "mobile navigation must use the card surface").toBe(
            navigationSurface,
          );
        }
        expect(colors.activeMobileLink || colors.activeDesktopLink, "navigation links must render a color").toMatch(
          /^rgb/,
        );

        const search = page.getByPlaceholder("Search merchant, category...");
        await search.focus();
        await expect(search).toBeFocused();
        const focusPaint = await search.evaluate((element) => {
          const style = getComputedStyle(element);
          return `${style.outlineColor} ${style.boxShadow}`;
        });
        expect(focusPaint, "focused controls must render the focus ring token").toContain(ring);

        const financial = page.locator(".financial-number").first();
        await expect(financial).toContainText("₹");
        const financialStyle = await financial.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            color: style.color,
            fontFamily: style.fontFamily,
            fontVariantNumeric: style.fontVariantNumeric,
          };
        });
        expect(financialStyle.color, "financial values must use a rendered semantic text color").toMatch(
          /^rgb/,
        );
        expect(financialStyle.color, "financial values must use the foreground token").toBe(foreground);
        expect(financialStyle.fontFamily).toContain("Inter");
        expect(financialStyle.fontVariantNumeric).toContain("tabular-nums");

        expect(colors.headingSize, "h1 must be larger than h2").toBeGreaterThan(colors.subheadingSize);
        expect(colors.subheadingSize, "h2 must be larger than body text").toBeGreaterThan(colors.bodySize);
        expect(colors.headingWeight, "headings must be visibly emphasized").toBeGreaterThanOrEqual(600);
        expect(colors.headingFamily).toContain("Inter");
        expect(colors.bodyFamily).toContain("Inter");
        await page.screenshot({ path: test.info().outputPath(`palette-${theme}-${paletteViewport.name}.png`), fullPage: true });

        const primaryForeground = await resolvedThemeColor(page, "--primary-foreground");
        await expect(page.getByRole("button", { name: "Add Expense" })).toHaveCSS("color", primaryForeground);
        if (paletteViewport.name === "desktop") {
          await page.getByRole("button", {
            name: `Delete ${financialData.expenses[0].merchant} transaction`,
          }).click();
        } else {
          await page.getByRole("button", {
            name: `More actions for ${financialData.expenses[0].merchant}`,
          }).click();
          await page.getByRole("menuitem", { name: "Delete" }).click();
        }
        const dialog = page.getByRole("alertdialog", { name: "Delete transaction?" });
        await expect(dialog).toBeVisible();
        const destructiveAction = dialog.getByRole("button", { name: "Delete", exact: true });
        await expect(destructiveAction).toHaveCSS(
          "background-color", await resolvedThemeColor(page, "--destructive"),
        );
        await expect(destructiveAction).toHaveCSS(
          "color", await resolvedThemeColor(page, "--destructive-foreground"),
        );
      });
    }
  }
});

async function resolvedThemeColor(page: Page, variable: string) {
  return page.evaluate((property) => {
    const probe = document.createElement("span");
    probe.style.color = `hsl(var(${property}))`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, variable);
}
