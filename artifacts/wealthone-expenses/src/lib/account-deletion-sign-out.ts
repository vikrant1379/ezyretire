import type { QueryClient } from "@tanstack/react-query";
import { activateFinancialDataAccount } from "@/lib/financial-api";
import { synchronizeAccountQueryCache } from "@/lib/query-policy";
import { forgetRememberedAccount } from "@/lib/remembered-account";

export function accountDeletionSignedOutPath(baseUrl = import.meta.env.BASE_URL): string {
  const base = (baseUrl || "/").replace(/\/$/, "");
  const loginPath = `${base}/login`;
  return `${loginPath}?accountDeletion=scheduled&returnTo=${encodeURIComponent("/settings")}`;
}

export async function completeAccountDeletionSignOut(
  queryClient: QueryClient,
  replaceLocation: (path: string) => void = (path) => window.location.replace(path),
  baseUrl = import.meta.env.BASE_URL,
): Promise<void> {
  await queryClient.cancelQueries();
  forgetRememberedAccount();
  activateFinancialDataAccount(null);
  synchronizeAccountQueryCache(queryClient, null);
  queryClient.clear();
  replaceLocation(accountDeletionSignedOutPath(baseUrl));
}