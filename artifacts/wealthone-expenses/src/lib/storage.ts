export type Expense = {
  id: string;
  date: string;
  amount: number;
  category: string;
  merchant: string;
  paymentMethod: string;
  note?: string;
  reimbursable: boolean;
  recurring: boolean;
  /** Active loan whose scheduled EMI this ledger entry records. */
  linkedLoanId?: string;
  createdAt: string;
};

export type BudgetWindowEndMode = "lifelong" | "retirement" | "custom";

/**
 * A monthly amount that is effective for an inclusive range of calendar
 * months. An omitted startDate means the amount is already effective (this is
 * also how pre-schedule budgets are migrated).
 */
export type BudgetWindow = {
  id: string;
  monthlyLimit: number;
  startDate?: string;
  endMode: BudgetWindowEndMode;
  endDate?: string;
  note?: string;
};

export type Budget = {
  category: string;
  /** Retained for wire compatibility with clients predating schedules. */
  monthlyLimit: number;
  windows?: BudgetWindow[];
};

const budgetMonth = (date: Date) => date.getFullYear() * 12 + date.getMonth();

const validBudgetDate = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (!match) return undefined;
  const [, yearText, monthText, dayText] = match;
  const date = new Date(Number(yearText), Number(monthText) - 1, Number(dayText));
  return date.getFullYear() === Number(yearText)
    && date.getMonth() === Number(monthText) - 1
    && date.getDate() === Number(dayText)
    ? `${yearText}-${monthText}-${dayText}`
    : undefined;
};

const normalizedBudgetAmount = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
};

/** Deterministic and idempotent migration/repair for persisted budget data. */
export function normalizeBudget(budget: Budget, budgetIndex = 0): Budget {
  const category = typeof budget?.category === "string" ? budget.category.trim() : "";
  const rawWindows = Array.isArray(budget?.windows) ? budget.windows : null;
  const sourceWindows: unknown[] = rawWindows ?? [{
    id: "legacy",
    monthlyLimit: budget?.monthlyLimit,
    endMode: "lifelong",
  }];
  const windows = sourceWindows.flatMap((value, windowIndex): BudgetWindow[] => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    const raw = value as Record<string, unknown>;
    const startDate = validBudgetDate(raw.startDate);
    if (typeof raw.startDate === "string" && raw.startDate.trim() && !startDate) return [];
    const requestedEndMode: BudgetWindowEndMode =
      raw.endMode === "custom" || raw.endMode === "retirement"
        ? raw.endMode
        : "lifelong";
    const endDate = requestedEndMode === "custom" ? validBudgetDate(raw.endDate) : undefined;
    // A malformed custom boundary is not silently turned into a lifelong cost.
    if (requestedEndMode === "custom" && !endDate) return [];
    if (startDate && endDate && budgetMonth(parseDateOnly(endDate)) < budgetMonth(parseDateOnly(startDate))) {
      return [];
    }
    const rawId = typeof raw.id === "string" ? raw.id.trim() : "";
    return [{
      id: rawId || `budget-${budgetIndex + 1}-window-${windowIndex + 1}`,
      monthlyLimit: normalizedBudgetAmount(raw.monthlyLimit ?? raw.amount),
      ...(startDate ? { startDate } : {}),
      endMode: requestedEndMode,
      ...(endDate ? { endDate } : {}),
      ...(typeof raw.note === "string" && raw.note.trim() ? { note: raw.note.trim() } : {}),
    }];
  });
  return {
    category,
    monthlyLimit: normalizedBudgetAmount(
      budget?.monthlyLimit
      ?? windows.reduce((sum, window) => sum + window.monthlyLimit, 0),
    ),
    windows,
  };
}

export function normalizeBudgets(value: unknown): Budget[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((budget): budget is Budget => typeof budget === "object" && budget !== null)
    .map(normalizeBudget);
}

export function isBudgetWindowActive(
  window: BudgetWindow,
  asOf = new Date(),
  retirementDate?: Date,
) {
  const month = budgetMonth(asOf);
  const start = window.startDate ? validBudgetDate(window.startDate) : undefined;
  const end = window.endMode === "custom" ? validBudgetDate(window.endDate) : undefined;
  if (window.startDate && !start) return false;
  if (window.endMode === "custom" && !end) return false;
  if (window.endMode === "retirement" && retirementDate && month >= budgetMonth(retirementDate)) {
    return false;
  }
  return (!start || budgetMonth(parseDateOnly(start)) <= month)
    && (!end || budgetMonth(parseDateOnly(end)) >= month);
}

/**
 * Amounts increase on calendar-month anniversaries of their own effective
 * dates. A legacy/always-active amount is considered effective in the queried
 * baseline month, so migration never unexpectedly inflates today's value.
 */
export function effectiveBudgetWindowAmount(
  window: BudgetWindow,
  asOf = new Date(),
  annualInflationPercent = 0,
  undatedAnchor = asOf,
  retirementDate?: Date,
) {
  if (!isBudgetWindowActive(window, asOf, retirementDate)) return 0;
  const amount = normalizedBudgetAmount(window.monthlyLimit);
  const rate = Math.min(0.25, normalizedBudgetAmount(annualInflationPercent) / 100);
  const start = window.startDate ? parseDateOnly(window.startDate) : undatedAnchor;
  const elapsedMonths = Math.max(0, budgetMonth(asOf) - budgetMonth(start));
  return amount * Math.pow(1 + rate, Math.floor(elapsedMonths / 12));
}

export function budgetTotalForMonth(
  budgets: Budget[],
  asOf = new Date(),
  annualInflationPercent = 0,
  undatedAnchor = asOf,
  retirementDate?: Date,
) {
  return normalizeBudgets(budgets).reduce(
    (total, budget) => total + (budget.windows ?? []).reduce(
      (sum, window) => sum + effectiveBudgetWindowAmount(
        window,
        asOf,
        annualInflationPercent,
        undatedAnchor,
        retirementDate,
      ),
      0,
    ),
    0,
  );
}

export function hasEffectiveBudgetPlan(budgets: Budget[]) {
  return normalizeBudgets(budgets).some((budget) =>
    (budget.windows ?? []).some((window) => normalizedBudgetAmount(window.monthlyLimit) > 0)
  );
}

export function validateBudgetSchedule(budgets: Budget[]) {
  const errors: string[] = [];
  budgets.forEach((budget, budgetIndex) => {
    if (!budget.category?.trim()) errors.push(`Budget ${budgetIndex + 1} has no category.`);
    if (Array.isArray(budget.windows)) {
      budget.windows.forEach((window, windowIndex) => {
        const label = `${budget.category || `Budget ${budgetIndex + 1}`} window ${windowIndex + 1}`;
        if (window.startDate && !validBudgetDate(window.startDate)) errors.push(`${label} has an invalid start date.`);
        if (window.endMode === "custom" && !validBudgetDate(window.endDate)) errors.push(`${label} has an invalid end date.`);
        const start = validBudgetDate(window.startDate);
        const end = validBudgetDate(window.endDate);
        if (start && end && budgetMonth(parseDateOnly(end)) < budgetMonth(parseDateOnly(start))) {
          errors.push(`${label} ends before it starts.`);
        }
        if (!Number.isFinite(Number(window.monthlyLimit)) || Number(window.monthlyLimit) < 0) {
          errors.push(`${label} has an invalid monthly amount.`);
        }
      });
    }
  });
  return errors;
}

export function summarizeBudgetSchedule(
  budgets: Budget[],
  asOf = new Date(),
  annualInflationPercent = 0,
) {
  const normalized = normalizeBudgets(budgets);
  return {
    budgets: normalized.length,
    windows: normalized.reduce((sum, budget) => sum + (budget.windows?.length ?? 0), 0),
    activeWindows: normalized.reduce(
      (sum, budget) => sum + (budget.windows ?? []).filter((window) => isBudgetWindowActive(window, asOf)).length,
      0,
    ),
    monthlyTotal: budgetTotalForMonth(normalized, asOf, annualInflationPercent),
    hasEffectivePlan: hasEffectiveBudgetPlan(normalized),
    validationErrors: validateBudgetSchedule(budgets),
  };
}

export type IncomeType = 'Salary' | 'Bonus' | 'Freelance/Consulting' | 'Rental' | 'Dividends' | 'Interest' | 'Business' | 'Capital Gains' | 'Other';
export type IncomeFrequency = 'Monthly' | 'Annual' | 'One-time';
export type IncomeEndMode = "retirement" | "custom";

export type SalaryDetails = {
  grossCTC: number;
  /** Whether gross CTC is derived from monthly earning components or entered directly. */
  grossCTCMode?: "automatic" | "manual";
  basicPay: number;
  hra: number;
  allowances: number;
  employeePF: number;
  professionalTax: number;
  tds: number;
  /** Whether monthly TDS is estimated by the tax calculator or entered directly. */
  tdsMode?: "automatic" | "manual";
  taxRegime?: "new" | "old";
  financialYear?: "2024-25" | "2025-26" | "2026-27";
  /** Identifies the tax-rule set used to produce an automatic TDS value. */
  taxRuleVersion?: string;
  otherDeductions: number;
};

export type IncomeSource = {
  id: string;
  name: string;
  type: IncomeType;
  frequency: IncomeFrequency;
  amount: number;
  date: string;
  recurring: boolean;
  /** Annual growth percentage for this recurring source. Undefined uses legacy projection defaults. */
  annualGrowthRate?: number;
  /** Recurring income remains available through this month. */
  incomeEndMode?: IncomeEndMode;
  incomeEndDate?: string;
  notes?: string;
  salaryDetails?: SalaryDetails;
  createdAt: string;
};

export type AssetClass = 'Direct Equity' | 'Mutual Funds' | 'Fixed Deposit' | 'Recurring Deposit' | 'PPF' | 'EPF' | 'NPS' | 'Gold' | 'Real Estate' | 'Bonds' | 'Crypto' | 'ESOP' | 'Other';

export type FundAllocation = {
  id: string;
  sourceId: string;
  opportunityDate: string;
  investmentDate: string;
  amount: number;
  createdAt: string;
};

export type CapitalGainsAssetType =
  | "Listed Equity"
  | "Equity Mutual Fund"
  | "Unlisted Equity"
  | "Real Estate"
  | "Gold"
  | "Debt Mutual Fund"
  | "Listed Bonds"
  | "Crypto";

/**
 * A disposal is intentionally tolerant of incomplete imported records. Tax
 * planning excludes it until all required facts are present rather than
 * manufacturing dates, values, classifications, or exemptions.
 */
export type InvestmentDisposal = {
  id: string;
  name: string;
  purchaseDate?: string;
  saleDate?: string;
  costBasis?: number;
  proceeds?: number;
  assetType?: CapitalGainsAssetType | string;
  eligibleExemption?: number;
  /** User-supplied indexed acquisition cost for historical LTCG rules. */
  indexedCostBasis?: number;
  /** Fair market value as at 31 January 2018 for eligible equity grandfathering. */
  grandfatheredValue?: number;
  /** Shared by every disposal confirmed from the same broker file review. */
  importBatchId?: string;
  /** Confirmation time for the broker import; the uploaded file itself is never stored. */
  importedAt?: string;
};

export type Investment = {
  id: string;
  name: string;
  assetClass: AssetClass;
  investedAmount: number;
  currentValue: number;
  quantity?: number;
  averageBuyPrice?: number;
  monthlyContribution?: number;
  /**
   * Contribution schedules are optional to support investments saved before
   * scheduling was introduced. Missing values mean "start today, end at
   * retirement" and are materialized by normalizeInvestmentContributionSchedule.
   */
  contributionStartDate?: string;
  contributionEndMode?: "retirement" | "custom";
  contributionEndDate?: string;
  /** Income source that owns an automatically synchronized salary EPF contribution. */
  linkedIncomeSourceId?: string;
  /** True when monthlyContribution is managed from the linked salary source. */
  autoManagedContribution?: boolean;
  expectedReturn: number;
  ticker?: string;
  folio?: string;
  institution?: string;
  interestRate?: number;
  accountNumber?: string;
  unit?: string;
  location?: string;
  area?: string;
  maturityDate?: string;
  notes?: string;
  /** Explicit commitments of annual or one-time income to this investment. */
  fundAllocations?: FundAllocation[];
  /** Realized sale lots used for capital-gains planning. */
  disposals?: InvestmentDisposal[];
  createdAt: string;
};

export type LoanType = 'Home' | 'Auto' | 'Personal' | 'Education' | 'Other';
export type InterestType = 'Fixed' | 'Floating';

export type Loan = {
  id: string;
  type: LoanType;
  name: string;
  sanctionedPrincipal: number;
  outstandingPrincipal: number;
  annualInterestRate: number;
  interestType: InterestType;
  totalTenureMonths: number;
  startDate: string;
  emi: number;
  prepayments: number;
  notes?: string;
  createdAt: string;
};

const normalizeLoanText = (value: string | undefined) =>
  (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type LoanNameMatch =
  | { status: "matched"; loan: Loan }
  | { status: "missing" | "ambiguous" };

/**
 * A blank or invalid date is treated as already started for compatibility with
 * loans created before start dates were used for cash-flow timing.
 */
export function isLoanStarted(loan: Pick<Loan, "startDate">, asOf = new Date()) {
  const startDate = loan.startDate?.trim();
  if (!startDate) return true;
  const start = parseDateOnly(startDate);
  return !Number.isFinite(start.getTime()) || start <= asOf;
}

export function isCurrentLoan(loan: Loan, asOf = new Date()) {
  return Number.isFinite(Number(loan.outstandingPrincipal))
    && Number(loan.outstandingPrincipal) > 0
    && Number.isFinite(Number(loan.emi))
    && Number(loan.emi) > 0
    && isLoanStarted(loan, asOf);
}

/** Active means currently due today, not merely a future loan with an EMI. */
export function isActiveLoan(loan: Loan) {
  return isCurrentLoan(loan);
}

export function findMatchingEmiLoan(
  expense: Pick<Expense, "amount" | "merchant" | "note" | "linkedLoanId">,
  loans: Loan[],
  requireLoanText = true,
) {
  if (expense.linkedLoanId) {
    return loans.find((loan) => loan.id === expense.linkedLoanId);
  }

  const activeLoans = loans.filter(isActiveLoan);
  const amount = Number(expense.amount);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const text = normalizeLoanText(`${expense.merchant} ${expense.note ?? ""}`);

  return activeLoans.find((loan) => {
    const emi = Number(loan.emi);
    const amountMatches = Math.abs(amount - emi) <= Math.max(1, emi * 0.01);
    if (!amountMatches) return false;
    if (!requireLoanText) return true;

    const loanName = normalizeLoanText(loan.name);
    const loanType = normalizeLoanText(loan.type);
    return /\b(emi|loan|mortgage)\b/.test(text)
      || (loanName.length >= 3 && text.includes(loanName))
      || (loanType.length >= 4 && text.includes(loanType));
  });
}

export function isLivingExpense(expense: Expense, loans: Loan[] = []) {
  return !expense.reimbursable
    && Number.isFinite(Number(expense.amount))
    && Number(expense.amount) > 0
    && !expense.linkedLoanId
    && !findMatchingEmiLoan(expense, loans);
}

export function getLinkedLoanName(
  expense: Pick<Expense, "linkedLoanId">,
  loans: Loan[],
) {
  if (!expense.linkedLoanId) return "";
  return loans.find((loan) => loan.id === expense.linkedLoanId)?.name
    ?? "Linked loan unavailable";
}

export type RetirementInputs = {
  dateOfBirth: string;
  targetRetirementAge: number;
  lifeExpectancy: number;
  generalInflation: number;
  salaryGrowth: number;
  monthlyContributionOverride?: number;
  investSurplus?: boolean;
};

export type RiskPreference = "Conservative" | "Balanced" | "Growth";

export type ProfileInputs = {
  fullName?: string;
  gender?: string;
  email?: string;
  phone?: string;
  onboardingCompleted?: boolean;
  dateOfBirth: string;
  targetRetirementAge: number;
  lifeExpectancy: number;
  riskPreference: RiskPreference;
};

const EXPENSES_KEY = "ezyretire_expenses";
const BUDGETS_KEY = "ezyretire_budgets";
const INCOME_KEY = "ezyretire_income";
const INVESTMENTS_KEY = "ezyretire_investments";
const LOANS_KEY = "ezyretire_loans";
const RETIREMENT_KEY = "ezyretire_retirement";
const PROFILE_KEY = "ezyretire_profile";

const LEGACY_STORAGE_KEYS = {
  [EXPENSES_KEY]: "wealthone_expenses",
  [BUDGETS_KEY]: "wealthone_budgets",
  [INCOME_KEY]: "wealthone_income",
  [INVESTMENTS_KEY]: "wealthone_investments",
  [LOANS_KEY]: "wealthone_loans",
  [RETIREMENT_KEY]: "wealthone_retirement",
  [PROFILE_KEY]: "wealthone_profile",
} as const;

export function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeDateOnly(value: string): string {
  const dateOnly = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (dateOnly) return dateOnly;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? formatDateOnly(parsed) : value;
}

export function parseDateOnly(value: string): Date {
  const dateOnly = normalizeDateOnly(value);
  const [year, month, day] = dateOnly.split("-").map(Number);
  if (year && month && day) return new Date(year, month - 1, day);
  return new Date(value);
}

export function isRecurringIncomeActive(source: IncomeSource, asOf = new Date()): boolean {
  if (!source.recurring || source.frequency === "One-time") return false;
  if (source.incomeEndMode !== "custom" || !source.incomeEndDate) return true;
  const end = parseDateOnly(source.incomeEndDate);
  if (!Number.isFinite(end.getTime())) return true;
  const endMonth = end.getFullYear() * 12 + end.getMonth();
  const currentMonth = asOf.getFullYear() * 12 + asOf.getMonth();
  return endMonth >= currentMonth;
}

export function normalizeInvestmentContributionSchedule(
  investment: Investment,
  asOf = new Date(),
): Investment {
  const { contributionEndDate: _existingContributionEndDate, ...baseInvestment } = investment;
  const contributionStartDate =
    typeof investment.contributionStartDate === "string" && investment.contributionStartDate.trim()
      ? normalizeDateOnly(investment.contributionStartDate)
      : formatDateOnly(asOf);
  const contributionEndMode =
    investment.contributionEndMode === "custom" ? "custom" : "retirement";
  const contributionEndDate =
    contributionEndMode === "custom"
    && typeof investment.contributionEndDate === "string"
    && investment.contributionEndDate.trim()
      ? normalizeDateOnly(investment.contributionEndDate)
      : undefined;

  return {
    ...baseInvestment,
    contributionStartDate,
    contributionEndMode,
    ...(contributionEndDate ? { contributionEndDate } : {}),
    ...(Array.isArray(investment.disposals)
      ? { disposals: normalizeInvestmentDisposals(investment.disposals, investment.id) }
      : {}),
  };
}

const validCalendarDate = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const normalized = normalizeDateOnly(value.trim());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return undefined;
  const parsed = parseDateOnly(normalized);
  return Number.isFinite(parsed.getTime()) && formatDateOnly(parsed) === normalized
    ? normalized
    : undefined;
};

const optionalFiniteAmount = (value: unknown) => {
  if (value === "" || value === null || value === undefined) return undefined;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
};

export function normalizeInvestmentDisposals(
  value: unknown,
  investmentId = "investment",
): InvestmentDisposal[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((record, index) => {
    const id = typeof record.id === "string" && record.id.trim()
      ? record.id.trim()
      : `${investmentId}-disposal-${index + 1}`;
    const name = typeof record.name === "string" && record.name.trim()
      ? record.name.trim()
      : `Disposal ${index + 1}`;
    const purchaseDate = validCalendarDate(record.purchaseDate);
    const saleDate = validCalendarDate(record.saleDate);
    const costBasis = optionalFiniteAmount(record.costBasis);
    const proceeds = optionalFiniteAmount(record.proceeds);
    const assetType = typeof record.assetType === "string" && record.assetType.trim()
      ? record.assetType.trim()
      : undefined;
    const eligibleExemption = optionalFiniteAmount(record.eligibleExemption);
    const indexedCostBasis = optionalFiniteAmount(record.indexedCostBasis);
    const grandfatheredValue = optionalFiniteAmount(record.grandfatheredValue);
    const importBatchId = typeof record.importBatchId === "string" && record.importBatchId.trim()
      ? record.importBatchId.trim()
      : undefined;
    const importedAt = typeof record.importedAt === "string"
      && record.importedAt.trim()
      && Number.isFinite(new Date(record.importedAt).getTime())
      ? record.importedAt.trim()
      : undefined;
    return {
      id,
      name,
      ...(purchaseDate ? { purchaseDate } : {}),
      ...(saleDate ? { saleDate } : {}),
      ...(costBasis !== undefined ? { costBasis } : {}),
      ...(proceeds !== undefined ? { proceeds } : {}),
      ...(assetType ? { assetType } : {}),
      ...(eligibleExemption !== undefined ? { eligibleExemption } : {}),
      ...(indexedCostBasis !== undefined ? { indexedCostBasis } : {}),
      ...(grandfatheredValue !== undefined ? { grandfatheredValue } : {}),
      ...(importBatchId ? { importBatchId } : {}),
      ...(importBatchId && importedAt ? { importedAt } : {}),
    };
  });
}

/**
 * Legacy or malformed income schedules must remain available until retirement.
 * A custom end is accepted only when it is a valid local calendar date.
 */
export function normalizeIncomeSchedule(source: IncomeSource): IncomeSource {
  const salaryDetails = source.salaryDetails
    ? {
        ...source.salaryDetails,
        // Existing salaries predate calculated fields, so their entered values
        // must remain authoritative rather than being silently recalculated.
        grossCTCMode: source.salaryDetails.grossCTCMode === "automatic" ? "automatic" as const : "manual" as const,
        tdsMode: source.salaryDetails.tdsMode === "automatic" ? "automatic" as const : "manual" as const,
        taxRegime:
          source.salaryDetails.taxRegime === "new" || source.salaryDetails.taxRegime === "old"
            ? source.salaryDetails.taxRegime
            : undefined,
        financialYear:
          source.salaryDetails.financialYear === "2024-25"
          || source.salaryDetails.financialYear === "2025-26"
          || source.salaryDetails.financialYear === "2026-27"
            ? source.salaryDetails.financialYear
            : undefined,
        taxRuleVersion:
          typeof source.salaryDetails.taxRuleVersion === "string"
          && source.salaryDetails.taxRuleVersion.trim()
            ? source.salaryDetails.taxRuleVersion.trim()
            : undefined,
      }
    : undefined;
  const normalizedSource = salaryDetails ? { ...source, salaryDetails } : source;
  // Older salary records used Annual to mean annual CTC while their component
  // amounts represented yearly payroll figures. Salary is monthly cash flow;
  // yearly bonus payments are represented by Bonus + Annual instead.
  const legacyAnnualSalary = normalizedSource.type === "Salary"
    && normalizedSource.frequency === "Annual"
    && normalizedSource.recurring === true
    && normalizedSource.salaryDetails !== undefined;
  const monthlyPayrollAmount = (value: number) => {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount / 12 : 0;
  };
  const migratedSource: IncomeSource = legacyAnnualSalary
    ? {
        ...normalizedSource,
        frequency: "Monthly",
        amount: monthlyPayrollAmount(normalizedSource.amount),
        salaryDetails: {
          ...normalizedSource.salaryDetails!,
          basicPay: monthlyPayrollAmount(normalizedSource.salaryDetails!.basicPay),
          hra: monthlyPayrollAmount(normalizedSource.salaryDetails!.hra),
          allowances: monthlyPayrollAmount(normalizedSource.salaryDetails!.allowances),
          employeePF: monthlyPayrollAmount(normalizedSource.salaryDetails!.employeePF),
          professionalTax: monthlyPayrollAmount(normalizedSource.salaryDetails!.professionalTax),
          tds: monthlyPayrollAmount(normalizedSource.salaryDetails!.tds),
          otherDeductions: monthlyPayrollAmount(normalizedSource.salaryDetails!.otherDeductions),
        },
      }
    : normalizedSource;
  const {
    incomeEndDate: _existingIncomeEndDate,
    annualGrowthRate: _existingAnnualGrowthRate,
    ...baseSource
  } = migratedSource;
  // Before One-time was available, the UI stored one-off funds as Annual with
  // recurring=false. Preserve that meaning rather than silently making them yearly.
  const frequency: IncomeFrequency = migratedSource.frequency === "Annual" && migratedSource.recurring === false
    ? "One-time"
    : migratedSource.frequency;
  const recurring = frequency !== "One-time";
  if (!recurring) {
    return {
      ...baseSource,
      frequency,
      recurring: false,
      incomeEndMode: "retirement",
    };
  }
  const rawDate = typeof migratedSource.incomeEndDate === "string" ? migratedSource.incomeEndDate.trim() : "";
  const normalizedDate = rawDate ? normalizeDateOnly(rawDate) : "";
  const parsed = normalizedDate ? parseDateOnly(normalizedDate) : null;
  const validCustomDate = migratedSource.incomeEndMode === "custom"
    && /^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)
    && parsed !== null
    && Number.isFinite(parsed.getTime())
    && formatDateOnly(parsed) === normalizedDate;
  return {
    ...baseSource,
    frequency,
    recurring: true,
    annualGrowthRate: migratedSource.annualGrowthRate,
    incomeEndMode: validCustomDate ? "custom" : "retirement",
    ...(validCustomDate ? { incomeEndDate: normalizedDate } : {}),
  };
}

const SAMPLE_EXPENSES: Expense[] = [
  {
    id: "e1",
    date: new Date().toISOString(),
    amount: 1250,
    category: "Food & Dining",
    merchant: "Swiggy",
    paymentMethod: "UPI",
    note: "Lunch",
    reimbursable: false,
    recurring: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: "e2",
    date: new Date(Date.now() - 86400000).toISOString(),
    amount: 45000,
    category: "Housing",
    merchant: "Landlord",
    paymentMethod: "Bank Transfer",
    note: "Rent",
    reimbursable: false,
    recurring: true,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: "e3",
    date: new Date(Date.now() - 172800000).toISOString(),
    amount: 350,
    category: "Transportation",
    merchant: "Uber",
    paymentMethod: "UPI",
    reimbursable: true,
    recurring: false,
    createdAt: new Date(Date.now() - 172800000).toISOString(),
  },
  {
    id: "e4",
    date: new Date(Date.now() - 259200000).toISOString(),
    amount: 2500,
    category: "Utilities",
    merchant: "BSES",
    paymentMethod: "Credit Card",
    note: "Electricity Bill",
    reimbursable: false,
    recurring: true,
    createdAt: new Date(Date.now() - 259200000).toISOString(),
  },
  {
    id: "e5",
    date: new Date(Date.now() - 345600000).toISOString(),
    amount: 1500,
    category: "Entertainment",
    merchant: "Netflix",
    paymentMethod: "Credit Card",
    reimbursable: false,
    recurring: true,
    createdAt: new Date(Date.now() - 345600000).toISOString(),
  }
];

const SAMPLE_BUDGETS: Budget[] = [
  { category: "Food & Dining", monthlyLimit: 15000 },
  { category: "Transportation", monthlyLimit: 5000 },
  { category: "Entertainment", monthlyLimit: 3000 },
  { category: "Shopping", monthlyLimit: 10000 },
  { category: "Utilities", monthlyLimit: 8000 },
];

const SAMPLE_INCOME: IncomeSource[] = [
  {
    id: "i1",
    name: "Tech Corp - Software Engineer",
    type: "Salary",
    frequency: "Annual",
    amount: 0,
    date: new Date().toISOString(),
    recurring: true,
    salaryDetails: {
      grossCTC: 2400000,
      basicPay: 1000000,
      hra: 500000,
      allowances: 900000,
      employeePF: 120000,
      professionalTax: 2400,
      tds: 350000,
      otherDeductions: 0
    },
    createdAt: new Date().toISOString()
  },
  {
    id: "i2",
    name: "Apartment Rent",
    type: "Rental",
    frequency: "Monthly",
    amount: 25000,
    date: new Date().toISOString(),
    recurring: true,
    createdAt: new Date().toISOString()
  }
];

const SAMPLE_INVESTMENTS: Investment[] = [
  {
    id: "inv1",
    name: "Nifty 50 Index Fund",
    assetClass: "Mutual Funds",
    investedAmount: 500000,
    currentValue: 650000,
    expectedReturn: 12,
    monthlyContribution: 20000,
    createdAt: new Date().toISOString()
  },
  {
    id: "inv2",
    name: "Employee Provident Fund",
    assetClass: "EPF",
    investedAmount: 800000,
    currentValue: 950000,
    expectedReturn: 8.15,
    monthlyContribution: 10000,
    linkedIncomeSourceId: "i1",
    autoManagedContribution: true,
    createdAt: new Date().toISOString()
  },
  {
    id: "inv3",
    name: "HDFC Bank FD",
    assetClass: "Fixed Deposit",
    investedAmount: 200000,
    currentValue: 215000,
    expectedReturn: 7,
    maturityDate: new Date(Date.now() + 86400000 * 365).toISOString(),
    createdAt: new Date().toISOString()
  }
];

const SAMPLE_LOANS: Loan[] = [
  {
    id: "l1",
    type: "Home",
    name: "HDFC Home Loan",
    sanctionedPrincipal: 5000000,
    outstandingPrincipal: 4500000,
    annualInterestRate: 8.5,
    interestType: "Floating",
    totalTenureMonths: 240,
    startDate: new Date(Date.now() - 86400000 * 365 * 2).toISOString(),
    emi: 43391,
    prepayments: 100000,
    createdAt: new Date().toISOString()
  },
  {
    id: "l2",
    type: "Auto",
    name: "SBI Car Loan",
    sanctionedPrincipal: 800000,
    outstandingPrincipal: 600000,
    annualInterestRate: 9.2,
    interestType: "Fixed",
    totalTenureMonths: 60,
    startDate: new Date(Date.now() - 86400000 * 365).toISOString(),
    emi: 16685,
    prepayments: 0,
    createdAt: new Date().toISOString()
  }
];

const SAMPLE_RETIREMENT: RetirementInputs = {
  dateOfBirth: new Date(Date.now() - 86400000 * 365 * 30).toISOString(), // ~30 years old
  targetRetirementAge: 55,
  lifeExpectancy: 85,
  generalInflation: 6,
  salaryGrowth: 8,
  monthlyContributionOverride: 0,
  investSurplus: false,
};

const SAMPLE_PROFILE: ProfileInputs = {
  dateOfBirth: SAMPLE_RETIREMENT.dateOfBirth,
  targetRetirementAge: SAMPLE_RETIREMENT.targetRetirementAge,
  lifeExpectancy: SAMPLE_RETIREMENT.lifeExpectancy,
  riskPreference: "Balanced",
  onboardingCompleted: false,
};

export function calculatePlanningTimeline(profile: Pick<ProfileInputs, "dateOfBirth" | "targetRetirementAge" | "lifeExpectancy">, asOf = new Date()) {
  const birthDate = parseDateOnly(profile.dateOfBirth);
  if (!Number.isFinite(birthDate.getTime()) || birthDate > asOf) {
    return { currentAge: 0, yearsToRetirement: 0, yearsInRetirement: 0, isValid: false };
  }
  let currentAge = asOf.getFullYear() - birthDate.getFullYear();
  const birthdayHasPassed = asOf.getMonth() > birthDate.getMonth()
    || (asOf.getMonth() === birthDate.getMonth() && asOf.getDate() >= birthDate.getDate());
  if (!birthdayHasPassed) currentAge -= 1;
  return {
    currentAge: Math.max(0, currentAge),
    yearsToRetirement: Math.max(0, profile.targetRetirementAge - currentAge),
    yearsInRetirement: Math.max(0, profile.lifeExpectancy - profile.targetRetirementAge),
    isValid: profile.targetRetirementAge >= currentAge && profile.lifeExpectancy >= profile.targetRetirementAge,
  };
}

export function calculateTargetRetirementMonth(
  profile: Pick<ProfileInputs, "dateOfBirth" | "targetRetirementAge">,
) {
  const birthDate = parseDateOnly(profile.dateOfBirth);
  const targetAge = Number(profile.targetRetirementAge);
  if (
    !Number.isFinite(birthDate.getTime())
    || !Number.isFinite(targetAge)
    || targetAge < 0
  ) return undefined;
  return new Date(
    birthDate.getFullYear() + Math.trunc(targetAge),
    birthDate.getMonth(),
    1,
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads only the expected top-level shape. Corrupt local storage must never
 * prevent the app from loading (or be mistaken for valid financial records).
 */
const readStored = <T>(key: string, fallback: T, isExpectedShape: (value: unknown) => boolean): T => {
  const data = localStorage.getItem(key);
  if (!data) return fallback;
  try {
    const parsed: unknown = JSON.parse(data);
    return isExpectedShape(parsed) ? parsed as T : fallback;
  } catch {
    return fallback;
  }
};

/**
 * Copies a legacy value only when the ezyRetire key does not exist. The old key
 * remains untouched so migration is non-destructive and can safely be retried.
 */
const getMigratedStorageValue = (key: keyof typeof LEGACY_STORAGE_KEYS): string | null => {
  const current = localStorage.getItem(key);
  if (current !== null) return current;

  const legacy = localStorage.getItem(LEGACY_STORAGE_KEYS[key]);
  if (legacy !== null) localStorage.setItem(key, legacy);
  return legacy;
};

const safeMonthlyEmployeePF = (source: IncomeSource) => {
  if (
    source.type !== "Salary"
    || !source.salaryDetails
    || !source.recurring
    || source.frequency !== "Monthly"
  ) return 0;
  const employeePF = Number(source.salaryDetails.employeePF);
  if (!Number.isFinite(employeePF) || employeePF <= 0) return 0;
  return employeePF;
};

/**
 * Keeps salary deductions and their EPF investment contribution in sync without
 * changing any manually maintained corpus or account details.
 */
export function synchronizeSalaryEPF(
  sources: IncomeSource[],
  existingInvestments: Investment[],
  asOf = new Date(),
): Investment[] {
  const investments = existingInvestments.map((investment) => ({ ...investment }));
  const sourcesById = new Map(sources.map((source) => [source.id, source]));

  // Repair duplicate managed links defensively. Keep the holding with the
  // largest recorded corpus linked; retain other holdings as historical EPF
  // records but stop their automatic contribution so PF is never counted twice.
  const managedBySource = new Map<string, Investment[]>();
  investments.forEach((investment) => {
    if (!investment.autoManagedContribution || !investment.linkedIncomeSourceId) return;
    const matches = managedBySource.get(investment.linkedIncomeSourceId) ?? [];
    matches.push(investment);
    managedBySource.set(investment.linkedIncomeSourceId, matches);
  });
  managedBySource.forEach((matches) => {
    if (matches.length <= 1) return;
    const [keeper, ...duplicates] = matches.sort(
      (left, right) => (Number(right.currentValue) || 0) - (Number(left.currentValue) || 0),
    );
    duplicates.forEach((duplicate) => {
      duplicate.monthlyContribution = 0;
      duplicate.autoManagedContribution = false;
      delete duplicate.linkedIncomeSourceId;
    });
    keeper.autoManagedContribution = true;
  });

  // Retain historical linked holdings when their source disappears or stops
  // qualifying, but stop projecting future contributions.
  investments.forEach((investment) => {
    if (!investment.autoManagedContribution || !investment.linkedIncomeSourceId) return;
    const source = sourcesById.get(investment.linkedIncomeSourceId);
    investment.monthlyContribution = source && isRecurringIncomeActive(source, asOf)
      ? safeMonthlyEmployeePF(source)
      : 0;
  });

  const eligible = sources.filter(
    (source) => isRecurringIncomeActive(source, asOf) && safeMonthlyEmployeePF(source) > 0,
  );
  const linkedSourceIds = new Set(
    investments
      .filter((investment) => investment.autoManagedContribution && investment.linkedIncomeSourceId)
      .map((investment) => investment.linkedIncomeSourceId as string),
  );
  const unlinkedEPF = investments.filter(
    (investment) => investment.assetClass === "EPF"
      && !investment.linkedIncomeSourceId
      && !investment.autoManagedContribution,
  );
  const canReuseLegacyEPF = eligible.length === 1 && unlinkedEPF.length === 1;
  const usedIds = new Set(investments.map((investment) => investment.id));

  eligible.forEach((source) => {
    if (linkedSourceIds.has(source.id)) return;

    // Only claim a manual holding when there is a single unambiguous candidate.
    // This also links the shipped sample EPF rather than duplicating it.
    const reusable = canReuseLegacyEPF ? unlinkedEPF.shift() : undefined;
    if (reusable) {
      reusable.linkedIncomeSourceId = source.id;
      reusable.autoManagedContribution = true;
      reusable.monthlyContribution = safeMonthlyEmployeePF(source);
    } else {
      const baseId = `salary-epf-${source.id}`;
      let id = baseId;
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }
      usedIds.add(id);
      investments.push({
        id,
        name: `${source.name} — Salary EPF`,
        assetClass: "EPF",
        investedAmount: 0,
        currentValue: 0,
        monthlyContribution: safeMonthlyEmployeePF(source),
        linkedIncomeSourceId: source.id,
        autoManagedContribution: true,
        expectedReturn: 8.15,
        createdAt: new Date().toISOString(),
      });
    }
    linkedSourceIds.add(source.id);
  });

  return investments;
}

export const storage = {
  getExpenses: (): Expense[] => {
    const data = getMigratedStorageValue(EXPENSES_KEY);
    return data
      ? readStored<Expense[]>(EXPENSES_KEY, [], Array.isArray)
      : SAMPLE_EXPENSES;
  },
  saveExpenses: (expenses: Expense[]) => {
    localStorage.setItem(EXPENSES_KEY, JSON.stringify(expenses));
  },
  getBudgets: (): Budget[] => {
    const data = getMigratedStorageValue(BUDGETS_KEY);
    const budgets = data
      ? readStored<Budget[]>(BUDGETS_KEY, [], Array.isArray)
      : SAMPLE_BUDGETS;
    return normalizeBudgets(budgets);
  },
  saveBudgets: (budgets: Budget[]) => {
    localStorage.setItem(BUDGETS_KEY, JSON.stringify(normalizeBudgets(budgets)));
  },
  getIncomeSources: (): IncomeSource[] => {
    const data = getMigratedStorageValue(INCOME_KEY);
    const sources = data
      ? readStored<IncomeSource[]>(INCOME_KEY, [], Array.isArray)
      : SAMPLE_INCOME;
    return sources.map(normalizeIncomeSchedule);
  },
  saveIncomeSources: (sources: IncomeSource[]) => {
    const normalized = sources.map(normalizeIncomeSchedule);
    localStorage.setItem(INCOME_KEY, JSON.stringify(normalized));
    const synchronized = synchronizeSalaryEPF(normalized, storage.getInvestments());
    localStorage.setItem(INVESTMENTS_KEY, JSON.stringify(synchronized));
  },
  getInvestments: (): Investment[] => {
    const data = getMigratedStorageValue(INVESTMENTS_KEY);
    const investments = data
      ? readStored<Investment[]>(INVESTMENTS_KEY, [], Array.isArray)
      : SAMPLE_INVESTMENTS;
    return investments.map((investment) => normalizeInvestmentContributionSchedule(investment));
  },
  saveInvestments: (investments: Investment[]) => {
    localStorage.setItem(
      INVESTMENTS_KEY,
      JSON.stringify(investments.map((investment) => normalizeInvestmentContributionSchedule(investment))),
    );
  },
  getLoans: (): Loan[] => {
    const data = getMigratedStorageValue(LOANS_KEY);
    return data
      ? readStored<Loan[]>(LOANS_KEY, [], Array.isArray)
      : SAMPLE_LOANS;
  },
  saveLoans: (loans: Loan[]) => {
    localStorage.setItem(LOANS_KEY, JSON.stringify(loans));
  },
  getRetirementInputs: (): RetirementInputs => {
    const data = getMigratedStorageValue(RETIREMENT_KEY);
    const retirement = data
      ? readStored<RetirementInputs>(RETIREMENT_KEY, SAMPLE_RETIREMENT, isRecord)
      : SAMPLE_RETIREMENT;
    const profile = storage.getProfileInputs();
    return { ...retirement, ...profile };
  },
  saveRetirementInputs: (inputs: RetirementInputs) => {
    const { dateOfBirth, targetRetirementAge, lifeExpectancy, ...planInputs } = inputs;
    const currentProfile = storage.getProfileInputs();
    storage.saveProfileInputs({
      ...currentProfile,
      dateOfBirth,
      targetRetirementAge,
      lifeExpectancy,
    });
    localStorage.setItem(RETIREMENT_KEY, JSON.stringify(planInputs));
  },
  getProfileInputs: (): ProfileInputs => {
    const savedProfile = getMigratedStorageValue(PROFILE_KEY);
    if (savedProfile) {
      const profile = { ...SAMPLE_PROFILE, ...readStored<Partial<ProfileInputs>>(PROFILE_KEY, {}, isRecord) };
      return { ...profile, dateOfBirth: normalizeDateOnly(profile.dateOfBirth) };
    }

    const legacyRetirement = getMigratedStorageValue(RETIREMENT_KEY);
    const legacy = legacyRetirement
      ? readStored<Partial<RetirementInputs>>(RETIREMENT_KEY, {}, isRecord)
      : {};
    const migrated: ProfileInputs = {
      ...SAMPLE_PROFILE,
      dateOfBirth: legacy.dateOfBirth ? normalizeDateOnly(legacy.dateOfBirth) : SAMPLE_PROFILE.dateOfBirth,
      targetRetirementAge: legacy.targetRetirementAge ?? SAMPLE_PROFILE.targetRetirementAge,
      lifeExpectancy: legacy.lifeExpectancy ?? SAMPLE_PROFILE.lifeExpectancy,
    };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(migrated));
    return migrated;
  },
  saveProfileInputs: (inputs: ProfileInputs) => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(inputs));
  },
  resetData: () => {
    localStorage.removeItem(EXPENSES_KEY);
    localStorage.removeItem(BUDGETS_KEY);
    localStorage.removeItem(INCOME_KEY);
    localStorage.removeItem(INVESTMENTS_KEY);
    localStorage.removeItem(LOANS_KEY);
    localStorage.removeItem(RETIREMENT_KEY);
    localStorage.removeItem(PROFILE_KEY);
    Object.values(LEGACY_STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
  }
};

export function matchLoanByName(name: string, loans: Loan[]): LoanNameMatch {
  const normalizedName = normalizeLoanText(name);
  if (!normalizedName) return { status: "missing" };

  const matches = loans.filter(
    (loan) => normalizeLoanText(loan.name) === normalizedName,
  );
  if (matches.length === 1) return { status: "matched", loan: matches[0] };
  return { status: matches.length === 0 ? "missing" : "ambiguous" };
}
