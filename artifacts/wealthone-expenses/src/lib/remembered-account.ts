const REMEMBERED_ACCOUNT_KEY = "ezyretire:remembered-account:v1";

export interface RememberedAccount {
  email: string;
  fullName: string;
}

export function readRememberedAccount(): RememberedAccount | null {
  try {
    const raw = window.localStorage.getItem(REMEMBERED_ACCOUNT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<RememberedAccount>;
    if (
      typeof value.email !== "string"
      || !value.email.includes("@")
      || typeof value.fullName !== "string"
      || !value.fullName.trim()
    ) return null;
    return { email: value.email, fullName: value.fullName.trim() };
  } catch {
    return null;
  }
}

export function rememberAccount(account: RememberedAccount): void {
  try {
    window.localStorage.setItem(REMEMBERED_ACCOUNT_KEY, JSON.stringify({
      email: account.email.trim().toLowerCase(),
      fullName: account.fullName.trim(),
    }));
  } catch {
    // Remembering identity is optional and must never block a successful sign-in.
  }
}

export function forgetRememberedAccount(): void {
  try {
    window.localStorage.removeItem(REMEMBERED_ACCOUNT_KEY);
  } catch {
    // Clearing optional persistence must not block switching accounts or signing out.
  }
}