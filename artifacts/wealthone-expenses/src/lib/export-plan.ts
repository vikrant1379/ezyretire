import {
  buildTransactionReportSheets,
  buildBudgetReportSheets,
  buildPlannedExpenseReportSheets,
  buildIncomeReportSheets,
  buildInvestmentReportSheets,
  buildLoanReportSheets,
} from "./excel-report-builders";
import { type FinancialData } from "./financial-api";
import { calculateRetirementProjection } from "./retirement-projection";
import { downloadExcelWorkbook, datedExcelFilename } from "./excel-export";
import { getTargetRetirementMonth } from "./budget-helpers";
import { getLinkedLoanName } from "./storage";

export const buildCompleteFinancialPlan = (data: FinancialData, asOf = new Date()) => {
  const projection = calculateRetirementProjection({
    expenses: data.expenses,
    budgets: data.budgets,
    incomes: data.incomeSources,
    investments: data.investments,
    loans: data.loans,
    plannedExpenses: data.plannedExpenses,
    emergencyFund: data.emergencyFund,
    assumptions: data.retirementInputs,
    asOf,
  });

  const retirementDate = getTargetRetirementMonth(data.retirementInputs);
  const monthsToRetirement = retirementDate 
    ? Math.max(0, (retirementDate.getFullYear() - asOf.getFullYear()) * 12 + (retirementDate.getMonth() - asOf.getMonth()))
    : 0;
  const yearsToRetirement = monthsToRetirement / 12;

  const sheets = [
    ...buildIncomeReportSheets(data.incomeSources, {
      now: asOf,
      salaryGrowth: data.retirementInputs.salaryGrowth,
      receipts: data.incomeReceipts,
    }),
    ...buildTransactionReportSheets(data.expenses, (expense) => getLinkedLoanName(expense, data.loans)),
    ...buildBudgetReportSheets(data.budgets),
    ...buildPlannedExpenseReportSheets(data.plannedExpenses, { asOf }),
    ...buildLoanReportSheets(data.loans, { now: asOf, retirementDate }),
    ...buildInvestmentReportSheets({
      holdings: data.investments,
      incomes: data.incomeSources,
      asOf,
      yearsToRetirement,
      monthsToRetirement,
      annualFunds: [], // Not exposed on projection result
      yearlyOutlook: projection.projectedYearlySurplusOutlook,
    }),
  ];

  return downloadExcelWorkbook(sheets, datedExcelFilename("financial-plan", asOf));
};
