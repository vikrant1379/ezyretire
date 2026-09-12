import { expect, test, type Page, type Route } from "@playwright/test";

const user = {
  id: "change-pin-e2e-user",
  email: "change-pin@example.com",
  profileImageUrl: null,
  fullName: "PIN Change Tester",
  dateOfBirth: "1990-01-15",
  gender: "Prefer not to say",
  phone: null,
  onboardingCompleted: true,
  isAdmin: false,
};

const financialData = {
  profileInputs: {
    fullName: user.fullName,
    email: user.email,
    phone: null,
    gender: user.gender,
    dateOfBirth: user.dateOfBirth,
    targetRetirementAge: 60,
    lifeExpectancy: 85,
    riskPreference: "Balanced",
    onboardingCompleted: true,
  },
  retirementInputs: {},
  expenses: [],
  budgets: [],
  incomeSources: [],
  investments: [],
  loans: [],
  uiPreferences: {},
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockSignedInProfile(page: Page) {
  await page.route("**/api/auth/user", (route) => json(route, { user }));
  await page.route("**/api/financial-data", (route) => json(route, financialData));
  await page.route("**/api/auth/passkeys", (route) => json(route, { credentials: [] }));
}

test("changes a PIN only after fresh email verification and returns to Settings", async ({ page }) => {
  await mockSignedInProfile(page);

  await page.goto("/settings?section=security");
  await page.getByTestId("link-change-pin").click();

  await expect(page).toHaveURL(/\/login\?changePin=true&returnTo=%2Fsettings$/);
  await expect(page.getByRole("heading", { name: "Verify to change your PIN" })).toBeVisible();
  await expect(page.getByTestId("button-sign-in-passkey")).toHaveCount(0);

  await page.route("**/api/auth/otp/request", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ email: user.email });
    await json(route, { challengeId: "11111111-1111-4111-8111-111111111111", resendAfterSeconds: 0 });
  });
  await page.route("**/api/auth/otp/verify", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      challengeId: "11111111-1111-4111-8111-111111111111",
      code: "654321",
    });
    await json(route, { user, needsProfile: false, pinConfigured: true });
  });

  const submittedPins: string[] = [];
  await page.route("**/api/auth/pin/setup", async (route) => {
    submittedPins.push(route.request().postDataJSON().pin);
    await json(route, { user, pinConfigured: true });
  });

  await page.getByTestId("input-email").fill(user.email);
  await page.getByTestId("button-submit-auth").click();
  await page.getByTestId("input-code").fill("654321");
  await page.getByTestId("button-submit-auth").click();

  await expect(page.getByRole("heading", { name: "Choose your new PIN" })).toBeVisible();
  await page.keyboard.type("2468");
  await page.getByTestId("button-submit-pin").click();
  await expect(page.getByRole("heading", { name: "Confirm your PIN" })).toBeVisible();
  await page.keyboard.type("2468");
  await page.getByTestId("button-submit-pin").click();

  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole("link", { name: "Security & access" }).click();
  await expect(page).toHaveURL(/\/settings\?section=security$/);
  await expect(page.getByTestId("link-change-pin")).toBeVisible();
  expect(submittedPins).toEqual(["2468"]);
});