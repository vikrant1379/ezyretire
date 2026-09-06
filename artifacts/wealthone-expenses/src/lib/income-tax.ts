/**
 * Pure Indian individual income-tax calculation.
 *
 * Amounts are annual Indian rupees. The module deliberately has no knowledge
 * of UI models or persistence. Rules are selected by financial year so a
 * future Finance Act cannot silently change an earlier calculation.
 *
 * Scope: resident individuals, normal slab-rate income. Capital gains,
 * lottery/crypto income, agricultural-income rate integration, AMT and
 * deduction eligibility are intentionally outside this calculator.
 */

export type FinancialYear = "2024-25" | "2025-26" | "2026-27";
export type TaxRegime = "old" | "new";
export type TaxpayerCategory = "individual" | "senior" | "super-senior";

export type TaxSlab = Readonly<{
  upTo: number | null;
  rate: number;
}>;

export type IncomeTaxRule = Readonly<{
  financialYear: FinancialYear;
  regime: TaxRegime;
  slabs: readonly TaxSlab[];
  salaryStandardDeduction: number;
  rebate: Readonly<{
    taxableIncomeLimit: number;
    maximum: number;
    marginalRelief: boolean;
  }>;
  maximumSurchargeRate: number;
}>;

const oldSlabs = (zeroRateLimit: number): readonly TaxSlab[] => [
  { upTo: zeroRateLimit, rate: 0 },
  { upTo: 500_000, rate: 0.05 },
  { upTo: 1_000_000, rate: 0.2 },
  { upTo: null, rate: 0.3 },
];

const RULES: Readonly<Record<FinancialYear, Readonly<Record<TaxRegime, IncomeTaxRule>>>> = {
  "2024-25": {
    old: {
      financialYear: "2024-25",
      regime: "old",
      slabs: oldSlabs(250_000),
      salaryStandardDeduction: 50_000,
      rebate: { taxableIncomeLimit: 500_000, maximum: 12_500, marginalRelief: false },
      maximumSurchargeRate: 0.37,
    },
    new: {
      financialYear: "2024-25",
      regime: "new",
      slabs: [
        { upTo: 300_000, rate: 0 },
        { upTo: 700_000, rate: 0.05 },
        { upTo: 1_000_000, rate: 0.1 },
        { upTo: 1_200_000, rate: 0.15 },
        { upTo: 1_500_000, rate: 0.2 },
        { upTo: null, rate: 0.3 },
      ],
      salaryStandardDeduction: 75_000,
      rebate: { taxableIncomeLimit: 700_000, maximum: 25_000, marginalRelief: false },
      maximumSurchargeRate: 0.25,
    },
  },
  "2025-26": {
    old: {
      financialYear: "2025-26",
      regime: "old",
      slabs: oldSlabs(250_000),
      salaryStandardDeduction: 50_000,
      rebate: { taxableIncomeLimit: 500_000, maximum: 12_500, marginalRelief: false },
      maximumSurchargeRate: 0.37,
    },
    new: {
      financialYear: "2025-26",
      regime: "new",
      slabs: [
        { upTo: 400_000, rate: 0 },
        { upTo: 800_000, rate: 0.05 },
        { upTo: 1_200_000, rate: 0.1 },
        { upTo: 1_600_000, rate: 0.15 },
        { upTo: 2_000_000, rate: 0.2 },
        { upTo: 2_400_000, rate: 0.25 },
        { upTo: null, rate: 0.3 },
      ],
      salaryStandardDeduction: 75_000,
      rebate: { taxableIncomeLimit: 1_200_000, maximum: 60_000, marginalRelief: true },
      maximumSurchargeRate: 0.25,
    },
  },
  "2026-27": {
    old: {
      financialYear: "2026-27",
      regime: "old",
      slabs: oldSlabs(250_000),
      salaryStandardDeduction: 50_000,
      rebate: { taxableIncomeLimit: 500_000, maximum: 12_500, marginalRelief: false },
      maximumSurchargeRate: 0.37,
    },
    new: {
      financialYear: "2026-27",
      regime: "new",
      slabs: [
        { upTo: 400_000, rate: 0 },
        { upTo: 800_000, rate: 0.05 },
        { upTo: 1_200_000, rate: 0.1 },
        { upTo: 1_600_000, rate: 0.15 },
        { upTo: 2_000_000, rate: 0.2 },
        { upTo: 2_400_000, rate: 0.25 },
        { upTo: null, rate: 0.3 },
      ],
      salaryStandardDeduction: 75_000,
      rebate: { taxableIncomeLimit: 1_200_000, maximum: 60_000, marginalRelief: true },
      maximumSurchargeRate: 0.25,
    },
  },
};

export const INDIAN_INCOME_TAX_RULES = RULES;

export type OrdinaryIncome = Readonly<{
  salary?: number;
  houseProperty?: number;
  businessOrProfession?: number;
  otherSources?: number;
}>;

export type IncomeTaxInput = Readonly<{
  financialYear: FinancialYear;
  regime: TaxRegime;
  income: OrdinaryIncome;
  /**
   * Eligible deductions already determined by the caller. Chapter VI-A
   * deductions are used only in the old regime.
   */
  chapterVIADeductions?: number;
  taxpayerCategory?: TaxpayerCategory;
}>;

export type IncomeTaxResult = Readonly<{
  ruleVersion: string;
  financialYear: FinancialYear;
  regime: TaxRegime;
  grossIncome: number;
  salaryStandardDeduction: number;
  chapterVIADeductions: number;
  taxableIncome: number;
  slabTax: number;
  rebate: number;
  rebateMarginalRelief: number;
  taxAfterRebate: number;
  surchargeRate: number;
  surchargeBeforeRelief: number;
  surchargeMarginalRelief: number;
  surcharge: number;
  cess: number;
  taxBeforeRounding: number;
  totalTax: number;
  slabBreakdown: readonly TaxSlabLine[];
  assumptions: readonly string[];
  warnings: readonly string[];
}>;

export type TaxSlabLine = Readonly<{
  from: number;
  to: number | null;
  rate: number;
  taxableAmount: number;
  tax: number;
}>;

function finiteNonNegative(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function parseCalendarDate(value: Date | string): { year: number; month: number; day: number } {
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new RangeError("Date must use YYYY-MM-DD format");
    const [, yearText, monthText, dayText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (
      candidate.getUTCFullYear() !== year
      || candidate.getUTCMonth() + 1 !== month
      || candidate.getUTCDate() !== day
    ) throw new RangeError("Date is not a valid calendar date");
    return { year, month, day };
  }
  if (!Number.isFinite(value.getTime())) throw new RangeError("Date is invalid");
  return { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() };
}

/** Returns the Indian FY containing the date, without timezone-shifting date-only strings. */
export function financialYearForDate(value: Date | string): string {
  const { year, month } = parseCalendarDate(value);
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export function getIncomeTaxRule(
  financialYear: FinancialYear,
  regime: TaxRegime,
  category: TaxpayerCategory = "individual",
): IncomeTaxRule {
  const rule = RULES[financialYear]?.[regime];
  if (!rule) throw new RangeError(`Unsupported Indian income-tax rules: FY ${financialYear}, ${regime} regime`);
  if (regime === "new" || category === "individual") return rule;
  const exemption = category === "senior" ? 300_000 : 500_000;
  return { ...rule, slabs: oldSlabs(exemption) };
}

/** Progressive slab tax, before rebate, surcharge and cess. */
export function calculateSlabBreakdown(
  taxableIncome: number,
  slabs: readonly TaxSlab[],
): readonly TaxSlabLine[] {
  const income = finiteNonNegative(taxableIncome);
  let lower = 0;
  const lines: TaxSlabLine[] = [];
  for (const slab of slabs) {
    const upper = slab.upTo ?? income;
    const amountInSlab = Math.max(0, Math.min(income, upper) - lower);
    lines.push({
      from: lower,
      to: slab.upTo,
      rate: slab.rate,
      taxableAmount: amountInSlab,
      tax: amountInSlab * slab.rate,
    });
    if (income <= upper || slab.upTo === null) break;
    lower = upper;
  }
  return lines;
}

export function calculateSlabTax(taxableIncome: number, slabs: readonly TaxSlab[]): number {
  return calculateSlabBreakdown(taxableIncome, slabs)
    .reduce((total, line) => total + line.tax, 0);
}

function taxAfterRebate(
  taxableIncome: number,
  rule: IncomeTaxRule,
): { slabTax: number; rebate: number; marginalRelief: number; net: number } {
  const slabTax = calculateSlabTax(taxableIncome, rule.slabs);
  if (taxableIncome <= rule.rebate.taxableIncomeLimit) {
    const rebate = Math.min(slabTax, rule.rebate.maximum);
    return { slabTax, rebate, marginalRelief: 0, net: slabTax - rebate };
  }
  if (rule.rebate.marginalRelief) {
    const excessIncome = taxableIncome - rule.rebate.taxableIncomeLimit;
    const marginalRelief = Math.max(0, slabTax - excessIncome);
    return { slabTax, rebate: 0, marginalRelief, net: slabTax - marginalRelief };
  }
  return { slabTax, rebate: 0, marginalRelief: 0, net: slabTax };
}

function surchargeRate(income: number, maximum: number): number {
  if (income > 50_000_000) return Math.min(0.37, maximum);
  if (income > 20_000_000) return Math.min(0.25, maximum);
  if (income > 10_000_000) return Math.min(0.15, maximum);
  if (income > 5_000_000) return Math.min(0.1, maximum);
  return 0;
}

function previousSurchargeThreshold(income: number): number | null {
  if (income > 50_000_000) return 50_000_000;
  if (income > 20_000_000) return 20_000_000;
  if (income > 10_000_000) return 10_000_000;
  if (income > 5_000_000) return 5_000_000;
  return null;
}

function taxAndSurchargeAt(income: number, rule: IncomeTaxRule): number {
  const base = taxAfterRebate(income, rule).net;
  return base * (1 + surchargeRate(income, rule.maximumSurchargeRate));
}

/** Section 288B-style rounding to the nearest multiple of ten rupees. */
export function roundTaxPayable(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round((amount + Number.EPSILON) / 10) * 10;
}

export function calculateIncomeTax(input: IncomeTaxInput): IncomeTaxResult {
  const rule = getIncomeTaxRule(
    input.financialYear,
    input.regime,
    input.taxpayerCategory,
  );
  const salary = finiteNonNegative(input.income.salary);
  const grossIncome = salary
    + finiteNonNegative(input.income.houseProperty)
    + finiteNonNegative(input.income.businessOrProfession)
    + finiteNonNegative(input.income.otherSources);
  const salaryStandardDeduction = Math.min(salary, rule.salaryStandardDeduction);
  const chapterVIADeductions = input.regime === "old"
    ? finiteNonNegative(input.chapterVIADeductions)
    : 0;
  const taxableIncome = Math.max(
    0,
    grossIncome - salaryStandardDeduction - chapterVIADeductions,
  );
  const rebateResult = taxAfterRebate(taxableIncome, rule);
  const rate = surchargeRate(taxableIncome, rule.maximumSurchargeRate);
  const surchargeBeforeRelief = rebateResult.net * rate;
  const threshold = previousSurchargeThreshold(taxableIncome);
  const maximumTaxAndSurcharge = threshold === null
    ? Number.POSITIVE_INFINITY
    : taxAndSurchargeAt(threshold, rule) + taxableIncome - threshold;
  const surcharge = Math.max(
    0,
    Math.min(surchargeBeforeRelief, maximumTaxAndSurcharge - rebateResult.net),
  );
  const surchargeMarginalRelief = surchargeBeforeRelief - surcharge;
  const cess = (rebateResult.net + surcharge) * 0.04;
  const taxBeforeRounding = rebateResult.net + surcharge + cess;
  const warnings = [
    ...(finiteNonNegative(input.income.houseProperty) > 0
      ? ["Rental income is treated as ordinary income; municipal taxes, the 30% house-property deduction and home-loan interest are not inferred."]
      : []),
    ...(finiteNonNegative(input.income.businessOrProfession) > 0
      ? ["Business and professional receipts are treated as taxable income because recorded expenses are not linked to them."]
      : []),
  ];

  return {
    ruleVersion: `india-income-tax/FY-${input.financialYear}`,
    financialYear: input.financialYear,
    regime: input.regime,
    grossIncome,
    salaryStandardDeduction,
    chapterVIADeductions,
    taxableIncome,
    slabTax: rebateResult.slabTax,
    rebate: rebateResult.rebate,
    rebateMarginalRelief: rebateResult.marginalRelief,
    taxAfterRebate: rebateResult.net,
    surchargeRate: rate,
    surchargeBeforeRelief,
    surchargeMarginalRelief,
    surcharge,
    cess,
    taxBeforeRounding,
    totalTax: roundTaxPayable(taxBeforeRounding),
    slabBreakdown: calculateSlabBreakdown(taxableIncome, rule.slabs),
    assumptions: [
      "Resident individual with ordinary slab-rate income.",
      "Only deductions represented by the supplied data are applied.",
      "Tax is rounded to the nearest ₹10 after surcharge and 4% cess.",
    ],
    warnings,
  };
}