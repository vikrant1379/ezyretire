import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  isFinancialAccountSwitchError,
  enqueueExternalFinancialMutation,
  UncertainExternalFinancialMutationError,
  saveFinancialData,
  updateFinancialData,
  type FinancialData,
} from "@/lib/financial-api";
import { trackEvent } from "@/lib/analytics";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import {
  beginAccountSwitchSave,
  carryPendingSaveNoticeAcrossLogout,
  claimAccountSwitchSaveNotice as claimSharedAccountSwitchSaveNotice,
  consumePendingSaveLogoutNotice,
} from "@/lib/account-switch-save-coordinator";
import { FINANCIAL_DATA_KEY } from "@/lib/query-policy";

export { FINANCIAL_DATA_KEY } from "@/lib/query-policy";
export const ACCOUNT_SWITCH_SAVE_TITLE = "Change not saved";
export const ACCOUNT_SWITCH_SAVE_CANCELLED_EVENT = "account_switch_save_cancelled";

export type FinancialSaveFlow =
  | "financial_operation"
  | "financial_write"
  | "ui_preferences";

export function trackAccountSwitchSaveCancellation(
  saveFlow?: FinancialSaveFlow,
): void {
  trackEvent(
    ACCOUNT_SWITCH_SAVE_CANCELLED_EVENT,
    saveFlow ? { save_flow: saveFlow } : undefined,
  );
}

export function accountSwitchSaveDescription(error: unknown): string | undefined {
  return isFinancialAccountSwitchError(error) && error instanceof Error
    ? error.message
    : undefined;
}

export function financialWriteErrorDescription(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Your change could not be saved. Check your connection and try again.";
}

type UpdateFinancialData = typeof updateFinancialData;
type FinancialOperation = () => Promise<FinancialData>;

export function carryPendingFinancialChangeNoticeAcrossLogout(
  queryClient: QueryClient,
): boolean {
  return carryPendingSaveNoticeAcrossLogout(queryClient);
}

export function claimAccountSwitchSaveNotice(
  queryClient: QueryClient,
): boolean {
  return claimSharedAccountSwitchSaveNotice(queryClient);
}

export function consumePendingFinancialChangeLogoutNotice(): boolean {
  return consumePendingSaveLogoutNotice();
}

function currentFinancialCache(queryClient: QueryClient) {
  const query = queryClient.getQueryCache().find({
    queryKey: FINANCIAL_DATA_KEY,
    exact: true,
  });
  return { query, data: query?.state.data };
}

export function beginFinancialWrite(queryClient: QueryClient) {
  const cache = currentFinancialCache(queryClient);
  const write = beginAccountSwitchSave(
    queryClient,
    { account: cache.query, visibleData: cache.data },
    "completion",
  );
  return {
    claimAccountSwitchNotice: write.claimAccountSwitchNotice,
    finish: () => {
      const visible = currentFinancialCache(queryClient);
      return write.finish({
        account: visible.query,
        visibleData: visible.data,
      });
    },
    setVisibleData: () => {
      const visible = currentFinancialCache(queryClient);
      write.setVisibleData({
        account: visible.query,
        visibleData: visible.data,
      });
    },
  };
}

export async function performFinancialOperation(
  queryClient: QueryClient,
  operation: FinancialOperation,
): Promise<FinancialData> {
  const write = beginFinancialWrite(queryClient);
  let saved: FinancialData;
  try {
    saved = await operation();
  } catch (error) {
    const mayPublish = write.finish();
    if (
      mayPublish &&
      error instanceof UncertainExternalFinancialMutationError &&
      error.reconciledData
    ) {
      queryClient.setQueryData(FINANCIAL_DATA_KEY, error.reconciledData);
      write.setVisibleData();
    }
    throw error;
  }

  if (write.finish()) {
    queryClient.setQueryData(FINANCIAL_DATA_KEY, saved);
    write.setVisibleData();
  }
  return saved;
}

/** Completes a server-side financial operation while publishing its result
 * through the same account-generation guard as ordinary financial writes. */
export async function performFinancialCacheUpdate<Result>(
  queryClient: QueryClient,
  operation: () => Promise<Result>,
  updater: (current: FinancialData, result: Result) => FinancialData,
): Promise<Result> {
  const write = beginFinancialWrite(queryClient);
  let completion: { result: Result; data: FinancialData };
  try {
    completion = await enqueueExternalFinancialMutation(operation, updater);
  } catch (error) {
    const mayPublish = write.finish();
    if (
      mayPublish &&
      error instanceof UncertainExternalFinancialMutationError &&
      error.reconciledData
    ) {
      queryClient.setQueryData(FINANCIAL_DATA_KEY, error.reconciledData);
      write.setVisibleData();
    }
    throw error;
  }
  if (!write.finish()) return completion.result;
  queryClient.setQueryData(FINANCIAL_DATA_KEY, completion.data);
  write.setVisibleData();
  return completion.result;
}

export function performFinancialWrite(
  queryClient: QueryClient,
  updater: (current: FinancialData) => FinancialData,
  save: UpdateFinancialData = updateFinancialData,
): Promise<FinancialData> {
  return performFinancialOperation(queryClient, () => save(updater));
}

export function useFinancialOperation() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useCallback(
    async (operation: FinancialOperation) => {
      try {
        return await performFinancialOperation(queryClient, operation);
      } catch (error) {
        const description = accountSwitchSaveDescription(error);
        if (description && claimAccountSwitchSaveNotice(queryClient)) {
          trackAccountSwitchSaveCancellation("financial_operation");
          toast({
            title: ACCOUNT_SWITCH_SAVE_TITLE,
            description,
            variant: "destructive",
          });
        } else if (!description) {
          toast({
            title: "Change not saved",
            description: financialWriteErrorDescription(error),
            variant: "destructive",
          });
        } else if (!description) {
          toast({
            title: "Change not saved",
            description: financialWriteErrorDescription(error),
            variant: "destructive",
          });
        }
        throw error;
      }
    },
    [queryClient, toast],
  );
}

export function useReplaceFinancialData() {
  const performFinancialOperation = useFinancialOperation();
  return useCallback(
    (data: FinancialData) =>
      performFinancialOperation(() => saveFinancialData(data)),
    [performFinancialOperation],
  );
}

/**
 * Applies a change and publishes the server's response straight into the
 * cache. Invalidating instead would spend another round trip re-reading the
 * document the write just returned.
 */
export function useFinancialWrite(
  { showErrorToast = true }: { showErrorToast?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useCallback(
    async (updater: (current: FinancialData) => FinancialData) => {
      try {
        return await performFinancialWrite(queryClient, updater);
      } catch (error) {
        const description = accountSwitchSaveDescription(error);
        if (description && claimAccountSwitchSaveNotice(queryClient)) {
          trackAccountSwitchSaveCancellation("financial_write");
          toast({
            title: ACCOUNT_SWITCH_SAVE_TITLE,
            description,
            variant: "destructive",
          });
        } else if (!description && showErrorToast) {
          toast({
            title: "Change not saved",
            description: financialWriteErrorDescription(error),
            variant: "destructive",
          });
        }
        throw error;
      }
    },
    [queryClient, showErrorToast, toast],
  );
}
