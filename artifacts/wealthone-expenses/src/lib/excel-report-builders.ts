import { calculateIncomeMetrics, datedFundNetAmount } from "./financial-metrics.ts";
import { addMonths } from "date-fns";
import {
  BUDGET_CADENCES,
  PLANNED_EXPENSE_CATEGORY_INFLATION,
  budgetMonthlyEquivalent,
  calculateTargetRetirementMonth,
  getLinkedLoanName,
  isRecurringIncomeActive,
  normalizeBudget,
  parseDateOnly,
  plannedExpenseInflatedValue,
  type Budget,
  type Expense,
  type IncomeReceipt,
  type IncomeSource,
  type Investment,
  type Loan,
  type PlannedExpense,
} from "./storage.ts";
import {
  investmentProjectedValue,
  calculateRetirementProjection,
  loanPayoffDetails,
} from "./retirement-projection.ts";
import type { FinancialData } from "./financial-api.ts";
import {
  toLocalDateCell,
  type ExcelSheet,
} from "./excel-export.ts";

export const buildTransactionReportSheets = (
  expenses: readonly Expense[],
  linkedLoanName: (expense: Expense) => string,
): ExcelSheet<any>[] => [{
  name: "Transactions",
  rows: expenses,
  columns: [
    { header: "Date", value: (expense) => toLocalDateCell(expense.date), width: 14 },
    { header: "Merchant", value: "merchant" },
    { header: "Note", value: (expense) => expense.note || "" },
    { header: "Category", value: "category" },
    { header: "Amount", value: "amount", width: 16 },
    { header: "Payment Method", value: "paymentMethod" },
    { header: "Reimbursable", value: "reimbursable" },
    { header: "Recurring", value: "recurring" },
    { header: "Linked Loan", value: linkedLoanName },
  ],
}];

export const buildBudgetReportSheets = (
  budgets: readonly Budget[],
): ExcelSheet<any>[] => [{
  name: "Budget Plan",
  rows: budgets.flatMap((budget, budgetIndex) => {
    const normalized = normalizeBudget(budget, budgetIndex);
    return (normalized.windows ?? []).map((window) => ({
      category: normalized.category,
      recurrence: BUDGET_CADENCES.find((cadence) => cadence.value === (window.cadence ?? "monthly"))?.label
        ?? "Monthly",
      scheduledAmount: window.monthlyLimit,
      monthlyEquivalent: budgetMonthlyEquivalent(window),
      dueMonth: window.cadence === "yearly" && window.annualMonth !== undefined
        ? new Date(2000, window.annualMonth, 1).toLocaleString("en", { month: "long" })
        : "",
      dueDate: toLocalDateCell(window.cadence === "one-time" ? window.startDate : undefined),
      startDate: toLocalDateCell(window.startDate),
      endMode: window.endMode === "custom"
        ? "Custom date"
        : window.endMode === "retirement" ? "Retirement" : "Lifelong",
      endDate: toLocalDateCell(window.endDate),
      note: window.note ?? "",
    }));
  }),
  columns: [
    { header: "Category", value: "category" },
    { header: "Recurrence", value: "recurrence" },
    { header: "Scheduled Amount", value: "scheduledAmount" },
    { header: "Monthly Equivalent", value: "monthlyEquivalent" },
    { header: "Due Month", value: "dueMonth" },
    { header: "Due Date", value: "dueDate" },
    { header: "Start Date", value: "startDate" },
    { header: "End Mode", value: "endMode" },
    { header: "End Date", value: "endDate" },
    { header: "Note", value: "note" },
  ],
}];

export const buildPlannedExpenseReportSheets = (
  expenses: readonly PlannedExpense[],
  options: { asOf?: Date } = {},
): ExcelSheet<any>[] => {
  const asOf = options.asOf ?? new Date();
  return [{
    name: "Planned Future Expenses",
    rows: expenses.map((expense) => ({
      name: expense.name,
      category: expense.category,
      presentValue: expense.amount,
      expectedDate: toLocalDateCell(expense.expectedDate),
      inflationRate: expense.customInflationRate
        ?? PLANNED_EXPENSE_CATEGORY_INFLATION[expense.category]
        ?? PLANNED_EXPENSE_CATEGORY_INFLATION.Other,
      inflationAssumption: expense.customInflationRate === undefined ? "Category default" : "Custom",
      inflatedValue: plannedExpenseInflatedValue(expense, asOf),
    })),
    columns: [
      { header: "Expense", value: "name" },
      { header: "Category", value: "category" },
      { header: "Present Value", value: "presentValue" },
      { header: "Expected Date", value: "expectedDate" },
      { header: "Inflation (%)", value: "inflationRate" },
      { header: "Inflation Assumption", value: "inflationAssumption" },
      { header: "Inflated Value", value: "inflatedValue" },
    ],
  }];
};

export const buildIncomeReportSheets = (
  sources: readonly IncomeSource[],
  options: { now?: Date; salaryGrowth?: number; receipts?: readonly IncomeReceipt[] } = {},
): ExcelSheet<any>[] => {
  const now = options.now ?? new Date();
  const rows = sources.map((source) => {
    const metrics = calculateIncomeMetrics(source);
    const sourceDate = parseDateOnly(source.date);
    const endDate = source.incomeEndDate ? parseDateOnly(source.incomeEndDate) : null;
    const ended = source.recurring && source.frequency !== "One-time"
      && source.incomeEndMode === "custom" && endDate
      && Number.isFinite(endDate.getTime())
      && new Date(now.getFullYear(), now.getMonth(), 1) > new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    const upcoming = source.frequency === "One-time"
      && Number.isFinite(sourceDate.getTime()) && sourceDate > now;
    return {
      name: source.name,
      type: source.type,
      frequency: source.frequency,
      amount: source.amount,
      annualGross: metrics.annualGross,
      annualTax: metrics.annualTax,
      monthlyNet: metrics.monthlyNet,
      datedFundAmount: source.frequency === "Monthly" ? 0 : datedFundNetAmount(source),
      annualGrowth: source.recurring
        ? Math.min(50, Math.max(0, source.annualGrowthRate ?? (source.type === "Salary" ? options.salaryGrowth ?? 0 : 0)))
        : 0,
      paymentDate: toLocalDateCell(source.date),
      endMode: source.recurring ? source.incomeEndMode === "custom" ? "Custom date" : "Retirement" : "One-time",
      endDate: toLocalDateCell(source.incomeEndDate),
      status: ended ? "Ended" : upcoming ? "Upcoming" : source.frequency === "One-time" ? "Ended" : "Active",
      grossCTC: source.salaryDetails?.grossCTC ?? 0,
      basicPay: source.salaryDetails?.basicPay ?? 0,
      hra: source.salaryDetails?.hra ?? 0,
      allowances: source.salaryDetails?.allowances ?? 0,
      employeePF: source.salaryDetails?.employeePF ?? 0,
      professionalTax: source.salaryDetails?.professionalTax ?? 0,
      tds: source.salaryDetails?.tds ?? 0,
      otherDeductions: source.salaryDetails?.otherDeductions ?? 0,
    };
  });
  const sourceNames = new Map(sources.map((source) => [source.id, source.name]));
  return [{
    name: "Income Sources",
    rows,
    columns: [
      { header: "Source Name", value: "name" }, { header: "Type", value: "type" },
      { header: "Frequency", value: "frequency" }, { header: "Amount", value: "amount" },
      { header: "Annual Gross", value: "annualGross" }, { header: "Annual Tax", value: "annualTax" },
      { header: "Monthly Net", value: "monthlyNet" }, { header: "Dated Fund Amount", value: "datedFundAmount" },
      { header: "Annual Growth (%)", value: "annualGrowth" }, { header: "Start / Payment Date", value: "paymentDate" },
      { header: "End Mode", value: "endMode" }, { header: "End Date", value: "endDate" },
      { header: "Status", value: "status" }, { header: "Gross CTC", value: "grossCTC" },
      { header: "Basic Pay", value: "basicPay" }, { header: "HRA", value: "hra" },
      { header: "Allowances", value: "allowances" }, { header: "Employee PF", value: "employeePF" },
      { header: "Professional Tax", value: "professionalTax" }, { header: "TDS", value: "tds" },
      { header: "Other Deductions", value: "otherDeductions" },
    ],
  }, {
    name: "Income Receipts",
    rows: (options.receipts ?? []).map((receipt) => ({
      source: sourceNames.get(receipt.incomeSourceId) ?? "Deleted income source",
      receivedDate: toLocalDateCell(receipt.receivedDate),
      amount: receipt.amount,
      note: receipt.note ?? "",
      recordedAt: toLocalDateCell(receipt.createdAt),
    })),
    columns: [
      { header: "Income Source", value: "source" },
      { header: "Received Date", value: "receivedDate" },
      { header: "Amount Received", value: "amount" },
      { header: "Note", value: "note" },
      { header: "Recorded At", value: "recordedAt" },
    ],
  }];
};

type AnnualFund = {
  sourceName: string; sourceType: string; date: Date; amount: number;
  kind: "recurring-annual" | "one-time"; estimated: boolean;
};
type Outlook = {
  year: number; income: number; annualFunds: number; living: number;
  loanEmi: number; scheduledInvestments: number; planningInvestment: number; surplus: number;
};

export const buildInvestmentReportSheets = (options: {
  holdings: readonly Investment[];
  incomes: readonly IncomeSource[];
  asOf: Date;
  yearsToRetirement: number;
  monthsToRetirement: number;
  annualFunds: readonly AnnualFund[];
  yearlyOutlook: readonly Outlook[];
}): ExcelSheet<any>[] => {
  const rows = options.holdings.map((investment) => {
    const linkedIncome = investment.autoManagedContribution && investment.linkedIncomeSourceId
      ? options.incomes.find((income) => income.id === investment.linkedIncomeSourceId) : undefined;
    const linkedIncomeAvailable = linkedIncome
      ? isRecurringIncomeActive(linkedIncome, options.asOf)
      : false;
    const monthlyContribution = investment.autoManagedContribution && investment.linkedIncomeSourceId
      && !linkedIncomeAvailable
      ? 0 : investment.monthlyContribution || 0;
    let endMode = investment.contributionEndMode || "retirement";
    let endDate = investment.contributionEndDate;
    if (linkedIncome?.incomeEndMode === "custom" && linkedIncome.incomeEndDate
      && (endMode !== "custom" || !endDate || parseDateOnly(linkedIncome.incomeEndDate) < parseDateOnly(endDate))) {
      endMode = "custom";
      endDate = linkedIncome.incomeEndDate;
    }
    const start = investment.contributionStartDate ? parseDateOnly(investment.contributionStartDate) : options.asOf;
    const end = endMode === "custom" && endDate ? parseDateOnly(endDate) : null;
    const ended = Boolean(end && (end.getFullYear() < options.asOf.getFullYear()
      || (end.getFullYear() === options.asOf.getFullYear() && end.getMonth() < options.asOf.getMonth())));
    return {
      name: investment.name, assetClass: investment.assetClass,
      investedAmount: investment.investedAmount, currentValue: investment.currentValue,
      gainLoss: investment.currentValue - investment.investedAmount, monthlyContribution,
      contributionStartDate: toLocalDateCell(investment.contributionStartDate),
      contributionEndMode: endMode === "custom" ? "Custom date" : "Retirement",
      contributionEndDate: toLocalDateCell(endDate),
      status: monthlyContribution <= 0 || ended || (endMode === "retirement" && options.monthsToRetirement <= 0)
        ? "Completed" : start > options.asOf ? "Upcoming" : "Active",
      expectedReturn: investment.expectedReturn,
      projectedRetirementValue: investmentProjectedValue(investment, options.yearsToRetirement, {
        asOf: options.asOf, monthsToRetirement: options.monthsToRetirement, incomes: [...options.incomes],
      }),
    };
  });
  return [
    { name: "Holdings", rows, columns: [
      { header: "Name", value: "name" }, { header: "Asset Class", value: "assetClass" },
      { header: "Invested Value", value: "investedAmount" }, { header: "Current Value", value: "currentValue" },
      { header: "Gain / Loss", value: "gainLoss" }, { header: "Monthly Contribution", value: "monthlyContribution" },
      { header: "Contribution Start Date", value: "contributionStartDate" }, { header: "Contribution End Mode", value: "contributionEndMode" },
      { header: "Contribution End Date", value: "contributionEndDate" }, { header: "Status", value: "status" },
      { header: "Expected Return (%)", value: "expectedReturn" }, { header: "Projected Value at Retirement", value: "projectedRetirementValue" },
    ] },
    { name: "Annual Funds", rows: options.annualFunds.map((fund) => ({
      sourceName: fund.sourceName, sourceType: fund.sourceType,
      availabilityDate: toLocalDateCell(fund.date), amount: fund.amount,
      occurrence: fund.kind === "recurring-annual" ? "Recurring annual" : "One-time", estimated: fund.estimated,
    })), columns: [
      { header: "Source", value: "sourceName" }, { header: "Type", value: "sourceType" },
      { header: "Availability Date", value: "availabilityDate" }, { header: "Amount", value: "amount" },
      { header: "Occurrence", value: "occurrence" }, { header: "Estimated", value: "estimated" },
    ] },
    { name: "Yearly Outlook", rows: options.yearlyOutlook.map((entry) => ({
      year: entry.year, income: entry.income, annualFunds: entry.annualFunds, living: entry.living,
      scheduledOutflows: entry.loanEmi + entry.scheduledInvestments + entry.planningInvestment, surplus: entry.surplus,
    })), columns: [
      { header: "Year", value: "year" }, { header: "Estimated Income / Month", value: "income" },
      { header: "Estimated Living / Month", value: "living" },
      { header: "Scheduled Outflows / Month", value: "scheduledOutflows" }, { header: "Estimated Surplus / Month", value: "surplus" },
      { header: "Annual Funds (Separate from Surplus / Month)", value: "annualFunds" },
    ] },
  ];
};

export const buildLoanReportSheets = (
  loans: readonly Loan[],
  options: { now?: Date; retirementDate?: Date | null } = {},
): ExcelSheet<any>[] => {
  const now = options.now ?? new Date();
  const rows = loans.map((loan) => {
    const payoff = loanPayoffDetails(loan);
    const future = Boolean(loan.startDate && parseDateOnly(loan.startDate) > now);
    const completed = payoff.remainingPrincipal <= 0;
    const payoffDate = addMonths(now, payoff.remainingMonths);
    return {
      name: loan.name, type: loan.type, status: completed ? "Completed" : future ? "Planned" : "Active",
      repaymentStructure: loan.repaymentType === "bullet"
        ? "Bullet"
        : loan.repaymentType === "interest-only-plus-bullet"
          ? "Interest-only + principal bullet"
          : "EMI (amortizing)",
      annualInterestRate: loan.annualInterestRate, interestType: loan.interestType,
      sanctionedPrincipal: loan.sanctionedPrincipal,
      outstandingPrincipal: future && loan.outstandingPrincipal === 0 ? loan.sanctionedPrincipal : loan.outstandingPrincipal,
      startDate: toLocalDateCell(loan.startDate), monthlyPayment: loan.repaymentType === "bullet"
        ? 0
        : loan.repaymentType === "interest-only-plus-bullet"
          ? payoff.remainingPrincipal * loan.annualInterestRate / 1200
          : loan.emi,
      maturityObligation: loan.repaymentType === "bullet" || loan.repaymentType === "interest-only-plus-bullet"
        ? payoff.remainingPrincipal
        : 0,
      totalTenureMonths: loan.totalTenureMonths,
      remainingTenureMonths: payoff.remainingMonths, futureInterest: payoff.totalInterestLeft,
      estimatedPayoffDate: toLocalDateCell(payoffDate),
      overlapsRetirement: Boolean(options.retirementDate && !completed && payoffDate > options.retirementDate),
      retirementDate: toLocalDateCell(options.retirementDate), prepayments: loan.prepayments,
    };
  });
  return [{ name: "Loans", rows, columns: [
    { header: "Name", value: "name" }, { header: "Type", value: "type" }, { header: "Status", value: "status" },
    { header: "Repayment Structure", value: "repaymentStructure" },
    { header: "Interest Rate (%)", value: "annualInterestRate" }, { header: "Interest Type", value: "interestType" },
    { header: "Sanctioned Principal", value: "sanctionedPrincipal" }, { header: "Outstanding Principal", value: "outstandingPrincipal" },
    { header: "Start Date", value: "startDate" }, { header: "Monthly Payment", value: "monthlyPayment" },
    { header: "Principal Due at Maturity", value: "maturityObligation" },
    { header: "Total Tenure (Months)", value: "totalTenureMonths" }, { header: "Remaining Tenure (Months)", value: "remainingTenureMonths" },
    { header: "Future Interest", value: "futureInterest" }, { header: "Estimated Payoff Date", value: "estimatedPayoffDate" },
    { header: "Continues Into Retirement", value: "overlapsRetirement" }, { header: "Retirement Date", value: "retirementDate" },
    { header: "Recorded Prepayments", value: "prepayments" },
  ] }];
};

export const buildCompleteFinancialPlanSheets = (
  data: FinancialData,
  options: { asOf?: Date } = {},
): ExcelSheet<any>[] => {
  const asOf = options.asOf ?? new Date();
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

  return [
    ...buildIncomeReportSheets(data.incomeSources, {
      now: asOf,
      salaryGrowth: data.retirementInputs.salaryGrowth,
      receipts: data.incomeReceipts,
    }),
    ...buildBudgetReportSheets(data.budgets),
    ...buildPlannedExpenseReportSheets(data.plannedExpenses, { asOf }),
    ...buildInvestmentReportSheets({
      holdings: data.investments,
      incomes: data.incomeSources,
      asOf,
      yearsToRetirement: projection.yearsToRetirement,
      monthsToRetirement: projection.monthsToRetirement,
      annualFunds: projection.datedFundOpportunities,
      yearlyOutlook: projection.projectedYearlySurplusOutlook,
    }),
    ...buildLoanReportSheets(data.loans, {
      now: asOf,
      retirementDate: calculateTargetRetirementMonth(data.retirementInputs),
    }),
    ...buildTransactionReportSheets(
      data.expenses,
      (expense) => getLinkedLoanName(expense, data.loans),
    ),
  ];
};