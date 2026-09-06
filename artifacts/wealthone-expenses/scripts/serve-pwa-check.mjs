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

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/api/pwa-recovery-network") {
    recoveryNetworkBlocked = url.searchParams.get("blocked") === "true";
    response.writeHead(204, { "cache-control": "no-store" });
    response.end();
    return;
  }

  if (recoveryNetworkBlocked && url.pathname.startsWith("/storage-blocked-")) {
    request.socket.destroy();
    return;
  }

  if (url.pathname === "/api/pwa-cache-safety") {
    apiRequestCount += 1;
    response.writeHead(200, {
      "cache-control": "public, max-age=3600",
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ requestCount: apiRequestCount }));
    return;
  }

  if (url.pathname === "/assets/pwa-cache-storage-revocation.txt") {
    staticAssetRequestCount += 1;
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    });
    response.end(`network-response-${staticAssetRequestCount}`);
    return;
  }

  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const requestedPath = resolve(publicRoot, `.${pathname}`);
  const safePath = requestedPath.startsWith(`${publicRoot}${sep}`)
    ? requestedPath
    : resolve(publicRoot, "index.html");

  try {
    let body = await readFile(safePath);
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
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      const body = await readFile(resolve(publicRoot, "index.html"));
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(body);
      return;
    }
    response.writeHead(500);
    response.end("PWA check server error");
  }
});

server.listen(port, "127.0.0.1");