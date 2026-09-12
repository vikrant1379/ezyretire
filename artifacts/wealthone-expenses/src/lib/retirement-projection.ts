import {
  datedFundNetAmount,
  finiteNonNegative,
  lifestyleMonthlyExpense,
  recurringMonthlyNetIncome,
} from "./financial-metrics.ts";
import { budgetTotalForMonth, calculatePlanningTimeline, calculateTargetRetirementMonth, hasEffectiveBudgetPlan, isLivingExpense, parseDateOnly, plannedExpenseInflatedValue, type Budget, type EmergencyFundPlan, type Expense, type IncomeSource, type Investment, type Loan, type PlannedExpense, type RetirementInputs } from "./storage.ts";

const MONTH_MS = 30.4375 * 24 * 60 * 60 * 1000;
const MAX_PROJECTION_MONTHS = 125 * 12;
const MAX_ANNUAL_OCCURRENCES = 126;
const MAX_FINANCIAL_VALUE = Number.MAX_SAFE_INTEGER;

function finiteResult(value: number, fallback = 0) {
  if (Number.isNaN(value)) return fallback;
  if (value === Number.POSITIVE_INFINITY) return MAX_FINANCIAL_VALUE;
  if (value === Number.NEGATIVE_INFINITY) return -MAX_FINANCIAL_VALUE;
  return Math.max(-MAX_FINANCIAL_VALUE, Math.min(MAX_FINANCIAL_VALUE, value));
}

function finiteResults<T>(value: T): T {
  if (typeof value === "number") return finiteResult(value) as T;
  if (value instanceof Date || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => finiteResults(item)) as T;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, finiteResults(item)]),
  ) as T;
}

export function portfolioAllocationPercent(value: number, totalCurrentValue: number) {
  return finiteResult(totalCurrentValue > 0 ? (value / totalCurrentValue) * 100 : 0);
}

const annualIncomeGrowth = (source: IncomeSource, legacySalaryGrowth: number) => {
  if (!source.recurring || source.frequency === "One-time") return 0;
  const fallback = source.type === "Salary" ? legacySalaryGrowth : 0;
  return Math.min(0.5, finiteNonNegative(source.annualGrowthRate, fallback) / 100);
};

function monthKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function calendarMonthOffset(from: Date, to: Date) {
  return (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth();
}

function validDate(value: string | undefined) {
  if (!value?.trim()) return null;
  const date = parseDateOnly(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function validMonth(value: string | undefined) {
  const date = validDate(value);
  return date ? new Date(date.getFullYear(), date.getMonth(), 1) : null;
}

function validDatedFundDate(value: string | undefined) {
  const dateOnly = value?.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/)?.slice(1).map(Number);
  if (!dateOnly) return null;
  const [year, month, day] = dateOnly;
  const date = new Date(year, month - 1, day);
  return Number.isFinite(date.getTime())
    && date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
    ? date
    : null;
}

function validDatedFundMonth(value: string | undefined) {
  const date = validDatedFundDate(value);
  return date ? new Date(date.getFullYear(), date.getMonth(), 1) : null;
}

function anchoredAnnualDate(year: number, anchor: Date) {
  const lastDay = new Date(year, anchor.getMonth() + 1, 0).getDate();
  return new Date(year, anchor.getMonth(), Math.min(anchor.getDate(), lastDay));
}

export type DatedFundOpportunity = {
  date: Date;
  amount: number;
  sourceId: string;
  sourceName: string;
  sourceType: IncomeSource["type"];
  kind: "recurring-annual" | "one-time";
  /** True when annual growth assumptions changed the entered amount. */
  estimated: boolean;
};

type AnnualFundOccurrence = {
  date: Date;
  amount: number;
  estimated: boolean;
};

type LumpSumAvailability = {
  arrived: number;
  committed: number;
  available: number;
};

function annualFundOccurrences(
  source: IncomeSource,
  legacySalaryGrowth: number,
  from: Date,
  through: Date,
): AnnualFundOccurrence[] {
  if (source.frequency !== "Annual" || !source.recurring || through < from) return [];
  const anchor = validDatedFundDate(source.date);
  const baseAmount = datedFundNetAmount(source);
  if (!anchor || baseAmount <= 0 || anchor > through) return [];

  const annualGrowth = annualIncomeGrowth(source, legacySalaryGrowth);
  const customEnd = source.incomeEndMode === "custom" ? validDatedFundMonth(source.incomeEndDate) : null;
  const firstYear = Math.max(
    anchor.getFullYear(),
    from.getFullYear(),
    through.getFullYear() - MAX_ANNUAL_OCCURRENCES + 1,
  );
  const lastYear = through.getFullYear();
  const occurrences: AnnualFundOccurrence[] = [];

  for (let year = firstYear; year <= lastYear; year += 1) {
    const date = anchoredAnnualDate(year, anchor);
    if (date < anchor || date < from || date > through) continue;
    if (customEnd && calendarMonthOffset(customEnd, date) > 0) continue;
    const occurrenceIndex = year - anchor.getFullYear();
    const amount = finiteNonNegative(baseAmount * Math.pow(1 + annualGrowth, occurrenceIndex));
    if (amount <= 0) continue;
    occurrences.push({
      date,
      amount,
      estimated: occurrenceIndex > 0 && annualGrowth > 0,
    });
  }

  return occurrences;
}

function calculateLumpSumAvailability(
  incomes: IncomeSource[],
  investments: Investment[],
  asOf: Date,
  legacySalaryGrowth: number,
): LumpSumAvailability {
  const asOfDate = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  const arrived = incomes.reduce((total, source) => {
    if (source.frequency === "Monthly") return total;
    const anchor = validDatedFundDate(source.date);
    if (!anchor) return total;
    if (source.frequency === "Annual" && source.recurring) {
      return total + annualFundOccurrences(
        source,
        legacySalaryGrowth,
        anchor,
        asOfDate,
      ).reduce((sum, occurrence) => sum + occurrence.amount, 0);
    }
    return total + (anchor <= asOfDate ? datedFundNetAmount(source) : 0);
  }, 0);
  const validAllocations = validatedFundAllocations(
    investments,
    incomes,
    legacySalaryGrowth,
  );
  const committed = investments.reduce((total, investment) =>
    total + (validAllocations.get(investment.id) ?? []).reduce((sum, allocation) => {
      const opportunityDate = validDatedFundDate(allocation.opportunityDate);
      return sum + (opportunityDate && opportunityDate <= asOfDate
        ? finiteNonNegative(allocation.amount)
        : 0);
    }, 0), 0);
  return {
    arrived: finiteNonNegative(arrived),
    committed,
    available: finiteNonNegative(arrived - committed),
  };
}

export function allocationOpportunityAmount(
  source: IncomeSource,
  opportunityDate: Date,
  legacySalaryGrowth = 0,
) {
  const anchor = validDatedFundDate(source.date);
  const baseAmount = datedFundNetAmount(source);
  if (!anchor || source.frequency === "Monthly" || baseAmount <= 0) return 0;
  if (source.recurring && source.frequency === "Annual") {
    const expected = anchoredAnnualDate(opportunityDate.getFullYear(), anchor);
    if (opportunityDate < anchor || formatDateKey(expected) !== formatDateKey(opportunityDate)) return 0;
    if (source.incomeEndMode === "custom") {
      const end = validDatedFundMonth(source.incomeEndDate);
      if (end && calendarMonthOffset(end, opportunityDate) > 0) return 0;
    }
    const occurrenceIndex = opportunityDate.getFullYear() - anchor.getFullYear();
    return finiteNonNegative(
      baseAmount * Math.pow(1 + annualIncomeGrowth(source, legacySalaryGrowth), occurrenceIndex),
    );
  }
  return formatDateKey(anchor) === formatDateKey(opportunityDate) ? baseAmount : 0;
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function validatedFundAllocations(
  investments: Investment[],
  incomes: IncomeSource[],
  legacySalaryGrowth = 0,
) {
  const sources = new Map(incomes.map((source) => [source.id, source]));
  const usedByOpportunity = new Map<string, number>();
  const usedIds = new Set<string>();
  const validByInvestment = new Map<string, NonNullable<Investment["fundAllocations"]>>();

  investments.forEach((investment) => {
    const valid = (investment.fundAllocations ?? []).filter((allocation) => {
      if (!allocation.id || usedIds.has(allocation.id)) return false;
      const source = sources.get(allocation.sourceId);
      const opportunityDate = validDate(allocation.opportunityDate);
      const investmentDate = validDate(allocation.investmentDate);
      const amount = finiteNonNegative(allocation.amount);
      if (!source || !opportunityDate || !investmentDate || amount <= 0) return false;
      const available = allocationOpportunityAmount(source, opportunityDate, legacySalaryGrowth);
      if (available <= 0 || investmentDate < opportunityDate) return false;
      const key = `${source.id}:${formatDateKey(opportunityDate)}`;
      const used = usedByOpportunity.get(key) ?? 0;
      if (used + amount > available + 0.005) return false;
      usedIds.add(allocation.id);
      usedByOpportunity.set(key, used + amount);
      return true;
    });
    validByInvestment.set(investment.id, valid);
  });
  return validByInvestment;
}

function monthZeroStartOffset(startDate: Date | null, asOf: Date) {
  if (!startDate) return 0;
  const asOfDate = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  if (startDate <= asOfDate) return 0;
  return Math.max(1, calendarMonthOffset(asOf, startDate));
}

function annualStepMultiplier(
  annualRate: number,
  effectiveDate: Date | null,
  asOf: Date,
  month: number,
) {
  if (annualRate <= 0 || month < 0) return 1;
  const anniversary = effectiveDate ?? asOf;
  const monthDifference = (anniversary.getMonth() - asOf.getMonth() + 12) % 12;
  const firstIncreaseMonth = monthDifference === 0
    ? anniversary.getDate() > asOf.getDate() ? 1 : 12
    : monthDifference;
  if (month < firstIncreaseMonth) return 1;
  const completedIncreases = 1 + Math.floor((month - firstIncreaseMonth) / 12);
  return Math.pow(1 + annualRate, completedIncreases);
}

function investmentIsScheduled(investment: Investment, month: number, asOf: Date, monthsToRetirement: number) {
  const startMonth = monthZeroStartOffset(validDate(investment.contributionStartDate), asOf);
  if (month < startMonth) return false;
  if (investment.contributionEndMode === "custom") {
    const end = validMonth(investment.contributionEndDate);
    return end ? month <= calendarMonthOffset(asOf, end) : month < monthsToRetirement;
  }
  return month < monthsToRetirement;
}

function incomeIsScheduled(income: IncomeSource, month: number, asOf: Date, monthsToRetirement: number) {
  if (!income.recurring || income.frequency === "One-time") return false;
  if (income.incomeEndMode === "custom") {
    const end = validMonth(income.incomeEndDate);
    // Invalid custom schedules are legacy-safe and continue to retirement.
    return end ? month <= calendarMonthOffset(asOf, end) : month < monthsToRetirement;
  }
  return month < monthsToRetirement;
}

/**
 * Uses up to three completed calendar months. Months before the first ledger
 * entry are not treated as zero-spend months. If only the current month exists,
 * spend-to-date is normalized by elapsed days (and never reduced).
 */
export function calculateActualMonthlyAverage(expenses: Expense[], asOf = new Date(), loans: Loan[] = []) {
  expenses = Array.isArray(expenses) ? expenses.filter(Boolean) : [];
  loans = Array.isArray(loans) ? loans.filter(Boolean) : [];
  if (!(asOf instanceof Date) || !Number.isFinite(asOf.getTime())) asOf = new Date(0);
  const ordinary = expenses
    .filter((expense) => isLivingExpense(expense, loans, asOf))
    .map((expense) => ({ ...expense, parsedDate: new Date(expense.date) }))
    .filter((expense) => Number.isFinite(expense.parsedDate.getTime()) && expense.parsedDate <= asOf);

  if (ordinary.length === 0) return { average: 0, monthsUsed: 0, method: "no ledger history" };

  const firstDate = ordinary.reduce((first, expense) => expense.parsedDate < first ? expense.parsedDate : first, ordinary[0].parsedDate);
  const completedTotals: number[] = [];
  for (let offset = -3; offset <= -1; offset += 1) {
    const month = addMonths(asOf, offset);
    const monthEnd = addMonths(month, 1);
    if (monthEnd <= new Date(firstDate.getFullYear(), firstDate.getMonth(), 1)) continue;
    const total = ordinary
      .filter((expense) => monthKey(expense.parsedDate) === monthKey(month))
      .reduce((sum, expense) => sum + finiteNonNegative(expense.amount), 0);
    // An empty ledger month is unknown coverage, not proof of zero spending.
    if (total > 0) completedTotals.push(total);
  }

  if (completedTotals.length > 0) {
    return finiteResults({
      average: completedTotals.reduce((sum, total) => sum + total, 0) / completedTotals.length,
      monthsUsed: completedTotals.length,
      method: `${completedTotals.length}-month completed average`,
    });
  }

  const currentTotal = ordinary
    .filter((expense) => monthKey(expense.parsedDate) === monthKey(asOf))
    .reduce((sum, expense) => sum + finiteNonNegative(expense.amount), 0);
  const daysInMonth = new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0).getDate();
  const elapsedDays = Math.max(1, Math.min(daysInMonth, asOf.getDate()));
  return finiteResults({
    average: Math.max(currentTotal, currentTotal * daysInMonth / elapsedDays),
    monthsUsed: currentTotal > 0 ? 1 : 0,
    method: currentTotal > 0 ? "current spend normalized to a full month" : "no ledger history",
  });
}

export function loanPayoffDetails(loan: Loan, asOf = new Date()) {
  if (!loan || typeof loan !== "object") {
    return { remainingPrincipal: 0, remainingMonths: 0, totalInterestLeft: 0 };
  }
  if (!(asOf instanceof Date) || !Number.isFinite(asOf.getTime())) asOf = new Date(0);
  // outstandingPrincipal is the lender's current balance. Prepayments are
  // retained as history and have already been reflected in that balance.
  const start = validDate(loan.startDate);
  const futureLoan = monthZeroStartOffset(start, asOf) > 0;
  const principal = futureLoan
    ? finiteNonNegative(loan.outstandingPrincipal) || finiteNonNegative(loan.sanctionedPrincipal)
    : finiteNonNegative(loan.outstandingPrincipal);
  const emi = finiteNonNegative(loan.emi);
  const repaymentType = loan.repaymentType ?? "emi";
  if (principal <= 0 || (repaymentType === "emi" && emi <= 0)) {
    return { remainingPrincipal: principal, remainingMonths: 0, totalInterestLeft: 0 };
  }

  const monthlyRate = finiteNonNegative(loan.annualInterestRate) / 1200;
  if (repaymentType !== "emi") {
    const loanStart = validDate(loan.startDate);
    const elapsed = loanStart ? Math.max(0, Math.floor((asOf.getTime() - loanStart.getTime()) / MONTH_MS)) : 0;
    const remainingMonths = Math.max(1, Math.min(1200, Math.ceil(finiteNonNegative(loan.totalTenureMonths, 1) - elapsed)));
    const totalInterestLeft = repaymentType === "bullet"
      ? principal * monthlyRate * remainingMonths
      : principal * monthlyRate * remainingMonths;
    return finiteResults({
      remainingPrincipal: principal,
      remainingMonths,
      totalInterestLeft,
    });
  }
  if (monthlyRate === 0) {
    const remainingMonths = Math.max(1, Math.ceil(principal / emi));
    return finiteResults({
      remainingPrincipal: principal,
      remainingMonths,
      totalInterestLeft: Math.max(0, remainingMonths * emi - principal),
    });
  }
  if (emi > principal * monthlyRate) {
    const calculated = Math.ceil(-Math.log(1 - principal * monthlyRate / emi) / Math.log(1 + monthlyRate));
    if (Number.isFinite(calculated) && calculated > 0) {
      const remainingMonths = Math.min(calculated, 1200);
      return finiteResults({
        remainingPrincipal: principal,
        remainingMonths,
        totalInterestLeft: Math.max(0, remainingMonths * emi - principal),
      });
    }
  }

  const loanStart = validDate(loan.startDate);
  const elapsed = loanStart ? Math.max(0, Math.floor((asOf.getTime() - loanStart.getTime()) / MONTH_MS)) : 0;
  const remainingMonths = Math.max(1, Math.min(1200, Math.ceil(finiteNonNegative(loan.totalTenureMonths, 1) - elapsed)));
  return finiteResults({
    remainingPrincipal: principal,
    remainingMonths,
    totalInterestLeft: Math.max(0, remainingMonths * emi - principal),
  });
}

export function remainingLoanMonths(loan: Loan, asOf = new Date()) {
  return loanPayoffDetails(loan, asOf).remainingMonths;
}

export function investmentProjectedValue(
  investment: Investment,
  yearsToRetirement: number,
  options?: {
    asOf?: Date;
    monthsToRetirement?: number;
    incomes?: IncomeSource[];
    legacySalaryGrowth?: number;
  },
) {
  if (!investment || typeof investment !== "object") return 0;
  const safeYears = Math.min(125, finiteNonNegative(yearsToRetirement));
  if (safeYears <= 0) return finiteNonNegative(investment.currentValue);
  const r = Math.min(0.5, finiteNonNegative(investment.expectedReturn) / 100);
  const fvCorpus = finiteNonNegative(investment.currentValue) * Math.pow(1 + r, safeYears);
  const pmt = finiteNonNegative(investment.monthlyContribution);
  const monthlyRate = r / 12;
  const requestedMonths = options?.monthsToRetirement ?? safeYears * 12;
  const months = Math.min(MAX_PROJECTION_MONTHS, Math.floor(finiteNonNegative(requestedMonths)));
  const requestedAsOf = options?.asOf ?? new Date();
  const asOf = requestedAsOf instanceof Date && Number.isFinite(requestedAsOf.getTime())
    ? requestedAsOf
    : new Date(0);
  const validAllocations = options?.incomes
    ? validatedFundAllocations(
        [investment],
        options.incomes,
        options.legacySalaryGrowth,
      ).get(investment.id) ?? []
    : [];
  const fvAllocatedLumpSums = validAllocations.reduce((sum, allocation) => {
    const amount = finiteNonNegative(allocation.amount);
    const date = validDate(allocation.investmentDate);
    if (!date || amount <= 0) return sum;
    const startMonth = Math.max(0, calendarMonthOffset(asOf, date));
    if (startMonth >= months) return sum;
    return sum + amount * Math.pow(1 + monthlyRate, Math.max(0, months - startMonth - 1));
  }, 0);
  if (options) {
    let fvSip = 0;
    const linkedIncome = investment.autoManagedContribution && investment.linkedIncomeSourceId
      ? options.incomes?.find((income) => income.id === investment.linkedIncomeSourceId)
      : undefined;
    for (let month = 0; month < months; month += 1) {
      const linkedIncomeScheduled = !investment.autoManagedContribution
        || !investment.linkedIncomeSourceId
        || options.incomes === undefined
        || Boolean(linkedIncome && incomeIsScheduled(linkedIncome, month, asOf, months));
      fvSip = (fvSip + (
        investmentIsScheduled(investment, month, asOf, months) && linkedIncomeScheduled
          ? finiteNonNegative(pmt)
          : 0
      ))
        * (1 + monthlyRate);
    }
    return finiteResult(fvCorpus + fvSip + fvAllocatedLumpSums);
  }
  const fvSip =
    monthlyRate > 0
      ? pmt * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate) * (1 + monthlyRate)
      : pmt * months;
  return finiteResult(fvCorpus + fvSip + fvAllocatedLumpSums);
}

export type RetirementProjectionArgs = {
  expenses: Expense[];
  budgets: Budget[];
  incomes: IncomeSource[];
  investments: Investment[];
  loans: Loan[];
  plannedExpenses?: PlannedExpense[];
  /** Separate reserve cash; never included in the investable retirement corpus. */
  emergencyFund?: EmergencyFundPlan;
  assumptions: RetirementInputs;
  /** Scenario-only override; never persists or rewrites investment records. */
  portfolioReturnOverride?: number;
  asOf?: Date;
};

export function calculateRetirementProjection({
  expenses,
  budgets,
  incomes,
  investments,
  loans,
  plannedExpenses = [],
  emergencyFund,
  assumptions,
  portfolioReturnOverride,
  asOf = new Date(),
}: RetirementProjectionArgs) {
  expenses = Array.isArray(expenses) ? expenses.filter(Boolean) : [];
  budgets = Array.isArray(budgets) ? budgets.filter(Boolean) : [];
  incomes = Array.isArray(incomes) ? incomes.filter(Boolean) : [];
  investments = Array.isArray(investments) ? investments.filter(Boolean) : [];
  loans = Array.isArray(loans) ? loans.filter(Boolean) : [];
  plannedExpenses = Array.isArray(plannedExpenses) ? plannedExpenses.filter(Boolean) : [];
  assumptions = assumptions && typeof assumptions === "object"
    ? assumptions
    : {} as RetirementInputs;
  assumptions = {
    ...assumptions,
    dateOfBirth: typeof assumptions.dateOfBirth === "string" ? assumptions.dateOfBirth : "",
  };
  if (!(asOf instanceof Date) || !Number.isFinite(asOf.getTime())) asOf = new Date(0);
  const planningTimeline = calculatePlanningTimeline({
    dateOfBirth: assumptions.dateOfBirth,
    targetRetirementAge: finiteNonNegative(assumptions.targetRetirementAge),
    lifeExpectancy: finiteNonNegative(assumptions.lifeExpectancy),
  }, asOf);
  const validBirthDate = planningTimeline.isValid
    || (Number.isFinite(parseDateOnly(assumptions.dateOfBirth).getTime()) && parseDateOnly(assumptions.dateOfBirth) <= asOf);
  const currentAge = Math.min(120, planningTimeline.currentAge);
  const targetAge = Math.min(120, Math.max(currentAge, finiteNonNegative(assumptions.targetRetirementAge, currentAge)));
  const lifeExpectancy = Math.min(125, Math.max(targetAge, finiteNonNegative(assumptions.lifeExpectancy, targetAge)));
  const asOfMonth = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
  const requestedRetirementDate = calculateTargetRetirementMonth({
    dateOfBirth: assumptions.dateOfBirth,
    targetRetirementAge: targetAge,
  });
  const retirementDate = requestedRetirementDate && requestedRetirementDate > asOfMonth
    ? requestedRetirementDate
    : asOfMonth;
  const monthsToRetirement = Math.min(
    MAX_PROJECTION_MONTHS,
    Math.max(0, finiteResult(calendarMonthOffset(asOfMonth, retirementDate))),
  );
  const yearsToRetirement = monthsToRetirement / 12;
  const yearsInRetirement = Math.max(0, lifeExpectancy - targetAge);
  const retirementMonths = Math.min(
    MAX_PROJECTION_MONTHS,
    Math.max(0, Math.round(yearsInRetirement * 12)),
  );
  const inflation = Math.min(0.25, finiteNonNegative(assumptions.generalInflation) / 100);
  const salaryGrowth = Math.min(50, finiteNonNegative(assumptions.salaryGrowth));
  const actual = calculateActualMonthlyAverage(expenses, asOf, loans);
  const effectiveBudgetPlan = hasEffectiveBudgetPlan(budgets);
  const budgetTotal = budgetTotalForMonth(
    budgets,
    asOf,
    assumptions.generalInflation,
    asOf,
    retirementDate,
  );
  const livingCostBaseline = effectiveBudgetPlan ? budgetTotal : actual.average;
  const projectedLivingCostAtMonth = (month: number) => {
    const projectedDate = addMonths(asOf, Math.max(0, month));
    return effectiveBudgetPlan
      ? budgetTotalForMonth(
          budgets,
          projectedDate,
          assumptions.generalInflation,
          asOf,
          retirementDate,
        )
      : livingCostBaseline * Math.pow(1 + inflation, Math.floor(Math.max(0, month) / 12));
  };
  const cashFlowCostBaseline = livingCostBaseline;
  const baselineDriver = effectiveBudgetPlan ? "budget" as const : "actuals" as const;
  const stableIncomes = incomes.filter((income) =>
    income.recurring && income.frequency === "Monthly" && incomeIsScheduled(income, 0, asOf, monthsToRetirement)
  );
  const growingIncomes = stableIncomes.map((income) => {
    const monthlyIncome = recurringMonthlyNetIncome(income);
    const annualGrowth = annualIncomeGrowth(income, salaryGrowth);
    return {
      source: income,
      monthlyIncome,
      annualGrowth,
      effectiveDate: validDate(income.date),
    };
  });
  const netMonthlyIncome = growingIncomes.reduce((sum, income) => sum + income.monthlyIncome, 0);
  const effectiveIncomeGrowthRate = netMonthlyIncome > 0
    ? growingIncomes.reduce((sum, income) => sum + income.monthlyIncome * income.annualGrowth, 0) / netMonthlyIncome * 100
    : 0;
  const validAllocations = validatedFundAllocations(investments, incomes, salaryGrowth);
  const lumpSumAvailability = calculateLumpSumAvailability(incomes, investments, asOf, salaryGrowth);
  const fundAllocationOpportunities: DatedFundOpportunity[] = [];
  const datedFundOpportunities: DatedFundOpportunity[] = [];
  let oneTimeIncomeBeforeRetirement = 0;
  const asOfDate = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  const projectionEnd = addMonths(asOfDate, monthsToRetirement);
  const addDatedFund = (
    source: IncomeSource,
    date: Date,
    kind: DatedFundOpportunity["kind"],
    amount = datedFundNetAmount(source),
    estimated = false,
  ) => {
    const month = calendarMonthOffset(asOf, date);
    if (date >= projectionEnd) return;
    if (source.recurring && source.incomeEndMode === "custom") {
      const end = validDatedFundMonth(source.incomeEndDate);
      if (end && month > calendarMonthOffset(asOf, end)) return;
    }
    if (amount <= 0) return;
    const opportunity = {
      date,
      amount,
      sourceId: source.id,
      sourceName: source.name,
      sourceType: source.type,
      kind,
      estimated,
    };
    fundAllocationOpportunities.push(opportunity);
    if (date < asOfDate || month < 0) return;
    datedFundOpportunities.push(opportunity);
    oneTimeIncomeBeforeRetirement += amount;
  };
  incomes.filter((income) => income.frequency !== "Monthly").forEach((source) => {
    const anchor = validDatedFundDate(source.date);
    if (!anchor) return;
    if (source.frequency === "Annual" && source.recurring) {
      annualFundOccurrences(source, salaryGrowth, anchor, projectionEnd).forEach((fund) => {
        addDatedFund(
          source,
          fund.date,
          "recurring-annual",
          fund.amount,
          fund.estimated,
        );
      });
    } else {
      addDatedFund(source, anchor, "one-time");
    }
  });
  fundAllocationOpportunities.sort((left, right) => left.date.getTime() - right.date.getTime());
  datedFundOpportunities.sort((left, right) => left.date.getTime() - right.date.getTime());

  const loanSchedules = loans.map((loan) => {
    const start = validDate(loan.startDate);
    const startMonth = monthZeroStartOffset(start, asOf);
    const future = startMonth > 0;
    const principal = future
      ? finiteNonNegative(loan.outstandingPrincipal) || finiteNonNegative(loan.sanctionedPrincipal)
      : finiteNonNegative(loan.outstandingPrincipal);
    const details = loanPayoffDetails(
      { ...loan, outstandingPrincipal: principal },
      future ? addMonths(asOf, startMonth) : asOf,
    );
    return {
      payment: finiteNonNegative(loan.emi),
      principal,
      monthlyRate: finiteNonNegative(loan.annualInterestRate) / 1200,
      repaymentType: loan.repaymentType ?? "emi",
      startMonth,
      remainingMonths: details.remainingMonths,
    };
  }).filter((loan) => loan.remainingMonths > 0);
  const loanPaymentAt = (loan: typeof loanSchedules[number], relativeMonth: number) => {
    if (relativeMonth < 0 || relativeMonth >= loan.remainingMonths) return 0;
    if (loan.repaymentType === "bullet") {
      return relativeMonth === loan.remainingMonths - 1
        ? loan.principal + loan.principal * loan.monthlyRate * loan.remainingMonths
        : 0;
    }
    if (loan.repaymentType === "interest-only-plus-bullet") {
      return loan.principal * loan.monthlyRate
        + (relativeMonth === loan.remainingMonths - 1 ? loan.principal : 0);
    }
    return loan.payment;
  };
  const activeEmi = loanSchedules.reduce((sum, loan) => sum + loanPaymentAt(loan, -loan.startMonth), 0);
  const emiAtMonth = (month: number) => loanSchedules.reduce(
    (sum, loan) => sum + loanPaymentAt(loan, month - loan.startMonth),
    0,
  );
  const plannedExpenseAtMonth = (month: number) => {
    const projectedDate = addMonths(asOf, month);
    return plannedExpenses.reduce((sum, expense) => {
      const due = validMonth(expense.expectedDate);
      return sum + (due && calendarMonthOffset(asOf, due) === month
        ? plannedExpenseInflatedValue(expense, asOf)
        : 0);
    }, 0);
  };

  const normalizedEmergencyFund = emergencyFund && typeof emergencyFund === "object"
    ? emergencyFund
    : undefined;
  const emergencyReserveBalance = finiteNonNegative(normalizedEmergencyFund?.reserveBalance);
  const emergencyTargetMonths = Math.min(24, finiteNonNegative(normalizedEmergencyFund?.targetMonths, 6));
  const emergencyTargetAmount = cashFlowCostBaseline * emergencyTargetMonths;
  const requestedEmergencyContribution = finiteNonNegative(normalizedEmergencyFund?.monthlyContribution);
  const emergencyFundContributionAtMonth = (month: number) => {
    if (month < 0 || emergencyReserveBalance >= emergencyTargetAmount || requestedEmergencyContribution <= 0) return 0;
    const remainingBeforeMonth = Math.max(
      0,
      emergencyTargetAmount - emergencyReserveBalance - requestedEmergencyContribution * month,
    );
    return Math.min(requestedEmergencyContribution, remainingBeforeMonth);
  };
  const emergencyFundBalanceAtMonth = (month: number) =>
    emergencyReserveBalance + Math.min(
      Math.max(0, emergencyTargetAmount - emergencyReserveBalance),
      requestedEmergencyContribution * Math.max(0, month),
    );
  const currentEmergencyFundContribution = emergencyFundContributionAtMonth(0);
  const availableSurplus = Math.max(
    0,
    netMonthlyIncome - cashFlowCostBaseline - activeEmi - currentEmergencyFundContribution,
  );
  const incomesById = new Map(incomes.map((income) => [income.id, income]));
  const linkedPFContributions = investments
    .filter((investment) => investment.autoManagedContribution && investment.linkedIncomeSourceId)
    .map((investment) => {
      const source = incomesById.get(investment.linkedIncomeSourceId as string);
      const annualGrowth = source ? annualIncomeGrowth(source, salaryGrowth) : 0;
      return {
        investment,
        amount: source?.type === "Salary" && source.recurring && source.frequency === "Monthly"
          ? finiteNonNegative(investment.monthlyContribution)
          : 0,
        annualGrowth,
        effectiveDate: source ? validDate(source.date) : null,
      };
    });
  const linkedPFContribution = linkedPFContributions.reduce(
    (sum, contribution) => {
      const linkedIncome = contribution.investment.linkedIncomeSourceId
        ? incomesById.get(contribution.investment.linkedIncomeSourceId)
        : undefined;
      return sum + (
        investmentIsScheduled(contribution.investment, 0, asOf, monthsToRetirement)
        && linkedIncome
        && incomeIsScheduled(linkedIncome, 0, asOf, monthsToRetirement)
          ? contribution.amount
          : 0
      );
    },
    0,
  );
  const nonLinkedSipCommitments = investments.reduce(
    (sum, investment) => sum + (
      investment.autoManagedContribution && investment.linkedIncomeSourceId
        ? 0
        : investmentIsScheduled(investment, 0, asOf, monthsToRetirement)
          ? finiteNonNegative(investment.monthlyContribution)
          : 0
    ),
    0,
  );
  const currentSipCommitments = linkedPFContribution + nonLinkedSipCommitments;
  const selectedTakeHomeInvestment = finiteNonNegative(assumptions.monthlyContributionOverride);
  const unallocatedSurplus = Math.max(0, availableSurplus - nonLinkedSipCommitments);
  const effectiveTakeHomeInvestment = selectedTakeHomeInvestment;
  const modeledTakeHomeContribution = nonLinkedSipCommitments + effectiveTakeHomeInvestment;
  const modeledMonthlyContribution = linkedPFContribution + modeledTakeHomeContribution;
  // Keep the established, present-month meaning of these public affordability
  // fields. The complete forward-looking result is exposed independently as
  // cashFlowFeasible and firstCashFlowShortfall below.
  const currentAffordabilityGap = Math.max(0, nonLinkedSipCommitments + selectedTakeHomeInvestment - availableSurplus);
  const currentRoundedAffordabilityGap = Math.round(currentAffordabilityGap);
  const currentCorpus = investments.reduce((sum, investment) => sum + finiteNonNegative(investment.currentValue), 0);
  const returnWeight = investments.reduce((sum, investment) => sum + finiteNonNegative(investment.currentValue), 0);
  const averageExpectedReturn = Math.min(0.5, Math.max(0,
    Number.isFinite(portfolioReturnOverride)
      ? finiteNonNegative(portfolioReturnOverride) / 100
      : returnWeight > 0
        ? investments.reduce((sum, investment) => sum + finiteNonNegative(investment.currentValue) * finiteNonNegative(investment.expectedReturn), 0) / returnWeight / 100
        : investments.length > 0
          ? investments.reduce((sum, investment) => sum + finiteNonNegative(investment.expectedReturn), 0) / investments.length / 100
          : 0.12,
  ));
  const accumulationMonthlyReturn = Math.pow(1 + averageExpectedReturn, 1 / 12) - 1;
  const lumpSumAllocations = investments.flatMap((investment) =>
    (validAllocations.get(investment.id) ?? []).flatMap((allocation) => {
      const amount = finiteNonNegative(allocation.amount);
      const date = validDate(allocation.investmentDate);
      if (!date || amount <= 0) return [];
      const month = Math.max(0, calendarMonthOffset(asOf, date));
      if (month >= monthsToRetirement) return [];
      const expectedReturn = Math.min(
        0.5,
        Number.isFinite(portfolioReturnOverride)
          ? finiteNonNegative(portfolioReturnOverride) / 100
          : finiteNonNegative(investment.expectedReturn) / 100,
      );
      return [{
        month,
        amount,
        baseMonthlyRate: expectedReturn / 12,
        optimisticMonthlyRate: Math.min(0.5, expectedReturn + 0.02) / 12,
        pessimisticMonthlyRate: Math.max(0, expectedReturn - 0.02) / 12,
      }];
    }),
  );

  const monthlyCashFlowTimeline = Array.from({ length: monthsToRetirement }, (_, month) => {
    const income = growingIncomes.reduce(
      (sum, source) => sum + (
        incomeIsScheduled(source.source, month, asOf, monthsToRetirement)
          ? source.monthlyIncome
          : 0
      ),
      0,
    );
    const living = projectedLivingCostAtMonth(month) + plannedExpenseAtMonth(month);
    const loanEmi = emiAtMonth(month);
    const scheduledInvestments = investments.reduce((sum, investment) => {
      if (!investmentIsScheduled(investment, month, asOf, monthsToRetirement)) return sum;
      if (investment.autoManagedContribution && investment.linkedIncomeSourceId) {
        const linked = linkedPFContributions.find((contribution) => contribution.investment.id === investment.id);
        const linkedIncome = incomesById.get(investment.linkedIncomeSourceId);
        return sum + (linked && linkedIncome
          && incomeIsScheduled(linkedIncome, month, asOf, monthsToRetirement)
          ? linked.amount
          : 0);
      }
      return sum + finiteNonNegative(investment.monthlyContribution);
    }, 0);
    const planningInvestment = selectedTakeHomeInvestment;
    const emergencyFundContribution = emergencyFundContributionAtMonth(month);
    const surplus = income - living - loanEmi - scheduledInvestments - planningInvestment - emergencyFundContribution;
    return {
      month,
      date: addMonths(asOf, month),
      income,
      living,
      loanEmi,
      scheduledInvestments,
      planningInvestment,
      emergencyFundContribution,
      emergencyFundBalance: emergencyFundBalanceAtMonth(month) + emergencyFundContribution,
      surplus,
      deficit: Math.max(0, -surplus),
    };
  });
  const firstCashFlowShortfall = monthlyCashFlowTimeline.find((entry) => Math.round(entry.deficit) > 0) ?? null;
  const cashFlowFeasible = firstCashFlowShortfall === null;
  const roundedAffordabilityGap = currentRoundedAffordabilityGap;
  const contributionAffordable = roundedAffordabilityGap === 0;
  const affordabilityWarning = contributionAffordable ? null
    : `Planned take-home investments exceed today's available monthly surplus by ${roundedAffordabilityGap.toLocaleString("en-IN")}.`;
  const contributionAtMonth = (month: number) => {
    const entry = monthlyCashFlowTimeline[month];
    if (!entry) return 0;
    const legacyNonLinkedCommitments = investments.reduce((sum, investment) => {
      const isLegacy = !investment.contributionStartDate
        && !investment.contributionEndMode
        && !investment.contributionEndDate;
      return sum + (isLegacy && !(investment.autoManagedContribution && investment.linkedIncomeSourceId)
        ? finiteNonNegative(investment.monthlyContribution)
        : 0);
    }, 0);
    const nonLegacyScheduled = investments.reduce((sum, investment) => {
      const isLegacy = !investment.contributionStartDate
        && !investment.contributionEndMode
        && !investment.contributionEndDate;
      return sum + (!isLegacy && !(investment.autoManagedContribution && investment.linkedIncomeSourceId)
        && investmentIsScheduled(investment, month, asOf, monthsToRetirement)
        ? finiteNonNegative(investment.monthlyContribution)
        : 0);
    }, 0);
    const linkedScheduled = linkedPFContributions.reduce(
      (sum, contribution) => {
        const linkedIncome = contribution.investment.linkedIncomeSourceId
          ? incomesById.get(contribution.investment.linkedIncomeSourceId)
          : undefined;
        return sum + (investmentIsScheduled(contribution.investment, month, asOf, monthsToRetirement)
        && linkedIncome
        && incomeIsScheduled(linkedIncome, month, asOf, monthsToRetirement)
        ? contribution.amount
        : 0);
      },
      0,
    );
    const legacyCapacity = Math.max(
      0,
      entry.income - entry.living - entry.loanEmi - entry.emergencyFundContribution,
    );
    return linkedScheduled + nonLegacyScheduled + Math.min(legacyNonLinkedCommitments, legacyCapacity) + entry.planningInvestment;
  };
  const surplusOpportunities: Array<{ startDate: Date; endDate: Date; monthlyAmount: number; reason: string }> = [];
  let opportunityStart = 0;
  while (opportunityStart < monthlyCashFlowTimeline.length) {
    const first = monthlyCashFlowTimeline[opportunityStart];
    if (first.surplus < 1) { opportunityStart += 1; continue; }
    let end = opportunityStart;
    while (end + 1 < monthlyCashFlowTimeline.length
      && monthlyCashFlowTimeline[end + 1].surplus >= 1
      && Math.abs(monthlyCashFlowTimeline[end + 1].income - first.income) < 0.01
      && Math.abs(monthlyCashFlowTimeline[end + 1].living - first.living) < 0.01
      && Math.abs(monthlyCashFlowTimeline[end + 1].loanEmi - first.loanEmi) < 0.01
      && Math.abs(monthlyCashFlowTimeline[end + 1].scheduledInvestments - first.scheduledInvestments) < 0.01) end += 1;
    const monthlyAmount = Math.min(...monthlyCashFlowTimeline.slice(opportunityStart, end + 1).map((entry) => entry.surplus));
    const previous = monthlyCashFlowTimeline[opportunityStart - 1];
    surplusOpportunities.push({
      startDate: first.date,
      endDate: monthlyCashFlowTimeline[end].date,
      monthlyAmount,
      reason: previous && previous.loanEmi > first.loanEmi
        ? "Loan payoff releases monthly EMI capacity."
        : "Monthly cash flow is available after living costs, loans, and scheduled investments.",
    });
    opportunityStart = end + 1;
  }

  const projectedCashFlowAtMonth = (month: number) => {
    const income = growingIncomes.reduce((sum, source) => sum + (
      incomeIsScheduled(source.source, month, asOf, monthsToRetirement)
        ? source.monthlyIncome * annualStepMultiplier(
            source.annualGrowth,
            source.effectiveDate,
            asOf,
            month,
          )
        : 0
    ), 0);
    const scheduledInvestments = investments.reduce((sum, investment) => {
      if (!investmentIsScheduled(investment, month, asOf, monthsToRetirement)) return sum;
      if (investment.autoManagedContribution && investment.linkedIncomeSourceId) {
        const linked = linkedPFContributions.find((item) => item.investment.id === investment.id);
        const linkedIncome = incomesById.get(investment.linkedIncomeSourceId);
        return sum + (linked && linkedIncome && incomeIsScheduled(linkedIncome, month, asOf, monthsToRetirement)
          ? linked.amount * annualStepMultiplier(linked.annualGrowth, linked.effectiveDate, asOf, month)
          : 0);
      }
      return sum + finiteNonNegative(investment.monthlyContribution);
    }, 0);
    const living = projectedLivingCostAtMonth(month) + plannedExpenseAtMonth(month);
    const loanEmi = emiAtMonth(month);
    const planningInvestment = selectedTakeHomeInvestment;
    const emergencyFundContribution = emergencyFundContributionAtMonth(month);
    return {
      income,
      living,
      loanEmi,
      scheduledInvestments,
      planningInvestment,
      emergencyFundContribution,
      surplus: income - living - loanEmi - scheduledInvestments - planningInvestment - emergencyFundContribution,
    };
  };
  const projectedYearlySurplusOutlook = Array.from(
    { length: yearsToRetirement > 0 ? Math.ceil(monthsToRetirement / 12) : 0 },
    (_, yearIndex) => {
      const month = Math.min(yearIndex * 12, Math.max(0, monthsToRetirement - 1));
      return {
        year: addMonths(asOf, month).getFullYear(),
        date: addMonths(asOf, month),
        month,
        annualFunds: datedFundOpportunities
          .filter((fund) => fund.date.getFullYear() === addMonths(asOf, month).getFullYear())
          .reduce((sum, fund) => sum + fund.amount, 0),
        ...projectedCashFlowAtMonth(month),
      };
    },
  );

  let projectedCorpus = currentCorpus;
  for (let month = 0; month < monthsToRetirement; month += 1) {
    projectedCorpus = projectedCorpus * (1 + accumulationMonthlyReturn)
      + contributionAtMonth(month);
  }
  const plannedExpenseCorpusImpact = plannedExpenses.reduce((sum, expense) => {
    const due = validMonth(expense.expectedDate);
    if (!due) return sum;
    const month = calendarMonthOffset(asOf, due);
    if (month < 0 || month >= monthsToRetirement) return sum;
    return sum + plannedExpenseInflatedValue(expense, asOf)
      * Math.pow(1 + accumulationMonthlyReturn, Math.max(0, monthsToRetirement - month - 1));
  }, 0);
  projectedCorpus = Math.max(0, projectedCorpus - plannedExpenseCorpusImpact);
  projectedCorpus += lumpSumAllocations.reduce(
    (sum, allocation) =>
      sum + allocation.amount * Math.pow(
        1 + allocation.baseMonthlyRate,
        Math.max(0, monthsToRetirement - allocation.month - 1),
      ),
    0,
  );

  const lifestyleChoice = assumptions.lifestyleChoice ?? "Comfortable";
  const spendingAdjustment = Number.isFinite(assumptions.retirementSpendingAdjustmentPercent)
    ? Math.min(300, Math.max(-90, Number(assumptions.retirementSpendingAdjustmentPercent)))
    : 0;
  const spendingAdjustmentFactor = 1 + spendingAdjustment / 100;
  const retirementLivingCostAtMonth = (retirementMonth: number) => {
    const absoluteMonth = monthsToRetirement + Math.max(0, retirementMonth);
    if (lifestyleChoice === "Custom") {
      const currentCustomExpense = lifestyleMonthlyExpense(
        "Custom",
        livingCostBaseline,
        assumptions.customLifestyleExpense,
      );
      return currentCustomExpense
        * Math.pow(1 + inflation, Math.floor(absoluteMonth / 12))
        * spendingAdjustmentFactor;
    }
    return lifestyleMonthlyExpense(
      lifestyleChoice,
      projectedLivingCostAtMonth(absoluteMonth),
    ) * spendingAdjustmentFactor;
  };
  const pensionIncomeAtMonth = (retirementMonth: number) =>
    (assumptions.pensionSources ?? []).reduce((total, source) => {
      if (!source || typeof source !== "object") return total;
      const monthlyAmount = finiteNonNegative(source.monthlyAmount);
      const requestedStartAge = Number(source.startAge);
      const startAge = Number.isFinite(requestedStartAge) ? requestedStartAge : targetAge;
      const configuredStartMonth = Math.ceil((startAge - targetAge) * 12 - 1e-9);
      const startMonth = Math.max(0, configuredStartMonth);
      if (retirementMonth < startMonth || monthlyAmount <= 0) return total;
      const escalation = Math.min(0.5, finiteNonNegative(source.annualEscalationRate) / 100);
      const completedEscalations = Math.max(0, Math.floor((retirementMonth - configuredStartMonth) / 12));
      const startMonthInflation = Math.max(0, Math.floor((monthsToRetirement + configuredStartMonth) / 12));
      const amountAtStart = monthlyAmount * Math.pow(1 + inflation, startMonthInflation);
      return total + amountAtStart * Math.pow(1 + escalation, completedEscalations);
    }, 0);
  const effectivePensionStartAges = [...new Set(
    (assumptions.pensionSources ?? [])
      .filter((source) => finiteNonNegative(source?.monthlyAmount) > 0)
      .map((source) => {
        const requestedStartAge = Number(source.startAge);
        return Math.max(Number.isFinite(requestedStartAge) ? requestedStartAge : targetAge, targetAge);
      }),
  )].sort((left, right) => left - right);
  const retirementOutflowAtMonth = (retirementMonth: number) => {
    const absoluteMonth = monthsToRetirement + retirementMonth;
    const grossOutflow = retirementLivingCostAtMonth(retirementMonth)
      + plannedExpenseAtMonth(absoluteMonth)
      + emiAtMonth(absoluteMonth);
    return Math.max(0, grossOutflow - pensionIncomeAtMonth(retirementMonth));
  };
  const expenseAtRetirement = retirementLivingCostAtMonth(0);
  const postRetirementMonthlyReturn = Math.pow(1.08, 1 / 12) - 1;
  let requiredCorpus = 0;
  for (let month = 0; month < retirementMonths; month += 1) {
    requiredCorpus += retirementOutflowAtMonth(month)
      / Math.pow(1 + postRetirementMonthlyReturn, month + 1);
  }

  const requiredLifestyleCorpusAtMonth = (month: number) => {
    if (month < monthsToRetirement) {
      return requiredCorpus / Math.pow(1 + accumulationMonthlyReturn, monthsToRetirement - month);
    }

    let remainingRequiredCorpus = 0;
    for (let futureMonth = month; futureMonth < monthsToRetirement + retirementMonths; futureMonth += 1) {
      const retirementMonth = futureMonth - monthsToRetirement;
      remainingRequiredCorpus += retirementOutflowAtMonth(retirementMonth)
        / Math.pow(1 + postRetirementMonthlyReturn, futureMonth - month + 1);
    }
    return remainingRequiredCorpus;
  };

  const gap = requiredCorpus - projectedCorpus;
  const annuityFactor = accumulationMonthlyReturn > 0
    ? (Math.pow(1 + accumulationMonthlyReturn, monthsToRetirement) - 1) / accumulationMonthlyReturn
    : monthsToRetirement;
  const extraSipRequired = gap > 0 && annuityFactor > 0 ? gap / annuityFactor : 0;
  const requiredLumpSumToday = gap > 0 && monthsToRetirement === 0 ? gap : 0;

  const chartData: Array<Record<string, number | string>> = [];
  let base = currentCorpus;
  let optimistic = currentCorpus;
  let pessimistic = currentCorpus;
  const allocationBalances = lumpSumAllocations.map((allocation) => ({
    ...allocation,
    base: 0,
    optimistic: 0,
    pessimistic: 0,
  }));
  let depletionAge: number | null = null;
  const totalMonths = monthsToRetirement + retirementMonths;
  for (let month = 0; month <= totalMonths; month += 1) {
    const allocatedBase = allocationBalances.reduce((sum, allocation) => sum + allocation.base, 0);
    const allocatedOptimistic = allocationBalances.reduce((sum, allocation) => sum + allocation.optimistic, 0);
    const allocatedPessimistic = allocationBalances.reduce((sum, allocation) => sum + allocation.pessimistic, 0);
    const retirementMonth = Math.max(0, month - monthsToRetirement);
    const monthlyLifestyleExpense = month < monthsToRetirement
      ? projectedLivingCostAtMonth(month)
      : retirementLivingCostAtMonth(retirementMonth);
    const monthlyPensionIncome = month < monthsToRetirement ? 0 : pensionIncomeAtMonth(retirementMonth);
    if (month % 12 === 0 || month === totalMonths) {
      chartData.push({
        age: Math.round((currentAge + month / 12) * 10) / 10,
        phase: month < monthsToRetirement ? "accumulation" : "drawdown",
        "Base Scenario": Math.max(0, base + allocatedBase),
        "Optimistic (+2% ret)": Math.max(0, optimistic + allocatedOptimistic),
        "Pessimistic (-2% ret)": Math.max(0, pessimistic + allocatedPessimistic),
        "Monthly Lifestyle Expense": monthlyLifestyleExpense,
        "Monthly Pension Income": monthlyPensionIncome,
        "Net Retirement Outflow": month < monthsToRetirement ? 0 : retirementOutflowAtMonth(retirementMonth),
        "Lifestyle Corpus Needed": requiredLifestyleCorpusAtMonth(month),
      });
    }
    if (month === totalMonths) break;
    if (month < monthsToRetirement) {
      const contribution = contributionAtMonth(month);
      base = base * (1 + accumulationMonthlyReturn) + contribution;
      optimistic = optimistic * (1 + Math.pow(1 + averageExpectedReturn + 0.02, 1 / 12) - 1) + contribution;
      pessimistic = pessimistic * (1 + Math.pow(1 + Math.max(0, averageExpectedReturn - 0.02), 1 / 12) - 1) + contribution;
      allocationBalances.forEach((allocation) => {
        allocation.base = allocation.base * (1 + allocation.baseMonthlyRate)
          + (allocation.month === month ? allocation.amount : 0);
        allocation.optimistic = allocation.optimistic * (1 + allocation.optimisticMonthlyRate)
          + (allocation.month === month ? allocation.amount : 0);
        allocation.pessimistic = allocation.pessimistic * (1 + allocation.pessimisticMonthlyRate)
          + (allocation.month === month ? allocation.amount : 0);
      });
    } else {
      const outflow = retirementOutflowAtMonth(retirementMonth);
      base = Math.max(0, (base + allocatedBase) * (1 + postRetirementMonthlyReturn) - outflow);
      optimistic = Math.max(0, (optimistic + allocatedOptimistic) * (1 + Math.pow(1.09, 1 / 12) - 1) - outflow);
      pessimistic = Math.max(0, (pessimistic + allocatedPessimistic) * (1 + Math.pow(1.07, 1 / 12) - 1) - outflow * 1.02);
      allocationBalances.forEach((allocation) => {
        allocation.base = 0;
        allocation.optimistic = 0;
        allocation.pessimistic = 0;
      });
      if (base <= 0 && depletionAge === null) depletionAge = Math.floor(currentAge + month / 12);
    }
  }

  return finiteResults({
    currentAge,
    targetAge,
    lifeExpectancy,
    yearsToRetirement,
    yearsInRetirement,
    monthsToRetirement,
    actualAverageSpending: actual.average,
    actualAverageMethod: actual.method,
    actualMonthsUsed: actual.monthsUsed,
    budgetTotal,
    livingCostBaseline,
    cashFlowCostBaseline,
    baselineDriver,
    netMonthlyIncome,
    effectiveIncomeGrowthRate,
    lumpSumAvailable: lumpSumAvailability.available,
    oneTimeIncomeBeforeRetirement,
    datedFundIncomeBeforeRetirement: oneTimeIncomeBeforeRetirement,
    fundAllocationOpportunities,
    datedFundOpportunities,
    activeEmi,
    availableSurplus,
    currentEmergencyFundContribution,
    emergencyFundContributionTimeline: monthlyCashFlowTimeline.map((entry) => ({
      month: entry.month,
      date: entry.date,
      contribution: entry.emergencyFundContribution,
      reserveBalance: entry.emergencyFundBalance,
      targetAmount: emergencyTargetAmount,
    })),
    unallocatedSurplus,
    currentSipCommitments,
    linkedPFContribution,
    nonLinkedSipCommitments,
    selectedTakeHomeInvestment,
    effectiveTakeHomeInvestment,
    modeledTakeHomeContribution,
    investSurplus: false,
    modeledMonthlyContribution,
    contributionAffordable,
    affordabilityWarning,
    monthlyCashFlowTimeline,
    cashFlowFeasible,
    firstCashFlowShortfall,
    surplusOpportunities,
    projectedYearlySurplusOutlook,
    currentCorpus,
    averageExpectedReturn,
    expenseAtRetirement,
    lifestyleChoice,
    pensionIncomeAtRetirement: pensionIncomeAtMonth(0),
    plannedExpenseCorpusImpact,
    requiredCorpus,
    projectedCorpus,
    gap,
    extraSipRequired,
    requiredLumpSumToday,
    chartData,
    depletionAge,
    milestones: {
      retirementAge: targetAge,
      projectedCorpusAtRetirement: projectedCorpus,
      requiredCorpusAtRetirement: requiredCorpus,
      depletionAge,
      effectivePensionStartAges,
    },
    assumptionsValid: validBirthDate
      && Number.isFinite(assumptions.targetRetirementAge)
      && Number.isFinite(assumptions.lifeExpectancy)
      && assumptions.targetRetirementAge >= currentAge
      && assumptions.lifeExpectancy >= assumptions.targetRetirementAge,
  });
}

export function calculateRetirementReadiness(args: RetirementProjectionArgs) {
  const asOf = args.asOf ?? new Date();
  const currentPlan = calculateRetirementProjection({ ...args, asOf });

  const earliestSustainableAge = (monthlyContributionOverride: number) => {
    if (!currentPlan.assumptionsValid) return null;

    const firstCandidateAge = Math.ceil(currentPlan.currentAge);
    const lastCandidateAge = Math.floor(currentPlan.lifeExpectancy) - 1;

    for (let age = firstCandidateAge; age <= lastCandidateAge; age += 1) {
      const scenario = calculateRetirementProjection({
        ...args,
        asOf,
        assumptions: {
          ...args.assumptions,
          targetRetirementAge: age,
          monthlyContributionOverride,
          investSurplus: false,
        },
      });

      if (scenario.assumptionsValid && scenario.gap <= 0) return age;
    }

    return null;
  };

  return {
    targetAge: currentPlan.targetAge,
    lifeExpectancy: currentPlan.lifeExpectancy,
    currentPlanRetirementAge: earliestSustainableAge(currentPlan.selectedTakeHomeInvestment),
    fullSurplusRetirementAge: earliestSustainableAge(currentPlan.unallocatedSurplus),
    extraSipRequiredAtTarget: currentPlan.extraSipRequired,
    requiredLumpSumTodayAtTarget: currentPlan.requiredLumpSumToday,
    monthsToRetirement: currentPlan.monthsToRetirement,
    unallocatedSurplus: currentPlan.unallocatedSurplus,
    targetIsFunded: currentPlan.gap <= 0,
    assumptionsValid: currentPlan.assumptionsValid,
  };
}
