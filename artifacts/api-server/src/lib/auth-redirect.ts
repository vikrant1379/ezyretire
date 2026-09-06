const FALLBACK_RETURN_PATH = "/";
const SAME_ORIGIN_SENTINEL = "https://ezyretire.invalid";
export type BrowserLoginIntent = "user" | "admin";

export function getSafeReturnTo(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return FALLBACK_RETURN_PATH;
  }

  try {
    const parsed = new URL(value, SAME_ORIGIN_SENTINEL);
    if (parsed.origin !== SAME_ORIGIN_SENTINEL) return FALLBACK_RETURN_PATH;
    // Returning to a server route would bounce the user straight back into the
    // OIDC flow instead of landing them in the app.
    if (parsed.pathname === "/api" || parsed.pathname.startsWith("/api/")) {
      return FALLBACK_RETURN_PATH;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return FALLBACK_RETURN_PATH;
  }
}

function getAdminLoginPath(returnTo: string): string {
  const path = returnTo.split(/[?#]/, 1)[0];
  const adminPath = path.match(/^(.*\/admin)(?:\/.*)?$/)?.[1] ?? "/admin";
  return `${adminPath}/login`;
}

export function getCallbackFailureRedirect(
  intent: BrowserLoginIntent,
  returnTo: unknown,
): string {
  if (intent !== "admin") return "/api/login";

  return `${getAdminLoginPath(getSafeReturnTo(returnTo))}?error=authentication-failed`;
}

export function getAdminAuthorizationFailureRedirect(returnTo: unknown): string {
  return `${getAdminLoginPath(getSafeReturnTo(returnTo))}?error=not-authorized`;
}