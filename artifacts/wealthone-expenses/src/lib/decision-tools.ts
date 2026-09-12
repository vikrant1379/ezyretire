/**
 * Pure, editable planning calculations. Currency values are unit-agnostic
 * (the application uses INR); annual rates are percentages, not decimals.
 */

export type AssumptionSet = {
  version: string;
  sourceDate: string;
  staleAfterMonths: number;
  sources: readonly string[];
};

export const DECISION_TOOL_ASSUMPTIONS = {
  insurance: {
    version: "insurance-planning/2025-01",
    sourceDate: "2025-01-01",
    staleAfterMonths: 12,
    sources: ["IRDAI consumer guidance; insurer quotes remain the source of actual premiums"],
  },
  housing: {
    version: "housing-planning/2025-01",
    sourceDate: "2025-01-01",
    staleAfterMonths: 12,
    sources: ["Editable planning assumptions; local prices, rents and charges must be verified"],
  },
  marketReturns: {
    version: "market-return-scenarios/2025-01",
    sourceDate: "2025-01-01",
    staleAfterMonths: 6,
    sources: ["Scenario range only; past market returns do not guarantee future returns"],
  },
  tax: {
    version: "india-tax/FY-2025-26",
    sourceDate: "2025-02-01",
    staleAfterMonths: 12,
    sources: ["Finance Act rules must be checked for the applicable financial year"],
  },
} as const satisfies Record<string, AssumptionSet>;

/** Calculator defaults are separate from provenance so every value remains editable. */
export const DEFAULT_DECISION_ASSUMPTIONS = {
  version: "decision-tools/2025-01",
  sourceDate: "2025-01-01",
  staleAfterMonths: 12,
  life: {
    incomeReplacementYears: 15,
    inflationRate: 6,
    investmentReturnRate: 7,
    premiumRatePerThousand: 1.5,
  },
  health: {
    metroBenchmark: 1_500_000,
    ageLoadingRate: 3,
    premiumRate: 1.2,
  },
  housing: {
    propertyAppreciationRate: 5,
    rentEscalationRate: 5,
    buyingCostsRate: 7,
    annualOwnershipCostRate: 1,
  },
  market: {
    expectedReturnRate: 9,
    returnUncertainty: 3,
    investmentTaxRate: 15,
  },
} as const;

export type AssumptionArea = keyof typeof DECISION_TOOL_ASSUMPTIONS;

function validDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export function isAssumptionStale(
  assumption: Pick<AssumptionSet, "sourceDate" | "staleAfterMonths">,
  asOf: string | Date = new Date(),
) {
  const source = validDate(assumption.sourceDate);
  const current = validDate(asOf);
  if (!source || !current) return true;
  const expiry = new Date(source);
  expiry.setUTCMonth(expiry.getUTCMonth() + Math.max(0, Math.floor(assumption.staleAfterMonths)));
  return current >= expiry;
}

export function staleAssumptionWarnings(
  asOf: string | Date = new Date(),
  assumptions: Record<string, AssumptionSet> = DECISION_TOOL_ASSUMPTIONS,
) {
  return Object.entries(assumptions)
    .filter(([, assumption]) => isAssumptionStale(assumption, asOf))
    .map(([area, assumption]) =>
      `${area} assumptions (${assumption.version}) are stale; verify values sourced ${assumption.sourceDate}.`);
}

export function assumptionsAreStale(
  assumption: { sourceDate?: string; staleAfterMonths?: number } = DEFAULT_DECISION_ASSUMPTIONS,
  asOf: string | Date = new Date(),
) {
  return isAssumptionStale({
    sourceDate: assumption.sourceDate ?? "",
    staleAfterMonths: assumption.staleAfterMonths ?? 12,
  }, asOf);
}

const n = (value: number, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, n(value, minimum)));
const money = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
const rate = (value: number, maximum = 100) => clamp(value, -99, maximum) / 100;
const MAX_MONEY = 1e15;
const safeMoney = (value: number) => clamp(value, 0, MAX_MONEY);

export const NO_GUARANTEE_WARNING =
  "Returns and premiums are estimates, not guaranteed quotes or financial advice.";

export type LifeCoverInput = {
  annualIncomeReplacement: number;
  replacementYears: number;
  annualIncomeGrowthRate: number;
  annualDiscountRate: number;
  liabilities?: number;
  plannedObligations?: number;
  existingCover?: number;
  earmarkedAssets?: number;
  age?: number;
  premiumRatePerThousandLow?: number;
  premiumRatePerThousandHigh?: number;
};

export function calculateLifeCover(input: LifeCoverInput) {
  const annualIncome = safeMoney(input.annualIncomeReplacement);
  const years = Math.floor(clamp(input.replacementYears, 0, 100));
  const growth = rate(input.annualIncomeGrowthRate, 50);
  const discount = rate(input.annualDiscountRate, 100);
  const ratio = (1 + growth) / (1 + discount);
  const incomeReplacement = years === 0 ? 0
    : Math.abs(discount - growth) < 1e-10
      ? annualIncome * years / (1 + discount)
      : annualIncome * (1 - ratio ** years) / (discount - growth);
  const liabilities = safeMoney(input.liabilities ?? 0);
  const plannedObligations = safeMoney(input.plannedObligations ?? 0);
  const existingCover = safeMoney(input.existingCover ?? 0);
  const earmarkedAssets = safeMoney(input.earmarkedAssets ?? 0);
  const humanLifeValue = money(incomeReplacement + liabilities + plannedObligations);
  const existingProtection = money(existingCover + earmarkedAssets);
  const coverGap = money(humanLifeValue - existingProtection);
  const age = Math.floor(clamp(input.age ?? 35, 18, 80));
  const defaultLow = age < 40 ? 0.8 : age < 50 ? 1.4 : 2.5;
  const defaultHigh = age < 40 ? 1.8 : age < 50 ? 3.2 : 5.5;
  const lowRate = clamp(input.premiumRatePerThousandLow ?? defaultLow, 0, 1_000);
  const highRate = Math.max(lowRate, clamp(input.premiumRatePerThousandHigh ?? defaultHigh, 0, 1_000));
  const warnings: string[] = [NO_GUARANTEE_WARNING];
  if (n(input.replacementYears) !== years || Object.values(input).some(value => typeof value === "number" && !Number.isFinite(value))) {
    warnings.push("One or more unsafe inputs were clamped.");
  }
  return {
    incomeReplacement: money(incomeReplacement),
    liabilities,
    plannedObligations,
    humanLifeValue,
    existingCover,
    earmarkedAssets,
    existingProtection,
    coverGap,
    estimatedAnnualPremiumRange: {
      low: coverGap / 1_000 * lowRate,
      high: coverGap / 1_000 * highRate,
      confirmed: false as const,
    },
    warnings,
  };
}

/** Compatibility name used by calculator consumers with form-shaped fields. */
export function analyzeLifeCover(input: Record<string, number>) {
  return calculateLifeCover({
    annualIncomeReplacement: input.annualIncomeReplacement ?? input.annualIncome ?? 0,
    replacementYears: input.replacementYears ?? input.incomeReplacementYears ?? 0,
    annualIncomeGrowthRate: input.annualIncomeGrowthRate ?? input.inflationRate ?? 0,
    annualDiscountRate: input.annualDiscountRate ?? input.investmentReturnRate ?? 0,
    liabilities: input.liabilities,
    plannedObligations: input.plannedObligations ?? input.plannedExpenses,
    existingCover: input.existingCover ?? input.existingLifeCover,
    earmarkedAssets: input.earmarkedAssets ?? input.liquidAssets ?? input.assets,
    age: input.age,
    premiumRatePerThousandLow:
      input.premiumRatePerThousandLow ?? input.premiumRatePerThousand,
    premiumRatePerThousandHigh:
      input.premiumRatePerThousandHigh ?? input.premiumRatePerThousand,
  });
}

export type CityTier = "tier-1" | "tier-2" | "tier-3";
export type HealthCoverInput = {
  cityTier: CityTier;
  age: number;
  adults: number;
  children: number;
  employerCover?: number;
  existingFloaterCover?: number;
  existingTopUpCover?: number;
  benchmarkByCity?: Partial<Record<CityTier, number>>;
  ageLoadingRate?: number;
  topUpMultiple?: number;
  estimatedPremiumRateLow?: number;
  estimatedPremiumRateHigh?: number;
};

export function recommendHealthCover(input: HealthCoverInput) {
  const defaults: Record<CityTier, number> = {
    "tier-1": 1_500_000, "tier-2": 1_000_000, "tier-3": 750_000,
  };
  const tier: CityTier = input.cityTier in defaults ? input.cityTier : "tier-2";
  const benchmark = safeMoney(input.benchmarkByCity?.[tier] ?? defaults[tier]);
  const age = Math.floor(clamp(input.age, 0, 100));
  const adults = Math.floor(clamp(input.adults, 1, 10));
  const children = Math.floor(clamp(input.children, 0, 10));
  const ageLoadingRate = clamp(input.ageLoadingRate ?? 3, 0, 20) / 100;
  const ageFactor = 1 + Math.max(0, age - 35) * ageLoadingRate;
  const familyFactor = 1 + Math.max(0, adults - 1) * 0.5 + children * 0.25;
  const recommendedBase = benchmark * ageFactor * familyFactor;
  const recommendedTotal = recommendedBase * clamp(input.topUpMultiple ?? 2, 1, 10);
  const employerCover = safeMoney(input.employerCover ?? 0);
  const existingFloaterCover = safeMoney(input.existingFloaterCover ?? 0);
  const existingTopUpCover = safeMoney(input.existingTopUpCover ?? 0);
  const confirmedBaseCover = employerCover + existingFloaterCover;
  const baseGap = money(recommendedBase - confirmedBaseCover);
  const topUpGap = money(recommendedTotal - confirmedBaseCover - existingTopUpCover - baseGap);
  const lowRate = clamp(input.estimatedPremiumRateLow ?? 0.008, 0, 1);
  const highRate = Math.max(lowRate, clamp(input.estimatedPremiumRateHigh ?? 0.025, 0, 1));
  return {
    benchmark,
    ageLoadingRate,
    ageFactor,
    familyFactor,
    recommendedBase,
    recommendedTopUp: money(recommendedTotal - recommendedBase),
    recommendedTotal,
    employerCover,
    existingFloaterCover,
    existingTopUpCover,
    baseGap,
    topUpGap,
    estimatedAnnualPremiumRange: {
      low: (baseGap + topUpGap) * lowRate,
      high: (baseGap + topUpGap) * highRate,
      confirmed: false as const,
    },
    warnings: [
      "Premium estimate is unconfirmed and must not be added to expenses until a quote is confirmed.",
      NO_GUARANTEE_WARNING,
    ],
  };
}

export function analyzeHealthCover(input: Record<string, unknown>) {
  const value = (key: string) => n(Number(input[key]));
  return recommendHealthCover({
    cityTier: input.cityTier === "tier-1" || input.cityTier === "tier-3" ? input.cityTier : "tier-2",
    age: value("age") || value("eldestAge"),
    adults: value("adults") || value("familyAdults"),
    children: value("children") || value("familyChildren"),
    employerCover: value("employerCover") || value("existingEmployerCover"),
    existingFloaterCover: value("existingFloaterCover") || value("floaterCover"),
    existingTopUpCover: value("existingTopUpCover") || value("topUpCover"),
    benchmarkByCity: input.benchmarkByCity as Partial<Record<CityTier, number>> | undefined,
    ageLoadingRate: value("ageLoadingRate"),
    topUpMultiple: value("topUpMultiple") || undefined,
    estimatedPremiumRateLow: value("estimatedPremiumRateLow") || undefined,
    estimatedPremiumRateHigh: value("estimatedPremiumRateHigh") || undefined,
  });
}

function monthlyRate(annualPercent: number) {
  return (1 + rate(annualPercent, 1_000)) ** (1 / 12) - 1;
}

function emi(principal: number, annualRate: number, months: number) {
  if (months <= 0 || principal <= 0) return 0;
  const r = Math.max(0, rate(annualRate, 1_000) / 12);
  return r === 0 ? principal / months : principal * r * (1 + r) ** months / ((1 + r) ** months - 1);
}

export type RentVsBuyInput = {
  propertyPrice: number;
  downPayment: number;
  loanAnnualRate: number;
  loanTenureMonths: number;
  monthlyRent: number;
  rentalDeposit?: number;
  annualRentEscalationRate?: number;
  annualAppreciationRate?: number;
  annualOpportunityReturnRate?: number;
  monthlyOwnershipCosts?: number;
  annualOwnershipCostRate?: number;
  purchaseCostRate?: number;
  saleCostRate?: number;
  horizonMonths: number;
};

export function simulateRentVsBuy(input: RentVsBuyInput) {
  const price = safeMoney(input.propertyPrice);
  const downPayment = Math.min(price, safeMoney(input.downPayment));
  const loanPrincipal = price - downPayment;
  const tenure = Math.floor(clamp(input.loanTenureMonths, 1, 1_200));
  const horizon = Math.floor(clamp(input.horizonMonths, 0, 1_200));
  const loanRate = Math.max(0, rate(input.loanAnnualRate, 1_000) / 12);
  const payment = emi(loanPrincipal, input.loanAnnualRate, tenure);
  const rentGrowth = monthlyRate(input.annualRentEscalationRate ?? 5);
  const appreciation = monthlyRate(input.annualAppreciationRate ?? 5);
  const investmentReturn = monthlyRate(input.annualOpportunityReturnRate ?? 8);
  const fixedOwnership = safeMoney(input.monthlyOwnershipCosts ?? 0);
  const ownershipRate = clamp(input.annualOwnershipCostRate ?? 1, 0, 100) / 1_200;
  const purchaseCosts = price * clamp(input.purchaseCostRate ?? 7, 0, 100) / 100;
  const saleRate = clamp(input.saleCostRate ?? 2, 0, 100) / 100;
  const requestedDeposit = safeMoney(input.rentalDeposit ?? 0);
  // Keep both strategies on the same initial cash budget. A renter cannot
  // allocate more to the refundable deposit than the buyer allocates upfront.
  const deposit = Math.min(requestedDeposit, downPayment + purchaseCosts);
  let loanBalance = loanPrincipal;
  let propertyValue = price;
  let rent = safeMoney(input.monthlyRent);
  let renterPortfolio = money(downPayment + purchaseCosts - deposit);
  let buyerPortfolio = 0;
  let cumulativeRent = 0;
  let cumulativeOwnershipCost = purchaseCosts;
  const timeline: Array<{
    month: number; rent: number; ownerOutflow: number; propertyValue: number;
    loanBalance: number; renterInvestmentBalance: number; buyerHomeEquity: number;
    renterNetWorth: number; buyerNetWorth: number;
  }> = [];

  for (let month = 1; month <= horizon; month += 1) {
    renterPortfolio *= 1 + investmentReturn;
    buyerPortfolio *= 1 + investmentReturn;
    propertyValue *= 1 + appreciation;
    const interest = loanBalance * loanRate;
    const principalPaid = month <= tenure ? Math.min(loanBalance, Math.max(0, payment - interest)) : 0;
    loanBalance = money(loanBalance - principalPaid);
    const loanPayment = month <= tenure ? Math.min(payment, interest + principalPaid) : 0;
    const ownerOutflow = loanPayment + fixedOwnership + propertyValue * ownershipRate;
    if (ownerOutflow > rent) renterPortfolio += ownerOutflow - rent;
    else buyerPortfolio += rent - ownerOutflow;
    cumulativeRent += rent;
    cumulativeOwnershipCost += ownerOutflow;
    const renterNetWorth = renterPortfolio + deposit;
    const buyerHomeEquity = propertyValue * (1 - saleRate) - loanBalance;
    const buyerNetWorth = buyerHomeEquity + buyerPortfolio;
    timeline.push({ month, rent, ownerOutflow, propertyValue, loanBalance, renterInvestmentBalance: renterPortfolio, buyerHomeEquity, renterNetWorth, buyerNetWorth });
    rent *= 1 + rentGrowth;
  }
  const last = timeline.at(-1);
  // A transient crossing is not a useful break-even: identify the first month
  // after which buying remains ahead for every remaining month in the horizon.
  let breakEvenMonth: number | null = null;
  let buyerStaysAhead = true;
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    buyerStaysAhead = buyerStaysAhead && timeline[index].buyerNetWorth >= timeline[index].renterNetWorth;
    if (buyerStaysAhead) breakEvenMonth = timeline[index].month;
  }
  return {
    downPayment,
    loanPrincipal,
    monthlyLoanPayment: payment,
    rentalDeposit: deposit,
    purchaseCosts,
    cumulativeRent,
    cumulativeOwnershipCost,
    renterInvestmentBalance: last?.renterInvestmentBalance ?? renterPortfolio,
    buyerHomeEquity: last?.buyerHomeEquity ?? price * (1 - saleRate) - loanBalance,
    renterNetWorth: last?.renterNetWorth ?? renterPortfolio + deposit,
    buyerNetWorth: last?.buyerNetWorth ?? price * (1 - saleRate) - loanBalance,
    breakEvenMonth,
    timeline,
    warnings: [NO_GUARANTEE_WARNING],
  };
}

export function compareRentVsBuy(input: RentVsBuyInput & Record<string, number>) {
  return simulateRentVsBuy({
    ...input,
    propertyPrice: input.propertyPrice ?? input.homePrice,
    loanAnnualRate: input.loanAnnualRate ?? input.mortgageRate,
    loanTenureMonths: input.loanTenureMonths ?? input.mortgageYears * 12,
    annualAppreciationRate: input.annualAppreciationRate ?? input.propertyAppreciationRate,
    purchaseCostRate: input.purchaseCostRate ?? input.transactionCostRate,
    annualOwnershipCostRate: input.annualOwnershipCostRate ?? input.maintenanceRate,
  });
}

export type RepaymentType = "emi" | "bullet" | "interest-only-plus-bullet";
export type PrepayVsInvestInput = {
  principal: number;
  annualLoanRate: number;
  remainingMonths: number;
  repaymentType: RepaymentType;
  emi?: number;
  initialExtraPayment?: number;
  monthlyExtraPayment?: number;
  horizonMonths?: number;
  annualInvestmentReturn: number;
  annualReturnRiskRange?: { low: number; high: number };
  investmentTaxRate?: number;
};

type LoanPath = { balance: number; interestPaid: number; payoffMonth: number | null };
type CashBudgetResult = { loan: LoanPath; portfolio: number; cashBudgetUsed: number };

/**
 * Simulates a strategy against the baseline loan's contractual cash budget.
 * Bullet interest is simple accrued interest, due with principal at maturity;
 * it is intentionally not capitalised into principal.
 */
function simulateCashBudget(
  principal: number, annualRatePercent: number, term: number, horizon: number,
  type: RepaymentType, contractualEmi: number, initialExtra: number,
  monthlyExtra: number, annualInvestmentReturn: number, taxRate: number,
  isPrepay: boolean,
) {
  const loanRate = Math.max(0, rate(annualRatePercent, 1_000) / 12);
  const investmentRate = monthlyRate(annualInvestmentReturn) * (1 - taxRate);
  let baselineBalance = principal;
  let balance = money(principal - (isPrepay ? initialExtra : 0));
  let baselineAccrued = 0;
  let accrued = 0;
  let portfolio = isPrepay ? 0 : initialExtra;
  let interestPaid = 0;
  let payoffMonth: number | null = balance === 0 && type !== "bullet" ? 0 : null;
  let cashBudgetUsed = initialExtra;

  for (let month = 1; month <= horizon; month += 1) {
    portfolio *= 1 + investmentRate;
    if (month > term) continue;
    let baselineDue = 0;
    if (type === "emi") {
      const interest = baselineBalance * loanRate;
      const due = Math.min(contractualEmi, baselineBalance + interest);
      baselineBalance = money(baselineBalance + interest - due);
      baselineDue = due;
      if (month === term && baselineBalance > 0) {
        baselineDue += baselineBalance;
        baselineBalance = 0;
      }
    } else if (type === "interest-only-plus-bullet") {
      baselineDue = baselineBalance * loanRate + (month === term ? baselineBalance : 0);
      if (month === term) baselineBalance = 0;
    } else {
      baselineAccrued += baselineBalance * loanRate;
      baselineDue = month === term ? baselineBalance + baselineAccrued : 0;
      if (month === term) baselineBalance = 0;
    }
    const budget = baselineDue + monthlyExtra;
    let paidToLoan = 0;
    if (balance > 0) {
      if (type === "emi") {
        const interest = balance * loanRate;
        interestPaid += interest;
        const due = Math.min(contractualEmi, balance + interest);
        balance = money(balance + interest - due);
        paidToLoan += due;
      } else if (type === "interest-only-plus-bullet") {
        const interest = balance * loanRate;
        interestPaid += interest;
        paidToLoan += interest;
      } else {
        const interest = balance * loanRate;
        accrued += interest;
        interestPaid += interest;
      }
      const extraToPrincipal = isPrepay
        ? Math.min(balance, Math.max(0, budget - paidToLoan))
        : 0;
      balance -= extraToPrincipal;
      paidToLoan += extraToPrincipal;
      if (month === term) {
        if (balance > 0) {
          paidToLoan += balance;
          balance = 0;
        }
      }
      if (balance === 0 && type !== "bullet" && payoffMonth === null) payoffMonth = month;
    }
    if (month === term && type === "bullet" && accrued > 0) {
      paidToLoan += accrued;
      accrued = 0;
    }
    if (month === term && balance === 0 && payoffMonth === null) {
      payoffMonth = month;
    }
    // Freed EMI/interest/maturity cash is invested immediately under prepay.
    const investable = isPrepay ? money(budget - paidToLoan) : monthlyExtra;
    portfolio += investable;
    cashBudgetUsed += isPrepay ? paidToLoan + investable : budget;
  }
  return { loan: { balance, interestPaid, payoffMonth }, portfolio: money(portfolio), cashBudgetUsed } satisfies CashBudgetResult;
}

export function simulatePrepayVsInvest(input: PrepayVsInvestInput) {
  const principal = safeMoney(input.principal);
  const term = Math.floor(clamp(input.remainingMonths, 1, 1_200));
  const horizon = Math.floor(clamp(input.horizonMonths ?? term, term, 1_200));
  const type: RepaymentType = input.repaymentType === "bullet"
    || input.repaymentType === "interest-only-plus-bullet" ? input.repaymentType : "emi";
  const contractualEmi = type === "emi"
    ? safeMoney(input.emi ?? emi(principal, input.annualLoanRate, term))
    : 0;
  const initialExtra = Math.min(principal, safeMoney(input.initialExtraPayment ?? 0));
  const monthlyExtra = safeMoney(input.monthlyExtraPayment ?? 0);
  const taxRate = clamp(input.investmentTaxRate ?? 0, 0, 100) / 100;
  const low = input.annualReturnRiskRange?.low ?? input.annualInvestmentReturn - 3;
  const high = input.annualReturnRiskRange?.high ?? input.annualInvestmentReturn + 3;
  const run = (annualReturn: number) => {
    const baseline = simulateCashBudget(principal, input.annualLoanRate, term, horizon, type, contractualEmi, initialExtra, monthlyExtra, annualReturn, taxRate, false);
    const prepay = simulateCashBudget(principal, input.annualLoanRate, term, horizon, type, contractualEmi, initialExtra, monthlyExtra, annualReturn, taxRate, true);
    return { baseline, prepay, incremental: prepay.portfolio - baseline.portfolio };
  };
  const lowRun = run(Math.min(low, high));
  const expectedRun = run(input.annualInvestmentReturn);
  const highRun = run(Math.max(low, high));
  const baseline = expectedRun.baseline.loan;
  const prepay = expectedRun.prepay.loan;
  const interestSaved = money(baseline.interestPaid - prepay.interestPaid);
  const investmentValues = { low: lowRun.baseline.portfolio, expected: expectedRun.baseline.portfolio, high: highRun.baseline.portfolio };
  const terminalIncrementalPortfolioValues = { low: lowRun.incremental, expected: expectedRun.incremental, high: highRun.incremental };
  let lower = -99;
  let upper = 200;
  let lowerValue = run(lower).incremental;
  const upperValue = run(upper).incremental;
  let breakEvenReturnRate: number | null = null;
  if (lowerValue * upperValue <= 0) {
    for (let iteration = 0; iteration < 50; iteration += 1) {
      const middle = (lower + upper) / 2;
      const middleValue = run(middle).incremental;
      if (lowerValue * middleValue <= 0) upper = middle;
      else { lower = middle; lowerValue = middleValue; }
    }
    breakEvenReturnRate = (lower + upper) / 2;
  }
  return {
    repaymentType: type,
    horizonMonths: horizon,
    baseline,
    prepay,
    baselineCashBudgetUsed: expectedRun.baseline.cashBudgetUsed,
    prepayCashBudgetUsed: expectedRun.prepay.cashBudgetUsed,
    interestSaved,
    investmentValues,
    prepayPortfolioValues: { low: lowRun.prepay.portfolio, expected: expectedRun.prepay.portfolio, high: highRun.prepay.portfolio },
    terminalIncrementalPortfolioValues,
    prepayValueAtHorizon: expectedRun.prepay.portfolio,
    breakEvenReturnRate,
    breakEvenInvestmentReturn: breakEvenReturnRate,
    expectedAdvantage: terminalIncrementalPortfolioValues.expected,
    preferredOnExpectedAssumption: terminalIncrementalPortfolioValues.expected > 0 ? "prepay" as const : "invest" as const,
    warnings: [
      "Investment outcomes use an after-tax risk range and are not guaranteed returns.",
      "Loan terms, foreclosure charges and tax treatment should be verified with the lender and a tax professional.",
    ],
  };
}

export function comparePrepayVsInvest(input: PrepayVsInvestInput & Record<string, unknown>) {
  return simulatePrepayVsInvest({
    ...input,
    principal: input.principal ?? Number(input.outstandingPrincipal ?? input.loanPrincipal),
    annualLoanRate: input.annualLoanRate ?? Number(input.annualInterestRate),
    remainingMonths: input.remainingMonths ?? Number(input.tenureMonths),
    annualInvestmentReturn:
      input.annualInvestmentReturn ?? Number(input.investmentReturnRate ?? input.expectedReturnRate),
    initialExtraPayment:
      input.initialExtraPayment ?? Number(input.extraPrepayment ?? input.extraPayment),
  });
}