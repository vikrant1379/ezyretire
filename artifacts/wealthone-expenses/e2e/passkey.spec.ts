import { expect, test, type Page, type Route } from "@playwright/test";

const user = {
  id: "passkey-e2e-user",
  email: "passkey@example.com",
  profileImageUrl: null,
  fullName: "Passkey Tester",
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
  if (status === 204) {
    await route.fulfill({ status });
    return;
  }
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockSignedOut(page: Page) {
  await page.route("**/api/auth/user", (route) => json(route, { user: null }));
}

async function mockSignedIn(page: Page) {
  await page.route("**/api/auth/user", (route) => json(route, { user }));
  await page.route("**/api/financial-data", (route) => json(route, financialData));
}

async function installVirtualAuthenticator(page: Page) {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { client, authenticatorId };
}

test.describe("passkey customer flows", () => {
  test("enrolls and signs in with a discoverable credential through a virtual authenticator", async ({
    browserName,
    page,
  }) => {
    test.skip(browserName !== "chromium", "CDP virtual authenticators are Chromium-only.");
    const virtualAuthenticator = await installVirtualAuthenticator(page);
    const appOrigin = "http://localhost:4173";
    const credentials: Array<{
      id: string;
      name: string;
      createdAt: string;
      lastUsedAt: string | null;
    }> = [];
    let registrationResponseId = "";
    let signedIn = true;

    await page.route("**/api/auth/user", (route) => json(route, { user: signedIn ? user : null }));
    await page.route("**/api/financial-data", (route) => json(route, financialData));
    await page.route("**/api/auth/passkeys", (route) => json(route, { credentials }));
    await page.route("**/api/auth/passkeys/registration/options", (route) =>
      json(route, {
        challengeId: "registration-ceremony",
        options: {
          challenge: "AQIDBAUGBwgJCgsMDQ4PEA",
          rp: { id: "localhost", name: "ezyRetire" },
          user: { id: "cGFzc2tleS1lMmUtdXNlcg", name: user.email, displayName: user.fullName },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 },
          ],
          timeout: 300_000,
          attestation: "none",
          authenticatorSelection: {
            residentKey: "required",
            requireResidentKey: true,
            userVerification: "required",
          },
        },
      }),
    );
    await page.route("**/api/auth/passkeys/registration/verify", async (route) => {
      const payload = route.request().postDataJSON();
      registrationResponseId = payload.response.id;
      expect(payload).toMatchObject({
        challengeId: "registration-ceremony",
        name: "My passkey",
        response: {
          id: expect.any(String),
          rawId: expect.any(String),
          type: "public-key",
          response: {
            clientDataJSON: expect.any(String),
            attestationObject: expect.any(String),
          },
        },
      });
      credentials.splice(0, credentials.length, {
        id: registrationResponseId,
        name: "My passkey",
        createdAt: "2026-09-09T00:00:00.000Z",
        lastUsedAt: null,
      });
      await json(route, { credential: credentials[0] }, 201);
    });

    await page.goto(`${appOrigin}/settings?section=security`);
    await page.getByTestId("button-add-passkey").click();
    await expect(page.getByTestId("status-passkey-success")).toContainText("Passkey added");
    await expect(page.getByTestId(`row-passkey-${registrationResponseId}`)).toBeVisible();

    signedIn = false;
    await page.route("**/api/auth/passkeys/authentication/options", (route) =>
      json(route, {
        challengeId: "authentication-ceremony",
        options: {
          challenge: "ERITFBUWFxgZGhscHR4fIA",
          rpId: "localhost",
          timeout: 300_000,
          userVerification: "required",
          allowCredentials: [],
        },
      }),
    );
    await page.route("**/api/auth/passkeys/authentication/verify", async (route) => {
      const payload = route.request().postDataJSON();
      expect(payload).toMatchObject({
        challengeId: "authentication-ceremony",
        response: {
          id: registrationResponseId,
          rawId: registrationResponseId,
          type: "public-key",
          response: {
            authenticatorData: expect.any(String),
            clientDataJSON: expect.any(String),
            signature: expect.any(String),
            userHandle: "cGFzc2tleS1lMmUtdXNlcg",
          },
        },
      });
      signedIn = true;
      await json(route, { user, needsProfile: false });
    });

    await page.goto(`${appOrigin}/login`);
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("link-desktop-nav-dashboard")).toBeVisible();

    await virtualAuthenticator.client.send("WebAuthn.removeVirtualAuthenticator", {
      authenticatorId: virtualAuthenticator.authenticatorId,
    });
  });

  test("shows supported passkey option, reports ceremony failure safely, and keeps email fallback", async ({ page }) => {
    await mockSignedOut(page);
    await page.addInitScript(() => {
      const credentials = navigator.credentials;
      Object.defineProperty(navigator, "credentials", {
        configurable: true,
        value: {
          create: credentials.create.bind(credentials),
          get: async () => {
            throw new DOMException("cancelled by test", "NotAllowedError");
          },
        },
      });
    });
    await page.route("**/api/auth/passkeys/authentication/options", (route) =>
      json(route, { challengeId: "e2e-challenge", options: { challenge: "AQID", rpId: "localhost", userVerification: "required" } }),
    );
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible();
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await expect(page.getByRole("alert")).toContainText("Passkey sign-in was cancelled or timed out. You can try again or use an email code.");
    await expect(page.getByRole("button", { name: "Email me a code" })).toBeVisible();
  });

  test("hides passkey sign-in in an unsupported environment", async ({ page }) => {
    await mockSignedOut(page);
    await page.addInitScript(() => {
      Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: undefined });
      Object.defineProperty(navigator, "credentials", { configurable: true, value: {} });
    });
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Email me a code" })).toBeVisible();
  });

  test("manages passkeys responsively and preserves recent-verification errors", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockSignedIn(page);
    await page.route("**/api/auth/passkeys", (route) => json(route, {
      credentials: [{ id: "pk-1", name: "Phone", createdAt: "2025-01-01T00:00:00Z", lastUsedAt: null }],
    }));
    await page.goto("/settings?section=security");
    await expect(page.getByTestId("row-passkey-pk-1")).toHaveCount(0);
    await expect(page.getByTestId("row-passkey-pk-1")).toContainText("Phone");
    await page.getByTestId("button-rename-passkey-pk-1").click();
    await page.getByTestId("input-passkey-name-pk-1").fill("Laptop");
    await page.route("**/api/auth/passkeys/pk-1", (route) => json(route, {
      credential: { id: "pk-1", name: "Laptop", createdAt: "2025-01-01T00:00:00Z", lastUsedAt: null },
    }));
    await page.getByTestId("button-save-passkey-pk-1").click();
    await expect(page.getByTestId("status-passkey-success")).toContainText("Passkey renamed");
    await page.getByTestId("button-revoke-passkey-pk-1").click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.route("**/api/auth/passkeys/pk-1", (route) => json(route, null, 204));
    await page.getByTestId("button-confirm-revoke-passkey").click();
    await expect(page.getByTestId("status-passkey-success")).toContainText("Passkey revoked");
  });

  test("shows an actionable recent-email-verification management error", async ({ page }) => {
    await mockSignedIn(page);
    await page.route("**/api/auth/passkeys", (route) => json(route, {
      error: "Verify your email in this session before managing passkeys",
      reason: "current_session_email_verification_required",
    }, 403));
    await page.goto("/settings?section=security");
    await expect(page.getByTestId("status-passkey-error")).toContainText("Verify your email in this session before managing passkeys");
    await expect(page.getByTestId("link-verify-email-for-passkeys")).toHaveAttribute("href", "/login?verify=passkeys&returnTo=%2Fsettings%3Fsection%3Dsecurity");
    await expect(page.getByTestId("text-passkeys-unavailable")).toBeVisible();
    await expect(page.getByTestId("text-no-passkeys")).toHaveCount(0);
    await expect(page.getByTestId("button-add-passkey")).toBeDisabled();
  });

  test("remembered PIN users complete the Settings passkey email step-up", async ({ page }) => {
    let steppedUp = false;
    let enrollmentRequested = false;
    await page.addInitScript((remembered) => {
      localStorage.setItem("ezyretire:remembered-account:v1", JSON.stringify(remembered));
    }, { email: "stale-account@example.com", fullName: "Stale Account" });
    await mockSignedIn(page);
    await page.route("**/api/auth/passkeys", (route) => steppedUp
      ? json(route, { credentials: [] })
      : json(route, {
          error: "Verify your email in this session before managing passkeys",
          reason: "current_session_email_verification_required",
        }, 403));
    await page.route("**/api/auth/otp/request", (route) => {
      expect(route.request().postDataJSON()).toEqual({ purpose: "passkey_management" });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "set-cookie": "__Host-ezyretire-passkey-step-up=test-binding; Path=/; HttpOnly; Secure; SameSite=Strict" },
        body: JSON.stringify({ challengeId: "11111111-1111-4111-8111-111111111111", resendAfterSeconds: 60 }),
      });
    });
    await page.route("**/api/auth/otp/verify", (route) => {
      steppedUp = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "set-cookie": "__Host-ezyretire-passkey-step-up=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict" },
        body: JSON.stringify({ user: { ...user, onboardingCompleted: false }, needsProfile: true, pinConfigured: false, passkeyStepUpAuthorized: true }),
      });
    });
    await page.route("**/api/auth/passkeys/registration/options", (route) => {
      enrollmentRequested = true;
      return json(route, { error: "Enrollment stopped after proving the handoff." }, 503);
    });

    await page.goto("/settings?section=security");
    await page.getByTestId("link-verify-email-for-passkeys").click();
    await expect(page.getByRole("heading", { name: "Verify to manage passkeys" })).toBeVisible();
    await expect(page.getByTestId("input-email")).toHaveValue(user.email);
    await expect(page.getByTestId("input-email")).toHaveAttribute("readonly", "");
    await expect(page.getByTestId("button-forgot-pin")).toHaveCount(0);
    await page.getByTestId("button-submit-auth").click();
    await expect.poll(async () => (await page.context().cookies()).some((cookie) => cookie.name === "__Host-ezyretire-passkey-step-up")).toBe(true);
    await page.getByTestId("input-code").fill("123456");
    await page.getByTestId("button-submit-auth").click();
    await expect(page).toHaveURL(/\/settings\?section=security$/);
    await expect.poll(async () => (await page.context().cookies()).some((cookie) => cookie.name === "__Host-ezyretire-passkey-step-up")).toBe(false);
    await expect(page.getByTestId("text-no-passkeys")).toBeVisible();
    await expect(page.getByTestId("button-add-passkey")).toBeEnabled();
    await page.getByTestId("button-add-passkey").click();
    await expect.poll(() => enrollmentRequested).toBe(true);
  });
});