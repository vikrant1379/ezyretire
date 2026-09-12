const CACHE_PREFIX = "ezyretire-static-";
const CACHE_NAME = `${CACHE_PREFIX}v3`;
const PRECACHE_URLS = [
  "./offline.html",
  "./site.webmanifest",
  "./favicon.png",
  "./apple-touch-icon.png",
  "./icon-192.png",
  "./icon-512.png",
];

const useCacheStorage = (operation) => {
  try {
    return Promise.resolve(operation(caches)).catch(() => undefined);
  } catch {
    return Promise.resolve(undefined);
  }
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    useCacheStorage((cacheStorage) => cacheStorage.open(CACHE_NAME))
      .then((cache) => cache?.addAll(PRECACHE_URLS))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    useCacheStorage((cacheStorage) => cacheStorage.keys())
      .then((keys) =>
        Promise.all(
          (keys ?? [])
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => useCacheStorage((cacheStorage) => cacheStorage.delete(key))),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CHECK_OFFLINE_STORAGE") return;

  event.waitUntil(
    useCacheStorage((cacheStorage) => cacheStorage.open(CACHE_NAME))
      .then((cache) => cache?.match("./offline.html"))
      .then((offlineDocument) => {
        event.ports[0]?.postMessage({
          offlineStorageAvailable: Boolean(offlineDocument),
        });
      }),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { title: "ezyRetire", message: "You have a new financial alert." };
  }
  const title = typeof payload.title === "string" ? payload.title : "ezyRetire";
  const body = typeof payload.body === "string"
    ? payload.body
    : "Open ezyRetire to review your latest alert.";
  event.waitUntil(
    fetch(new URL("/api/auth/user", self.location.origin), {
      credentials: "include",
      cache: "no-store",
    })
      .then((response) => response.ok ? response.json() : null)
      .then((session) => {
        const ownerUserId = typeof payload.ownerUserId === "string" ? payload.ownerUserId : "";
        if (!ownerUserId || session?.user?.id !== ownerUserId) return undefined;
        return self.registration.showNotification(title, {
          body,
          tag: typeof payload.tag === "string" ? payload.tag : undefined,
          icon: "./icon-192.png",
          badge: "./favicon.png",
          data: { url: "./planner?tab=notifications" },
        });
      })
      .catch(() => undefined),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url ?? "./planner?tab=notifications", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.startsWith(self.registration.scope));
      if (existing) {
        existing.navigate(target);
        return existing.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) {
    // Financial and authenticated API data must never use the browser HTTP cache.
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const offline = await useCacheStorage((cacheStorage) =>
          cacheStorage.match("./offline.html"),
        );
        return offline ?? Response.error();
      }),
    );
    return;
  }

  const isStaticAsset =
    url.pathname.includes("/assets/") ||
    ["font", "image", "script", "style"].includes(request.destination);

  if (!isStaticAsset) return;

  event.respondWith(
    useCacheStorage((cacheStorage) => cacheStorage.match(request))
      .then(async (cached) => {
        if (cached) return cached;

        const response = await fetch(request);
        if (response.ok && response.type === "basic") {
          const cache = await useCacheStorage((cacheStorage) =>
            cacheStorage.open(CACHE_NAME),
          );
          await cache?.put(request, response.clone()).catch(() => undefined);
        }
        return response;
      }),
  );
});
