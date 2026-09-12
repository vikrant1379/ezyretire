import { useQuery, useMutation } from "@tanstack/react-query";
import { clearFinancialData, deleteFinancialExpense } from "@/lib/financial-api";
import {
  useFinancialOperation,
  useFinancialWrite,
} from "@/hooks/use-financial-write";
import { financialDataQueryOptions } from "@/lib/query-policy";
import { type Expense } from "@/lib/storage";
import {
  mergeImportedExpenses,
  type ImportedExpense,
} from "@/lib/expense-import";

const generateId = () => Math.random().toString(36).substring(2, 9);

export function useExpenses() {
  return useQuery({
    ...financialDataQueryOptions(),
    select: (data) =>
      [...data.expenses].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
  });
}

export function useAddExpense() {
  const write = useFinancialWrite();
  return useMutation({
    mutationFn: async (expense: Omit<Expense, "id" | "createdAt">) => {
      const newExpense: Expense = {
        ...expense,
        id: generateId(),
        createdAt: new Date().toISOString(),
      };
      await write((current) => ({
        ...current,
        expenses: [...current.expenses, newExpense],
      }));
      return newExpense;
    },
  });
}

export function useUpdateExpense() {
  const write = useFinancialWrite();
  return useMutation({
    mutationFn: async (expense: Expense) => {
      await write((current) => ({
        ...current,
        expenses: current.expenses.map((existingExpense) =>
          existingExpense.id === expense.id ? expense : existingExpense
        ),
      }));
      return expense;
    },
  });
}

export function useDeleteExpense() {
  const performFinancialOperation = useFinancialOperation();
  return useMutation({
    mutationFn: async (id: string) => {
      await performFinancialOperation(() => deleteFinancialExpense(id));
      return id;
    },
  });
}

export function useImportExpenses() {
  const write = useFinancialWrite();
  return useMutation({
    mutationFn: async (newExpenses: ImportedExpense[]) => {
      // The merge runs inside the write so it sees whatever the queued write
      // before it produced, rather than a separately fetched snapshot.
      let result!: ReturnType<typeof mergeImportedExpenses>;
      await write((current) => {
        result = mergeImportedExpenses(current.expenses, newExpenses, generateId);
        return { ...current, expenses: result.expenses };
      });
      return result;
    },
  });
}

export function useClearData() {
  const performFinancialOperation = useFinancialOperation();
  return useMutation({
    mutationFn: async () => {
      await performFinancialOperation(clearFinancialData);
    },
  });
}
