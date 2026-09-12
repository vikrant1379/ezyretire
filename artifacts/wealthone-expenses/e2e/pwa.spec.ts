import { expect, test } from "@playwright/test";

const expectedIcons = new Map([
  ["/icon-192.png", { width: 192, height: 192, purpose: "any" }],
  ["/icon-maskable-512.png", { width: 512, height: 512, purpose: "maskable" }],
  ["/icon-512.png", { width: 512, height: 512, purpose: "any" }],
]);

test("production build exposes complete install metadata and valid icons", async ({ page, request }) => {
  await page.goto("/");

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/site.webmanifest");
  const canonicalThemeColor = await page.evaluate(() => {
    const background = window.getComputedStyle(document.documentElement)
      .getPropertyValue("--background")
      .trim();
    if (!background) throw new Error("The canonical --background theme token is unavailable.");
    return `hsl(${background})`;
  });
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    canonicalThemeColor,
  );
  await expect(page.locator('meta[name="application-name"]')).toHaveAttribute("content", "ezyRetire");
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "ezyRetire");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("sizes", "180x180");

  const manifestResponse = await request.get("/site.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  expect(manifestResponse.headers()["content-type"]).toContain("manifest");
  const manifest = await manifestResponse.json();
  expect(manifest.background_color).toBe(manifest.theme_color);

  const offlineResponse = await request.get("/offline.html");
  expect(offlineResponse.ok()).toBe(true);
  const offlineHtml = await offlineResponse.text();
  expect(offlineHtml).toContain(
    `<meta name="theme-color" content="${manifest.theme_color}" />`,
  );
  expect(offlineHtml).toContain(
    `--offline-background: ${manifest.background_color};`,
  );
  expect(offlineHtml).toMatch(
    /\bbody\s*\{[\s\S]*?\bbackground:\s*var\(--offline-background\)\s*;/,
  );

  const brandEvidenceResponse = await request.get("/brand-assets.json");
  expect(brandEvidenceResponse.ok()).toBe(true);
  const brandEvidence = await brandEvidenceResponse.json();
  expect(manifest.icons).toHaveLength(expectedIcons.size);

  for (const icon of manifest.icons) {
    const expected = expectedIcons.get(icon.src);
    expect(expected, `unexpected manifest icon ${icon.src}`).toBeDefined();
    expect(icon).toMatchObject({
      sizes: `${expected!.width}x${expected!.height}`,
      type: "image/png",
      purpose: expected!.purpose,
    });
    expect(brandEvidence.assets).toContainEqual(expect.objectContaining({
      file: icon.src.slice(1),
      width: expected!.width,
      height: expected!.height,
      purpose: expected!.purpose,
      sourceMarker: "ezyretire-black-silver-launcher-supplied-v2",
    }));
    const response = await request.get(icon.src);
    expect(response.ok(), `${icon.src} is available`).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/png");
    const dimensions = await page.evaluate(
      (src) =>
        new Promise<{ width: number; height: number }>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
          image.onerror = () => reject(new Error(`Could not decode ${src}`));
          image.src = src;
        }),
      icon.src,
    );
    expect(dimensions).toEqual({ width: expected!.width, height: expected!.height });
  }

  const appleIcon = await page.evaluate(
    () =>
      new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error("Could not decode Apple touch icon"));
        image.src = "/apple-touch-icon.png";
      }),
  );
  expect(appleIcon).toEqual({ width: 180, height: 180 });
  expect(brandEvidence.assets).toContainEqual(expect.objectContaining({
    file: "apple-touch-icon.png",
    width: 180,
    height: 180,
    purpose: "apple-touch-and-splash",
    sourceMarker: "ezyretire-black-silver-launcher-supplied-v2",
  }));
});

test("service worker controls the production scope, cleans old caches, and serves offline navigation", async ({
  context,
  page,
}) => {
  await context.addInitScript(() => caches.open("ezyretire-static-obsolete"));
  await page.goto("/");

  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL))
    .toMatch(/\/sw\.js$/);

  const registration = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return {
      scope: registration.scope,
      scriptURL: registration.active?.scriptURL,
    };
  });
  expect(new URL(registration.scope).pathname).toBe("/");
  expect(registration.scriptURL).toMatch(/\/sw\.js$/);
  await expect
    .poll(() => page.evaluate(() => caches.keys()))
    .not.toContain("ezyretire-static-obsolete");

  await context.setOffline(true);
  await page.goto("/offline-readiness-check");
  await expect(page).toHaveTitle("ezyRetire — Offline");
  await expect(page.getByRole("heading", { name: "You’re offline" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Waiting for a connection.");

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("status")).toHaveText(
    "Internet restored. ezyRetire is still unavailable. Try again in a moment.",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByRole("status")).toHaveText("Connection lost. Waiting for a connection.");
  await expect(page.locator("html")).toHaveAttribute("data-recovery-state", "cancelled");
  await expect(page).toHaveTitle("ezyRetire — Offline");

  await context.setOffline(false);
  await page.route("**/offline-readiness-check", (route) => {
    if (route.request().method() === "HEAD") {
      return route.abort("connectionfailed");
    }
    return route.continue();
  });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("heading", { name: "ezyRetire is still unavailable" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(
    "Internet restored. ezyRetire is still unavailable. Try again in a moment.",
  );
  await expect(page.getByRole("button", { name: "Try ezyRetire again" })).toBeEnabled();
  await expect(page).toHaveURL(/\/offline-readiness-check$/);
  await expect(page.locator("html")).toHaveAttribute("data-recovery-state", "idle");
  await expect(page).toHaveTitle("ezyRetire — Offline");
});

test("an existing installation receives the canonical offline colors after updating", async ({
  context,
  page,
}) => {
  await page.goto("/safari-storage-check-setup.html");
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
    await navigator.serviceWorker.register("/legacy-sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL))
    .toContain("/legacy-sw.js");
  await expect
    .poll(() => page.evaluate(() => caches.keys()))
    .toContain("ezyretire-static-v4");

  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  });
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL))
    .toMatch(/\/sw\.js$/);
  await expect
    .poll(() => page.evaluate(() => caches.keys()))
    .toContain("ezyretire-static-v5");
  await expect
    .poll(() => page.evaluate(() => caches.keys()))
    .not.toContain("ezyretire-static-v4");

  await context.setOffline(true);
  await page.goto("/offline-upgrade-check");
  await expect(page).toHaveTitle("ezyRetire — Offline");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#f9faf8");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(249, 250, 248)");
});

test("offline recovery stops waiting when the availability check never responds", async ({
  context,
  page,
}) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.goto("/availability-check-timeout");
  await expect(page).toHaveTitle("ezyRetire — Offline");

  await context.setOffline(false);
  await page.route("**/availability-check-timeout", async (route) => {
    if (route.request().method() === "HEAD") {
      await new Promise(() => {});
    }
    await route.continue();
  });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect(page.getByRole("status")).toHaveText(
    "Internet restored. Checking ezyRetire availability.",
  );
  await expect(page.getByRole("heading", { name: "ezyRetire is still unavailable" })).toBeVisible({
    timeout: 7000,
  });
  await expect(page.getByRole("status")).toHaveText(
    "Internet restored. ezyRetire is still unavailable. Try again in a moment.",
  );
  await expect(page.getByRole("button", { name: "Try ezyRetire again" })).toBeEnabled();
  await expect(page).toHaveURL(/\/availability-check-timeout$/);
});

for (const lateResult of ["success", "failure"] as const) {
  test(`offline recovery ignores a late availability ${lateResult} after the connection drops again`, async ({
    context,
    page,
  }) => {
    await page.goto("/");
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    await context.setOffline(true);
    await page.goto(`/availability-check-interrupted-${lateResult}`);
    await expect(page).toHaveTitle("ezyRetire — Offline");

    let availabilityCheckStarted: (() => void) | undefined;
    const availabilityCheckWasStarted = new Promise<void>((resolve) => {
      availabilityCheckStarted = resolve;
    });
    let releaseAvailabilityCheck: (() => void) | undefined;
    const availabilityCheckReleased = new Promise<void>((resolve) => {
      releaseAvailabilityCheck = resolve;
    });

    await context.setOffline(false);
    await page.route(`**/availability-check-interrupted-${lateResult}`, async (route) => {
      if (route.request().method() !== "HEAD") {
        return route.continue();
      }

      availabilityCheckStarted?.();
      await availabilityCheckReleased;
      if (lateResult === "success") {
        await route.fulfill({ status: 200 });
      } else {
        await route.abort("connectionfailed");
      }
    });
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await availabilityCheckWasStarted;
    await expect(page.getByRole("status")).toHaveText(
      "Internet restored. Checking ezyRetire availability.",
    );

    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.getByRole("heading", { name: "You’re offline" })).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("Connection lost. Waiting for a connection.");
    await expect(page.getByRole("button", { name: "Try again" })).toBeEnabled();

    releaseAvailabilityCheck?.();
    await expect(page.locator("html")).toHaveAttribute("data-recovery-state", "cancelled");
    await page.waitForTimeout(100);
    await expect(page.getByRole("heading", { name: "You’re offline" })).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("Connection lost. Waiting for a connection.");
    await expect(page.getByRole("button", { name: "Try again" })).toBeEnabled();
    await expect(page).toHaveURL(new RegExp(`/availability-check-interrupted-${lateResult}$`));
  });
}

test("offline recovery works when privacy settings block session storage", async ({
  browserName,
  context,
  page,
  request,
}) => {
  await page.goto("/");
  const serviceWorkersAvailable = await page.evaluate(
    () => "serviceWorker" in navigator,
  );
  test.skip(
    browserName === "webkit" && !serviceWorkersAvailable,
    "Playwright WebKit does not expose service workers in this runtime, so it cannot exercise Safari-like offline recovery.",
  );
  if (browserName === "webkit") {
    test.info().annotations.push({
      type: "webkit-limitation",
      description:
        "Playwright WebKit is the closest automated Safari proxy, but it does not reproduce every Safari-specific service-worker and storage behavior.",
    });
  }

  await expect
    .poll(
      () => page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      {
        message:
          browserName === "webkit"
            ? "Playwright WebKit did not obtain service-worker control; this runtime cannot verify Safari-like offline recovery."
            : "The page did not obtain service-worker control.",
      },
    )
    .toBe(true);

  await context.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage access is blocked", "SecurityError");
      },
    });
  });
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  let automaticRecoveryAttempts = 0;
  page.on("request", (request) => {
    if (
      request.isNavigationRequest() &&
      new URL(request.url()).pathname === "/storage-blocked-auto-recovery"
    ) {
      automaticRecoveryAttempts += 1;
    }
  });

  await request.post("/api/pwa-recovery-network?blocked=true");
  await context.setOffline(true);
  await page.goto("/storage-blocked-auto-recovery");
  await expect(page).toHaveTitle("ezyRetire — Offline");

  await request.post("/api/pwa-recovery-network?blocked=false");
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("heading", { name: "You’re back online" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("ezyRetire is available. Reopening now.");
  await expect(page.getByRole("button", { name: "Open ezyRetire now" })).toBeEnabled();
  await expect(page).toHaveTitle("ezyRetire — Track, plan, retire");
  expect(automaticRecoveryAttempts).toBe(2);
  await expect
    .poll(() => page.evaluate(() => document.readyState))
    .toBe("complete");
  expect(await page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(1);
  expect(automaticRecoveryAttempts).toBe(2);

  await request.post("/api/pwa-recovery-network?blocked=true");
  await context.setOffline(true);
  await page.goto("/storage-blocked-manual-recovery");
  await request.post("/api/pwa-recovery-network?blocked=false");
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.getByRole("button", { name: "Open ezyRetire now" }).click();
  await expect(page).toHaveTitle("ezyRetire — Track, plan, retire");

  expect(pageErrors).toEqual([]);
});

test("warns once while online and still fails safely when Cache Storage is blocked", async ({
  context,
  page,
}) => {
  await context.addInitScript(() => {
    const analyticsWindow = window as typeof window & { analyticsEvents: string[] };
    analyticsWindow.analyticsEvents = [];
    window.umami = {
      track(name) {
        analyticsWindow.analyticsEvents.push(name);
        throw new Error("Analytics unavailable");
      },
    };

    if (!("serviceWorker" in navigator)) return;
    const serviceWorkerPrototype = Object.getPrototypeOf(navigator.serviceWorker);
    const register = serviceWorkerPrototype.register;
    serviceWorkerPrototype.register = function (scriptURL: string | URL, options?: RegistrationOptions) {
      const url = new URL(String(scriptURL), window.location.href);
      if (url.pathname === "/sw.js") url.searchParams.set("mutable-cache-storage", "");
      return register.call(this, url.href, options);
    };
  });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL))
    .toContain("mutable-cache-storage");

    const warning = page.getByRole("status", { name: "Offline access unavailable" });
  await expect(warning).toContainText(
    "Your browser privacy settings prevent ezyRetire from saving its offline page.",
  );
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (
      window as typeof window & { analyticsEvents: string[] }
    ).analyticsEvents))
    .toEqual(["offline_storage_warning_shown"]);
  await expect
    .poll(() => page.evaluate(() => (
      window.localStorage.getItem("ezyretire:offline-storage-unavailable")
    )))
    .not.toBeNull();

  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  let blockedNavigationAttempts = 0;
  page.on("request", (request) => {
    if (
      request.isNavigationRequest()
      && new URL(request.url()).pathname === "/cache-storage-revoked-recovery"
    ) {
      blockedNavigationAttempts += 1;
    }
  });

  await page.evaluate(() => {
    navigator.serviceWorker.controller?.postMessage("revoke-cache-storage");
  });
  await context.setOffline(true);
  await expect(page.goto("/cache-storage-revoked-recovery")).rejects.toThrow();
  await page.waitForTimeout(1500);
  const settledNavigationAttempts = blockedNavigationAttempts;
  await page.waitForTimeout(1000);

  expect(settledNavigationAttempts).toBeGreaterThan(0);
  expect(settledNavigationAttempts).toBeLessThanOrEqual(2);
  expect(blockedNavigationAttempts).toBe(settledNavigationAttempts);
  expect(pageErrors).toEqual([]);

  await context.setOffline(false);
  await page.goto("/");
  await page.getByRole("button", { name: "Dismiss offline access notice" }).click();
  await expect(warning).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => (
      window as typeof window & { analyticsEvents: string[] }
    ).analyticsEvents))
    .toEqual(["offline_storage_warning_dismissed"]);
  await page.reload();
  await expect(page).toHaveTitle("ezyRetire — Track, plan, retire");
  await expect(warning).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
});

test("updates the offline storage warning when privacy settings change mid-session", async ({
  context,
  page,
}) => {
  await context.addInitScript(() => {
    const analyticsWindow = window as typeof window & { analyticsEvents: string[] };
    analyticsWindow.analyticsEvents = [];
    window.umami = {
      track(name) {
        analyticsWindow.analyticsEvents.push(name);
        throw new Error("Analytics unavailable");
      },
    };

    if (!("serviceWorker" in navigator)) return;
    const serviceWorkerPrototype = Object.getPrototypeOf(navigator.serviceWorker);
    const register = serviceWorkerPrototype.register;
    serviceWorkerPrototype.register = function (scriptURL: string | URL, options?: RegistrationOptions) {
      const url = new URL(String(scriptURL), window.location.href);
      if (url.pathname === "/sw.js") url.searchParams.set("mutable-cache-storage", "");
      return register.call(this, url.href, options);
    };
  });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL))
    .toContain("mutable-cache-storage");

    const warning = page.getByRole("status", { name: "Offline access unavailable" });
  await expect(warning).toBeHidden();

  await page.evaluate(() => {
    navigator.serviceWorker.controller?.postMessage({
      type: "SET_CACHE_STORAGE_BLOCKED",
      blocked: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(warning).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();

  await page.evaluate(() => {
    navigator.serviceWorker.controller?.postMessage({
      type: "SET_OFFLINE_STORAGE_CHECK_RESPONSIVE",
      responsive: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(2500);
  await expect(warning).toBeVisible();

  await page.reload();
  await expect(warning).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(warning).toBeVisible();

  await page.evaluate(() => {
    navigator.serviceWorker.controller?.postMessage({
      type: "SET_OFFLINE_STORAGE_CHECK_RESPONSIVE",
      responsive: true,
    });
    navigator.serviceWorker.controller?.postMessage({
      type: "SET_CACHE_STORAGE_BLOCKED",
      blocked: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(warning).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => (
      window.localStorage.getItem("ezyretire:offline-storage-unavailable")
    )))
    .toBeNull();
  await expect
    .poll(() => page.evaluate(() => (
      window as typeof window & { analyticsEvents: string[] }
    ).analyticsEvents))
    .toEqual([
      "offline_storage_warning_shown",
      "offline_storage_recovered",
    ]);

  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(await page.evaluate(() => (
    window as typeof window & { analyticsEvents: string[] }
  ).analyticsEvents)).toEqual([
    "offline_storage_warning_shown",
    "offline_storage_recovered",
  ]);

  await page.evaluate(() => {
    navigator.serviceWorker.controller?.postMessage({
      type: "SET_CACHE_STORAGE_BLOCKED",
      blocked: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(warning).toBeVisible();
  await page.getByRole("button", { name: "Dismiss offline access notice" }).click();
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(warning).toBeHidden();
});

test("expires a stale confirmed offline storage warning after seven days", async ({
  context,
  page,
}) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("ezyretire:offline-storage-unavailable", JSON.stringify({
      confirmedAt: Date.now() - (7 * 24 * 60 * 60 * 1000) - 1,
      unavailable: true,
    }));
  });

  await page.goto("/");

    const warning = page.getByRole("status", { name: "Offline access unavailable" });
  await expect(warning).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => (
      window.localStorage.getItem("ezyretire:offline-storage-unavailable")
    )))
    .toBeNull();
});

test("keeps a current confirmed offline storage warning visible when local storage is blocked", async ({
  context,
  page,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage access is blocked", "SecurityError");
      },
    });
  });
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("ezyretire:offline-storage-availability", {
      detail: { available: false },
    }));
  });

  await expect(page.getByRole("status", { name: "Offline access unavailable" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("removes a malformed persisted offline storage warning without a page error", async ({
  context,
  page,
}) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("ezyretire:offline-storage-unavailable", "{not-json");
  });
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.goto("/");

  await expect(page.getByRole("status", { name: "Offline access unavailable" })).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => (
      window.localStorage.getItem("ezyretire:offline-storage-unavailable")
    )))
    .toBeNull();
  expect(pageErrors).toEqual([]);
});

for (const { family, userAgent, guidance } of [
  {
    family: "Chromium",
    userAgent: "Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
    guidance: "Privacy and security → Site settings",
  },
  {
    family: "Firefox",
    userAgent: "Mozilla/5.0 Gecko/20100101 Firefox/142.0",
    guidance: "Settings → Privacy & Security → Cookies and Site Data",
  },
  {
    family: "Safari",
    userAgent: "Mozilla/5.0 Version/19.0 Safari/605.1.15",
    guidance: "Settings → Privacy",
  },
  {
    family: "an unknown browser",
    userAgent: "ExampleBrowser/1.0",
    guidance: "privacy or site-data settings",
  },
]) {
  test(`offers usable privacy-setting guidance for ${family}`, async ({ context, page }) => {
    await context.addInitScript((agent) => {
      Object.defineProperty(window.navigator, "userAgent", {
        configurable: true,
        value: agent,
      });
      const testWindow = window as typeof window & { offlineStorageAvailabilityUpdates: number };
      testWindow.offlineStorageAvailabilityUpdates = 0;
      window.addEventListener("ezyretire:offline-storage-availability", () => {
        testWindow.offlineStorageAvailabilityUpdates += 1;
      });
    }, userAgent);

    await page.goto("/");
    await expect
      .poll(() => page.evaluate(() => (
        window as typeof window & { offlineStorageAvailabilityUpdates: number }
      ).offlineStorageAvailabilityUpdates))
      .toBeGreaterThan(0);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("ezyretire:offline-storage-availability", {
        detail: { available: false },
      }));
    });

    const warning = page.getByRole("status", { name: "Offline access unavailable" });
    await expect(warning).toContainText(guidance);
    await warning.getByRole("button", { name: "Dismiss offline access notice" }).click();
    await expect(warning).toBeHidden();
  });
}

test("offline recovery fails safely when Cache Storage is revoked after install", async ({
  context,
  page,
}) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    await navigator.serviceWorker.register("/sw.js?revoke-cache-storage", { scope: "/" });
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL))
    .toContain("revoke-cache-storage");
  await expect
    .poll(() => page.evaluate(async () => (await caches.match("/offline.html"))?.ok))
    .toBe(true);

  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  let blockedNavigationAttempts = 0;
  page.on("request", (request) => {
    if (
      request.isNavigationRequest()
      && new URL(request.url()).pathname === "/cache-storage-revoked-recovery"
    ) {
      blockedNavigationAttempts += 1;
    }
  });

  await page.evaluate(() => {
    navigator.serviceWorker.controller?.postMessage("revoke-cache-storage");
  });
  await context.setOffline(true);
  await expect(page.goto("/cache-storage-revoked-recovery")).rejects.toThrow();
  await page.waitForTimeout(1500);
  const settledNavigationAttempts = blockedNavigationAttempts;
  await page.waitForTimeout(1000);

  expect(settledNavigationAttempts).toBeGreaterThan(0);
  expect(settledNavigationAttempts).toBeLessThanOrEqual(2);
  expect(blockedNavigationAttempts).toBe(settledNavigationAttempts);
  expect(pageErrors).toEqual([]);
});

test("static assets stay available when Cache Storage is revoked between install and fetch", async ({
  context,
  page,
}) => {
  const serviceWorkerErrors: Error[] = [];
  context.on("weberror", (webError) => serviceWorkerErrors.push(webError.error()));

  await page.goto("/");
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    await navigator.serviceWorker.register("/sw.js?revoke-cache-storage", { scope: "/" });
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL))
    .toContain("revoke-cache-storage");

  const assetUrl = "/assets/pwa-cache-storage-revocation.txt";
  const cachedResponse = await page.evaluate(
    (url) => fetch(url).then((response) => response.text()),
    assetUrl,
  );
  expect(cachedResponse).toMatch(/^network-response-\d+$/);
  await expect
    .poll(() =>
      page.evaluate(async (url) => {
        for (const cacheName of await caches.keys()) {
          if (await (await caches.open(cacheName)).match(url)) return true;
        }
        return false;
      }, assetUrl),
    )
    .toBe(true);

  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const controller = navigator.serviceWorker.controller;
      if (!controller) {
        reject(new Error("The service worker is not controlling the page."));
        return;
      }
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      controller.postMessage("revoke-cache-storage", [channel.port2]);
    });
  });

  const firstNetworkResponse = await page.evaluate(
    (url) => fetch(url).then((response) => response.text()),
    assetUrl,
  );
  const secondNetworkResponse = await page.evaluate(
    (url) => fetch(url).then((response) => response.text()),
    assetUrl,
  );

  expect(firstNetworkResponse).toMatch(/^network-response-\d+$/);
  expect(secondNetworkResponse).toMatch(/^network-response-\d+$/);
  expect(firstNetworkResponse).not.toBe(cachedResponse);
  expect(secondNetworkResponse).not.toBe(firstNetworkResponse);
  expect(pageErrors).toEqual([]);
  expect(serviceWorkerErrors).toEqual([]);
});

test("authenticated and financial API requests remain network-only", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  const responses = await page.evaluate(async () => {
    const first = await fetch("/api/pwa-cache-safety").then((result) => result.json());
    const second = await fetch("/api/pwa-cache-safety").then((result) => result.json());
    return [first, second];
  });
  expect(responses).toEqual([{ requestCount: 1 }, { requestCount: 2 }]);
  const cachedApiUrls = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const key of await caches.keys()) {
      const cache = await caches.open(key);
      urls.push(...(await cache.keys()).map((request) => request.url));
    }
    return urls.filter((url) => new URL(url).pathname.startsWith("/api/"));
  });
  expect(cachedApiUrls).toEqual([]);
});
