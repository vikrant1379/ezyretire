import { useQuery, useMutation } from "@tanstack/react-query";
import { fetchFinancialData } from "@/lib/financial-api";
import { useFinancialWrite, FINANCIAL_DATA_KEY } from "@/hooks/use-financial-write";
import { synchronizeSalaryEPF, type IncomeSource } from "@/lib/storage";
import { defaultUiPreferences, dropId, prependId } from "@/lib/card-order";
export { calculateIncomeMetrics } from "@/lib/financial-metrics";

const generateId = () => Math.random().toString(36).substring(2, 9);

export function useIncomeSources() {
  return useQuery({
    queryKey: FINANCIAL_DATA_KEY,
    queryFn: fetchFinancialData,
    select: (data) =>
      [...data.incomeSources].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
  });
}

export function useAddIncomeSource() {
  const write = useFinancialWrite();
  return useMutation({
    mutationFn: async (source: Omit<IncomeSource, "id" | "createdAt">) => {
      const newSource: IncomeSource = {
        ...source,
        id: generateId(),
        createdAt: new Date().toISOString(),
      };
      await write((current) => {
        const nextIncomeSources = [...current.incomeSources, newSource];
        return {
          ...current,
          incomeSources: nextIncomeSources,
          investments: synchronizeSalaryEPF(nextIncomeSources, current.investments),
          uiPreferences: {
            ...defaultUiPreferences(),
            ...current.uiPreferences,
            incomeOrder: prependId(current.uiPreferences?.incomeOrder ?? [], newSource.id),
          },
        };
      });
      return newSource;
    },
  });
}

export function useUpdateIncomeSource() {
  const write = useFinancialWrite();
  return useMutation({
    mutationFn: async (source: IncomeSource) => {
      await write((current) => {
        const nextIncomeSources = current.incomeSources.map((existingSource) =>
          existingSource.id === source.id ? source : existingSource
        );
        return {
          ...current,
          incomeSources: nextIncomeSources,
          investments: synchronizeSalaryEPF(nextIncomeSources, current.investments),
        };
      });
      return source;
    },
  });
}

export function useDeleteIncomeSource() {
  const write = useFinancialWrite();
  return useMutation({
    mutationFn: async (id: string) => {
      await write((current) => {
        const nextIncomeSources = current.incomeSources.filter((source) => source.id !== id);
        return {
          ...current,
          incomeSources: nextIncomeSources,
          investments: synchronizeSalaryEPF(nextIncomeSources, current.investments),
          uiPreferences: {
            ...defaultUiPreferences(),
            ...current.uiPreferences,
            incomeOrder: dropId(current.uiPreferences?.incomeOrder ?? [], id),
          },
        };
      });
      return id;
    },
  });
}
