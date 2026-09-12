import { useMutation, useQuery } from "@tanstack/react-query";
import { useFinancialOperation } from "@/hooks/use-financial-write";
import { updateFinancialHealthPlanning } from "@/lib/financial-api";
import { financialDataQueryOptions } from "@/lib/query-policy";
import type { EmergencyFundPlan, NetWorthSnapshot } from "@/lib/storage";

export function useFinancialHealthData() {
  return useQuery({
    ...financialDataQueryOptions(),
    select: (data) => ({
      emergencyFund: data.emergencyFund,
      netWorthSnapshots: data.netWorthSnapshots,
    }),
  });
}

export function useUpdateEmergencyFund() {
  const perform = useFinancialOperation();
  return useMutation({
    mutationFn: async (emergencyFund: EmergencyFundPlan) => {
      await perform(() => updateFinancialHealthPlanning({ emergencyFund }));
      return emergencyFund;
    },
  });
}

export function useSaveNetWorthSnapshot() {
  const perform = useFinancialOperation();
  return useMutation({
    mutationFn: async (snapshot: NetWorthSnapshot) => {
      await perform(() => updateFinancialHealthPlanning({ netWorthSnapshot: snapshot }));
      return snapshot;
    },
  });
}