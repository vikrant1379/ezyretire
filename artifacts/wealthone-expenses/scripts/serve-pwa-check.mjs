import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error("PORT must be a positive integer.");
}

const publicRoot = resolve(import.meta.dirname, "../dist/public");
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);
let apiRequestCount = 0;
let staticAssetRequestCount = 0;
let recoveryNetworkBlocked = false;

const logRequest = (request, status) => {
  console.log(`${new Date().toISOString()} ${request.method ?? "GET"} ${request.url ?? "/"} ${status}`);
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/legacy-sw.js") {
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/javascript; charset=utf-8",
      "service-worker-allowed": "/",
    });
    response.end(`
      const CACHE_NAME = "ezyretire-static-v4";
      self.addEventListener("install", (event) => {
        event.waitUntil(
          caches.open(CACHE_NAME).then((cache) => cache.put(
            "/offline.html",
            new Response(
              '<!doctype html><html><head><meta name="theme-color" content="#312e81"></head><body style="background:#fffaf2">Legacy offline</body></html>',
              { headers: { "content-type": "text/html; charset=utf-8" } },
            ),
          )),
        );
        self.skipWaiting();
      });
      self.addEventListener("activate", (event) => {
        event.waitUntil(self.clients.claim());
      });
      self.addEventListener("fetch", (event) => {
        if (event.request.mode === "navigate") {
          event.respondWith(fetch(event.request).catch(() => caches.match("/offline.html")));
        }
      });
    `);
    logRequest(request, 200);
    return;
  }

  if (url.pathname === "/safari-storage-check-setup.html") {
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
    });
    response.end("<!doctype html><title>Safari storage check setup</title>");
    logRequest(request, 200);
    return;
  }

  if (url.pathname === "/api/pwa-recovery-network") {
    recoveryNetworkBlocked = url.searchParams.get("blocked") === "true";
    response.writeHead(204, { "cache-control": "no-store" });
    response.end();
    logRequest(request, 204);
    return;
  }

  if (recoveryNetworkBlocked && url.pathname.startsWith("/storage-blocked-")) {
    request.socket.destroy();
    logRequest(request, "connection-destroyed");
    return;
  }

  if (url.pathname === "/api/pwa-cache-safety") {
    apiRequestCount += 1;
    response.writeHead(200, {
      "cache-control": "public, max-age=3600",
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ requestCount: apiRequestCount }));
    logRequest(request, 200);
    return;
  }

  if (url.pathname === "/assets/pwa-cache-storage-revocation.txt") {
    staticAssetRequestCount += 1;
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    });
    response.end(`network-response-${staticAssetRequestCount}`);
    logRequest(request, 200);
    return;
  }

  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const requestedPath = resolve(publicRoot, `.${pathname}`);
  const safePath = requestedPath.startsWith(`${publicRoot}${sep}`)
    ? requestedPath
    : resolve(publicRoot, "index.html");

  try {
    let body = await readFile(safePath);
    if (pathname === "/index.html" && url.searchParams.has("safari-storage-check")) {
      const scenario = url.searchParams.get("safari-storage-check");
      const fixtureScript = {
        current: `window.localStorage.setItem(
          "ezyretire:offline-storage-unavailable",
          JSON.stringify({ confirmedAt: Date.now(), unavailable: true }),
        );`,
        stale: `window.localStorage.setItem(
          "ezyretire:offline-storage-unavailable",
          JSON.stringify({
            confirmedAt: Date.now() - (7 * 24 * 60 * 60 * 1000) - 1,
            unavailable: true,
          }),
        );`,
        malformed: `window.localStorage.setItem(
          "ezyretire:offline-storage-unavailable",
          "{not-json",
        );`,
        denied: `Object.defineProperty(window, "localStorage", {
          configurable: true,
          get() { throw new DOMException("Storage access is blocked", "SecurityError"); },
        });
        const safariStorageCheckRegister =
          navigator.serviceWorker.register.bind(navigator.serviceWorker);
        navigator.serviceWorker.register = (scriptUrl, options) => {
          const deniedScriptUrl = new URL(scriptUrl, window.location.href);
          deniedScriptUrl.searchParams.set("deny-cache-storage", "1");
          return safariStorageCheckRegister(deniedScriptUrl.href, options);
        };`,
      }[scenario] ?? "";
      const suppressStorageRecovery = ["current", "stale", "malformed"].includes(scenario)
        ? `navigator.serviceWorker.register = () =>
          Promise.reject(new DOMException("Disabled by Safari storage-state fixture", "NotSupportedError"));`
        : "";
      body = Buffer.from(
        body.toString("utf8").replace(
          "<head>",
          `<head>
    <script>
      window.__safariStoragePageErrors = [];
      window.addEventListener("error", (event) => {
        window.__safariStoragePageErrors.push(event.message || "Unknown page error");
      });
      window.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason;
        window.__safariStoragePageErrors.push(reason && reason.message ? reason.message : String(reason));
      });
      ${fixtureScript}
      ${suppressStorageRecovery}
    </script>`,
        ),
      );
    }
    if (pathname === "/sw.js") {
      if (url.searchParams.has("deny-cache-storage")) {
        body = Buffer.concat([
          Buffer.from(
            'Object.defineProperty(self, "caches", { get() { throw new DOMException("Cache Storage access is blocked", "SecurityError"); } });\n',
          ),
          body,
        ]);
      } else if (
        url.searchParams.has("revoke-cache-storage")
        || url.searchParams.has("mutable-cache-storage")
      ) {
        body = Buffer.concat([
          Buffer.from(
            'let cacheStorageRevoked = false;\n'
              + 'let offlineStorageCheckResponsive = true;\n'
              + 'const availableCacheStorage = self.caches;\n'
              + 'const failCacheOperationsWhenRevoked = new URL(self.location.href).searchParams.has("revoke-cache-storage");\n'
              + 'const denyRevokedCacheOperation = (operation) => (...args) => cacheStorageRevoked ? Promise.reject(new DOMException("Cache Storage access was revoked", "SecurityError")) : operation(...args);\n'
              + 'const wrapCache = (cache) => new Proxy(cache, { get(target, property) { const value = Reflect.get(target, property, target); return typeof value === "function" ? denyRevokedCacheOperation(value.bind(target)) : value; } });\n'
              + 'const revocableCacheStorage = new Proxy(availableCacheStorage, { get(target, property) { const value = Reflect.get(target, property, target); if (property === "open") return async (...args) => wrapCache(await value.apply(target, args)); return typeof value === "function" ? denyRevokedCacheOperation(value.bind(target)) : value; } });\n'
              + 'Object.defineProperty(self, "caches", { get() { if (cacheStorageRevoked && !failCacheOperationsWhenRevoked) throw new DOMException("Cache Storage access was revoked", "SecurityError"); return revocableCacheStorage; } });\n'
              + 'self.addEventListener("message", (event) => { if (event.data === "revoke-cache-storage") { cacheStorageRevoked = true; event.ports[0]?.postMessage("cache-storage-revoked"); return; } if (event.data?.type === "SET_CACHE_STORAGE_BLOCKED") cacheStorageRevoked = event.data.blocked; if (event.data?.type === "SET_OFFLINE_STORAGE_CHECK_RESPONSIVE") offlineStorageCheckResponsive = event.data.responsive; if (event.data?.type === "CHECK_OFFLINE_STORAGE" && !offlineStorageCheckResponsive) event.stopImmediatePropagation(); });\n',
          ),
          body,
        ]);
      }
    }
    response.writeHead(200, {
      "content-type": contentTypes.get(extname(safePath)) ?? "application/octet-stream",
      ...(pathname === "/sw.js" ? { "cache-control": "no-cache" } : {}),
    });
    response.end(body);
    logRequest(request, 200);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      const body = await readFile(resolve(publicRoot, "index.html"));
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(body);
      logRequest(request, 200);
      return;
    }
    console.error(`${new Date().toISOString()} PWA check server error`, error);
    response.writeHead(500);
    response.end("PWA check server error");
    logRequest(request, 500);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`${new Date().toISOString()} PWA check server listening on http://127.0.0.1:${port}`);
});
