import { useQuery, useMutation } from "@tanstack/react-query";
import { fetchFinancialData, managePlanningCategory } from "@/lib/financial-api";
import {
  useFinancialOperation,
  useFinancialWrite,
  FINANCIAL_DATA_KEY,
} from "@/hooks/use-financial-write";
import { type Budget } from "@/lib/storage";

export function useBudgets() {
  return useQuery({
    queryKey: FINANCIAL_DATA_KEY,
    queryFn: fetchFinancialData,
    select: (data) => data.budgets,
  });
}

export function useUpdateBudget() {
  const write = useFinancialWrite();
  return useMutation({
    mutationFn: async (budget: Budget) => {
      await write((current) => {
        const exists = current.budgets.some(
          (existingBudget) => existingBudget.category === budget.category
        );
        const budgets = exists
          ? current.budgets.map((existingBudget) =>
              existingBudget.category === budget.category ? budget : existingBudget
            )
          : [...current.budgets, budget];
        return {
          ...current,
          budgets,
          uiPreferences: {
            ...current.uiPreferences,
            archivedPlanningCategories:
              current.uiPreferences.archivedPlanningCategories.filter(
                (category) => category !== budget.category,
              ),
          },
        };
      });
      return budget;
    },
  });
}

export function useManageBudgetCategory() {
  const performFinancialOperation = useFinancialOperation();
  return useMutation({
    mutationFn: async ({
      category,
      action,
      nextCategory,
    }: {
      category: string;
      action: "archive" | "restore" | "rename";
      nextCategory?: string;
    }) => {
      return performFinancialOperation(() =>
        managePlanningCategory(category, action, nextCategory?.trim())
      );
    },
  });
}
