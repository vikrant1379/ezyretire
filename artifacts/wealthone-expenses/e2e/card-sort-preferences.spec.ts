import { expect, test, type Page, type Route } from "@playwright/test";

const testUser = {
  id: "card-sort-user",
  email: "card-sort@example.com",
  profileImageUrl: null,
  fullName: "Card Sort",
  dateOfBirth: "1990-01-15",
  gender: "Prefer not to say",
  phone: "+919999999999",
  onboardingCompleted: true,
  isAdmin: false,
};

const initialFinancialData = {
  expenses: [],
  budgets: [],
  incomeSources: [
    {
      id: "income-1",
      name: "Salary",
      type: "Salary",
      frequency: "Monthly",
      amount: 0,
      date: "2024-01-01",
      recurring: true,
      annualGrowthRate: 8,
      incomeEndMode: "retirement",
      salaryDetails: {
        grossCTC: 1_200_000,
        grossCTCMode: "manual",
        basicPay: 70_000,
        hra: 20_000,
        allowances: 10_000,
        employeePF: 5_000,
        professionalTax: 200,
        tds: 8_000,
        tdsMode: "manual",
        taxRegime: "new",
        financialYear: "2026-27",
        otherDeductions: 0,
      },
      createdAt: "2024-01-01T09:00:00.000Z",
    },
    {
      id: "income-2",
      name: "Consulting",
      type: "Freelance/Consulting",
      frequency: "Monthly",
      amount: 30_000,
      date: "2025-01-01",
      recurring: true,
      annualGrowthRate: 5,
      incomeEndMode: "retirement",
      createdAt: "2025-01-01T09:00:00.000Z",
    },
  ],
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
  uiPreferences: {
    incomeSort: { by: "manual", direction: "desc" },
  },
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installSession(page: Page) {
  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: testUser }),
  );
}

async function navigateWithinApp(page: Page, path: string) {
  await page.evaluate((nextPath) => {
    history.pushState(null, "", nextPath);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

test("a stale financial response cannot rewind an Income sort being saved", async ({ page }) => {
  await installSession(page);

  let serverDocument = structuredClone(initialFinancialData);
  let getCount = 0;
  const staleReadStarted = deferred();
  const releaseStaleRead = deferred();
  const saveStarted = deferred();
  const releaseSave = deferred();

  await page.route("**/api/financial-data", async (route) => {
    if (route.request().method() === "PUT") {
      saveStarted.resolve();
      await releaseSave.promise;
      serverDocument = JSON.parse(route.request().postData() ?? "{}");
      await fulfillJson(route, serverDocument);
      return;
    }

    getCount += 1;
    const snapshot = structuredClone(serverDocument);
    if (getCount === 2) {
      staleReadStarted.resolve();
      await releaseStaleRead.promise;
    }
    await fulfillJson(route, snapshot).catch(() => {
      // React Query may abort the stale request after the optimistic write.
    });
  });

  await page.goto("/income");
  const sort = page.getByRole("combobox", { name: "Sort cards by" });
  await expect(sort).toContainText("Custom Order");

  await navigateWithinApp(page, "/about");
  await expect(page.getByRole("heading", { name: /scattered financial details/i })).toBeVisible();
  await navigateWithinApp(page, "/income");
  await staleReadStarted.promise;

  await sort.click();
  await page.getByRole("option", { name: "Monthly Net" }).click();
  await saveStarted.promise;
  await expect(sort).toContainText("Monthly Net");

  releaseStaleRead.resolve();
  await expect(sort).toContainText("Monthly Net");

  releaseSave.resolve();
  await expect(sort).toContainText("Monthly Net");

  await navigateWithinApp(page, "/about");
  await expect(page.getByRole("heading", { name: /scattered financial details/i })).toBeVisible();
  await navigateWithinApp(page, "/income");
  await expect(sort).toContainText("Monthly Net");
});