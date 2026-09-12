import { useMutation, useQuery } from "@tanstack/react-query";
import { useFinancialWrite } from "./use-financial-write";
import { financialDataQueryOptions } from "@/lib/query-policy";
import { applyPlannedExpenseOperation, type PlannedExpenseOperation } from "@/lib/planning-simulations";
import type { PlannedExpense } from "@/lib/storage";

export function usePlannedExpenses() {
  return useQuery({ ...financialDataQueryOptions(), select: (data) => data.plannedExpenses });
}

export function useUpdatePlannedExpenses() {
  const write = useFinancialWrite();
  return useMutation({
    mutationFn: async (operation: PlannedExpenseOperation) => {
      const saved = await write((current) => ({
        ...current,
        plannedExpenses: applyPlannedExpenseOperation(current.plannedExpenses, operation),
      }));
      return saved.plannedExpenses;
    },
  });
}

export function useUpdatePlannedExpense() {
  const write = useFinancialWrite();
  return useMutation({
    mutationFn: async (expense: PlannedExpense) => {
      await write((current) => ({
        ...current,
        plannedExpenses: current.plannedExpenses.map((item) =>
          item.id === expense.id ? expense : item
        ),
      }));
      return expense;
    },
  });
}
