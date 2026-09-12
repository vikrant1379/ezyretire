import { expect, test, type Dialog, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { formatChartAmount } from "../src/lib/retirement-chart-format";

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
  plannedExpenses: [],
  reminders: [],
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

function createTrajectoryData({
  monthlyIncome,
  monthlyExpense,
  currentValue,
  investedAmount,
  expectedReturn,
  targetRetirementAge = 60,
}: {
  monthlyIncome: number;
  monthlyExpense: number;
  currentValue: number;
  investedAmount: number;
  expectedReturn: number;
  targetRetirementAge?: number;
}) {
  const data = structuredClone(financialData);
  const source = data.incomeSources[0];
  const investment = data.investments[0];

  data.expenses = [{
    ...financialData.expenses[1],
    id: `trajectory-expense-${monthlyExpense}`,
    amount: monthlyExpense,
  }];
  data.budgets = [];
  data.incomeSources = [{
    ...source,
    id: `trajectory-income-${monthlyIncome}`,
    amount: 0,
    salaryDetails: {
      ...source.salaryDetails,
      grossCTC: monthlyIncome * 12,
      basicPay: monthlyIncome,
      hra: 0,
      allowances: 0,
      employeePF: 0,
      professionalTax: 0,
      tds: 0,
      otherDeductions: 0,
    },
  }];
  data.investments = [{
    ...investment,
    id: `trajectory-investment-${currentValue}`,
    investedAmount,
    currentValue,
    monthlyContribution: 0,
    expectedReturn,
  }];
  data.loans = [];
  data.retirementInputs = {
    ...data.retirementInputs,
    targetRetirementAge,
    lifeExpectancy: 85,
    monthlyContributionOverride: 0,
    lifestyleChoice: "Comfortable",
    customLifestyleExpense: 0,
  };
  data.profileInputs = {
    ...data.profileInputs,
    targetRetirementAge,
    lifeExpectancy: 85,
  };
  return data;
}

const trajectoryScenarios = [
  {
    name: "zero",
    data: createTrajectoryData({
      monthlyIncome: 30_000,
      monthlyExpense: 12_000,
      currentValue: 0,
      investedAmount: 0,
      expectedReturn: 0,
    }),
  },
  {
    name: "large",
    data: financialData,
  },
  {
    name: "depleted",
    data: createTrajectoryData({
      monthlyIncome: 50_000,
      monthlyExpense: 200_000,
      currentValue: 100_000,
      investedAmount: 100_000,
      expectedReturn: 4,
      targetRetirementAge: 40,
    }),
  },
  {
    name: "large-outflow",
    data: createTrajectoryData({
      monthlyIncome: 50_000,
      monthlyExpense: 2_000_000_000,
      currentValue: 100_000,
      investedAmount: 100_000,
      expectedReturn: 4,
      targetRetirementAge: 40,
    }),
  },
] as const;

const trajectoryViewports = [
  { width: 320, height: 844 },
  { width: 375, height: 844 },
  { width: 390, height: 844 },
  { width: 767, height: 900 },
  { width: 768, height: 900 },
  { width: 1440, height: 1000 },
] as const;

const trajectoryScreenshotDirectory = resolve(
  process.cwd().endsWith("artifacts/wealthone-expenses") ? "../../screenshots" : "screenshots",
);

const pages = [
  { name: "Profile", path: "/profile", heading: "Your Profile" },
  { name: "Settings", path: "/settings", heading: "Settings" },
  { name: "Dashboard", path: "/", heading: "Your retirement outlook" },
  { name: "Financial Health", path: "/financial-health", heading: "Financial Health" },
  { name: "Income", path: "/income", heading: "Income" },
  { name: "Transactions", path: "/transactions", heading: "Expenses" },
  { name: "Budgets", path: "/budgets", heading: "Expenses" },
  { name: "Tax", path: "/tax", heading: "Tax" },
  { name: "Investments", path: "/investments", heading: "Investment Portfolio" },
  { name: "Loans", path: "/loans", heading: "Loans & Liabilities" },
  { name: "Decision tools", path: "/decision-tools", heading: "Decision tools" },
  { name: "Retirement", path: "/retirement", heading: "Retirement Projection", immersive: true },
  { name: "Trends", path: "/trends", heading: "Trends" },
  { name: "Advice", path: "/advice", heading: "Advisor section updates are coming soon" },
  { name: "Advisor", path: "/advisor", heading: "No Advisor Assigned" },
  { name: "About", path: "/about", heading: "From scattered financial details to one clear retirement story." },
] as const;

const compactViewports = [
  { name: "narrow portrait phone", width: 360, height: 800, expectedNavigationItems: 5 },
  { name: "portrait phone", width: 390, height: 844, expectedNavigationItems: 5 },
  { name: "short landscape phone", width: 667, height: 375, expectedNavigationItems: 6 },
  { name: "portrait tablet", width: 768, height: 1024, expectedNavigationItems: 8 },
  { name: "landscape tablet", width: 1023, height: 768, expectedNavigationItems: 8 },
] as const;

const desktopViewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "wide desktop", width: 1920, height: 1080 },
] as const;
const desktopNavigationItemCount = 17;
async function mockCustomerSession(page: Page, data: typeof financialData = financialData) {
  await page.route("**/api/auth/user", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: testUser }) }),
  );
  await page.route("**/api/financial-data", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) }),
  );
  await page.route("**/api/entitlements", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
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
    }),
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
  await page.route("**/api/auth/passkeys", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ credentials: [] }),
    }),
  );
  await page.route("**/api/account/deletion", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "none" }),
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
    offenders: (() => {
      const container = document.querySelector<HTMLElement>('[data-testid="page-scroll-container"]');
      if (!container) return [];
      const bounds = container.getBoundingClientRect();
      return Array.from(container.querySelectorAll<HTMLElement>("*"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName.toLowerCase(),
            testId: element.dataset.testid ?? null,
            className: typeof element.className === "string" ? element.className.slice(0, 160) : "",
            left: Math.round(rect.left),
            right: Math.round(rect.right),
          };
        })
        .filter((element) => element.left < bounds.left - 1 || element.right > bounds.right + 1)
        .slice(0, 8);
    })(),
  }));
  expect(overflow.document, "document must not scroll horizontally").toBeLessThanOrEqual(1);
  expect(overflow.body, "body must not scroll horizontally").toBeLessThanOrEqual(1);
  expect(overflow.scrollContainer, "page scroll container must exist").not.toBeNull();
  expect(
    overflow.scrollContainer!,
    `page scroll container must not scroll horizontally; offenders: ${JSON.stringify(overflow.offenders)}`,
  ).toBeLessThanOrEqual(1);
  expect(overflow.content, "page content must exist").not.toBeNull();
  expect(overflow.content!, "page content must not overflow horizontally").toBeLessThanOrEqual(1);
}

const dashboardSummaryHeadings = [
  "Monthly Income",
  "Monthly Outflow",
  "Monthly Savings",
  "Savings Rate",
  "Investments",
  "Outstanding Debt",
  "Available to Invest",
] as const;
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

  for (const scenario of trajectoryScenarios) {
    for (const viewport of trajectoryViewports) {
      test(`Wealth Trajectory ${scenario.name} stays legible at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await mockCustomerSession(page, scenario.data);
        await page.goto("/retirement");

        const chartCard = page.getByTestId("retirement-projection-chart");
        await expect(chartCard).toBeVisible();
        await expect(page.getByRole("heading", { name: "Retirement Projection", exact: true })).toBeVisible();

        let geometryFailure: unknown;
        for (const chartView of ["corpus", "lifestyle"] as const) {
          const tab = chartCard.getByRole("tab", { name: chartView.toUpperCase(), exact: true });
          await tab.click();
          await expect(tab).toHaveAttribute("aria-selected", "true");
          await expect(chartCard.getByRole("tabpanel")).toHaveAttribute(
            "aria-label",
            chartView === "corpus" ? "Retirement corpus projection" : "Retirement lifestyle projection",
          );

          const legendLabels = chartView === "corpus"
            ? ["Base corpus", "Optimistic (+2%)", "Pessimistic (-2%)", "Corpus needed"]
            : ["Lifestyle expense", "Pension income", "Net retirement outflow"];
          const legend = chartCard.getByTestId("retirement-chart-legend");
          for (const label of legendLabels) {
            await expect(legend.getByText(label, { exact: true })).toBeVisible();
          }

          await mkdir(trajectoryScreenshotDirectory, { recursive: true });
          await page.mouse.move(0, 0);
          await chartCard.screenshot({
            path: resolve(
              trajectoryScreenshotDirectory,
              `trajectory-${scenario.name}-${viewport.width}-${chartView}.png`,
            ),
            animations: "disabled",
          });
          try {
            await expectTrajectoryChartGeometry(
              page,
              viewport.width,
              chartView,
              true,
            );
            if (scenario.name === "large" && viewport.width >= 768) {
              // The model floors depleted corpus at zero. Exercise negative
              // formatter output in the real desktop SVG/font/gutter directly.
              const labels = [-7e11, -9.99e11, -7e12, -1e15, -Number.MAX_VALUE]
                .map(formatChartAmount);
              const ticks = chartCard.locator(".recharts-yAxis .recharts-cartesian-axis-tick-value tspan");
              await expect(ticks).not.toHaveCount(0);
              await ticks.evaluateAll((elements, values) => {
                elements.forEach((element, index) => {
                  element.textContent = values[index % values.length];
                });
              }, labels);
              await expectTrajectoryChartGeometry(page, viewport.width, chartView, true);
            }
          } catch (error) {
            geometryFailure ??= error;
          }
        }
        if (geometryFailure) {
          throw geometryFailure;
        }
      });
    }
  }

  for (const viewport of [
    { width: 320, height: 1200 },
    { width: 375, height: 1200 },
    { width: 390, height: 1200 },
  ] as const) {
    test(`Wealth Trajectory touch tooltip stays inside its card at ${viewport.width}px @touch`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockCustomerSession(page, trajectoryScenarios[2].data);
      await page.goto("/retirement");

      const chartCard = page.getByTestId("retirement-projection-chart");
      const svg = chartCard.locator("svg.recharts-surface");
      await expect(svg).toBeVisible();

      const cdp = await page.context().newCDPSession(page);
      for (const chartView of ["corpus", "lifestyle"] as const) {
        await chartCard.getByRole("tab", { name: chartView.toUpperCase(), exact: true }).click();
        await chartCard.scrollIntoViewIfNeeded();
        const plotBox = await svg.boundingBox();
        expect(plotBox).not.toBeNull();
        const x = plotBox!.x + plotBox!.width * 0.55;
        const y = plotBox!.y + plotBox!.height * 0.5;
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
        });
        await page.waitForTimeout(50);
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x + 24, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
        });

        const tooltip = page.locator(".recharts-tooltip-wrapper").filter({ visible: true });
        await expect(tooltip).toBeVisible();
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await expect.poll(async () => {
          const [cardBox, tooltipBox] = await Promise.all([chartCard.boundingBox(), tooltip.boundingBox()]);
          if (!cardBox || !tooltipBox) return false;
          return (
            tooltipBox.width <= cardBox.width - 14
            && tooltipBox.x >= cardBox.x + 7
            && tooltipBox.x + tooltipBox.width <= cardBox.x + cardBox.width - 7
            && tooltipBox.y >= cardBox.y - 1
            && tooltipBox.y + tooltipBox.height <= cardBox.y + cardBox.height + 1
          );
        }, { timeout: 2_000 }).toBe(true);

        const [cardBox, tooltipBox] = await Promise.all([chartCard.boundingBox(), tooltip.boundingBox()]);
        expect(cardBox).not.toBeNull();
        expect(tooltipBox).not.toBeNull();
        expect(tooltipBox!.width, "mobile tooltip must fit inside the trajectory card").toBeLessThanOrEqual(
          cardBox!.width - 16 + 2,
        );
        expect(tooltipBox!.x, "mobile tooltip must keep an 8px card inset on the left").toBeGreaterThanOrEqual(
          cardBox!.x + 8 - 1,
        );
        expect(tooltipBox!.x + tooltipBox!.width, "mobile tooltip must keep an 8px card inset on the right").toBeLessThanOrEqual(
          cardBox!.x + cardBox!.width - 8 + 1,
        );
        expect(tooltipBox!.y, "mobile tooltip must stay inside the trajectory card").toBeGreaterThanOrEqual(
          cardBox!.y - 1,
        );
        expect(tooltipBox!.y + tooltipBox!.height, "mobile tooltip must stay inside the trajectory card").toBeLessThanOrEqual(
          cardBox!.y + cardBox!.height + 1,
        );
      }
    });
  }

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
          await expectIncomeSummaryCardSpacing(page, viewport.width);
          await expect(page.getByText(financialData.incomeSources[0].name)).toBeVisible();
          await expect(
            page.getByRole("button", {
              name: viewport.width < 768
                ? `Actions for ${financialData.incomeSources[0].name}`
                : `Edit ${financialData.incomeSources[0].name}`,
            }),
          ).toBeVisible();
        } else if (pageInfo.name === "Dashboard") {
          await expectDashboardSummaryCardSpacing(page, viewport.width);
          await expectFinancialHealthCardSpacing(page, viewport.width);
          const investCard = page.getByTestId("dashboard-available-to-invest-card");
          await expect(investCard).toHaveClass(/bg-positive-background/);
          await expect(investCard).toHaveClass(/border-positive/);
          await expect(investCard.getByText("Available to Invest")).toHaveClass(/text-positive/);
          await expect(investCard.getByText("Monthly Surplus")).toHaveClass(/text-positive/);
          await expect(investCard).toHaveScreenshot(`light-theme-dashboard-invest-card-${viewport.width}.png`, {
            animations: "disabled",
            caret: "hide",
            maxDiffPixelRatio: 0.01,
          });
        } else if (pageInfo.name === "Financial Health") {
          await expectFinancialHealthMetricSpacing(page, viewport.width);
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
          await expect(
            page.getByRole("button", {
              name: viewport.width < 640
                ? `More actions for ${financialData.investments[0].name}`
                : `Edit ${financialData.investments[0].name}`,
            }),
          ).toBeVisible();
        } else if (pageInfo.name === "Loans") {
          await expect(page.getByText(financialData.loans[0].name)).toBeVisible();
          await expect(
            page.getByRole("button", {
              name: viewport.width < 768
                ? `Actions for ${financialData.loans[0].name}`
                : `Edit ${financialData.loans[0].name} loan`,
            }),
          ).toBeVisible();
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

  test("switches navigation placement without covering the investment heading", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("ezyretire-theme", JSON.stringify("dark"));
    });
    await page.setViewportSize({ width: 1279, height: 800 });
    await page.goto("/investments");
    await page.locator(":root").evaluate((root) => {
      const element = root as HTMLElement;
      element.style.setProperty("--safe-area-inset-left", "11px");
      element.style.setProperty("--safe-area-inset-right", "13px");
      element.style.setProperty("--safe-area-inset-bottom", "17px");
    });

    const mobileTitle = page.getByTestId("mobile-page-title");
    const contentHeading = page.getByRole("heading", { name: "Investment Portfolio" });
    const bottomNavigation = page.getByTestId("mobile-bottom-navigation");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(mobileTitle).toBeVisible();
    await expect(contentHeading).toBeVisible();
    await expect(bottomNavigation).toBeVisible();
    await expect(bottomNavigation).toHaveCSS("padding-left", "15px");
    await expect(bottomNavigation).toHaveCSS("padding-right", "17px");
    await expect(bottomNavigation).toHaveCSS("padding-bottom", "17px");
    await expect(page.getByTestId("desktop-sidebar")).toBeHidden();
    await expect(page.getByTestId("desktop-sidebar-logo")).toBeHidden();

    const [titleBox, headingBox] = await Promise.all([
      mobileTitle.boundingBox(),
      contentHeading.boundingBox(),
    ]);
    expect(titleBox).not.toBeNull();
    expect(headingBox).not.toBeNull();
    expect(titleBox!.x).toBeGreaterThanOrEqual(0);
    expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(1279);
    expect(headingBox!.width).toBe(1);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByTestId("mobile-header")).toBeHidden();
    await expect(bottomNavigation).toBeHidden();
    await expect(page.getByTestId("desktop-sidebar")).toBeVisible();
    const desktopLogo = page
      .getByTestId("desktop-sidebar-logo")
      .locator('img[alt="ezyRetire"]:visible');
    await expect(desktopLogo).toBeVisible();
    await expect(contentHeading).toBeVisible();
    const [narrowDesktopLogoBox, narrowDesktopHeadingBox] = await Promise.all([
      desktopLogo.boundingBox(),
      contentHeading.boundingBox(),
    ]);
    expect(narrowDesktopLogoBox).not.toBeNull();
    expect(narrowDesktopHeadingBox).not.toBeNull();
    expect(narrowDesktopLogoBox!.width).toBeLessThanOrEqual(80);
    expect(
      narrowDesktopLogoBox!.x + narrowDesktopLogoBox!.width,
      "compact logo must finish before the investment heading starts",
    ).toBeLessThanOrEqual(narrowDesktopHeadingBox!.x);

    await page.setViewportSize({ width: 1440, height: 800 });
    const [wideDesktopLogoBox, wideDesktopHeadingBox] = await Promise.all([
      desktopLogo.boundingBox(),
      contentHeading.boundingBox(),
    ]);
    expect(wideDesktopLogoBox).not.toBeNull();
    expect(wideDesktopHeadingBox).not.toBeNull();
    expect(wideDesktopLogoBox!.height).toBe(36);
    expect(wideDesktopLogoBox!.x + wideDesktopLogoBox!.width).toBeLessThanOrEqual(
      wideDesktopHeadingBox!.x,
    );
  });

  for (const viewport of desktopViewports) {
    for (const pageInfo of pages) {
      test(`${pageInfo.name} preserves the ${viewport.name} layout`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
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
        } else if (pageInfo.name === "Income") {
          await expectIncomeSummaryCardSpacing(page, viewport.width);
        } else if (pageInfo.name === "Dashboard") {
          await expectDashboardSummaryCardSpacing(page, viewport.width);
          await expectFinancialHealthCardSpacing(page, viewport.width);
          const investCard = page.getByTestId("dashboard-available-to-invest-card");
          await expect(investCard).toHaveClass(/bg-positive-background/);
          await expect(investCard).toHaveClass(/border-positive/);
          await expect(investCard.getByText("Available to Invest")).toHaveClass(/text-positive/);
          await expect(investCard.getByText("Put this surplus to work")).toHaveClass(/text-positive/);
          await expect(investCard).toHaveScreenshot(`light-theme-dashboard-invest-card-${viewport.width}.png`, {
            animations: "disabled",
            caret: "hide",
            maxDiffPixelRatio: 0.01,
          });
        } else if (pageInfo.name === "Financial Health") {
          await expectFinancialHealthMetricSpacing(page, viewport.width);
        }
      });
    }
  }

  test("bottom navigation remains active at the former large breakpoint", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");

    await expectUsableBottomNavigation(page, 8);
    await expect(page.getByTestId("link-desktop-nav-dashboard")).toBeHidden();
    await expectNoHorizontalOverflow(page);
  });

  test("planner tabs respond to clicks and direct links", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/planner");

    const calendarTab = page.getByTestId("tab-planner-calendar");
    const notificationsTab = page.getByTestId("tab-planner-notifications");
    const reportsTab = page.getByTestId("tab-planner-reports");

    await expect(calendarTab).toHaveAttribute("data-state", "active");
    await expect(page.getByTestId("panel-planner-calendar")).toBeVisible();

    await notificationsTab.click();
    await expect(page).toHaveURL(/\/planner\?tab=notifications$/);
    await expect(notificationsTab).toHaveAttribute("data-state", "active");
    await expect(page.getByTestId("panel-planner-notifications")).toBeVisible();
    await expect(page.getByTestId("panel-planner-calendar")).toBeHidden();

    await reportsTab.click();
    await expect(page).toHaveURL(/\/planner\?tab=reports$/);
    await expect(reportsTab).toHaveAttribute("data-state", "active");
    await expect(page.getByTestId("panel-planner-reports")).toBeVisible();
    await expect(page.getByTestId("panel-planner-notifications")).toBeHidden();

    await calendarTab.click();
    await expect(page).toHaveURL(/\/planner\?tab=calendar$/);
    await expect(calendarTab).toHaveAttribute("data-state", "active");
    await expect(page.getByTestId("panel-planner-calendar")).toBeVisible();

    await page.goto("/planner?tab=notifications");
    await expect(notificationsTab).toHaveAttribute("data-state", "active");
    await expect(page.getByTestId("panel-planner-notifications")).toBeVisible();
  });

  test("reminder date and amount stack on short phones while actions stay reachable", async ({ page }) => {
    for (const viewport of [
      { name: "short phone", width: 320, height: 480 },
      { name: "desktop", width: 1440, height: 1000 },
    ] as const) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/planner");
      await page.getByRole("button", { name: "Add Reminder" }).click();

      const dialog = page.getByRole("dialog", { name: "Add Reminder" });
      const date = dialog.getByLabel("Date");
      const amount = dialog.getByLabel("Amount (Optional)");
      await expect(dialog).toBeVisible();
      await expect(date).toBeVisible();
      await expect(amount).toBeVisible();

      const [dateBox, amountBox] = await Promise.all([date.boundingBox(), amount.boundingBox()]);
      expect(dateBox).not.toBeNull();
      expect(amountBox).not.toBeNull();
      if (viewport.width < 640) {
        expect(
          amountBox!.y,
          `${viewport.name} amount must follow the date instead of crowding it`,
        ).toBeGreaterThanOrEqual(dateBox!.y + dateBox!.height - 1);
      } else {
        expect(
          Math.abs(amountBox!.y - dateBox!.y),
          `${viewport.name} date and amount fields should remain side by side`,
        ).toBeLessThanOrEqual(1);
      }

      const openCalendar = date.locator("xpath=..").getByRole("button", { name: "Open calendar" });
      await openCalendar.click();
      const today = page.getByRole("button", { name: "Today", exact: true });
      await expect(today).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(today).toHaveCount(0);
      await expect(dialog).toBeVisible();

      await openCalendar.click();
      await today.click();
      await expect(date).toHaveValue(/^\d{2}\/\d{2}\/\d{4}$/);

      for (const action of [
        dialog.getByRole("button", { name: "Cancel", exact: true }),
        dialog.getByRole("button", { name: "Save", exact: true }),
      ]) {
        await action.scrollIntoViewIfNeeded();
        await expect(action).toBeVisible();
        const actionBox = await action.boundingBox();
        expect(actionBox).not.toBeNull();
        expect(actionBox!.y).toBeGreaterThanOrEqual(-1);
        expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(viewport.height + 1);
      }

      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }
  });

  test("desktop navigation controls stay aligned and meet target sizing", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");

    const sidebar = page.getByTestId("desktop-sidebar");
    const links = sidebar.locator('[data-testid^="link-desktop-nav-"]:visible');
    await expect(sidebar).toBeVisible();
    await expect(links).toHaveCount(desktopNavigationItemCount);

    const geometry = await links.evaluateAll((items) =>
      items.map((item) => {
        const rect = item.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
      }),
    );
    const sidebarBox = await sidebar.boundingBox();
    expect(sidebarBox).not.toBeNull();
    for (const [index, item] of geometry.entries()) {
      expect(item.width, `desktop navigation item ${index + 1} must be wide enough to activate`).toBeGreaterThanOrEqual(44);
      expect(item.height, `desktop navigation item ${index + 1} must be tall enough to activate`).toBeGreaterThanOrEqual(44);
      expect(item.left).toBeGreaterThanOrEqual(sidebarBox!.x);
      expect(item.right).toBeLessThanOrEqual(sidebarBox!.x + sidebarBox!.width);
      if (index > 0) {
        expect(item.top, `desktop navigation item ${index + 1} must not overlap its previous item`).toBeGreaterThanOrEqual(
          geometry[index - 1].bottom - 1,
        );
      }
    }
  });

  test("desktop sidebar expands over content while its branding and layout anchor stay fixed", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");

    const sidebar = page.getByTestId("desktop-sidebar");
    const sidebarPanel = page.getByTestId("desktop-sidebar-panel");
    const logo = page.getByTestId("desktop-sidebar-logo");
    const dashboardLink = page.getByTestId("link-desktop-nav-dashboard");
    const expensesLink = page.getByTestId("link-desktop-nav-expenses");
    const dashboardLabel = dashboardLink.getByText("Dashboard");
    const pageContent = page.getByTestId("page-content");
    const readGeometry = async () => ({
      sidebar: await sidebar.boundingBox(),
      logo: await logo.boundingBox(),
      dashboard: await dashboardLink.boundingBox(),
      content: await pageContent.boundingBox().then((box) => box && ({ x: box.x, width: box.width })),
    });

    await expect(sidebar).toBeVisible();
    await expect(logo).toBeVisible();
    const initial = await readGeometry();
    expect(initial.sidebar?.width).toBe(80);
    expect(initial.logo?.height).toBeGreaterThan(0);
    expect(initial.logo?.height).toBeLessThanOrEqual(40);
    await expect(sidebarPanel).toHaveCSS("width", "80px");
    await expect(dashboardLabel).toHaveCSS("opacity", "0");

    await dashboardLink.hover();
    await expect(sidebarPanel).toHaveCSS("width", "240px");
    await expect(dashboardLabel).toHaveCSS("opacity", "1");
    const expanded = await readGeometry();
    expect(expanded.sidebar).toEqual(initial.sidebar);
    expect(expanded.logo).toEqual(initial.logo);
    expect(expanded.content).toEqual(initial.content);

    await expensesLink.click();
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(expensesLink).toBeVisible();
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
    await pageContent.hover();
    await expect(sidebarPanel).toHaveCSS("width", "80px");
    const afterNavigation = await readGeometry();
    expect(afterNavigation.sidebar).toEqual(initial.sidebar);
    expect(afterNavigation.logo).toEqual(initial.logo);
    expect(afterNavigation.content).toEqual(initial.content);
  });

  for (const viewport of [
    { name: "narrow portrait", width: 360, height: 640 },
    { name: "short landscape", width: 667, height: 375 },
  ] as const) {
    test(`mobile More menu stays reachable in ${viewport.name} geometry`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Your retirement outlook" })).toBeVisible();

      const trigger = page.getByTestId("button-mobile-nav-more");
      await expect(trigger).toBeVisible();
      const triggerBox = await trigger.boundingBox();
      expect(triggerBox).not.toBeNull();
      expect(triggerBox!.width).toBeGreaterThanOrEqual(44);
      expect(triggerBox!.height).toBeGreaterThanOrEqual(44);
      await trigger.click();

      const menu = page.getByTestId("mobile-more-menu");
      await expect(menu).toBeVisible();
      const menuBox = await menu.boundingBox();
      expect(menuBox).not.toBeNull();
      expect(menuBox!.x).toBeGreaterThanOrEqual(0);
      expect(menuBox!.y).toBeGreaterThanOrEqual(0);
      expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport.width);
      expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport.height);

      const items = menu.locator('a[href]:visible');
      expect(await items.count()).toBeGreaterThan(0);
      const itemHeights = await items.evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().height),
      );
      for (const [index, height] of itemHeights.entries()) {
        expect(height, `More menu item ${index + 1} must be tall enough to tap`).toBeGreaterThanOrEqual(44);
      }

      const lastItem = items.last();
      await lastItem.scrollIntoViewIfNeeded();
      await expect(lastItem).toBeInViewport();
    });
  }

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

test.describe("financial data recovery", () => {
  test("shows a retryable account error instead of onboarding or an empty dashboard", async ({ page }) => {
    let attempts = 0;
    let allowSuccess = false;
    await page.route("**/api/auth/user", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: testUser }) }),
    );
    await page.route("**/api/financial-data", (route) => {
      attempts += 1;
      return allowSuccess
        ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(financialData) })
        : route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Unavailable" }) });
    });

    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "We couldn't open your account" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Your retirement outlook")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /onboarding/i })).toHaveCount(0);

    allowSuccess = true;
    await page.getByRole("button", { name: "Try again" }).click();

    await expect(page.getByRole("heading", { name: "Your retirement outlook" })).toBeVisible();
    expect(attempts).toBeGreaterThanOrEqual(2);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("account profile and settings behavior", () => {
  test.beforeEach(async ({ page }) => {
    await mockCustomerSession(page);
  });

  test("saves a merged Profile edit and preserves the form after a failed save", async ({ page }) => {
    let savedDocument: typeof financialData | undefined;
    let failNextSave = false;
    await page.route("**/api/financial-data", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(financialData) });
        return;
      }
      if (failNextSave) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Unavailable" }) });
        return;
      }
      savedDocument = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(savedDocument) });
    });

    await page.goto("/profile?section=personal");
    await page.getByTestId("input-personal-fullname").fill("Updated Account Name");
    await page.getByTestId("button-save-personal").click();
    await expect(page.getByText("Changes saved", { exact: true })).toBeVisible();
    expect(savedDocument?.profileInputs.fullName).toBe("Updated Account Name");
    expect(savedDocument?.profileInputs.riskPreference).toBe(financialData.profileInputs.riskPreference);

    failNextSave = true;
    await page.goto("/profile?section=personal");
    await page.getByTestId("input-personal-fullname").fill("Save must fail");
    await page.getByTestId("button-save-personal").click();
    await expect(page.getByText("Could not save your profile. Please try again.")).toBeVisible();
    await expect(page.getByTestId("input-personal-fullname")).toBeEditable();
    await expect(page.getByTestId("input-personal-fullname")).toHaveValue("Save must fail");
  });

  test("account hub section destinations open the requested profile and settings surface", async ({ page }) => {
    const destinations = [
      { hub: "/profile", link: /Personal details/i, path: "/profile?section=personal", heading: /Personal details/i },
      { hub: "/profile", link: /Contact info/i, path: "/profile?section=contact", heading: /Contact (info|information)/i },
      { hub: "/profile", link: /Retirement preferences/i, path: "/profile?section=retirement", heading: /Retirement (preferences|settings)/i },
      { hub: "/settings", link: /^Appearance$/, path: "/settings?section=appearance", heading: /Appearance/i },
      { hub: "/settings", link: /Security & access/i, path: "/settings?section=security", heading: /Security( & access)?/i },
      { hub: "/settings", link: /Data & privacy/i, path: "/settings?section=data", heading: /Data & privacy/i },
    ] as const;

    for (const destination of destinations) {
      await page.goto(destination.hub);
      await expect(page.getByRole("link", { name: destination.link })).toBeVisible();
      await page.getByRole("link", { name: destination.link }).click();
      await expect(page).toHaveURL(new RegExp(`${destination.path.replace("?", "\\?")}$`));
      await expect(page.getByRole("heading", { name: destination.heading })).toBeVisible();
    }

    await page.goto("/profile");
    await expect(page.getByTestId("text-profile-display-name")).toBeVisible();
  });

  test("a dirty profile edit guards browser back until the edit is cancelled", async ({ page }) => {
    await page.goto("/transactions");
    await page.goto("/profile?section=personal");
    await page.getByTestId("input-personal-fullname").fill("Unsaved identity");

    const beforeBack = page.url();
    const dismissNativeDialog = async (dialog: Dialog) => {
      await dialog.dismiss();
    };
    page.on("dialog", dismissNativeDialog);
    await page.goBack().catch(() => undefined);
    page.off("dialog", dismissNativeDialog);

    const discardDialog = page.getByRole("alertdialog").filter({ hasText: /unsaved|discard|leave/i }).first();
    if (await discardDialog.count()) {
      await discardDialog.getByRole("button", { name: /stay|cancel|keep editing/i }).click();
    }
    await expect(page).toHaveURL(beforeBack);
    await expect(page.getByTestId("input-personal-fullname")).toHaveValue("Unsaved identity");
  });

  test("Settings detail Back replaces the exited surface including direct entry", async ({ page }) => {
    for (const section of ["appearance", "security", "data"]) {
      await page.goto("/profile");
      await page.goto("/settings");
      await page.locator(`a[href="/settings?section=${section}"]`).click();
      await expect(page).toHaveURL(new RegExp(`section=${section}$`));
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(page).toHaveURL(/\/settings$/);
      await page.goBack();
      await expect(page).toHaveURL(/\/settings$/);
      await expect(page.locator(`a[href="/settings?section=${section}"]`)).toBeVisible();

      await page.goto(`/settings?section=${section}`);
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(page).toHaveURL(/\/settings$/);
      await expect(page.getByRole("link", { name: "Back to Profile" })).toBeVisible();
    }
  });

  test("accepted cancel and save exits do not reopen an editor on browser Back", async ({ page }) => {
    await page.route("**/api/financial-data", async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(financialData),
        });
        return;
      }
      await route.fallback();
    });

    for (const exit of ["cancel", "save"] as const) {
      await page.goto("/transactions");
      await page.goto("/profile");
      await page.getByRole("link", { name: /Personal details/i }).click();
      await page.getByTestId("input-personal-fullname").fill(`Exited with ${exit}`);

      if (exit === "cancel") {
        page.once("dialog", (dialog) => dialog.accept());
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
      } else {
        await page.getByTestId("button-save-personal").click();
        await expect(page.getByText("Changes saved", { exact: true })).toBeVisible();
      }

      await expect(page).toHaveURL(/\/profile$/);
      await expect(page.getByTestId("input-personal-fullname")).toHaveCount(0);
      await page.goBack();
      await expect(page).toHaveURL(/\/profile$/);
      await expect(page.getByTestId("input-personal-fullname")).toHaveCount(0);
      await page.goBack();
      await expect(page).toHaveURL(/\/transactions$/);
    }
  });

  test("saves contact and retirement edits while keeping failed edits open", async ({ page }) => {
    let shouldFail = false;
    let savedDocument: typeof financialData | undefined;
    await page.route("**/api/financial-data", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(savedDocument ?? financialData) });
        return;
      }
      if (shouldFail) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Unavailable" }) });
        return;
      }
      savedDocument = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(savedDocument) });
    });

    await page.goto("/profile?section=contact");
    await page.getByTestId("input-contact-phone").fill("+919999999998");
    await page.getByTestId("button-save-contact").click();
    await expect(page.getByText("Changes saved", { exact: true })).toBeVisible();
    expect(savedDocument?.profileInputs.phone).toBe("+919999999998");

    await page.goto("/profile?section=retirement");
    await page.getByTestId("input-target-retirement-age").fill("62");
    await page.getByTestId("button-save-retirement").click();
    await expect(page.getByText("Changes saved", { exact: true })).toBeVisible();
    expect(savedDocument?.profileInputs.targetRetirementAge).toBe(62);

    shouldFail = true;
    await page.goto("/profile?section=retirement");
    await page.getByTestId("input-target-retirement-age").fill("64");
    await page.getByTestId("button-save-retirement").click();
    await expect(page.getByText("Could not save your profile. Please try again.")).toBeVisible();
    await expect(page.getByTestId("input-target-retirement-age")).toBeEditable();
    await expect(page.getByTestId("input-target-retirement-age")).toHaveValue("64");
  });

  test("quick theme choices keep explicit preference and resolved System theme synchronized", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(() => localStorage.setItem("ezyretire-theme", JSON.stringify("system")));
    await page.goto("/settings?section=appearance");

    const system = page.getByRole("radio", { name: "System" });
    const light = page.getByRole("radio", { name: "Light" });
    const dark = page.getByRole("radio", { name: "Dark" });
    await expect(system).toBeChecked();
    await expect(page.locator("html")).toHaveClass(/dark/);

    await page.getByTestId("radio-theme-light").click();
    await expect(light).toBeChecked();
    await expect(page.locator("html")).toHaveClass(/light/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("ezyretire-theme"))).toBe('"light"');

    await page.getByTestId("radio-theme-system").click();
    await expect(system).toBeChecked();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("ezyretire-theme"))).toBe('"system"');

    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveClass(/light/);
    await page.getByTestId("radio-theme-dark").click();
    await expect(dark).toBeChecked();
    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("account hub links expose notifications, About, admin, passkeys, data export, and the unchanged PIN destination", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.getByTestId("link-manage-notifications")).toHaveAttribute("href", "/planner?tab=notifications");
    await page.getByTestId("link-manage-notifications").click();
    await expect(page).toHaveURL(/\/planner\?tab=notifications$/);
    await expect(page.getByTestId("panel-planner-notifications")).toBeVisible();

    await page.goto("/profile");
    await page.getByRole("link", { name: /Help & about/i }).click();
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.getByRole("heading", { name: /scattered financial details/i })).toBeVisible();

    await page.goto("/profile");
    await expect(page.getByRole("link", { name: /Admin panel/i })).toHaveCount(0);

    await page.route("**/api/auth/user", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ user: { ...testUser, isAdmin: true } }),
      }),
    );
    await page.goto("/profile");
    await page.reload();
    await expect(page.getByRole("link", { name: /Admin panel/i })).toHaveAttribute("href", "/admin");
    await page.getByRole("link", { name: /Admin panel/i }).click();
    await expect(page).toHaveURL(/\/admin$/);

    await page.goto("/settings?section=security");
    await expect(page).toHaveURL(/\/settings\?section=security$/);
    await expect(page.getByTestId("link-change-pin")).toHaveAttribute(
      "href",
      "/login?changePin=true&returnTo=%2Fsettings",
    );
    await page.goto("/settings?section=security");
    await expect(page.getByTestId("button-add-passkey")).toBeVisible();
    await page.goto("/settings?section=data");
    await expect(page.getByTestId("link-export-personal-data")).toBeVisible();
    await expect(page.getByTestId("link-export-personal-data")).toHaveAttribute("href", "/api/account/export");
    await expect(page.getByTestId("link-export-personal-data")).toHaveAttribute("download", "");

    await page.goto("/settings?section=data");
    await expect(page.getByTestId("button-open-account-deletion")).toBeVisible();
  });

  test("signing out from the current session returns to login without disrupting remembered PIN UX", async ({ page }) => {
    await page.addInitScript((rememberedAccount) => {
      localStorage.setItem("ezyretire:remembered-account:v1", JSON.stringify({
        email: rememberedAccount.email,
        fullName: rememberedAccount.fullName,
      }));
    }, { email: testUser.email, fullName: testUser.fullName });
    let signedOut = false;
    await page.route("**/api/auth/user", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ user: signedOut ? null : testUser }),
      }),
    );
    await page.route("**/api/logout?**", async (route) => {
      signedOut = true;
      await route.fulfill({ status: 302, headers: { location: "/" } });
    });

    await page.goto("/profile");
    await page.getByRole("button", { name: /Sign out/i }).click();
    await expect.poll(() => signedOut).toBe(true);
    await expect(page.getByRole("heading", { name: `Hi, ${testUser.fullName}` })).toBeVisible();
    await expect(page.getByRole("group", { name: "0 of 4 PIN digits entered" })).toBeVisible();
  });

  test("schedules deletion from Settings, clears remembered identity, and shows recovery sign-in", async ({ page }) => {
    let signedIn = true;
    let deletionRequest: unknown;
    let deletionStatus = "none";
    await page.route("**/api/auth/user", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ user: signedIn ? testUser : null }),
      }),
    );
    await page.route("**/api/account/deletion", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          status: deletionStatus,
          scheduledFor: deletionStatus === "cooling_off" ? "2026-09-17T00:00:00.000Z" : null,
        }) });
        return;
      }
      deletionRequest = route.request().postDataJSON();
      deletionStatus = "cooling_off";
      signedIn = false;
      await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ status: "cooling_off" }) });
    });
    await page.addInitScript(() => {
      localStorage.setItem("ezyretire:remembered-account:v1", JSON.stringify({
        email: "responsive@example.com",
        fullName: "Responsive Layout",
      }));
    });

    await page.goto("/settings?section=data");
    await page.getByTestId("button-open-account-deletion").click();
    await page.getByTestId("input-delete-account-email").fill(testUser.email);
    await page.getByTestId("input-delete-account-confirmation").fill("DELETE MY ACCOUNT");
    await page.getByTestId("button-confirm-account-deletion").click();

    await expect(page).toHaveURL(/\/login\?accountDeletion=scheduled&returnTo=%2Fsettings$/);
    expect(deletionRequest).toEqual({
      email: testUser.email,
      confirmation: "DELETE MY ACCOUNT",
    });
    await expect(page.getByText(/Deletion is scheduled/)).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("ezyretire:remembered-account:v1"))).toBeNull();

  });

  test("keeps a cooling-off deletion cancellable from the data destination", async ({ page }) => {
    let deletionStatus: "cooling_off" | "none" = "cooling_off";
    let cancellationRequested = false;
    await page.route("**/api/account/deletion", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: deletionStatus,
            scheduledFor: deletionStatus === "cooling_off" ? "2026-09-17T00:00:00.000Z" : null,
          }),
        });
        return;
      }
      cancellationRequested = route.request().method() === "DELETE";
      deletionStatus = "none";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "none" }),
      });
    });

    await page.goto("/settings?section=data");
    await expect(page.getByTestId("button-cancel-account-deletion")).toBeVisible();
    await page.getByTestId("button-cancel-account-deletion").click();
    await expect.poll(() => cancellationRequested).toBe(true);
    await expect(page.getByTestId("button-open-account-deletion")).toBeVisible();
  });
});

test.describe("mobile header and route scroll behavior", () => {
  test.beforeEach(async ({ page }) => {
    await mockCustomerSession(page);
  });

  test("hides the mobile header while scrolling down and reveals it while scrolling up", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    for (const path of ["/profile", "/retirement"]) {
      await page.goto(path);

      const header = page.getByTestId("mobile-header");
    const scrollContainer = page.getByTestId("page-scroll-container");
      if (path === "/profile") {
        await expect(page.getByRole("button", { name: /Sign out/i })).toBeAttached();
      } else {
        await expect(page.getByLabel(/Retirement projection chart/)).toBeAttached();
      }
      await page.getByTestId("page-content").evaluate((element) => {
        element.style.minHeight = "2400px";
      });

      await expect(header).toHaveAttribute("data-scroll-state", "visible");
      await scrollContainer.hover({ position: { x: 180, y: 300 } });
      await page.mouse.wheel(0, 500);
      await expect.poll(() => scrollContainer.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
      await expect(header).toHaveAttribute("data-scroll-state", "hidden");
      await expect.poll(() => header.evaluate((element) => element.getBoundingClientRect().height)).toBe(0);

      await page.mouse.wheel(0, -150);
      await expect(header).toHaveAttribute("data-scroll-state", "visible");
      await expect.poll(() => header.evaluate((element) => Math.round(element.getBoundingClientRect().height))).toBe(56);
    }
  });

  test("resets the page scroll position after mobile navigation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/profile");

    const scrollContainer = page.getByTestId("page-scroll-container");
    await expect(page.getByTestId("text-profile-display-name")).toBeVisible();

    await page.getByTestId("page-content").evaluate((element) => {
      element.style.minHeight = "2400px";
    });

    await scrollContainer.evaluate((element) => element.scrollTo({ top: 600 }));
    await expect(page.getByTestId("mobile-header")).toHaveAttribute("data-scroll-state", "hidden");
    await page.locator('[data-testid="mobile-bottom-navigation"] a[href="/investments"]').click();

    await expect(page).toHaveURL(/\/investments$/);
    await expect(page.getByRole("heading", { name: "Investment Portfolio", exact: false })).toBeVisible();
    await expect.poll(() => scrollContainer.evaluate((element) => element.scrollTop)).toBe(0);
    await expect(page.getByTestId("mobile-header")).toHaveAttribute("data-scroll-state", "visible");
  });

  test("moves stable page titles into the mobile navbar without repeating the app logo", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/profile");

    const mobileTitle = page.getByTestId("mobile-page-title");
    const profileHeading = page.getByTestId("text-profile-display-name");

    await expect(mobileTitle).toHaveText("Profile");
    await expect(page.getByTestId("mobile-page-icon")).toHaveCount(0);
    await expect(profileHeading).toBeVisible();

    await page.locator('[data-testid="mobile-bottom-navigation"] a[href="/investments"]').click();
    await expect(page).toHaveURL(/\/investments$/);
    await expect(mobileTitle).toHaveText("Investments");
    await expect(page.getByTestId("mobile-page-icon")).toHaveCount(0);
  });

  test("keeps account appearance and notification settings compact and functional", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/profile");
    await page.evaluate(() => localStorage.setItem("ezyretire-theme", JSON.stringify("light")));
    await page.reload();

    const darkModeSwitch = page.getByRole("switch", { name: "Dark mode" });
    await expect(darkModeSwitch).toBeVisible();
    await expect(darkModeSwitch).toHaveAttribute("aria-checked", "false");
    await darkModeSwitch.click();
    await expect(darkModeSwitch).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("html")).toHaveClass(/dark/);

    await page.goto("/profile");
    const notificationsLink = page.getByRole("link", { name: /Notifications/i });
    await expect(notificationsLink).toBeVisible();
    await expect(notificationsLink).toHaveAttribute("href", "/planner?tab=notifications");
  });

  test("keeps account security and data controls independently accessible", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/settings?section=security");

    await expect(page.getByTestId("button-add-passkey")).toBeVisible();

    await page.goto("/settings?section=data");
    await expect(page.getByTestId("link-export-personal-data")).toBeVisible();
    await expect(page.getByText("It cannot currently be restored into ezyRetire.")).toBeVisible();
  });

  test("keeps the desktop sidebar visible while the page scrolls", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/transactions");

    const sidebar = page.getByTestId("desktop-sidebar");
    const logo = page.getByTestId("desktop-sidebar-logo");
    const desktopDashboardLink = page.getByTestId("link-desktop-nav-dashboard");
    await expect(desktopDashboardLink).toBeVisible();
    await expect(page.getByTestId("mobile-header")).toBeHidden();
    const initialSidebarBox = await sidebar.boundingBox();
    const initialLogoBox = await logo.boundingBox();

    await page.getByTestId("page-content").evaluate((element) => {
      element.style.minHeight = "2400px";
    });
    await page.getByTestId("page-scroll-container").evaluate((element) => element.scrollTo({ top: 600 }));

    await expect(desktopDashboardLink).toBeVisible();
    await expect(page.getByTestId("mobile-header")).toBeHidden();
    expect(await sidebar.boundingBox()).toEqual(initialSidebarBox);
    expect(await logo.boundingBox()).toEqual(initialLogoBox);
  });
});

async function expectTrajectoryChartGeometry(
  page: Page,
  viewportWidth: number,
  chartView: "corpus" | "lifestyle",
  assertTextBounds = true,
) {
  const chartCard = page.getByTestId("retirement-projection-chart");
  const svg = chartCard.locator("svg.recharts-surface");
  await expect(svg).toBeVisible();

  const geometry = await Promise.all([
    chartCard.boundingBox(),
    svg.boundingBox(),
    svg.evaluate((element) => {
      const svgRect = element.getBoundingClientRect();
      const text = Array.from(element.querySelectorAll<SVGTextElement>("text"))
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            value: node.textContent?.trim() ?? "",
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          };
        })
        .filter((item) => item.width > 0 && item.height > 0);
      const xTicks = Array.from(
        element.querySelectorAll<SVGTextElement>(".recharts-xAxis .recharts-cartesian-axis-tick text"),
      )
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            value: node.textContent?.trim() ?? "",
            left: rect.left,
            right: rect.right,
          };
        })
        .filter((item) => item.right > item.left);
      const plotWidth = Math.max(
        0,
        ...Array.from(element.querySelectorAll<SVGLineElement>(".recharts-cartesian-grid-horizontal line"))
          .map((line) => line.getBoundingClientRect().width),
      );
      return {
        svg: {
          left: svgRect.left,
          right: svgRect.right,
          top: svgRect.top,
          bottom: svgRect.bottom,
          width: svgRect.width,
        },
        plotWidth,
        text,
        xTicks,
      };
    }),
  ]);
  const [cardBox, svgBox, content] = geometry;

  expect(cardBox).not.toBeNull();
  expect(svgBox).not.toBeNull();
  expect(content.text.length, "trajectory SVG must expose chart labels").toBeGreaterThan(0);
  if (viewportWidth < 768) {
    expect(
      content.plotWidth,
      "the actual trajectory plot must use at least 80% of the mobile card width",
    ).toBeGreaterThanOrEqual(cardBox!.width * 0.8 - 2);
  } else {
    expect(
      Math.abs(content.svg.width - content.plotWidth - 80),
      "desktop trajectory plot must retain the current 80px total horizontal gutters",
    ).toBeLessThanOrEqual(2);
  }

  if (assertTextBounds) {
    for (const item of content.text) {
      expect(item.left, `SVG text "${item.value}" must not clip on the left`).toBeGreaterThanOrEqual(content.svg.left - 2);
      expect(item.right, `SVG text "${item.value}" must not clip on the right`).toBeLessThanOrEqual(content.svg.right + 2);
      expect(item.top, `SVG text "${item.value}" must not clip at the top`).toBeGreaterThanOrEqual(content.svg.top - 2);
      expect(item.bottom, `SVG text "${item.value}" must not clip at the bottom`).toBeLessThanOrEqual(content.svg.bottom + 2);
    }
  }

  const tickValues = content.xTicks.map((tick) => Number(tick.value));
  expect(content.xTicks.length, "trajectory chart must retain endpoint age ticks").toBeGreaterThanOrEqual(2);
  if (viewportWidth < 768) {
    expect(content.xTicks.length, "mobile age ticks must stay sparse").toBeLessThanOrEqual(4);
  }
  expect(tickValues.every((value) => Number.isFinite(value)), "age ticks must be numeric").toBe(true);
  expect(tickValues[0], "first age tick must precede the final age tick").toBeLessThan(tickValues.at(-1)!);
  expect(tickValues.at(-1), "the final age tick must reach the end of the projection").toBeGreaterThanOrEqual(84);
  expect(tickValues.at(-1), "the final age tick must not exceed life expectancy").toBeLessThanOrEqual(85);
  for (const [index, tick] of content.xTicks.entries()) {
    if (index === 0) continue;
    expect(
      tick.left,
      `age tick ${index + 1} must not overlap the preceding endpoint tick`,
    ).toBeGreaterThanOrEqual(content.xTicks[index - 1].right - 1);
  }

  const chartText = content.text.map((item) => item.value);
  expect(chartText).toContain("Retirement");
  if (chartView === "corpus") {
    expect(chartText).toContain("Required");
  }
}
async function expectDashboardSummaryCardSpacing(page: Page, viewportWidth: number) {
  const geometry = await Promise.all(
    dashboardSummaryHeadings.map(async (heading) => {
      const headingElement = page.getByTestId("page-content").getByText(heading, { exact: true });
      await expect(headingElement).toBeVisible();
      return headingElement.evaluate((element) => {
        const card = element.closest("a")?.firstElementChild;
        const content = Array.from(element.closest("a")?.querySelectorAll<HTMLElement>("div") ?? [])
          .find((candidate) => candidate.classList.contains("lg:pt-7"));
        if (!card || !content) throw new Error(`Summary heading "${element.textContent}" must be inside summary card content`);
        const headingRect = element.getBoundingClientRect();
        return {
          heading: element.textContent,
          topInset: headingRect.top - content.getBoundingClientRect().top,
          cardTop: card.getBoundingClientRect().top,
          headingTop: headingRect.top,
        };
      });
    }),
  );

  for (const [index, item] of geometry.entries()) {
    const expectedTopInset = viewportWidth >= 1024 ? 28 : viewportWidth >= 768 ? 20 : index < 4 ? 16 : 12;
    expect(
      Math.abs(item.topInset - expectedTopInset),
      `${item.heading} must keep the expected top inset of ${expectedTopInset}px; received ${item.topInset}px`,
    ).toBeLessThanOrEqual(1);
  }

  const rows = geometry.reduce((groups, item) => {
    const row = Math.round(item.cardTop);
    groups.set(row, [...(groups.get(row) ?? []), item]);
    return groups;
  }, new Map<number, typeof geometry>());
  for (const row of rows.values()) {
    const headingTops = row.map((item) => item.headingTop);
    expect(
      Math.max(...headingTops) - Math.min(...headingTops),
      "dashboard summary headings in the same row must stay aligned",
    ).toBeLessThanOrEqual(1);
  }
}

async function expectFinancialHealthCardSpacing(page: Page, viewportWidth: number) {
  const expectedTopInset = viewportWidth >= 1024 ? 28 : viewportWidth >= 768 ? 20 : 16;
  const summaryContent = page.getByTestId("dashboard-financial-health-content");
  await expect(summaryContent).toBeVisible();
  const summaryInset = await summaryContent.evaluate((content) =>
    Number.parseFloat(getComputedStyle(content).paddingTop),
  );
  expect(
    Math.abs(summaryInset - expectedTopInset),
    `Financial Health summary must keep the expected top inset of ${expectedTopInset}px; received ${summaryInset}px`,
  ).toBeLessThanOrEqual(1);
}

async function expectFinancialHealthMetricSpacing(page: Page, viewportWidth: number) {
  const expectedTopInset = viewportWidth >= 1024 ? 28 : viewportWidth >= 768 ? 20 : 16;
  const metricContents = page.getByTestId("financial-health-metric-content");
  await expect(metricContents).toHaveCount(3);
  const geometry = await metricContents.evaluateAll((contents) =>
    contents.map((content) => {
      const firstRow = content.firstElementChild;
      if (!firstRow) throw new Error("Financial Health metric must contain a first row");
      const contentRect = content.getBoundingClientRect();
      const rowRect = firstRow.getBoundingClientRect();
      return {
        topInset: rowRect.top - contentRect.top,
        cardTop: content.parentElement?.getBoundingClientRect().top ?? contentRect.top,
        headingTop: rowRect.top,
      };
    }),
  );
  for (const item of geometry) {
    expect(
      Math.abs(item.topInset - expectedTopInset),
      `Financial Health metric must keep the expected top inset of ${expectedTopInset}px; received ${item.topInset}px`,
    ).toBeLessThanOrEqual(1);
  }
  const rows = geometry.reduce((groups, item) => {
    const row = Math.round(item.cardTop);
    groups.set(row, [...(groups.get(row) ?? []), item]);
    return groups;
  }, new Map<number, typeof geometry>());
  for (const row of rows.values()) {
    const headingTops = row.map((item) => item.headingTop);
    expect(
      Math.max(...headingTops) - Math.min(...headingTops),
      "Financial Health metric headings in the same row must stay aligned",
    ).toBeLessThanOrEqual(1);
  }
}

async function expectIncomeSummaryCardSpacing(page: Page, viewportWidth: number) {
  const contents = page.getByTestId("income-summary-content");
  await expect(contents).toHaveCount(3);
  const geometry = await contents.evaluateAll((items) =>
    items.map((content) => {
      const heading = content.firstElementChild;
      if (!heading) throw new Error("Income summary card must contain a heading");
      const contentRect = content.getBoundingClientRect();
      const headingRect = heading.getBoundingClientRect();
      return {
        topInset: Number.parseFloat(getComputedStyle(content).paddingTop),
        cardTop: content.parentElement?.getBoundingClientRect().top ?? contentRect.top,
        headingTop: headingRect.top,
      };
    }),
  );
  for (const [index, item] of geometry.entries()) {
    const expectedTopInset = viewportWidth >= 1024
      ? 28
      : viewportWidth >= 768
        ? 20
        : viewportWidth >= 640 || index === 2
          ? 16
          : 14;
    expect(
      Math.abs(item.topInset - expectedTopInset),
      `Income summary ${index + 1} must keep the expected top inset of ${expectedTopInset}px; received ${item.topInset}px`,
    ).toBeLessThanOrEqual(1);
  }
  const rows = geometry.reduce((groups, item) => {
    const row = Math.round(item.cardTop);
    groups.set(row, [...(groups.get(row) ?? []), item]);
    return groups;
  }, new Map<number, typeof geometry>());
  for (const row of rows.values()) {
    const headingTops = row.map((item) => item.headingTop);
    expect(
      Math.max(...headingTops) - Math.min(...headingTops),
      "Income summary headings in the same row must stay aligned",
    ).toBeLessThanOrEqual(1);
  }
}
