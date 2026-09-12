import { QueryClient, queryOptions } from "@tanstack/react-query";
import { fetchFinancialData, type FinancialData } from "./financial-api";

export const FINANCIAL_DATA_KEY = ["financial-data"] as const;
export const FINANCIAL_DATA_STALE_TIME_MS = 60_000;
export const PRIVATE_QUERY_GC_TIME_MS = 5 * 60_000;

export const financialDataQueryOptions = () =>
  queryOptions({
    queryKey: FINANCIAL_DATA_KEY,
    queryFn: fetchFinancialData,
    staleTime: FINANCIAL_DATA_STALE_TIME_MS,
    gcTime: PRIVATE_QUERY_GC_TIME_MS,
    retry: 1,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: PRIVATE_QUERY_GC_TIME_MS,
        retry: 1,
        staleTime: 30_000,
        refetchOnMount: true,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

const cachedAccountIds = new WeakMap<QueryClient, string | null>();
const privateQueryGenerations = new WeakMap<QueryClient, object>();

export type PrivateQueryGeneration = object;

export function capturePrivateQueryGeneration(
  queryClient: QueryClient,
): PrivateQueryGeneration {
  let generation = privateQueryGenerations.get(queryClient);
  if (!generation) {
    generation = {};
    privateQueryGenerations.set(queryClient, generation);
  }
  return generation;
}

export function isCurrentPrivateQueryGeneration(
  queryClient: QueryClient,
  generation: PrivateQueryGeneration,
): boolean {
  return privateQueryGenerations.get(queryClient) === generation;
}

export function synchronizeAccountQueryCache(
  queryClient: QueryClient,
  accountId: string | null,
): boolean {
  if (cachedAccountIds.get(queryClient) === accountId) return false;
  cachedAccountIds.set(queryClient, accountId);
  privateQueryGenerations.set(queryClient, {});
  queryClient.removeQueries({ queryKey: FINANCIAL_DATA_KEY });
  queryClient.removeQueries({
    predicate: (query) => {
      const root = query.queryKey[0];
      return typeof root === "string"
        && (root.startsWith("/api/advice") || root.startsWith("/api/admin"));
    },
  });
  return true;
}

export function setFinancialQueryData(
  queryClient: QueryClient,
  data: FinancialData,
): void {
  queryClient.setQueryData(FINANCIAL_DATA_KEY, data);
}