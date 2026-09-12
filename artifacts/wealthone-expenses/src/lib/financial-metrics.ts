import type {
  IncomeSource,
  Investment,
  Loan,
  NetWorthSnapshot,
  RetirementLifestyle,
} from "./storage";

export const finiteNonNegative = (value: number | undefined, fallback = 0) =>
  Number.isFinite(value) ? Math.max(0, value as number) : fallback;

/** Net cash received for one occurrence, including the salary form's component model. */
export function incomeOccurrenceNetAmount(source: IncomeSource) {
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

/**
 * Normalizes an active recurring source to monthly cash flow. One-time and
 * inactive sources deliberately return zero so summaries cannot turn a lump
 * sum into recurring income.
 */
export function recurringMonthlyNetIncome(source: IncomeSource) {
  if (!source.recurring || source.frequency !== "Monthly") return 0;
  return incomeOccurrenceNetAmount(source);
}

/** Confirmed amount of a single annual or one-time payment. */
export function datedFundNetAmount(source: IncomeSource) {
  if (source.frequency === "Monthly") return 0;
  return incomeOccurrenceNetAmount(source);
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

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));
const rounded = (value: number, places = 2) => {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export type NetWorthItem = {
  id: string;
  name: string;
  category: string;
  value: number;
};

export type NetWorthInput = {
  investments?: Array<Pick<Investment, "id" | "name" | "assetClass" | "currentValue">>;
  loans?: Array<Pick<Loan, "id" | "name" | "type" | "outstandingPrincipal">>;
  /** Cash not already represented by an investment. */
  cashBalance?: number;
  additionalAssets?: NetWorthItem[];
  additionalLiabilities?: NetWorthItem[];
};

/**
 * Net worth is based on current balances only. Invested cost, sanctioned loan
 * principal, future interest, income, and contributions are deliberately not
 * counted.
 */
export function calculateNetWorth({
  investments = [],
  loans = [],
  cashBalance = 0,
  additionalAssets = [],
  additionalLiabilities = [],
}: NetWorthInput) {
  const assets: NetWorthItem[] = investments.map((investment) => ({
    id: investment.id,
    name: investment.name,
    category: investment.assetClass,
    value: finiteNonNegative(investment.currentValue),
  }));
  const cash = finiteNonNegative(cashBalance);
  if (cash > 0) assets.push({ id: "cash", name: "Cash", category: "Cash", value: cash });
  assets.push(...additionalAssets.map((item) => ({ ...item, value: finiteNonNegative(item.value) })));

  const liabilities: NetWorthItem[] = loans.map((loan) => ({
    id: loan.id,
    name: loan.name,
    category: loan.type,
    value: finiteNonNegative(loan.outstandingPrincipal),
  }));
  liabilities.push(...additionalLiabilities.map((item) => ({ ...item, value: finiteNonNegative(item.value) })));

  const totalAssets = assets.reduce((sum, item) => sum + item.value, 0);
  const totalLiabilities = liabilities.reduce((sum, item) => sum + item.value, 0);
  const byCategory = (items: NetWorthItem[]) => Object.fromEntries(
    [...items.reduce((totals, item) => {
      totals.set(item.category, (totals.get(item.category) ?? 0) + item.value);
      return totals;
    }, new Map<string, number>())]
      .sort(([left], [right]) => left.localeCompare(right)),
  );

  return {
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
    assets,
    liabilities,
    assetComposition: byCategory(assets),
    liabilityComposition: byCategory(liabilities),
  };
}

/** Storage-compatible snapshot with optional capture audit metadata. */
export type MonthlyNetWorthSnapshot = NetWorthSnapshot & {
  capturedAt?: string;
};

const canonicalMonth = (value: string) => {
  const match = value?.trim().match(/^(\d{4})-(\d{2})(?:-\d{2})?/);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
    throw new Error("Snapshot month must be a valid YYYY-MM value.");
  }
  return `${match[1]}-${match[2]}`;
};

/**
 * One snapshot is retained per month. Re-saving a month replaces it, while
 * preserving all other months; output order is chronological and deterministic.
 */
export function upsertMonthlyNetWorthSnapshot(
  snapshots: MonthlyNetWorthSnapshot[],
  snapshot: MonthlyNetWorthSnapshot,
) {
  const month = canonicalMonth(snapshot.month);
  const assets = finiteNonNegative(snapshot.assets);
  const liabilities = finiteNonNegative(snapshot.liabilities);
  const normalized: MonthlyNetWorthSnapshot = {
    month,
    assets,
    liabilities,
    // Derive this value so persisted snapshots cannot contain contradictory totals.
    netWorth: assets - liabilities,
    ...(snapshot.capturedAt ? { capturedAt: snapshot.capturedAt } : {}),
  };
  const byMonth = new Map<string, MonthlyNetWorthSnapshot>();
  for (const existing of Array.isArray(snapshots) ? snapshots : []) {
    try {
      const existingMonth = canonicalMonth(existing.month);
      if (!byMonth.has(existingMonth)) {
        const assets = finiteNonNegative(existing.assets);
        const liabilities = finiteNonNegative(existing.liabilities);
        byMonth.set(existingMonth, {
          month: existingMonth,
          assets,
          liabilities,
          netWorth: assets - liabilities,
          ...(existing.capturedAt ? { capturedAt: existing.capturedAt } : {}),
        });
      }
    } catch {
      // Malformed historical rows are excluded rather than assigned a fake month.
    }
  }
  byMonth.set(month, normalized);
  return [...byMonth.values()].sort((left, right) => left.month.localeCompare(right.month));
}

export type EmergencyFundInput = {
  reserveBalance?: number;
  monthlyEssentialExpenses?: number;
  targetMonths?: number;
  monthlyContribution?: number;
  asOf?: Date;
};

export type EmergencyContributionPoint = {
  month: string;
  contribution: number;
  projectedBalance: number;
};

export const EMERGENCY_FUND_TIMELINE_MONTH_LIMIT = 120;

export function calculateEmergencyFundMetrics({
  reserveBalance,
  monthlyEssentialExpenses,
  targetMonths = 6,
  monthlyContribution = 0,
  asOf = new Date(0),
}: EmergencyFundInput) {
  const balance = finiteNonNegative(reserveBalance);
  const expenses = finiteNonNegative(monthlyEssentialExpenses);
  const monthsTarget = Math.max(0, Math.min(24, finiteNonNegative(targetMonths, 6)));
  const contribution = finiteNonNegative(monthlyContribution);
  const targetAmount = expenses * monthsTarget;
  const shortfall = Math.max(0, targetAmount - balance);
  const monthsCovered = expenses > 0 ? balance / expenses : null;
  const calculatedMonthsToTarget = shortfall === 0
    ? 0
    : contribution > 0
      ? Math.ceil(shortfall / contribution)
      : null;
  const monthsToTarget = calculatedMonthsToTarget === null
    ? null
    : Math.min(calculatedMonthsToTarget, Number.MAX_SAFE_INTEGER);
  const validAsOf = asOf instanceof Date && Number.isFinite(asOf.getTime()) ? asOf : new Date(0);
  const timeline: EmergencyContributionPoint[] = [];
  if (monthsToTarget !== null) {
    const timelineMonths = Math.min(monthsToTarget, EMERGENCY_FUND_TIMELINE_MONTH_LIMIT);
    for (let offset = 1; offset <= timelineMonths; offset += 1) {
      const date = new Date(validAsOf.getFullYear(), validAsOf.getMonth() + offset, 1);
      const priorBalance = balance + contribution * (offset - 1);
      const paid = Math.min(contribution, Math.max(0, targetAmount - priorBalance));
      timeline.push({
        month: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
        contribution: paid,
        projectedBalance: Math.min(targetAmount, priorBalance + paid),
      });
    }
  }
  return {
    reserveBalance: balance,
    monthlyEssentialExpenses: expenses,
    targetMonths: monthsTarget,
    monthsCovered: monthsCovered === null ? null : rounded(monthsCovered),
    targetAmount,
    shortfall,
    monthlyContribution: contribution,
    monthsToTarget,
    monthsToTargetCapped: calculatedMonthsToTarget === Number.POSITIVE_INFINITY
      || (calculatedMonthsToTarget !== null && calculatedMonthsToTarget > Number.MAX_SAFE_INTEGER),
    timelineTruncated: monthsToTarget !== null
      && monthsToTarget > EMERGENCY_FUND_TIMELINE_MONTH_LIMIT,
    timeline,
    dataAvailable: expenses > 0,
  };
}

export type FinancialHealthInput = {
  monthlyNetIncome?: number;
  monthlyEssentialExpenses?: number;
  monthlyDebtPayments?: number;
  monthlySavings?: number;
  emergencyReserve?: number;
  emergencyTargetMonths?: number;
  totalAssets?: number;
  totalLiabilities?: number;
};

export type FinancialHealthComponentKey =
  | "cashFlow"
  | "emergencyFund"
  | "debtLoad"
  | "savingsRate"
  | "netWorth";

export type FinancialHealthComponent = {
  key: FinancialHealthComponentKey;
  label: string;
  weight: number;
  score: number | null;
  weightedPoints: number;
  explanation: string;
};

export const FINANCIAL_HEALTH_WEIGHTS: Record<FinancialHealthComponentKey, number> = {
  cashFlow: 25,
  emergencyFund: 25,
  debtLoad: 20,
  savingsRate: 20,
  netWorth: 10,
};

const validAmount = (value: number | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/**
 * Missing inputs contribute zero weighted points (rather than manufacturing a
 * healthy value). Each unavailable component has a null score and the result
 * reports data coverage so a partial score cannot be mistaken for a full one.
 */
export function calculateFinancialHealthScore(input: FinancialHealthInput) {
  const incomeKnown = validAmount(input.monthlyNetIncome);
  const expensesKnown = validAmount(input.monthlyEssentialExpenses);
  const debtKnown = validAmount(input.monthlyDebtPayments);
  const savingsKnown = validAmount(input.monthlySavings);
  const reserveKnown = validAmount(input.emergencyReserve);
  const assetsKnown = validAmount(input.totalAssets);
  const liabilitiesKnown = validAmount(input.totalLiabilities);
  const income = finiteNonNegative(input.monthlyNetIncome);

  const definitions: Array<Omit<FinancialHealthComponent, "weightedPoints">> = [
    {
      key: "cashFlow",
      label: "Cash flow",
      weight: FINANCIAL_HEALTH_WEIGHTS.cashFlow,
      score: incomeKnown && expensesKnown
        ? (income > 0 ? clampPercent(((income - finiteNonNegative(input.monthlyEssentialExpenses)) / income) / 0.2 * 100) : 0)
        : null,
      explanation: "Full marks require essential expenses to leave at least 20% of net income.",
    },
    {
      key: "emergencyFund",
      label: "Emergency reserve",
      weight: FINANCIAL_HEALTH_WEIGHTS.emergencyFund,
      score: reserveKnown && expensesKnown && finiteNonNegative(input.monthlyEssentialExpenses) > 0
        ? clampPercent(
            (finiteNonNegative(input.emergencyReserve)
              / (finiteNonNegative(input.monthlyEssentialExpenses)
                * Math.max(1, finiteNonNegative(input.emergencyTargetMonths, 6)))) * 100,
          )
        : null,
      explanation: "Reserve balance is measured against the configured essential-expense target.",
    },
    {
      key: "debtLoad",
      label: "Debt load",
      weight: FINANCIAL_HEALTH_WEIGHTS.debtLoad,
      score: incomeKnown && debtKnown
        ? (income > 0
            ? clampPercent((0.5 - finiteNonNegative(input.monthlyDebtPayments) / income) / 0.3 * 100)
            : finiteNonNegative(input.monthlyDebtPayments) === 0 ? 100 : 0)
        : null,
      explanation: "Debt payments at or below 20% of income earn full marks; 50% or more earns zero.",
    },
    {
      key: "savingsRate",
      label: "Savings rate",
      weight: FINANCIAL_HEALTH_WEIGHTS.savingsRate,
      score: incomeKnown && savingsKnown
        ? (income > 0 ? clampPercent((finiteNonNegative(input.monthlySavings) / income) / 0.2 * 100) : 0)
        : null,
      explanation: "Full marks require saving at least 20% of net income.",
    },
    {
      key: "netWorth",
      label: "Net worth",
      weight: FINANCIAL_HEALTH_WEIGHTS.netWorth,
      score: assetsKnown && liabilitiesKnown
        ? (finiteNonNegative(input.totalAssets) > 0
            ? clampPercent((1 - finiteNonNegative(input.totalLiabilities) / finiteNonNegative(input.totalAssets)) * 100)
            : finiteNonNegative(input.totalLiabilities) === 0 ? 100 : 0)
        : null,
      explanation: "Measures the share of assets remaining after current liabilities.",
    },
  ];
  const components: FinancialHealthComponent[] = definitions.map((component) => ({
    ...component,
    score: component.score === null ? null : rounded(component.score),
    weightedPoints: component.score === null ? 0 : rounded(component.score * component.weight / 100),
  }));
  const availableWeight = components.reduce(
    (sum, component) => sum + (component.score === null ? 0 : component.weight),
    0,
  );
  const score = rounded(components.reduce((sum, component) => sum + component.weightedPoints, 0));
  const actions = components
    .filter((component) => component.score === null || component.score < 100)
    .sort((left, right) =>
      (right.score === null ? right.weight : right.weight * (100 - right.score) / 100)
      - (left.score === null ? left.weight : left.weight * (100 - left.score) / 100)
    )
    .map((component) => component.score === null
      ? `Add data for ${component.label.toLowerCase()} to complete your score.`
      : ({
          cashFlow: "Reduce essential spending or increase recurring net income.",
          emergencyFund: "Direct a monthly contribution to your emergency reserve.",
          debtLoad: "Reduce monthly debt payments, prioritizing costly debt.",
          savingsRate: "Increase monthly saving toward 20% of net income.",
          netWorth: "Reduce liabilities or build assets to improve net worth.",
        })[component.key]);

  return {
    score,
    components,
    availableWeight,
    missingWeight: 100 - availableWeight,
    isComplete: availableWeight === 100,
    status: availableWeight === 0 ? "insufficient-data" as const
      : availableWeight < 100 ? "partial" as const
      : "complete" as const,
    actions,
  };
}

export type LifestylePreset = RetirementLifestyle;

export const LIFESTYLE_PRESETS: Record<Exclude<LifestylePreset, "Custom">, {
  multiplier: number;
  description: string;
}> = {
  Basic: { multiplier: 0.75, description: "Essential retirement spending" },
  Comfortable: { multiplier: 1, description: "Maintain the current planned lifestyle" },
  Premium: { multiplier: 1.5, description: "More discretionary spending and travel" },
};

export function lifestyleMonthlyExpense(
  lifestyle: LifestylePreset,
  comfortableMonthlyExpense: number,
  customMonthlyExpense?: number,
) {
  if (lifestyle === "Custom") return finiteNonNegative(customMonthlyExpense);
  return finiteNonNegative(comfortableMonthlyExpense) * LIFESTYLE_PRESETS[lifestyle].multiplier;
}

export function lifestylePresetOptions(comfortableMonthlyExpense: number) {
  return (Object.keys(LIFESTYLE_PRESETS) as Array<Exclude<LifestylePreset, "Custom">>).map((value) => ({
    value,
    monthlyExpense: lifestyleMonthlyExpense(value, comfortableMonthlyExpense),
    ...LIFESTYLE_PRESETS[value],
  }));
}
