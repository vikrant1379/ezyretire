import { expect, test, type Page, type Route } from "@playwright/test";

const user = {
  id: "test-user",
  email: "test@example.com",
  fullName: "Test User",
  dateOfBirth: "1990-01-15",
  gender: "Prefer not to say",
  phone: "",
  onboardingCompleted: true,
  isAdmin: false,
};

function dateOnly(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const emptyData = () => ({
  expenses: [],
  budgets: [],
  incomeSources: [],
  investments: [],
  loans: [],
  plannedExpenses: [],
  goals: [],
  reminders: [],
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
  netWorthSnapshots: [],
  emergencyFund: { targetMonths: 6, reserveBalance: 0, monthlyContribution: 0 },
  retirementInputs: {
    dateOfBirth: "1990-01-15",
    targetRetirementAge: 60,
    lifeExpectancy: 85,
    generalInflation: 6,
    salaryGrowth: 7,
    monthlyContributionOverride: 0,
    investSurplus: false,
  },
  profileInputs: {
    fullName: user.fullName,
    email: user.email,
    phone: "",
    gender: user.gender,
    dateOfBirth: user.dateOfBirth,
    targetRetirementAge: 60,
    lifeExpectancy: 85,
    riskPreference: "Balanced",
    onboardingCompleted: true,
  },
  uiPreferences: {},
});

async function json(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockedApp(page: Page, document: ReturnType<typeof emptyData>) {
  let data = structuredClone(document);
  await page.route("**/api/auth/user", (route) => json(route, { user }));
  await page.route("**/api/financial-data**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postDataJSON?.() as Record<string, unknown> | null;

    if (url.pathname.endsWith("/email") && method === "POST") {
      await json(route, { sent: true });
      return;
    }
    if (url.pathname.endsWith("/monthly-reports") && method === "POST") {
      const report = {
        ...body,
        id: body?.id ?? `monthly-report-${String(body?.month)}`,
        generatedAt: new Date().toISOString(),
      };
      if (!data.monthlyReports.some((item) => item.month === report.month)) {
        data.monthlyReports = [report as never, ...data.monthlyReports];
      }
      await json(route, data);
      return;
    }
    if (url.pathname.includes("/push-subscriptions")) {
      await json(route, data);
      return;
    }
    if (url.pathname.endsWith("/api/financial-data") && method === "PUT") {
      data = {
        ...(body as ReturnType<typeof emptyData>),
        monthlyReports: data.monthlyReports,
      };
    }
    await json(route, data);
  });
  return () => data;
}

test("system and manual themes persist on desktop and mobile", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    if (!localStorage.getItem("ezyretire-theme")) {
      localStorage.setItem("ezyretire-theme", '"system"');
    }
  });
  await mockedApp(page, emptyData());
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/goals");

  await expect(page.getByRole("heading", { name: "Goals" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("ezyretire-theme"))).toBe('"system"');
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page).toHaveScreenshot("task-233-desktop-system-dark.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
  await page.goto("/settings?section=appearance");
  await page.getByRole("radio", { name: "Light" }).focus();
  await page.keyboard.press("Space");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("ezyretire-theme"))).toBe('"light"');
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.goto("/goals");
  await expect(page).toHaveScreenshot("task-233-desktop-light.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("ezyretire-theme"))).toBe('"light"');
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings?section=appearance");
  await page.getByRole("radio", { name: "Dark" }).focus();
  await page.keyboard.press("Space");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("ezyretire-theme"))).toBe('"dark"');
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.goto("/goals");
  await expect(page.getByRole("heading", { name: "Goals" })).toBeVisible();
});

test("mobile touch applies both manual themes to Planner @touch", async ({ page }) => {
  await mockedApp(page, emptyData());
  await page.addInitScript(() => {
    if (!localStorage.getItem("ezyretire-theme")) {
      localStorage.setItem("ezyretire-theme", '"dark"');
    }
  });
  await page.goto("/planner");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("heading", { name: "Planner" })).toBeVisible();
  await expect(page).toHaveScreenshot("task-233-mobile-dark.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
  await page.goto("/settings?section=appearance");
  await page.getByRole("radio", { name: "Light" }).focus();
  await page.keyboard.press("Space");
  await page.goto("/planner");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect(page.getByRole("grid", { name: "Financial calendar month view" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page).toHaveScreenshot("task-233-mobile-light.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});

test("account appearance stays synchronized while profile editing remains usable", async ({ page }) => {
  await mockedApp(page, emptyData());
  await page.addInitScript(() => {
    if (!localStorage.getItem("ezyretire-theme")) {
      localStorage.setItem("ezyretire-theme", '"light"');
    }
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/settings?section=appearance");

  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Light" })).toBeChecked();
  await page.getByRole("radio", { name: "Dark" }).focus();
  await page.keyboard.press("Space");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("combobox", { name: "Theme preference" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("ezyretire-theme"))).toBe('"dark"');

  await page.goto("/profile?section=personal");
  await expect(page.getByTestId("input-personal-fullname")).toBeEditable();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByTestId("link-desktop-nav-dashboard").first().click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/settings?section=appearance");
  await expect(page).toHaveURL(/\/settings\?section=appearance$/);
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("radio", { name: "Light" }).focus();
  await page.keyboard.press("Space");
  await expect(page.locator("html")).toHaveClass(/light/);
  await expect(page.getByRole("combobox", { name: "Theme preference" })).toHaveCount(0);
  await page.goto("/profile?section=contact");
  await expect(page.getByTestId("input-contact-phone")).toBeEditable();
  await page.getByRole("button", { name: "Back" }).click();
  await page.reload();
  await page.goto("/settings?section=appearance");
  await expect(page.getByRole("radio", { name: "Light" })).toBeChecked();
});

test("goals, calendar, notifications, and reports work across responsive states", async ({ page }) => {
  const data = emptyData();
  data.incomeSources = [{
    id: "income-1",
    name: "Salary",
    type: "Salary",
    frequency: "Monthly",
    amount: 150_000,
    date: dateOnly(-40),
    recurring: true,
    incomeEndMode: "retirement",
    createdAt: new Date().toISOString(),
  } as never];
  data.budgets = [{
    category: "Living",
    monthlyLimit: 50_000,
    windows: [{ id: "living", monthlyLimit: 50_000, cadence: "monthly", endMode: "lifelong" }],
  } as never];
  data.expenses = [{
    id: "expense-1",
    date: dateOnly(),
    amount: 120_000,
    category: "Living",
    merchant: "Large purchase",
    paymentMethod: "Card",
    reimbursable: false,
    recurring: false,
    createdAt: new Date().toISOString(),
  } as never];
  data.goals = [{
    id: "goal-1",
    name: "House deposit",
    targetAmount: 5_000_000,
    currentAmount: 1_000_000,
    targetDate: dateOnly(365),
    priority: 1,
    annualInflationRate: 5,
    monthlyAllocation: 5_000,
    createdAt: new Date().toISOString(),
  } as never];
  data.reminders = [{
    id: "reminder-1",
    title: "Pay advance tax",
    date: dateOnly(2),
    recurrence: "none",
    enabled: true,
    createdAt: new Date().toISOString(),
  } as never];
  const reportMonthDate = new Date();
  reportMonthDate.setMonth(reportMonthDate.getMonth() - 1);
  const reportMonth = `${reportMonthDate.getFullYear()}-${String(reportMonthDate.getMonth() + 1).padStart(2, "0")}`;
  data.monthlyReports = [{
    id: `monthly-report-${reportMonth}`,
    month: reportMonth,
    generatedAt: new Date().toISOString(),
    sections: [
      "income-vs-expected",
      "expenses-vs-budget-category",
      "savings-amount-rate",
      "portfolio-value-returns-change",
      "net-worth-change",
      "retirement-date-movement",
      "health-score-change",
      "top-next-month-actions",
    ].map((id) => ({
      id,
      title: id === "expenses-vs-budget-category"
        ? "Expenses vs budget and category"
        : id.split("-").join(" "),
      metrics: { value: id === "expenses-vs-budget-category" ? 120_000 : 0 },
      metricFormats: { value: "currency" },
      actions: id === "expenses-vs-budget-category"
        ? ["Review categories that exceeded their plan."]
        : [],
    })),
  } as never];

  await page.setViewportSize({ width: 1440, height: 1000 });
  const getData = await mockedApp(page, data);
  await page.goto("/goals");

  await expect(page.getByText("House deposit")).toBeVisible();
  await expect(page.getByText("Available surplus")).toBeVisible();
  await page.getByRole("button", { name: "Add Goal" }).click();
  const goalDialog = page.getByRole("dialog");
  await goalDialog.getByLabel("Name").fill("Education fund");
  await goalDialog.getByLabel("Target Amount").fill("1000000");
  await goalDialog.getByLabel("Saved So Far").fill("100000");
  await goalDialog.getByPlaceholder("DD/MM/YYYY").fill("01/01/2032");
  await goalDialog.getByLabel("Monthly Allocation").fill("2500");
  await goalDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Education fund")).toBeVisible();
  expect(getData().goals).toHaveLength(2);

  await page.goto("/planner");
  await expect(page.getByRole("grid", { name: "Financial calendar month view" })).toBeVisible();
  await page.getByRole("button", { name: "Next month" }).click();
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.getByText("Upcoming (Next 30 Days)")).toBeVisible();
  await expect(page.getByText("Pay advance tax").last()).toBeVisible();

  await page.getByRole("tab", { name: /Notifications/ }).click();
  await expect(page.getByText("Recent alerts", { exact: true })).toBeVisible();
  await expect(page.getByText("Budget alerts")).toBeVisible();
  await expect(page.getByText("Unusual expenses")).toBeVisible();
  await expect(page.getByText("Weekly email digest")).toBeVisible();
  await expect(page.getByText(/Email delivery requires a configured account-mail service/)).toBeVisible();

  await page.getByRole("tab", { name: /Reports/ }).click();
  await expect(page.getByText(/Report for/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Print / save PDF" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Email this report" })).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("heading", { name: "Expenses vs budget and category" })).toBeVisible();
  await page.emulateMedia({ media: "screen" });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("button-mobile-nav-more").click();
  await expect(page.getByTestId("link-mobile-nav-planner")).toBeVisible();
  await page.getByTestId("link-mobile-nav-planner").click();
  await expect(page.getByRole("heading", { name: "Planner" })).toBeVisible();
  await expect(page.getByRole("grid", { name: "Financial calendar month view" })).toBeVisible();
});