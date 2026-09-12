/** Helpers for building admin paths inside the artifact's deployed base path. */

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
 * Starts a fresh admin OIDC sign-in and returns to the requested in-app route.
 * This is also the account-switch path for an authenticated non-admin.
 */
export function adminLoginUrl(returnRoute: string = "/admin"): string {
  const returnTo = adminAppPath(returnRoute);
  return `/api/admin/login?returnTo=${encodeURIComponent(returnTo)}`;
}
