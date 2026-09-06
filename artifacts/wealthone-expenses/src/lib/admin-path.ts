/**
 * Helpers for building admin auth redirect URLs.
 *
 * The admin sign-in flow is OIDC redirect-based: the browser is sent to
 * `/api/admin/login?returnTo=<encoded app /admin path>` and comes back
 * authenticated. We compute the returnTo against the artifact's deployed base
 * path so the redirect lands back inside the app rather than the API root.
 */

/** The artifact base path (e.g. "/" or "/some-base"), always without a trailing slash. */
function getBase(): string {
  const raw = import.meta.env.BASE_URL || "/";
  return raw.replace(/\/$/, "");
}

/**
 * Absolute in-app path for an admin route, prefixed with the artifact base.
 * `adminAppPath("/admin")` -> "/admin" (or "/base/admin" when hosted under a base).
 */
export function adminAppPath(route: string = "/admin"): string {
  const normalized = route.startsWith("/") ? route : `/${route}`;
  return `${getBase()}${normalized}` || "/";
}

/**
 * Full admin sign-in URL. Sends the browser through the server OIDC redirect and
 * returns to the given in-app admin path once authenticated.
 */
export function adminLoginUrl(returnRoute: string = "/admin"): string {
  const returnTo = adminAppPath(returnRoute);
  return `/api/admin/login?returnTo=${encodeURIComponent(returnTo)}`;
}
