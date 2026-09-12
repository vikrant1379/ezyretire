import { useMutation, useQuery } from "@tanstack/react-query";
import { useFinancialWrite } from "@/hooks/use-financial-write";
import { financialDataQueryOptions } from "@/lib/query-policy";
import type { IncomeReceipt } from "@/lib/storage";

const generateId = () => Math.random().toString(36).substring(2, 9);

export function useIncomeReceipts() {
  return useQuery({
    ...financialDataQueryOptions(),
    select: (data) => [...data.incomeReceipts].sort(
      (left, right) => right.receivedDate.localeCompare(left.receivedDate),
    ),
  });
}

export function useAddIncomeReceipt() {
  const write = useFinancialWrite();
  return useMutation({
    mutationFn: async (receipt: Omit<IncomeReceipt, "id" | "createdAt">) => {
      const newReceipt: IncomeReceipt = {
        ...receipt,
        id: generateId(),
        createdAt: new Date().toISOString(),
      };
      await write((current) => ({
        ...current,
        incomeReceipts: [...current.incomeReceipts, newReceipt],
      }));
      return newReceipt;
    },
  });
}

export function useUpdateIncomeReceipt() {
  const write = useFinancialWrite();
  return useMutation({
    mutationFn: async (receipt: IncomeReceipt) => {
      await write((current) => ({
        ...current,
        incomeReceipts: current.incomeReceipts.map((existing) =>
          existing.id === receipt.id ? receipt : existing
        ),
      }));
      return receipt;
    },
  });
}

export function useDeleteIncomeReceipt() {
  const write = useFinancialWrite();
  return useMutation({
    mutationFn: async (id: string) => {
      await write((current) => ({
        ...current,
        incomeReceipts: current.incomeReceipts.filter((receipt) => receipt.id !== id),
      }));
      return id;
    },
  });
}