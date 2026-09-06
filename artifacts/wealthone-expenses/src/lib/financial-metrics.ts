import type { IncomeSource } from "./storage";

export const finiteNonNegative = (value: number | undefined, fallback = 0) =>
  Number.isFinite(value) ? Math.max(0, value as number) : fallback;

/**
 * Normalizes an active recurring source to monthly cash flow. One-time and
 * inactive sources deliberately return zero so summaries cannot turn a lump
 * sum into recurring income.
 */
export function recurringMonthlyNetIncome(source: IncomeSource) {
  if (!source.recurring || source.frequency !== "Monthly") return 0;

  if (source.type === "Salary" && source.salaryDetails) {
    const details = source.salaryDetails;
    const gross = finiteNonNegative(details.basicPay)
      + finiteNonNegative(details.hra)
      + finiteNonNegative(details.allowances);
    const deductions = finiteNonNegative(details.employeePF)
      + finiteNonNegative(details.professionalTax)
      + finiteNonNegative(details.tds)
      + finiteNonNegative(details.otherDeductions);
    return Math.max(0, gross - deductions);
  }

  return finiteNonNegative(source.amount);
}

/** Confirmed amount of a single annual or one-time payment. */
export function datedFundNetAmount(source: IncomeSource) {
  if (source.frequency === "Monthly") return 0;
  if (source.type === "Salary" && source.salaryDetails) {
    const details = source.salaryDetails;
    return Math.max(
      0,
      finiteNonNegative(details.basicPay)
        + finiteNonNegative(details.hra)
        + finiteNonNegative(details.allowances)
        - finiteNonNegative(details.employeePF)
        - finiteNonNegative(details.professionalTax)
        - finiteNonNegative(details.tds)
        - finiteNonNegative(details.otherDeductions),
    );
  }
  return finiteNonNegative(source.amount);
}

export function calculateIncomeMetrics(source: IncomeSource) {
  const isRecurring = source.recurring && source.frequency === "Monthly";
  let annualGross = 0;
  let annualTax = 0;

  if (source.type === "Salary" && source.salaryDetails) {
    const details = source.salaryDetails;
    const gross = finiteNonNegative(details.basicPay)
      + finiteNonNegative(details.hra)
      + finiteNonNegative(details.allowances);
    const tax = finiteNonNegative(details.tds);
    const annualMultiplier = source.frequency === "Annual" ? 1 : source.frequency === "Monthly" ? 12 : 1;
    annualGross = gross * annualMultiplier;
    annualTax = tax * annualMultiplier;
  } else {
    const amount = finiteNonNegative(source.amount);
    annualGross = source.frequency === "Monthly" && isRecurring ? amount * 12 : amount;
  }

  const monthlyNet = recurringMonthlyNetIncome(source);
  const monthlyGross = isRecurring
    ? (source.type === "Salary" && source.salaryDetails
      ? (finiteNonNegative(source.salaryDetails.basicPay)
        + finiteNonNegative(source.salaryDetails.hra)
        + finiteNonNegative(source.salaryDetails.allowances))
      : finiteNonNegative(source.amount))
    : 0;
  const effectiveTaxRate = annualGross > 0 ? annualTax / annualGross * 100 : 0;

  return { monthlyGross, monthlyNet, annualGross, annualTax, effectiveTaxRate };
}