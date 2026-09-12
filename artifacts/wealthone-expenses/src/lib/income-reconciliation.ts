import { generateFinancialCalendar } from "./financial-calendar.ts";
import {
  calculateTargetRetirementMonth,
  formatDateOnly,
  type IncomeReceipt,
  type IncomeSource,
  type ProfileInputs,
  type RetirementInputs,
} from "./storage.ts";

type IncomeReconciliationArgs = {
  sources: IncomeSource[];
  receipts: IncomeReceipt[];
  profileInputs?: Pick<ProfileInputs, "dateOfBirth" | "targetRetirementAge">;
  retirementInputs?: Pick<RetirementInputs, "dateOfBirth" | "targetRetirementAge">;
  asOf?: Date;
};

export function incomeReconciliationForMonth({
  sources,
  receipts,
  profileInputs,
  retirementInputs,
  asOf = new Date(),
}: IncomeReconciliationArgs) {
  const from = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
  const through = new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0);
  const month = formatDateOnly(from).slice(0, 7);
  const retirementMonth = calculateTargetRetirementMonth({
    dateOfBirth: profileInputs?.dateOfBirth ?? retirementInputs?.dateOfBirth ?? "",
    targetRetirementAge:
      retirementInputs?.targetRetirementAge
      ?? profileInputs?.targetRetirementAge
      ?? Number.NaN,
  });
  const expected = generateFinancialCalendar({
    from: formatDateOnly(from),
    through: formatDateOnly(through),
    incomes: sources,
    ...(retirementMonth ? { retirementDate: formatDateOnly(retirementMonth) } : {}),
  }).filter((event) => event.kind === "income")
    .reduce((sum, event) => sum + (event.amount ?? 0), 0);
  const received = receipts
    .filter((receipt) => receipt.receivedDate.startsWith(month))
    .reduce((sum, receipt) => sum + receipt.amount, 0);
  return { month, expected, received, variance: received - expected };
}