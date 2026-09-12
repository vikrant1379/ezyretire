import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const adminUser = {
  id: "admin-hmr-user",
  email: "admin-hmr@example.com",
  profileImageUrl: null,
  fullName: "HMR Admin",
  dateOfBirth: null,
  gender: null,
  phone: null,
  onboardingCompleted: false,
  isAdmin: true,
};

const customerUser: typeof adminUser = {
  ...adminUser,
  id: "customer-hmr-user",
  email: "customer-hmr@example.com",
  fullName: "HMR Customer",
  isAdmin: false,
};

const dashboard = {
  requests: [],
  advisors: [],
  settings: {
    consultationFee: 999,
    currency: "INR",
    businessWhatsapp: "",
    upiId: "admin-hmr@upi",
  },
};

const fatalConsolePattern =
  /createRoot\(\).*already been passed to createRoot|invalid hook call|errorboundary caught an error/i;

async function captureRuntimeFailures(page: Page) {
  const failures: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (fatalConsolePattern.test(text)) failures.push(text);
  });
  page.on("pageerror", (error) => failures.push(error.message));
  return failures;
}

async function mockSession(context: BrowserContext, user: typeof adminUser | null) {
  await context.route("**/api/auth/user", (route) =>
    route.fulfill({
      status: user ? 200 : 401,
      contentType: "application/json",
      body: JSON.stringify({ user }),
    }),
  );
  await context.route("**/api/admin/advice", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(dashboard),
    }),
  );
}

test("admin entry and operations panel survive a Vite hot update", async ({ browser }) => {
  const signedOutContext = await browser.newContext();
  const customerContext = await browser.newContext();
  const adminContext = await browser.newContext();
  const signedOutPage = await signedOutContext.newPage();
  const customerPage = await customerContext.newPage();
  const adminPage = await adminContext.newPage();
  const signedOutFailures = await captureRuntimeFailures(signedOutPage);
  const customerFailures = await captureRuntimeFailures(customerPage);
  const adminFailures = await captureRuntimeFailures(adminPage);

  await mockSession(signedOutContext, null);
  await mockSession(customerContext, customerUser);
  await mockSession(adminContext, adminUser);

  const mainPath = path.resolve(process.cwd(), "src/main.tsx");
  const originalMain = await readFile(mainPath, "utf8");
  const hmrProbe = `admin-hmr-${Date.now()}`;

  try {
    await signedOutPage.goto("/admin");
    await expect(signedOutPage).toHaveURL(/\/login\?returnTo=%2Fadmin$/);
    await expect(
      signedOutPage.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();

    await customerPage.goto("/admin");
    await expect(
      customerPage.getByRole("heading", { name: "This account lacks admin access" }),
    ).toBeVisible();
    await expect(customerPage.getByText("HMR Customer")).toBeVisible();
    const switchAccountLink = customerPage.getByTestId("button-switch-admin-account");
    await expect(switchAccountLink).toBeVisible();
    await expect(switchAccountLink).toHaveAttribute(
      "href",
      /\/api\/admin\/login\?returnTo=%2Fadmin$/,
    );

    await adminPage.goto("/admin");
    await expect(
      adminPage.getByRole("heading", { name: "Advice operations" }),
    ).toBeVisible();
    await expect(adminPage.getByTestId("tab-requests")).toBeVisible();

    const signedOutNavigations: string[] = [];
    const customerNavigations: string[] = [];
    const adminNavigations: string[] = [];
    signedOutPage.on("framenavigated", (frame) => {
      if (frame === signedOutPage.mainFrame()) signedOutNavigations.push(frame.url());
    });
    customerPage.on("framenavigated", (frame) => {
      if (frame === customerPage.mainFrame()) customerNavigations.push(frame.url());
    });
    adminPage.on("framenavigated", (frame) => {
      if (frame === adminPage.mainFrame()) adminNavigations.push(frame.url());
    });

    await writeFile(
      mainPath,
      `${originalMain}\n(window as Window & { __ezyRetireHmrProbe?: string }).__ezyRetireHmrProbe = ${JSON.stringify(hmrProbe)};\n`,
      "utf8",
    );

    await signedOutPage.waitForFunction(
      (expectedProbe) =>
        (window as Window & { __ezyRetireHmrProbe?: string }).__ezyRetireHmrProbe
        === expectedProbe,
      hmrProbe,
    );
    await customerPage.waitForFunction(
      (expectedProbe) =>
        (window as Window & { __ezyRetireHmrProbe?: string }).__ezyRetireHmrProbe
        === expectedProbe,
      hmrProbe,
    );
    await adminPage.waitForFunction(
      (expectedProbe) =>
        (window as Window & { __ezyRetireHmrProbe?: string }).__ezyRetireHmrProbe
        === expectedProbe,
      hmrProbe,
    );

    await expect(
      signedOutPage.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
    await expect(
      customerPage.getByRole("heading", { name: "This account lacks admin access" }),
    ).toBeVisible();
    await expect(switchAccountLink).toBeVisible();
    await expect(switchAccountLink).toBeEnabled();
    await switchAccountLink.focus();
    await expect(switchAccountLink).toBeFocused();
    await expect(
      adminPage.getByRole("heading", { name: "Advice operations" }),
    ).toBeVisible();
    await expect(adminPage.getByTestId("tab-settings")).toBeVisible();

    await expect(signedOutPage.getByRole("alert")).toHaveCount(0);
    await expect(customerPage.getByRole("alert")).toHaveCount(0);
    await expect(adminPage.getByRole("alert")).toHaveCount(0);
    expect(
      { signedOutNavigations, customerNavigations, adminNavigations },
      "all admin guard branches must update without a main-frame navigation",
    ).toEqual({
      signedOutNavigations: [],
      customerNavigations: [],
      adminNavigations: [],
    });
    expect(signedOutFailures).toEqual([]);
    expect(customerFailures).toEqual([]);
    expect(adminFailures).toEqual([]);
  } finally {
    await writeFile(mainPath, originalMain, "utf8");
    await signedOutContext.close();
    await customerContext.close();
    await adminContext.close();
  }
});
