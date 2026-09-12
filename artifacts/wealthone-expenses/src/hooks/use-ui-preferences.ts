import {
  useQuery,
  useMutation,
  useQueryClient,
  type MutationOptions,
  type QueryClient,
} from "@tanstack/react-query";
import { updateFinancialData, type FinancialData } from "@/lib/financial-api";
import {
  ACCOUNT_SWITCH_SAVE_TITLE,
  accountSwitchSaveDescription,
  FINANCIAL_DATA_KEY,
  trackAccountSwitchSaveCancellation,
} from "@/hooks/use-financial-write";
import { defaultUiPreferences, type UiPreferences } from "@/lib/card-order";
import { beginAccountSwitchSave } from "@/lib/account-switch-save-coordinator";
import { useToast } from "@workspace/wealthone-design-system/hooks/use-toast";
import { financialDataQueryOptions } from "@/lib/query-policy";

export function useUiPreferences() {
  return useQuery({
    ...financialDataQueryOptions(),
    select: (data) => data.uiPreferences ?? defaultUiPreferences(),
  });
}

function withPreferences(current: FinancialData, patch: Partial<UiPreferences>): FinancialData {
  return {
    ...current,
    uiPreferences: { ...defaultUiPreferences(), ...current.uiPreferences, ...patch },
  };
}

type UpdateUiPreferences = typeof updateFinancialData;

export function uiPreferenceMutationOptions(
  queryClient: QueryClient,
  savePreferences: UpdateUiPreferences = updateFinancialData,
  onAccountSwitch?: (description: string) => void,
): MutationOptions<
  FinancialData,
  Error,
  Partial<UiPreferences>,
  {
    previous: FinancialData | undefined;
    write: ReturnType<typeof beginAccountSwitchSave>;
  }
> {
  return {
    mutationFn: (patch: Partial<UiPreferences>) =>
      savePreferences((current) => withPreferences(current, patch)),
    onMutate: async (patch: Partial<UiPreferences>) => {
      await queryClient.cancelQueries({ queryKey: FINANCIAL_DATA_KEY });
      const previous = queryClient.getQueryData<FinancialData>(FINANCIAL_DATA_KEY);
      const query = queryClient.getQueryCache().find({
        queryKey: FINANCIAL_DATA_KEY,
        exact: true,
      });
      const write = beginAccountSwitchSave(
        queryClient,
        { account: query, visibleData: previous },
        "latest",
      );
      if (previous) {
        const optimistic = withPreferences(previous, patch);
        queryClient.setQueryData(FINANCIAL_DATA_KEY, optimistic);
        const visible = queryClient.getQueryData<FinancialData>(FINANCIAL_DATA_KEY);
        if (visible) {
          write.setVisibleData({ account: query, visibleData: visible });
        }
      }
      return { previous, write };
    },
    onError: (error, _patch, context) => {
      const visible = queryClient.getQueryData<FinancialData>(FINANCIAL_DATA_KEY);
      const query = queryClient.getQueryCache().find({
        queryKey: FINANCIAL_DATA_KEY,
        exact: true,
      });
      const write = context?.write;
      const previous = context?.previous;
      const mayRecover = write?.finish({
        account: query,
        visibleData: visible,
      });
      if (mayRecover && previous) {
        queryClient.setQueryData(FINANCIAL_DATA_KEY, previous);
      }
      const description = accountSwitchSaveDescription(error);
      if (
        mayRecover &&
        write &&
        description &&
        write.claimAccountSwitchNotice()
      ) {
        trackAccountSwitchSaveCancellation("ui_preferences");
        onAccountSwitch?.(description);
      }
    },
    onSuccess: (saved, _patch, context) => {
      // Only the newest write may publish or roll back, regardless of which
      // overlapping request finishes first.
      const visible = queryClient.getQueryData<FinancialData>(FINANCIAL_DATA_KEY);
      const query = queryClient.getQueryCache().find({
        queryKey: FINANCIAL_DATA_KEY,
        exact: true,
      });
      if (context.write.finish({ account: query, visibleData: visible })) {
        queryClient.setQueryData(FINANCIAL_DATA_KEY, saved);
      }
    },
  };
}

export function useUpdateUiPreferences() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation(uiPreferenceMutationOptions(queryClient, updateFinancialData, (description) => {
    toast({
      title: ACCOUNT_SWITCH_SAVE_TITLE,
      description,
      variant: "destructive",
    });
  }));
}
