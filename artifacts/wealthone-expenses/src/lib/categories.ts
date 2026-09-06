import { useBudgets } from "@/hooks/use-budgets";
import { useExpenses } from "@/hooks/use-expenses";
import { useQuery } from "@tanstack/react-query";
import { fetchFinancialData } from "@/lib/financial-api";
import { FINANCIAL_DATA_KEY } from "@/hooks/use-financial-write";
import {
  CORE_CATEGORIES,
  getBudgetCategories,
} from "@/lib/category-policy";

export {
  CORE_CATEGORIES,
  OPTIONAL_CATEGORIES,
  isCoreCategory,
  isCustomPlanningCategory,
} from "@/lib/category-policy";

export function useAllCategories() {
  const { data: budgets = [] } = useBudgets();
  const { data: expenses = [] } = useExpenses();

  const dynamicCategories = new Set<string>();

  budgets.forEach(b => {
    if (b.category) dynamicCategories.add(b.category);
  });
  
  expenses.forEach(e => {
    if (e.category) dynamicCategories.add(e.category);
  });

  CORE_CATEGORIES.forEach(c => dynamicCategories.add(c));

  return Array.from(dynamicCategories).sort();
}

/** Core categories plus categories this account has actually used or planned. */
export function useBudgetCategories() {
  const { data: budgets = [] } = useBudgets();
  const { data: expenses = [] } = useExpenses();
  const { data } = useQuery({
    queryKey: FINANCIAL_DATA_KEY,
    queryFn: fetchFinancialData,
  });
  return getBudgetCategories(
    budgets,
    expenses,
    data?.uiPreferences.archivedPlanningCategories ?? [],
  );
}
