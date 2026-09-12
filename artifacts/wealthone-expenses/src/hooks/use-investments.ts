import { useQuery, useMutation } from "@tanstack/react-query";
import { useFinancialWrite } from "@/hooks/use-financial-write";
import { financialDataQueryOptions } from "@/lib/query-policy";
import { type Investment } from "@/lib/storage";
import { applyCustomOrder, dropId, prependId, defaultUiPreferences } from "@/lib/card-order";

const generateId = () => Math.random().toString(36).substring(2, 9);

export function useInvestments() {
  return useQuery({
    ...financialDataQueryOptions(),
    select: (data) => applyCustomOrder(data.investments, data.uiPreferences?.investmentOrder ?? []),
  });
}

export function useAddInvestment() {
  const write = useFinancialWrite();
  return useMutation({
    mutationFn: async (investment: Omit<Investment, "id" | "createdAt">) => {
      const newInvestment: Investment = {
        ...investment,
        id: generateId(),
        createdAt: new Date().toISOString(),
      };
      await write((current) => ({
        ...current,
        investments: [...current.investments, newInvestment],
        uiPreferences: {
          ...defaultUiPreferences(),
          ...current.uiPreferences,
          investmentOrder: prependId(current.uiPreferences?.investmentOrder ?? [], newInvestment.id),
        },
      }));
      return newInvestment;
    },
  });
}

export function useUpdateInvestment() {
  const write = useFinancialWrite();
  return useMutation({
    mutationFn: async (investment: Investment) => {
      await write((current) => ({
        ...current,
        investments: current.investments.map((existingInvestment) =>
          existingInvestment.id === investment.id ? investment : existingInvestment
        ),
      }));
      return investment;
    },
  });
}

export function useDeleteInvestment() {
  const write = useFinancialWrite();
  return useMutation({
    mutationFn: async (id: string) => {
      await write((current) => ({
        ...current,
        investments: current.investments.filter((investment) => investment.id !== id),
        uiPreferences: {
          ...defaultUiPreferences(),
          ...current.uiPreferences,
          investmentOrder: dropId(current.uiPreferences?.investmentOrder ?? [], id),
        },
      }));
      return id;
    },
  });
}
