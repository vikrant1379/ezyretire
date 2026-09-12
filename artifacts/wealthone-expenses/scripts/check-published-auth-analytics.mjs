import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';

export const AUTH_FUNNEL_EVENTS = [
  {
    boundary: 'code request success',
    name: 'email_sign_in_code_requested',
    data: { request_kind: 'initial' },
  },
  {
    boundary: 'code verification success',
    name: 'email_sign_in_verified',
    data: undefined,
  },
  {
    boundary: 'profile completion success',
    name: 'email_sign_in_profile_completed',
    data: undefined,
  },
];

const SYNTHETIC_ACCOUNT = {
  email: 'published-auth-analytics@example.invalid',
  code: '246810',
  challengeId: 'synthetic-published-auth-analytics-check',
  fullName: 'Synthetic Analytics Check',
  dateOfBirth: '01/01/1980',
  gender: 'Prefer not to say',
};

export function assertAuthFunnelEvents(events) {
  for (const expected of AUTH_FUNNEL_EVENTS) {
    const matchingEvents = events.filter(({ name }) => name === expected.name);
    if (matchingEvents.length === 0) {
      throw new Error(
        `${expected.boundary} did not reach the injected analytics tracker (${expected.name}).`,
      );
    }
    if (matchingEvents.length > 1) {
      throw new Error(
        `${expected.boundary} reached the injected analytics tracker ${matchingEvents.length} times; expected once (${expected.name}).`,
      );
    }
    const receivedData = matchingEvents[0].data;
    const expectedData = expected.data;
    const hasApprovedData =
      expectedData === undefined
        ? receivedData === undefined
        : receivedData !== null
          && !Array.isArray(receivedData)
          && typeof receivedData === 'object'
          && Object.keys(receivedData).length === 1
          && receivedData.request_kind === expectedData.request_kind;
    if (!hasApprovedData) {
      throw new Error(
        `${expected.boundary} included unapproved analytics data; only the coarse request_kind dimension is allowed, and email, code, challenge, or profile values are forbidden (${expected.name}).`,
      );
    }
  }
}

export async function checkPublishedAuthAnalytics(
  publishedUrl,
  {
    accessToken,
    browserType = chromium,
    timeoutMs = 15_000,
  } = {},
) {
  let pageUrl;
  try {
    pageUrl = new URL('/login', publishedUrl);
  } catch {
    throw new Error(
      `Published URL must be an absolute HTTP(S) URL, received "${publishedUrl}".`,
    );
  }
  if (!['http:', 'https:'].includes(pageUrl.protocol)) {
    throw new Error(
      `Published URL must use HTTP(S), received "${pageUrl.protocol}".`,
    );
  }

  const browser = await browserType.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ?? '/repl/tools/bin/chromium',
    headless: true,
  });
  const receivedEvents = [];

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    if (accessToken) {
      await page.route(`${pageUrl.origin}/**`, async (route) => {
        await route.continue({
          headers: {
            ...route.request().headers(),
            Authorization: `Bearer ${accessToken}`,
          },
        });
      });
    }

    // These routes are scoped to this synthetic browser tab. The deployed auth
    // API remains untouched and must never accept the synthetic credentials.
    await page.route(`${pageUrl.origin}/api/auth/otp/request`, async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          challengeId: SYNTHETIC_ACCOUNT.challengeId,
          resendAfterSeconds: 60,
        }),
      });
    });
    await page.route(`${pageUrl.origin}/api/auth/otp/verify`, async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ needsProfile: true, user: {} }),
      });
    });
    await page.route(`${pageUrl.origin}/api/auth/profile`, async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          user: { onboardingCompleted: true },
        }),
      });
    });

    await page.goto(pageUrl.href, { waitUntil: 'domcontentloaded' });
    const emailInput = page.getByLabel('Email address');
    const reachedSignIn = await emailInput
      .waitFor({ state: 'visible', timeout: timeoutMs })
      .then(() => true)
      .catch(() => false);
    if (!reachedSignIn) {
      throw new Error(
        'The published sign-in page could not be reached. If the deployment is private, provide a valid Production external access token in PUBLISHED_SITE_ACCESS_TOKEN.',
      );
    }
    await page.waitForFunction(
      () => typeof window.umami?.track === 'function',
      undefined,
      { timeout: timeoutMs },
    ).catch(() => {
      throw new Error(
        'The published page did not expose the injected analytics tracker. Confirm analytics is enabled and republish the website.',
      );
    });

    await page.exposeFunction(
      '__recordPublishedAuthAnalyticsEvent',
      (name, data) => {
        receivedEvents.push({ name, data });
      },
    );
    await page.evaluate(() => {
      const originalTrack = window.umami.track.bind(window.umami);
      window.umami.track = (name, data) => {
        window.__recordPublishedAuthAnalyticsEvent(name, data);
        originalTrack(name, data);
      };
    });

    await emailInput.fill(SYNTHETIC_ACCOUNT.email);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('6-digit sign-in code').fill(SYNTHETIC_ACCOUNT.code);
    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await page.getByLabel('Full name').fill(SYNTHETIC_ACCOUNT.fullName);
    await page.getByLabel('Date of birth').fill(SYNTHETIC_ACCOUNT.dateOfBirth);
    await page.getByLabel('Gender').click();
    await page
      .getByRole('option', { name: SYNTHETIC_ACCOUNT.gender })
      .click();
    await page.getByRole('button', { name: 'Complete account' }).click();

    // Allow the tracker wrapper's exposed callback to cross the browser/Node
    // boundary before evaluating the complete funnel.
    await page.waitForTimeout(250);
    assertAuthFunnelEvents(receivedEvents);

    await context.close();
    return { events: receivedEvents.map(({ name }) => name) };
  } finally {
    await browser.close();
  }
}

async function main() {
  const publishedUrl =
    process.argv.slice(2).find((argument) => argument !== '--')
    || process.env.PUBLISHED_URL;
  if (!publishedUrl) {
    throw new Error(
      'Provide the published site URL as an argument or set PUBLISHED_URL.',
    );
  }

  const result = await checkPublishedAuthAnalytics(publishedUrl, {
    accessToken: process.env.PUBLISHED_SITE_ACCESS_TOKEN,
  });
  console.log(
    `Published sign-in analytics check passed: ${result.events.length} secure funnel events reached the injected tracker.`,
  );
  for (const eventName of result.events) console.log(`- ${eventName}`);
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      `Published sign-in analytics check failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}