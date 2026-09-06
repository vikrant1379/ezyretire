import { expect, test, type Page, type Route } from "@playwright/test";

const firstUser = {
  id: "save-cancellation-first-user",
  email: "first@example.com",
  profileImageUrl: null,
  fullName: "First Account",
  dateOfBirth: "1990-01-15",
  gender: "Prefer not to say",
  phone: "+919999999991",
  onboardingCompleted: true,
  isAdmin: false,
};

const secondUser = {
  ...firstUser,
  id: "save-cancellation-second-user",
  email: "second@example.com",
  fullName: "Second Account",
  phone: "+919999999992",
};

const emptyFinancialData = {
  expenses: [],
  budgets: [],
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
    fullName: firstUser.fullName,
    email: firstUser.email,
    phone: firstUser.phone,
    gender: firstUser.gender,
    dateOfBirth: firstUser.dateOfBirth,
    targetRetirementAge: 60,
    lifeExpectancy: 85,
    riskPreference: "Balanced",
    onboardingCompleted: true,
  },
  uiPreferences: {},
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installSession(page: Page) {
  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: firstUser }),
  );
}

async function submitExpense(page: Page) {
  await page.getByRole("button", { name: "Add Expense" }).click();
  await page.getByLabel("Amount (₹) *").fill("1250");
  await page.getByRole("combobox", { name: "Category *" }).click();
  await page.getByRole("option", { name: "Food & Dining" }).click();
  await page.getByRole("button", { name: "Save Expense" }).click();
}

function withIncomeSort(
  document: typeof emptyFinancialData,
  by: "manual" | "monthly" | "annual",
) {
  const next = structuredClone(document);
  next.incomeSources = [
    {
      id: "salary-income",
      name: "Salary",
      type: "Salary",
      frequency: "Monthly",
      amount: 100000,
      date: "2026-01-01",
      recurring: true,
      annualGrowthRate: 8,
      incomeEndMode: "retirement",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "consulting-income",
      name: "Consulting",
      type: "Freelance/Consulting",
      frequency: "Monthly",
      amount: 30000,
      date: "2026-01-01",
      recurring: true,
      annualGrowthRate: 5,
      incomeEndMode: "retirement",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  next.uiPreferences = {
    incomeSort: { by, direction: "desc" },
  };
  return next;
}

async function switchFinancialAccount(page: Page, accountId: string) {
  await page.evaluate(async (nextAccountId) => {
    const { activateFinancialDataAccount } = await import("/src/lib/financial-api.ts");
    activateFinancialDataAccount(nextAccountId);
  }, accountId);
}

async function expectSingleAccountSwitchNotice(page: Page) {
  const cancellationNotice = page.getByText(
    "Your account changed before this could be saved. Switch to the correct account and try again.",
    { exact: true },
  );
  await expect(page.getByText("Change not saved", { exact: true })).toHaveCount(1);
  await expect(cancellationNotice).toHaveCount(1);
  await expect(cancellationNotice).toBeVisible();
}

test("an account switch shows one save-cancellation notice and preserves the new account", async ({ page }) => {
  await installSession(page);

  const firstAccount = structuredClone(emptyFinancialData);
  const secondAccount = structuredClone(emptyFinancialData);
  secondAccount.profileInputs.fullName = "Second Account";
  secondAccount.profileInputs.email = "second@example.com";

  let activeServerDocument = firstAccount;
  const saveStarted = deferred();
  const releaseSave = deferred();

  await page.route("**/api/financial-data", async (route) => {
    if (route.request().method() === "PUT") {
      const savedFirstAccount = JSON.parse(route.request().postData() ?? "{}");
      saveStarted.resolve();
      await releaseSave.promise;
      Object.assign(firstAccount, savedFirstAccount);
      await fulfillJson(route, firstAccount);
      return;
    }
    await fulfillJson(route, activeServerDocument);
  });

  await page.goto("/transactions");
  await submitExpense(page);
  await saveStarted.promise;

  activeServerDocument = secondAccount;
  await switchFinancialAccount(page, "save-cancellation-second-user");
  releaseSave.resolve();

  await expectSingleAccountSwitchNotice(page);
  await expect(page.getByRole("dialog", { name: "Add Expense" })).toBeVisible();
  expect(secondAccount.expenses).toEqual([]);
});

test("signing out during a save cannot carry the change into the next signed-in account", async ({ page }) => {
  let authenticatedUser: typeof firstUser | typeof secondUser | null = firstUser;
  const firstAccount = structuredClone(emptyFinancialData);
  const secondAccount = structuredClone(emptyFinancialData);
  secondAccount.profileInputs.fullName = secondUser.fullName;
  secondAccount.profileInputs.email = secondUser.email;
  secondAccount.profileInputs.phone = secondUser.phone;
  const bothSavesStarted = deferred();
  const releaseSaves = deferred();
  let startedSaveCount = 0;

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: authenticatedUser }),
  );
  await page.route("**/api/logout?**", async (route) => {
    authenticatedUser = null;
    await route.fulfill({
      status: 302,
      headers: { location: "/" },
    });
  });
  await page.route("**/api/auth/otp/request", (route) =>
    fulfillJson(route, { challengeId: "second-account-challenge", resendAfterSeconds: 60 }),
  );
  await page.route("**/api/auth/otp/verify", async (route) => {
    authenticatedUser = secondUser;
    await fulfillJson(route, { user: secondUser, needsProfile: false });
  });
  await page.route("**/api/financial-data", async (route) => {
    if (route.request().method() === "PUT") {
      const savedFirstAccount = JSON.parse(route.request().postData() ?? "{}");
      startedSaveCount += 1;
      if (startedSaveCount === 2) {
        bothSavesStarted.resolve();
      }
      await releaseSaves.promise;
      Object.assign(firstAccount, savedFirstAccount);
      await fulfillJson(route, firstAccount);
      return;
    }
    await fulfillJson(
      route,
      authenticatedUser?.id === secondUser.id ? secondAccount : firstAccount,
    );
  });

  await page.goto("/transactions");
  await submitExpense(page);
  await page.getByRole("dialog", { name: "Add Expense" })
    .getByRole("button", { name: "Close" })
    .click();

  const restoredAccount = structuredClone(emptyFinancialData);
  restoredAccount.expenses = [{
    id: "simultaneous-restored-expense",
    amount: 4200,
    category: "Travel",
    date: "2026-09-01",
    createdAt: "2026-09-01T00:00:00.000Z",
  }];
  await page.getByRole("button", { name: "Import" }).click();
  await page.locator("#import-file").setInputFiles({
    name: "ezyretire-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ formatVersion: 1, data: restoredAccount })),
  });
  await bothSavesStarted.promise;
  await page.evaluate(() => {
    window.history.pushState(null, "", "/profile");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(secondUser.email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("6-digit sign-in code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.getByRole("button", { name: "Add Expense" })).toBeVisible();

  releaseSaves.resolve();

  await expectSingleAccountSwitchNotice(page);
  await expect(page.getByText("Expense added", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Backup restored", { exact: true })).toHaveCount(0);
  await expect(page.getByText("₹1,250", { exact: true })).toHaveCount(0);
  await expect(page.getByText("₹4,200", { exact: true })).toHaveCount(0);
  expect(secondAccount.expenses).toEqual([]);
});

test("signing out during a preference save shows one warning without changing the next account", async ({ page }) => {
  let authenticatedUser: typeof firstUser | typeof secondUser | null = firstUser;
  const firstAccount = withIncomeSort(emptyFinancialData, "manual");
  const secondAccount = withIncomeSort(emptyFinancialData, "annual");
  secondAccount.profileInputs.fullName = secondUser.fullName;
  secondAccount.profileInputs.email = secondUser.email;
  secondAccount.profileInputs.phone = secondUser.phone;
  const saveStarted = deferred();
  const releaseSave = deferred();

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: authenticatedUser }),
  );
  await page.route("**/api/logout?**", async (route) => {
    authenticatedUser = null;
    await route.fulfill({
      status: 302,
      headers: { location: "/" },
    });
  });
  await page.route("**/api/auth/otp/request", (route) =>
    fulfillJson(route, { challengeId: "preference-save-challenge", resendAfterSeconds: 60 }),
  );
  await page.route("**/api/auth/otp/verify", async (route) => {
    authenticatedUser = secondUser;
    await fulfillJson(route, { user: secondUser, needsProfile: false });
  });
  await page.route("**/api/financial-data", async (route) => {
    if (route.request().method() === "PUT") {
      const savedFirstAccount = JSON.parse(route.request().postData() ?? "{}");
      saveStarted.resolve();
      await releaseSave.promise;
      Object.assign(firstAccount, savedFirstAccount);
      await fulfillJson(route, firstAccount);
      return;
    }
    await fulfillJson(
      route,
      authenticatedUser?.id === secondUser.id ? secondAccount : firstAccount,
    );
  });

  await page.goto("/income");
  const sort = page.getByRole("combobox", { name: "Sort cards by" });
  await expect(sort).toContainText("Custom Order");
  await sort.click();
  await page.getByRole("option", { name: "Monthly Net" }).click();
  await saveStarted.promise;

  await page.evaluate(() => {
    window.history.pushState(null, "", "/profile");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(secondUser.email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("6-digit sign-in code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.getByRole("button", { name: "Add Expense" })).toBeVisible();
  await page.evaluate(() => {
    window.history.pushState(null, "", "/income");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(sort).toContainText("Annual Gross");

  releaseSave.resolve();

  await expectSingleAccountSwitchNotice(page);
  await expect(sort).toContainText("Annual Gross");
  expect(secondAccount.uiPreferences.incomeSort).toEqual({
    by: "annual",
    direction: "desc",
  });
});

test("a rejected old preference save cannot roll back the next account", async ({ page }) => {
  let authenticatedUser: typeof firstUser | typeof secondUser | null = firstUser;
  const firstAccount = withIncomeSort(emptyFinancialData, "manual");
  const secondAccount = withIncomeSort(emptyFinancialData, "annual");
  secondAccount.profileInputs.fullName = secondUser.fullName;
  secondAccount.profileInputs.email = secondUser.email;
  secondAccount.profileInputs.phone = secondUser.phone;
  const saveStarted = deferred();
  const rejectSave = deferred();

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: authenticatedUser }),
  );
  await page.route("**/api/logout?**", async (route) => {
    authenticatedUser = null;
    await route.fulfill({
      status: 302,
      headers: { location: "/" },
    });
  });
  await page.route("**/api/auth/otp/request", (route) =>
    fulfillJson(route, { challengeId: "rejected-preference-save-challenge", resendAfterSeconds: 60 }),
  );
  await page.route("**/api/auth/otp/verify", async (route) => {
    authenticatedUser = secondUser;
    await fulfillJson(route, { user: secondUser, needsProfile: false });
  });
  await page.route("**/api/financial-data", async (route) => {
    if (route.request().method() === "PUT") {
      saveStarted.resolve();
      await rejectSave.promise;
      await fulfillJson(route, { error: "Unable to save preference" }, 500);
      return;
    }
    await fulfillJson(
      route,
      authenticatedUser?.id === secondUser.id ? secondAccount : firstAccount,
    );
  });

  await page.goto("/income");
  const sort = page.getByRole("combobox", { name: "Sort cards by" });
  await expect(sort).toContainText("Custom Order");
  await sort.click();
  await page.getByRole("option", { name: "Monthly Net" }).click();
  await saveStarted.promise;

  await page.evaluate(() => {
    window.history.pushState(null, "", "/profile");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(secondUser.email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("6-digit sign-in code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.getByRole("button", { name: "Add Expense" })).toBeVisible();
  await page.evaluate(() => {
    window.history.pushState(null, "", "/income");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(sort).toContainText("Annual Gross");

  rejectSave.resolve();

  await expectSingleAccountSwitchNotice(page);
  await expect(sort).toContainText("Annual Gross");
  expect(secondAccount.uiPreferences.incomeSort).toEqual({
    by: "annual",
    direction: "desc",
  });
});

test("signing out during a save still invalidates the account when session storage is blocked", async ({ page }) => {
  let authenticatedUser: typeof firstUser | typeof secondUser | null = firstUser;
  const firstAccount = structuredClone(emptyFinancialData);
  const secondAccount = structuredClone(emptyFinancialData);
  secondAccount.profileInputs.fullName = secondUser.fullName;
  secondAccount.profileInputs.email = secondUser.email;
  secondAccount.profileInputs.phone = secondUser.phone;
  const saveStarted = deferred();
  const releaseSave = deferred();
  const pageErrors: Error[] = [];

  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage access is blocked", "SecurityError");
      },
    });
  });
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: authenticatedUser }),
  );
  await page.route("**/api/logout?**", async (route) => {
    authenticatedUser = null;
    await route.fulfill({
      status: 302,
      headers: { location: "/" },
    });
  });
  await page.route("**/api/auth/otp/request", (route) =>
    fulfillJson(route, { challengeId: "storage-blocked-challenge", resendAfterSeconds: 60 }),
  );
  await page.route("**/api/auth/otp/verify", async (route) => {
    authenticatedUser = secondUser;
    await fulfillJson(route, { user: secondUser, needsProfile: false });
  });
  await page.route("**/api/financial-data", async (route) => {
    if (route.request().method() === "PUT") {
      const savedFirstAccount = JSON.parse(route.request().postData() ?? "{}");
      saveStarted.resolve();
      await releaseSave.promise;
      Object.assign(firstAccount, savedFirstAccount);
      await fulfillJson(route, firstAccount);
      return;
    }
    await fulfillJson(
      route,
      authenticatedUser?.id === secondUser.id ? secondAccount : firstAccount,
    );
  });

  await page.goto("/transactions");
  await submitExpense(page);
  await saveStarted.promise;
  await page.evaluate(() => {
    window.history.pushState(null, "", "/profile");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(secondUser.email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("6-digit sign-in code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.getByRole("button", { name: "Add Expense" })).toBeVisible();

  releaseSave.resolve();

  await expect(page.getByText("Expense added", { exact: true })).toHaveCount(0);
  await expect(page.getByText("₹1,250", { exact: true })).toHaveCount(0);
  expect(secondAccount.expenses).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("signing out during a save survives session storage being revoked mid-session", async ({ page }) => {
  let authenticatedUser: typeof firstUser | typeof secondUser | null = firstUser;
  const firstAccount = structuredClone(emptyFinancialData);
  const secondAccount = structuredClone(emptyFinancialData);
  secondAccount.profileInputs.fullName = secondUser.fullName;
  secondAccount.profileInputs.email = secondUser.email;
  secondAccount.profileInputs.phone = secondUser.phone;
  const saveStarted = deferred();
  const releaseSave = deferred();
  const pageErrors: Error[] = [];

  page.on("pageerror", (error) => pageErrors.push(error));

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: authenticatedUser }),
  );
  await page.route("**/api/logout?**", async (route) => {
    authenticatedUser = null;
    await route.fulfill({
      status: 302,
      headers: { location: "/" },
    });
  });
  await page.route("**/api/auth/otp/request", (route) =>
    fulfillJson(route, { challengeId: "storage-revoked-challenge", resendAfterSeconds: 60 }),
  );
  await page.route("**/api/auth/otp/verify", async (route) => {
    authenticatedUser = secondUser;
    await fulfillJson(route, { user: secondUser, needsProfile: false });
  });
  await page.route("**/api/financial-data", async (route) => {
    if (route.request().method() === "PUT") {
      const savedFirstAccount = JSON.parse(route.request().postData() ?? "{}");
      saveStarted.resolve();
      await releaseSave.promise;
      Object.assign(firstAccount, savedFirstAccount);
      await fulfillJson(route, firstAccount);
      return;
    }
    await fulfillJson(
      route,
      authenticatedUser?.id === secondUser.id ? secondAccount : firstAccount,
    );
  });

  await page.goto("/transactions");
  await page.evaluate(() => {
    window.sessionStorage.setItem("storage-available-before-save", "1");
  });
  await submitExpense(page);
  await saveStarted.promise;
  await page.evaluate(() => {
    if (window.sessionStorage.getItem("storage-available-before-save") !== "1") {
      throw new Error("Session storage was not available before revocation");
    }
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage access was revoked", "SecurityError");
      },
    });
    window.history.pushState(null, "", "/profile");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(secondUser.email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("6-digit sign-in code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.getByRole("button", { name: "Add Expense" })).toBeVisible();

  releaseSave.resolve();

  await expect(page.getByText("Expense added", { exact: true })).toHaveCount(0);
  await expect(page.getByText("₹1,250", { exact: true })).toHaveCount(0);
  expect(secondAccount.expenses).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("an interrupted planning-category change cannot publish into the new account", async ({ page }) => {
  await installSession(page);

  const firstAccount = structuredClone(emptyFinancialData);
  firstAccount.budgets = [{
    category: "Custom Holiday",
    windows: [{ startMonth: "2026-09", monthlyLimit: 5000 }],
  }];
  const secondAccount = structuredClone(emptyFinancialData);
  const categoryChangeStarted = deferred();
  const releaseCategoryChange = deferred();

  await page.route("**/api/financial-data", (route) =>
    fulfillJson(route, firstAccount),
  );
  await page.route("**/api/financial-data/planning-categories/**", async (route) => {
    categoryChangeStarted.resolve();
    await releaseCategoryChange.promise;
    firstAccount.uiPreferences.archivedPlanningCategories = ["Custom Holiday"];
    await fulfillJson(route, firstAccount);
  });

  await page.goto("/budgets");
  await page.getByRole("button", { name: "Manage Custom Holiday category" }).click();
  await page.getByRole("menuitem", { name: "Rename or archive" }).click();
  await page.getByRole("button", { name: "Archive from Budgets" }).click();
  await categoryChangeStarted.promise;

  await switchFinancialAccount(page, "category-change-second-user");
  releaseCategoryChange.resolve();

  await expectSingleAccountSwitchNotice(page);
  expect(secondAccount.budgets).toEqual([]);
  expect(secondAccount.uiPreferences.archivedPlanningCategories ?? []).toEqual([]);
});

test("an interrupted backup restore cannot replace the new account", async ({ page }) => {
  await installSession(page);

  const firstAccount = structuredClone(emptyFinancialData);
  const secondAccount = structuredClone(emptyFinancialData);
  const restoreStarted = deferred();
  const releaseRestore = deferred();

  await page.route("**/api/financial-data", async (route) => {
    if (route.request().method() === "PUT") {
      restoreStarted.resolve();
      await releaseRestore.promise;
      Object.assign(firstAccount, JSON.parse(route.request().postData() ?? "{}"));
      await fulfillJson(route, firstAccount);
      return;
    }
    await fulfillJson(route, firstAccount);
  });

  const restoredAccount = structuredClone(emptyFinancialData);
  restoredAccount.expenses = [{
    id: "restored-expense",
    amount: 4200,
    category: "Travel",
    date: "2026-09-01",
    createdAt: "2026-09-01T00:00:00.000Z",
  }];

  await page.goto("/transactions");
  await page.getByRole("button", { name: "Import" }).click();
  await page.locator("#import-file").setInputFiles({
    name: "ezyretire-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ formatVersion: 1, data: restoredAccount })),
  });
  await restoreStarted.promise;

  await switchFinancialAccount(page, "backup-restore-second-user");
  releaseRestore.resolve();

  await expectSingleAccountSwitchNotice(page);
  await expect(page.getByRole("dialog", { name: "Import Data" })).toBeVisible();
  await expect(page.getByText("Backup restored", { exact: true })).toHaveCount(0);
  expect(secondAccount.expenses).toEqual([]);
});

test("an ordinary save failure keeps the form open without an account-switch notice", async ({ page }) => {
  await installSession(page);
  await page.route("**/api/financial-data", async (route) => {
    if (route.request().method() === "PUT") {
      await fulfillJson(route, { error: "Unable to save expense" }, 500);
      return;
    }
    await fulfillJson(route, emptyFinancialData);
  });

  await page.goto("/transactions");
  await submitExpense(page);

  await expect(page.getByRole("dialog", { name: "Add Expense" })).toBeVisible();
  await expect(page.getByLabel("Amount (₹) *")).toHaveValue("1,250");
  await expect(page.getByRole("button", { name: "Save Expense" })).toBeEnabled();
  await expect(page.getByText("Change not saved", { exact: true })).toHaveCount(0);
});