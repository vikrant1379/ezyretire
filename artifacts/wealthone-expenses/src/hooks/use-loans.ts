import { useQuery, useMutation } from "@tanstack/react-query";
import { fetchFinancialData } from "@/lib/financial-api";
import { useFinancialWrite, FINANCIAL_DATA_KEY } from "@/hooks/use-financial-write";
import { type Loan } from "@/lib/storage";
import { applyCustomOrder, dropId, prependId, defaultUiPreferences } from "@/lib/card-order";

const generateId = () => Math.random().toString(36).substring(2, 9);

export function useLoans() {
  return useQuery({
    queryKey: FINANCIAL_DATA_KEY,
    queryFn: fetchFinancialData,
    select: (data) => applyCustomOrder(data.loans, data.uiPreferences?.loanOrder ?? []),
  });
}

export function useAddLoan() {
  const write = useFinancialWrite();
  return useMutation({
    mutationFn: async (loan: Omit<Loan, "id" | "createdAt">) => {
      const newLoan: Loan = {
        ...loan,
        id: generateId(),
        createdAt: new Date().toISOString(),
      };
      await write((current) => ({
        ...current,
        loans: [...current.loans, newLoan],
        uiPreferences: {
          ...defaultUiPreferences(),
          ...current.uiPreferences,
          loanOrder: prependId(current.uiPreferences?.loanOrder ?? [], newLoan.id),
        },
      }));
      return newLoan;
    },
  });
}

export function useUpdateLoan() {
  const write = useFinancialWrite();
  return useMutation({
    mutationFn: async (loan: Loan) => {
      await write((current) => ({
        ...current,
        loans: current.loans.map((existingLoan) =>
          existingLoan.id === loan.id ? loan : existingLoan
        ),
      }));
      return loan;
    },
  });
}

export function useDeleteLoan() {
  const write = useFinancialWrite();
  return useMutation({
    mutationFn: async (id: string) => {
      await write((current) => ({
        ...current,
        loans: current.loans.filter((loan) => loan.id !== id),
        uiPreferences: {
          ...defaultUiPreferences(),
          ...current.uiPreferences,
          loanOrder: dropId(current.uiPreferences?.loanOrder ?? [], id),
        },
      }));
      return id;
    },
  });
}
