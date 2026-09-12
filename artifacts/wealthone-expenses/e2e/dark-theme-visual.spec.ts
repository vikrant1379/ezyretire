import { expect, test, type Page, type Route } from "@playwright/test";

const FIXED_NOW = new Date("2026-09-09T10:00:00.000Z");

const user = {
  id: "dark-theme-visual-user",
  email: "visual@example.com",
  fullName: "Aarav Mehta",
  dateOfBirth: "1990-01-15",
  gender: "Prefer not to say",
  phone: "+919876543210",
  onboardingCompleted: true,
  isAdmin: false,
};

const financialData = {
  expenses: [
    {
      id: "expense-1",
      date: "2026-09-05",
      amount: 4_850,
      category: "Food & Dining",
      merchant: "Neighbourhood Market",
      paymentMethod: "UPI",
      reimbursable: false,
      recurring: false,
      createdAt: "2026-09-05T09:00:00.000Z",
    },
    {
      id: "expense-2",
      date: "2026-09-03",
      amount: 18_500,
      category: "Housing",
      merchant: "Monthly rent",
      paymentMethod: "Bank Transfer",
      reimbursable: false,
      recurring: true,
      createdAt: "2026-09-03T09:00:00.000Z",
    },
  ],
  budgets: [
    { category: "Food & Dining", monthlyLimit: 15_000 },
    { category: "Housing", monthlyLimit: 25_000 },
  ],
  incomeSources: [{
    id: "income-1",
    name: "Salary",
    type: "Salary",
    frequency: "Monthly",
    amount: 150_000,
    date: "2024-01-01",
    recurring: true,
    annualGrowthRate: 8,
    incomeEndMode: "retirement",
    createdAt: "2024-01-01T09:00:00.000Z",
  }],
  investments: [{
    id: "investment-1",
    name: "Balanced retirement fund",
    assetClass: "Mutual Funds",
    investedAmount: 1_400_000,
    currentValue: 1_725_000,
    monthlyContribution: 25_000,
    contributionStartDate: "2024-01-01",
    contributionEndMode: "retirement",
    expectedReturn: 11,
    institution: "Example Asset Management",
    createdAt: "2024-01-01T09:00:00.000Z",
  }],
  loans: [{
    id: "loan-1",
    name: "Home loan",
    type: "Home",
    sanctionedPrincipal: 3_000_000,
    outstandingPrincipal: 2_350_000,
    annualInterestRate: 8.5,
    interestType: "Floating",
    totalTenureMonths: 240,
    startDate: "2022-01-01",
    emi: 26_000,
    prepayments: 0,
    createdAt: "2022-01-01T09:00:00.000Z",
  }],
  plannedExpenses: [{
    id: "planned-1",
    name: "Annual insurance premium",
    category: "Insurance",
    amount: 42_000,
    expectedDate: "2026-09-20",
    createdAt: "2026-01-01T09:00:00.000Z",
  }],
  goals: [{
    id: "goal-1",
    name: "House deposit",
    targetAmount: 5_000_000,
    currentAmount: 1_250_000,
    targetDate: "2030-09-01",
    priority: 1,
    annualInflationRate: 5,
    monthlyAllocation: 12_000,
    createdAt: "2025-01-01T09:00:00.000Z",
  }],
  reminders: [{
    id: "reminder-1",
    title: "Pay advance tax",
    date: "2026-09-15",
    recurrence: "none",
    enabled: true,
    createdAt: "2026-01-01T09:00:00.000Z",
  }],
  notificationPreferences: {
    enabled: true,
    types: {
      budget: true,
      goal: true,
      upcoming: true,
      milestone: true,
      retirement: true,
      tax: true,
      anomaly: true,
    },
    inApp: true,
    push: false,
    weeklyDigest: false,
    digestDay: 1,
    quietHours: { start: "22:00", end: "07:00" },
    timeZone: "UTC",
  },
  notifications: [],
  monthlyReports: [],
  netWorthSnapshots: [
    { id: "snapshot-1", date: "2026-07-01", netWorth: 900_000 },
    { id: "snapshot-2", date: "2026-08-01", netWorth: 1_050_000 },
    { id: "snapshot-3", date: "2026-09-01", netWorth: 1_175_000 },
  ],
  emergencyFund: {
    targetMonths: 6,
    reserveBalance: 180_000,
    monthlyContribution: 10_000,
  },
  retirementInputs: {
    dateOfBirth: "1990-01-15",
    targetRetirementAge: 60,
    lifeExpectancy: 85,
    generalInflation: 6,
    salaryGrowth: 8,
    monthlyContributionOverride: 25_000,
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

async function installDarkFixture(page: Page) {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("ezyretire-theme", '"dark"');
  });
  await page.route("**/api/auth/user", (route) => fulfillJson(route, { user }));
  await page.route("**/api/auth/passkeys", (route) =>
    fulfillJson(route, { credentials: [] })
  );
  await page.route("**/api/account/deletion", (route) =>
    fulfillJson(route, { status: "none" })
  );
  await page.route("**/api/entitlements", (route) =>
    fulfillJson(route, {
      plan: "free",
      premium: false,
      capabilities: {
        receiptOcr: false,
        documentVault: false,
        nomineeTracker: false,
        verifiedMobile: false,
      },
      mobileVerification: { hasMobile: true, verified: false },
    })
  );
  await page.route("**/api/financial-data**", (route) => fulfillJson(route, financialData));
  await page.route("**/api/whatsapp/support", (route) =>
    fulfillJson(route, { available: false, whatsappUrl: null })
  );
}

async function installProfileThemeFixture(page: Page, theme: "light" | "dark") {
  await installDarkFixture(page);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.addInitScript((selectedTheme) => {
    localStorage.setItem("ezyretire-theme", JSON.stringify(selectedTheme));
  }, theme);
}
async function expectDarkScreenshot(
  page: Page,
  screen: string,
  viewport: "desktop" | "phone",
) {
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page).toHaveScreenshot(`dark-theme-${screen}-${viewport}.png`, {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    maxDiffPixelRatio: 0.01,
  });
}

async function expectDarkRegionScreenshot(
  page: Page,
  selector: Parameters<Page["locator"]>[0],
  name: string,
) {
  const region = page.locator(selector).first();
  await region.scrollIntoViewIfNeeded();
  await expect(region).toBeVisible();
  await expect(region).toHaveScreenshot(`${name}.png`, {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.01,
  });
}

async function expectHealthyScreen(page: Page) {
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
}

async function expectScreenHeading(
  page: Page,
  screen: { name: string; heading: string },
) {
  if (screen.name === "profile") {
    await expect(page.getByTestId("text-profile-display-name")).toBeVisible();
    return;
  }
  await expect(
    page.getByRole("heading", { name: screen.heading, exact: false }).first(),
  ).toBeVisible();
}

const screens = [
  { name: "dashboard", path: "/", heading: "Your retirement outlook" },
  { name: "expenses", path: "/transactions", heading: "Transactions" },
  { name: "planner", path: "/planner", heading: "Planner" },
  { name: "retirement", path: "/retirement", heading: "Retirement Projection" },
  { name: "profile", path: "/profile", heading: "Aarav Mehta" },
  { name: "settings", path: "/settings?section=security", heading: "Security" },
] as const;

const remainingDesktopScreens = [
  { name: "income", path: "/income", heading: "Income" },
  { name: "investments", path: "/investments", heading: "Investment Portfolio" },
  { name: "tax", path: "/tax", heading: "Tax" },
  { name: "trends", path: "/trends", heading: "Trends" },
  { name: "decision-tools", path: "/decision-tools", heading: "Decision tools" },
] as const;

const remainingPhoneScreens = [
  { name: "loans", path: "/loans", heading: "Loans & Liabilities" },
  { name: "goals", path: "/goals", heading: "Goals" },
] as const;

for (const theme of ["light", "dark"] as const) {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "phone @touch", width: 390, height: 844 },
  ] as const) {
    test(`profile summary uses the rendered ${theme} ${viewport.name} foreground color`, async ({ page }) => {
      await installProfileThemeFixture(page, theme);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/profile");

      const name = page.getByTestId("text-profile-display-name");
      await expect(name).toBeVisible();

      const rendered = await name.evaluate((element) => {
        const styles = getComputedStyle(element);
        const resolveThemeColor = (variable: string) => {
          const probe = document.createElement("span");
          probe.style.color = `hsl(var(${variable}))`;
          document.body.append(probe);
          const color = getComputedStyle(probe).color;
          probe.remove();
          return color;
        };
        return {
          color: styles.color,
          foreground: resolveThemeColor("--foreground"),
        };
      });
      expect(rendered.color).toBe(rendered.foreground);
    });
  }
}

for (const screen of screens) {
  test(`${screen.name} keeps a stable populated dark fixture on desktop`, async ({ page }) => {
    await installDarkFixture(page);
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.goto(screen.path);
    await expectScreenHeading(page, screen);

    if (screen.name === "dashboard") {
      await expectDarkRegionScreenshot(
        page,
        ".recharts-responsive-container",
        "dark-theme-dashboard-chart-desktop",
      );
    }
    if (screen.name === "expenses") {
      const populatedTable = page.locator("div.hidden.md\\:grid.grid-cols-12").first();
      await expect(populatedTable).toBeVisible();
      await expect(page.locator("div.hidden.md\\:grid").getByText("Neighbourhood Market"))
        .toBeVisible();
      await expect(populatedTable.locator("xpath=..")).toHaveScreenshot(
        "dark-theme-expenses-table-desktop.png",
        { animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.01 },
      );
      await page.getByRole("button", { name: "Add Expense" }).click();
      const dialog = page.getByRole("dialog", { name: "Add Expense" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveScreenshot("dark-theme-expenses-dialog-desktop.png", {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.01,
      });
      await expect(dialog).toBeVisible();
    }
    if (screen.name === "retirement") {
      const chart = page.getByLabel(/Retirement projection chart/);
      await chart.scrollIntoViewIfNeeded();
      await expect(chart).toHaveScreenshot("dark-theme-retirement-chart-desktop.png", {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.01,
      });
    }
    if (screen.name === "profile") {
      await expect(page.getByTestId("text-profile-display-name")).toBeVisible();
    }
    if (screen.name === "settings") {
      await expect(page.getByText("No passkeys added yet.")).toBeVisible();
      await expect(page.getByTestId("status-passkey-error")).toHaveCount(0);
    }

    await expectHealthyScreen(page);
    await expectDarkScreenshot(page, screen.name, "desktop");
    await expectHealthyScreen(page);
  });

  test(`${screen.name} keeps a stable populated dark fixture on phone @touch`, async ({ page }) => {
    await installDarkFixture(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto(screen.path);
    await expectScreenHeading(page, screen);

    if (screen.name === "dashboard") {
      await expectDarkRegionScreenshot(
        page,
        ".recharts-responsive-container",
        "dark-theme-dashboard-chart-phone",
      );
    }
    if (screen.name === "expenses") {
      await expect(page.getByText("Neighbourhood Market").first()).toBeVisible();
    }
    if (screen.name === "retirement") {
      await expect(page.getByTestId("mobile-header")).toHaveScreenshot(
        "dark-theme-retirement-header-phone.png",
        {
          animations: "disabled",
          caret: "hide",
          maxDiffPixelRatio: 0.01,
        },
      );
      const chart = page.getByLabel(/Retirement projection chart/);
      await chart.scrollIntoViewIfNeeded();
      await expect(chart).toHaveScreenshot("dark-theme-retirement-chart-phone.png", {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.01,
      });
    }
    if (screen.name === "profile") {
      await expect(page.getByTestId("text-profile-display-name")).toBeVisible();
      await page.getByRole("link", { name: /Personal details/i }).click();
      await expect(page.getByTestId("input-personal-fullname")).toBeEditable();
    }
    if (screen.name === "settings") {
      await expect(page.getByText("No passkeys added yet.")).toBeVisible();
      await expect(page).toHaveScreenshot("dark-theme-settings-account-actions-phone.png", {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.01,
      });
    }

    await expectHealthyScreen(page);
    await expectDarkScreenshot(page, screen.name, "phone");
    await expectHealthyScreen(page);
  });
}

for (const screen of remainingDesktopScreens) {
  test(`${screen.name} keeps a stable populated dark fixture on desktop`, async ({ page }) => {
    await installDarkFixture(page);
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.goto(screen.path);
    await expect(page.getByRole("heading", { name: screen.heading, exact: true }).first())
      .toBeVisible();
    await expectHealthyScreen(page);
    await expectDarkScreenshot(page, screen.name, "desktop");
    await expectHealthyScreen(page);
  });
}

for (const screen of remainingPhoneScreens) {
  test(`${screen.name} keeps a stable populated dark fixture on phone @touch`, async ({ page }) => {
    await installDarkFixture(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto(screen.path);
    await expect(page.getByRole("heading", { name: screen.heading, exact: true }).first())
      .toBeVisible();
    await expectHealthyScreen(page);
    await expectDarkScreenshot(page, screen.name, "phone");
    await expectHealthyScreen(page);
  });
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "phone @touch", width: 390, height: 844 },
] as const) {
  test(`Available to Invest card preserves dark-theme contrast on ${viewport.name}`, async ({ page }) => {
    await installDarkFixture(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");

    const investCard = page.getByTestId("dashboard-available-to-invest-card");
    await expect(investCard).toBeVisible();
    await expect(investCard).toHaveClass(/dark:bg-positive-background/);
    await expect(investCard).toHaveClass(/dark:border-positive/);
    await expect(investCard).toHaveScreenshot(
      `dark-theme-dashboard-invest-card-${viewport.name.split(" ")[0]}.png`,
      {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.01,
      },
    );
  });
}
