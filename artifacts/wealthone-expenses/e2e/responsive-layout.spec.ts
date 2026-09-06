import { expect, test, type Page } from "@playwright/test";

const testUser = {
  id: "responsive-layout-user",
  email: "responsive@example.com",
  profileImageUrl: null,
  fullName: "Responsive Layout",
  dateOfBirth: "1990-01-15",
  gender: "Prefer not to say",
  phone: "+919999999999",
  onboardingCompleted: true,
  isAdmin: false,
};

const financialData = {
  expenses: [
    {
      id: "expense-long",
      date: "2026-09-05",
      amount: 9876543,
      category: "Family healthcare, medicines and specialist consultations",
      merchant: "Metropolitan Multi-Speciality Hospital and Diagnostic Centre",
      paymentMethod: "Credit Card",
      reimbursable: false,
      recurring: false,
      createdAt: "2026-09-05T09:00:00.000Z",
    },
    {
      id: "expense-second",
      date: "2026-09-04",
      amount: 1250,
      category: "Groceries",
      merchant: "Neighbourhood Grocery",
      paymentMethod: "UPI",
      reimbursable: false,
      recurring: false,
      createdAt: "2026-09-04T09:00:00.000Z",
    },
  ],
  budgets: [
    {
      category: "Family healthcare, medicines and specialist consultations",
      monthlyLimit: 12345678,
    },
  ],
  incomeSources: [
    {
      id: "income-long",
      name: "Senior Vice President of International Strategy and Transformation",
      type: "Salary",
      frequency: "Monthly",
      amount: 0,
      date: "2024-01-01",
      recurring: true,
      annualGrowthRate: 12.5,
      incomeEndMode: "retirement",
      salaryDetails: {
        grossCTC: 987654321,
        grossCTCMode: "manual",
        basicPay: 34567890,
        hra: 12345678,
        allowances: 8765432,
        employeePF: 1234567,
        professionalTax: 2500,
        tds: 9876543,
        tdsMode: "manual",
        taxRegime: "new",
        financialYear: "2026-27",
        otherDeductions: 345678,
      },
      createdAt: "2024-01-01T09:00:00.000Z",
    },
  ],
  investments: [
    {
      id: "investment-long",
      name: "Globally Diversified Multi-Asset Retirement Opportunity Portfolio",
      assetClass: "Mutual Funds",
      investedAmount: 9876543210,
      currentValue: 12345678901,
      monthlyContribution: 12345678,
      contributionStartDate: "2024-01-01",
      contributionEndMode: "retirement",
      expectedReturn: 12.75,
      institution: "International Wealth and Asset Management Corporation",
      createdAt: "2024-01-01T09:00:00.000Z",
    },
  ],
  loans: [
    {
      id: "loan-long",
      name: "Thirty Year Floating Rate Metropolitan Family Residence Mortgage",
      type: "Home",
      sanctionedPrincipal: 9876543210,
      outstandingPrincipal: 8765432109,
      annualInterestRate: 9.25,
      interestType: "Floating",
      totalTenureMonths: 360,
      startDate: "2025-01-01",
      emi: 12345678,
      prepayments: 0,
      createdAt: "2025-01-01T09:00:00.000Z",
    },
  ],
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

const pages = [
  { name: "Profile", path: "/profile", heading: "Your Profile" },
  { name: "Dashboard", path: "/", heading: "Your retirement outlook" },
  { name: "Income", path: "/income", heading: "Income" },
  { name: "Transactions", path: "/transactions", heading: "Expenses" },
  { name: "Budgets", path: "/budgets", heading: "Expenses" },
  { name: "Tax", path: "/tax", heading: "Tax" },
  { name: "Investments", path: "/investments", heading: "Investment Portfolio" },
  { name: "Loans", path: "/loans", heading: "Loans & Liabilities" },
  { name: "Retirement", path: "/retirement", heading: "Retirement Projection", immersive: true },
  { name: "Trends", path: "/trends", heading: "Trends" },
  { name: "Advice", path: "/advice", heading: "Advisor section updates are coming soon" },
  { name: "Advisor", path: "/advisor", heading: "No Advisor Assigned" },
  { name: "About", path: "/about", heading: "From scattered financial details to one clear retirement story." },
] as const;

const compactViewports = [
  { name: "portrait phone", width: 390, height: 844, expectedNavigationItems: 5 },
  { name: "short landscape phone", width: 667, height: 375, expectedNavigationItems: 6 },
  { name: "portrait tablet", width: 768, height: 1024, expectedNavigationItems: 8 },
  { name: "landscape tablet", width: 1023, height: 768, expectedNavigationItems: 8 },
] as const;
async function mockCustomerSession(page: Page) {
  await page.route("**/api/auth/user", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: testUser }) }),
  );
  await page.route("**/api/financial-data", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(financialData) }),
  );
  await page.route("**/api/advice/overview", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        request: null,
        advisor: null,
        settings: {
          consultationFee: 999,
          currency: "INR",
          businessWhatsapp: "",
          upiId: "responsive@upi",
        },
      }),
    }),
  );
  await page.route("**/api/whatsapp/support", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ available: false, whatsappUrl: null }),
    }),
  );
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
    scrollContainer: (() => {
      const element = document.querySelector<HTMLElement>('[data-testid="page-scroll-container"]');
      return element ? element.scrollWidth - element.clientWidth : null;
    })(),
    content: (() => {
      const element = document.querySelector<HTMLElement>('[data-testid="page-content"]');
      return element ? element.scrollWidth - element.clientWidth : null;
    })(),
  }));
  expect(overflow.document, "document must not scroll horizontally").toBeLessThanOrEqual(1);
  expect(overflow.body, "body must not scroll horizontally").toBeLessThanOrEqual(1);
  expect(overflow.scrollContainer, "page scroll container must exist").not.toBeNull();
  expect(overflow.scrollContainer!, "page scroll container must not scroll horizontally").toBeLessThanOrEqual(1);
  expect(overflow.content, "page content must exist").not.toBeNull();
  expect(overflow.content!, "page content must not overflow horizontally").toBeLessThanOrEqual(1);
}

async function expectUsableBottomNavigation(page: Page, expectedItemCount: number) {
  const navigation = page.getByTestId("mobile-bottom-navigation");
  await expect(navigation).toBeVisible();

  const itemGeometry = await navigation.locator(":scope > *:visible").evaluateAll((items) =>
    items.map((item) => {
      const rect = item.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
      };
    }),
  );

  expect(itemGeometry, "bottom navigation must show the expected responsive item count").toHaveLength(
    expectedItemCount,
  );
  for (const [index, item] of itemGeometry.entries()) {
    expect(item.width, `bottom navigation item ${index + 1} must be wide enough to tap`).toBeGreaterThanOrEqual(44);
    expect(item.height, `bottom navigation item ${index + 1} must be tall enough to tap`).toBeGreaterThanOrEqual(44);
    if (index > 0) {
      expect(
        item.left,
        `bottom navigation item ${index + 1} must not overlap its previous item`,
      ).toBeGreaterThanOrEqual(itemGeometry[index - 1].right - 1);
    }
  }
}

test.describe("responsive customer pages", () => {
  test.beforeEach(async ({ page }) => {
    await mockCustomerSession(page);
  });

  for (const viewport of compactViewports) {
    for (const pageInfo of pages) {
      test(`${pageInfo.name} fits a ${viewport.name} and clears the bottom navigation`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(pageInfo.path);

        const heading = page.getByRole("heading", { name: pageInfo.heading, exact: false }).first();
        await expect(heading).toBeVisible();
        await expect(page.getByTestId("link-desktop-nav-dashboard")).toBeHidden();
        if ("immersive" in pageInfo && pageInfo.immersive) {
          await expect(page.getByTestId("mobile-bottom-navigation")).toBeHidden();
        } else {
          await expectUsableBottomNavigation(page, viewport.expectedNavigationItems);
        }
        await expectNoHorizontalOverflow(page);

        if (pageInfo.name === "Income") {
          await expect(page.getByText(financialData.incomeSources[0].name)).toBeVisible();
          await expect(page.getByRole("button", { name: `Edit ${financialData.incomeSources[0].name}` })).toBeVisible();
        } else if (pageInfo.name === "Transactions") {
          await expect(page.getByPlaceholder("Search merchant, category...")).toBeVisible();
          await expect(page.getByRole("button", { name: "Add Expense" })).toBeVisible();
          await expect(page.getByRole("combobox", { name: "Sort cards by" })).toBeVisible();
          await expect(
            page.locator("p:visible, span:visible").filter({ hasText: financialData.expenses[0].merchant }).first(),
          ).toBeVisible();
          if (viewport.width < 640) {
            await page.getByRole("button", { name: "Filters" }).click();
          }
          await expect(page.getByRole("combobox")).toHaveCount(3);
          if (viewport.width < 768) {
            await expect(
              page.getByRole("button", { name: `More actions for ${financialData.expenses[0].merchant}` }),
            ).toBeVisible();
          } else {
            await expect(
              page.getByRole("button", { name: `Edit ${financialData.expenses[0].merchant} transaction` }),
            ).toBeVisible();
          }
        } else if (pageInfo.name === "Investments") {
          await expect(page.getByText(financialData.investments[0].name)).toBeVisible();
          await expect(page.getByRole("button", { name: `Edit ${financialData.investments[0].name}` })).toBeVisible();
        } else if (pageInfo.name === "Loans") {
          await expect(page.getByText(financialData.loans[0].name)).toBeVisible();
          await expect(page.getByRole("button", { name: `Edit ${financialData.loans[0].name} loan` })).toBeVisible();
        }

        const scrollContainer = page.getByTestId("page-scroll-container");
        await scrollContainer.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));

        if (!("immersive" in pageInfo && pageInfo.immersive)) {
          const clearance = await page.evaluate(() => {
            const content = document.querySelector<HTMLElement>('[data-testid="page-content"]');
            const navigation = document.querySelector<HTMLElement>('[data-testid="mobile-bottom-navigation"]');
            const lastContent = content?.lastElementChild;
            if (!content || !navigation || !(lastContent instanceof HTMLElement)) return null;
            return navigation.getBoundingClientRect().top - lastContent.getBoundingClientRect().bottom;
          });
          expect(clearance, "page content must finish above the fixed bottom navigation").not.toBeNull();
          expect(clearance!).toBeGreaterThanOrEqual(0);
        }

        const usableControls = page.locator(
          '[data-testid="page-content"] :is(button, a[href], input, select, textarea):visible',
        );
        if (pageInfo.name !== "Trends") {
          expect(await usableControls.count(), "page should expose at least one usable control").toBeGreaterThan(0);
        }
      });
    }
  }

  for (const pageInfo of pages) {
    test(`${pageInfo.name} preserves the desktop layout`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(pageInfo.path);

      await expect(page.getByRole("heading", { name: pageInfo.heading, exact: false }).first()).toBeVisible();
      await expect(page.getByTestId("mobile-bottom-navigation")).toBeHidden();
      await expect(page.getByTestId("link-desktop-nav-dashboard")).toBeVisible();
      await expectNoHorizontalOverflow(page);

      if (pageInfo.name === "Transactions") {
        await expect(page.getByPlaceholder("Search merchant, category...")).toBeVisible();
        await expect(page.getByRole("button", { name: "Add Expense" })).toBeVisible();
        await expect(page.getByRole("combobox", { name: "Sort cards by" })).toBeVisible();
        await expect(page.getByRole("combobox")).toHaveCount(3);
        await expect(
          page.locator("p:visible, span:visible").filter({ hasText: financialData.expenses[0].merchant }).first(),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: `Edit ${financialData.expenses[0].merchant} transaction` }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: `Delete ${financialData.expenses[0].merchant} transaction` }),
        ).toBeVisible();
      }
    });
  }

  test("desktop navigation starts at the large breakpoint", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");

    await expect(page.getByTestId("mobile-bottom-navigation")).toBeHidden();
    await expect(page.getByTestId("link-desktop-nav-dashboard")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  for (const viewport of [
    { name: "mobile", width: 390, height: 844 },
    { name: "desktop", width: 1440, height: 1000 },
  ] as const) {
    test(`shows the temporary Advice and public contact experience on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/advice");

      await expect(page.getByTestId("page-advice-paused")).toBeVisible();
      await expect(page.getByText("Consultation requests and payments are temporarily unavailable")).toBeVisible();
      await expect(page.getByTestId("link-advice-email")).toHaveAttribute("href", "mailto:hello@ezyretire.com");
      await expect(page.getByText("Request a Consultation")).toHaveCount(0);
      await expect(page.getByText("UPI transaction reference")).toHaveCount(0);
      await expect(page.locator('a[href*="wa.me"]')).toHaveCount(0);
      await expectNoHorizontalOverflow(page);

      await page.goto("/about");
      await expect(page.getByTestId("about-contact")).toBeVisible();
      for (const address of [
        "hello@ezyretire.com",
        "support@ezyretire.com",
        "feedback@ezyretire.com",
        "info@ezyretire.com",
      ]) {
        await expect(page.locator(`a[href="mailto:${address}"]`)).toHaveCount(1);
      }
      await expect(page.getByText("vikrant@ezyretire.com")).toHaveCount(0);
      await expect(page.locator('a[href^="mailto:vikrant@"]')).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
    });
  }
});

test.describe("mobile header scroll behavior", () => {
  test.beforeEach(async ({ page }) => {
    await mockCustomerSession(page);
  });

  for (const preference of ["no-preference", "reduce"] as const) {
    test(`uses ${preference === "reduce" ? "instant changes" : "transitions"} when reduced motion is ${preference}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: preference });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/transactions");

      const header = page.getByTestId("mobile-header");
      const scrollContainer = page.getByTestId("page-scroll-container");
      await expect(page.getByRole("heading", { name: "Expenses", exact: false }).first()).toBeVisible();
      await page.getByTestId("page-content").evaluate((element) => {
        element.style.minHeight = "2400px";
      });
      await scrollContainer.evaluate((element) => element.scrollTo({ top: 0 }));
      await expect(header).toHaveAttribute("aria-hidden", "false");

      const transition = await header.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          duration: style.transitionDuration,
          property: style.transitionProperty,
        };
      });

      if (preference === "reduce") {
        expect(transition.duration).toBe("0s");
        expect(transition.property).toBe("none");
      } else {
        expect(transition.duration).not.toBe("0s");
        expect(transition.property).toContain("transform");
      }

      await scrollContainer.evaluate((element) => element.scrollTo({ top: 400 }));
      await expect(header).toHaveAttribute("aria-hidden", "true");
      await scrollContainer.evaluate((element) => element.scrollTo({ top: 380 }));
      await expect(header).toHaveAttribute("aria-hidden", "false");
    });
  }

  test("hides on meaningful downward scroll, ignores jitter, restores upward, and resets after navigation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/transactions");

    const header = page.getByTestId("mobile-header");
    const scrollContainer = page.getByTestId("page-scroll-container");
    await expect(page.getByRole("heading", { name: "Expenses", exact: false }).first()).toBeVisible();
    await expect(header).toHaveAttribute("aria-hidden", "false");

    await page.getByTestId("page-content").evaluate((element) => {
      element.style.minHeight = "2400px";
    });

    await scrollContainer.evaluate((element) => element.scrollTo({ top: 400 }));
    await expect(header).toHaveAttribute("aria-hidden", "true");

    await scrollContainer.evaluate((element) => element.scrollTo({ top: 396 }));
    await expect(header).toHaveAttribute("aria-hidden", "true");
    await scrollContainer.evaluate((element) => element.scrollTo({ top: 403 }));
    await expect(header).toHaveAttribute("aria-hidden", "true");

    await scrollContainer.evaluate((element) => element.scrollTo({ top: 380 }));
    await expect(header).toHaveAttribute("aria-hidden", "false");

    await scrollContainer.evaluate((element) => element.scrollTo({ top: 600 }));
    await expect(header).toHaveAttribute("aria-hidden", "true");
    await page.locator('[data-testid="mobile-bottom-navigation"] a[href="/investments"]').click();

    await expect(page).toHaveURL(/\/investments$/);
    await expect(page.getByRole("heading", { name: "Investment Portfolio", exact: false })).toBeVisible();
    await expect(header).toHaveAttribute("aria-hidden", "false");
  });

  test("keeps the desktop sidebar visible while the page scrolls", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/transactions");

    const desktopDashboardLink = page.getByTestId("link-desktop-nav-dashboard");
    await expect(desktopDashboardLink).toBeVisible();
    await expect(page.getByTestId("mobile-header")).toBeHidden();

    await page.getByTestId("page-content").evaluate((element) => {
      element.style.minHeight = "2400px";
    });
    await page.getByTestId("page-scroll-container").evaluate((element) => element.scrollTo({ top: 600 }));

    await expect(desktopDashboardLink).toBeVisible();
    await expect(page.getByTestId("mobile-header")).toBeHidden();
  });
});
