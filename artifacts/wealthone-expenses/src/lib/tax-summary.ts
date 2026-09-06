import {
  parseDateOnly,
  type IncomeSource,
  type Investment,
  type InvestmentDisposal,
} from "./storage.ts";
import {
  calculateIncomeTax,
  getIncomeTaxRule,
  roundTaxPayable,
  type FinancialYear as TaxFinancialYear,
  type TaxRegime,
} from "./income-tax.ts";
export type { FinancialYear as TaxFinancialYear, TaxRegime } from "./income-tax.ts";

export type TaxSummary = {
  grossIncome: number;
  salaryIncome: number;
  otherIncome: number;
  standardDeduction: number;
  investmentDeduction: number;
  taxableIncome: number;
  slabTax: number;
  rebate: number;
  surcharge: number;
  cess: number;
  totalTax: number;
  tdsWithheld: number;
  automaticTdsEstimate: number;
  balanceTax: number;
  recordedCapitalGains: number;
  shortTermCapitalGains: number;
  longTermCapitalGains: number;
  taxableCapitalGains: number;
  capitalGainsTax: number;
  slabBreakdown: ReturnType<typeof calculateIncomeTax>["slabBreakdown"];
  assumptions: readonly string[];
  warnings: readonly string[];
  sourceTreatments: readonly {
    id: string;
    name: string;
    type: IncomeSource["type"];
    amount: number;
    status: "included" | "excluded";
    treatment: string;
  }[];
  disposalTreatments: readonly CapitalGainTreatment[];
};

export type CapitalGainTreatment = {
  id: string;
  name: string;
  investmentId: string;
  status: "included" | "excluded";
  gain: number;
  holdingPeriod: "short-term" | "long-term" | "not-applicable";
  rate: number | "slab" | null;
  treatment: string;
};

type TaxableDisposal = CapitalGainTreatment & {
  taxableGain: number;
  bucket: "short" | "long";
  specialRate: number | null;
  equity112A: boolean;
  transferDate: Date;
};

const canonicalAssetType = (value: string) => {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const aliases: Record<string, string> = {
    "listed equity": "Listed Equity",
    "direct equity": "Listed Equity",
    "equity mutual fund": "Equity Mutual Fund",
    "equity oriented mutual fund": "Equity Mutual Fund",
    "unlisted equity": "Unlisted Equity",
    "real estate": "Real Estate",
    gold: "Gold",
    "debt mutual fund": "Debt Mutual Fund",
    "listed bonds": "Listed Bonds",
    crypto: "Crypto",
    cryptocurrency: "Crypto",
  };
  return aliases[normalized];
};

const completeDisposal = (
  disposal: InvestmentDisposal,
): disposal is InvestmentDisposal & Required<Pick<InvestmentDisposal, "purchaseDate" | "saleDate" | "costBasis" | "proceeds" | "assetType">> =>
  Boolean(
    disposal.purchaseDate
    && disposal.saleDate
    && Number.isFinite(disposal.costBasis)
    && Number.isFinite(disposal.proceeds)
    && disposal.costBasis! >= 0
    && disposal.proceeds! >= 0
    && disposal.assetType,
  );

function heldMoreThanMonths(purchase: Date, sale: Date, months: number) {
  const boundary = new Date(
    purchase.getFullYear(),
    purchase.getMonth() + months,
    purchase.getDate(),
  );
  return sale > boundary;
}

function disposalRate(
  assetType: string,
  purchase: Date,
  sale: Date,
): { bucket: "short" | "long"; rate: number | null; equity112A: boolean; warning?: string } {
  const afterRateChange = sale >= new Date(2024, 6, 23);
  if (assetType === "Crypto") {
    return { bucket: "short", rate: 0.3, equity112A: false };
  }
  if (assetType === "Listed Equity" || assetType === "Equity Mutual Fund") {
    const long = heldMoreThanMonths(purchase, sale, 12);
    return {
      bucket: long ? "long" : "short",
      rate: long ? (afterRateChange ? 0.125 : 0.1) : (afterRateChange ? 0.2 : 0.15),
      equity112A: long,
    };
  }
  if (assetType === "Listed Bonds") {
    const long = heldMoreThanMonths(purchase, sale, 12);
    return { bucket: long ? "long" : "short", rate: long ? (afterRateChange ? 0.125 : 0.1) : null, equity112A: false };
  }
  if (assetType === "Debt Mutual Fund") {
    if (purchase >= new Date(2023, 3, 1)) {
      return { bucket: "short", rate: null, equity112A: false };
    }
    if (sale < new Date(2024, 6, 23)) {
      const long = heldMoreThanMonths(purchase, sale, 36);
      return long
        ? {
            bucket: "long",
            rate: 0.2,
            equity112A: false,
            warning: "Pre-23 July 2024 long-term debt-fund treatment requires an indexed cost basis, which is not inferred.",
          }
        : { bucket: "short", rate: null, equity112A: false };
    }
    const long = heldMoreThanMonths(purchase, sale, 24);
    return {
      bucket: long ? "long" : "short",
      rate: long ? 0.125 : null,
      equity112A: false,
    };
  }
  const long = heldMoreThanMonths(purchase, sale, 24);
  if (!long) return { bucket: "short", rate: null, equity112A: false };
  if (!afterRateChange) {
    return {
      bucket: "long",
      rate: 0.2,
      equity112A: false,
      warning: "Pre-23 July 2024 long-term treatment requires an indexed cost basis, which is not inferred.",
    };
  }
  return { bucket: "long", rate: 0.125, equity112A: false };
}

function analyzeCapitalGains(investments: Investment[], financialYear: TaxFinancialYear) {
  const treatments: CapitalGainTreatment[] = [];
  const taxable: TaxableDisposal[] = [];
  const warnings: string[] = [];
  const { start, end } = financialYearBounds(financialYear);

  for (const investment of investments) {
    for (const disposal of investment.disposals ?? []) {
      const base = { id: disposal.id, name: disposal.name, investmentId: investment.id };
      if (!completeDisposal(disposal)) {
        treatments.push({
          ...base, status: "excluded", gain: 0, holdingPeriod: "not-applicable", rate: null,
          treatment: "Excluded: purchase date, sale date, cost basis, proceeds and supported asset type are required.",
        });
        warnings.push(`${disposal.name}: incomplete disposal facts; excluded from tax.`);
        continue;
      }
      const purchase = parseDateOnly(disposal.purchaseDate);
      const sale = parseDateOnly(disposal.saleDate);
      const assetType = canonicalAssetType(disposal.assetType);
      if (!Number.isFinite(purchase.getTime()) || !Number.isFinite(sale.getTime()) || sale < purchase) {
        treatments.push({
          ...base, status: "excluded", gain: 0, holdingPeriod: "not-applicable", rate: null,
          treatment: "Excluded: purchase and sale dates must be valid and sale cannot precede purchase.",
        });
        warnings.push(`${disposal.name}: invalid purchase/sale chronology; excluded from tax.`);
        continue;
      }
      if (sale < start || sale > end) {
        treatments.push({
          ...base, status: "excluded", gain: disposal.proceeds - disposal.costBasis,
          holdingPeriod: "not-applicable", rate: null,
          treatment: "Excluded: sale is outside the selected financial year.",
        });
        continue;
      }
      if (!assetType) {
        treatments.push({
          ...base, status: "excluded", gain: disposal.proceeds - disposal.costBasis,
          holdingPeriod: "not-applicable", rate: null,
          treatment: `Excluded: unsupported asset type "${disposal.assetType}".`,
        });
        warnings.push(`${disposal.name}: unsupported asset type "${disposal.assetType}"; excluded from tax.`);
        continue;
      }
      const classification = disposalRate(assetType, purchase, sale);
      const needsIndexedCost = Boolean(classification.warning);
      if (
        needsIndexedCost
        && (!Number.isFinite(disposal.indexedCostBasis) || disposal.indexedCostBasis! < 0)
      ) {
        const guidance = assetType === "Debt Mutual Fund"
          ? "Enter the indexed cost basis for this pre-23 July 2024 long-term debt-fund sale."
          : "Enter the indexed cost basis for this pre-23 July 2024 long-term asset sale.";
        treatments.push({
          ...base, status: "excluded", gain: disposal.proceeds - disposal.costBasis,
          holdingPeriod: classification.bucket === "long" ? "long-term" : "short-term",
          rate: null, treatment: `Excluded: ${guidance}`,
        });
        warnings.push(`${disposal.name}: ${guidance}`);
        continue;
      }
      const grandfatheringEligible = (
        (assetType === "Listed Equity" || assetType === "Equity Mutual Fund")
        && classification.bucket === "long"
        && purchase < new Date(2018, 1, 1)
        && sale >= new Date(2018, 3, 1)
      );
      const hasValidGrandfatheredValue = Number.isFinite(disposal.grandfatheredValue)
        && disposal.grandfatheredValue! >= 0;
      const effectiveCostBasis = needsIndexedCost
        ? disposal.indexedCostBasis!
        : grandfatheringEligible && hasValidGrandfatheredValue
          ? Math.max(
              disposal.costBasis,
              Math.min(disposal.grandfatheredValue!, disposal.proceeds),
            )
          : disposal.costBasis;
      const rawGain = disposal.proceeds - effectiveCostBasis;
      const exemption = rawGain > 0
        ? Math.min(rawGain, Math.max(0, disposal.eligibleExemption ?? 0))
        : 0;
      const taxableGain = rawGain - exemption;
      const treatment: TaxableDisposal = {
        ...base,
        status: "included",
        gain: rawGain,
        taxableGain,
        bucket: classification.bucket,
        specialRate: classification.rate,
        equity112A: classification.equity112A,
        transferDate: sale,
        holdingPeriod: assetType === "Crypto"
          ? "not-applicable"
          : classification.bucket === "long" ? "long-term" : "short-term",
        rate: classification.rate ?? "slab",
        treatment: `${assetType}; ${classification.rate === null ? "ordinary slab rate" : `${classification.rate * 100}% special rate`}${needsIndexedCost ? ` using ₹${effectiveCostBasis} recorded indexed cost` : grandfatheringEligible && hasValidGrandfatheredValue ? ` using recorded 31 January 2018 grandfathered value` : ""}${exemption ? ` after ₹${exemption} recorded exemption` : ""}.`,
      };
      treatments.push(treatment);
      taxable.push(treatment);
    }
  }

  // Capital losses (other than virtual digital asset losses) offset gains:
  // LT losses only LT gains; ST losses ST gains first and then LT gains.
  const crypto = taxable.filter((item) => item.rate === 0.3);
  const general = taxable.filter((item) => item.rate !== 0.3);
  const reduceGains = (items: TaxableDisposal[], loss: number) => {
    for (const item of items.filter((entry) => entry.taxableGain > 0).sort((a, b) => (b.specialRate ?? 0) - (a.specialRate ?? 0))) {
      const offset = Math.min(item.taxableGain, loss);
      item.taxableGain -= offset;
      loss -= offset;
      if (loss <= 0) break;
    }
    return loss;
  };
  const longLoss = -general.filter((item) => item.bucket === "long" && item.taxableGain < 0)
    .reduce((sum, item) => sum + item.taxableGain, 0);
  const shortLoss = -general.filter((item) => item.bucket === "short" && item.taxableGain < 0)
    .reduce((sum, item) => sum + item.taxableGain, 0);
  const longGains = general.filter((item) => item.bucket === "long");
  const shortGains = general.filter((item) => item.bucket === "short");
  reduceGains(longGains, longLoss);
  const remainingShortLoss = reduceGains(shortGains, shortLoss);
  reduceGains(longGains, remainingShortLoss);

  // Section 112A exemption is one annual pool, allocated in transfer-date
  // order after losses. During FY 2024-25 it was ₹1 lakh through 22 July and
  // rose cumulatively to ₹1.25 lakh from 23 July (not separate pools).
  let section112AExemptionUsed = 0;
  general
    .filter((item) => item.equity112A && item.taxableGain > 0)
    .sort((left, right) => left.transferDate.getTime() - right.transferDate.getTime())
    .forEach((item) => {
      const ceiling = financialYear === "2024-25" && item.transferDate < new Date(2024, 6, 23)
        ? 100_000
        : 125_000;
      const exemption = Math.min(item.taxableGain, Math.max(0, ceiling - section112AExemptionUsed));
      item.taxableGain -= exemption;
      section112AExemptionUsed += exemption;
    });

  const positives = [...general, ...crypto].filter((item) => item.taxableGain > 0);
  return {
    treatments: treatments.map((item) => ({
      id: item.id,
      name: item.name,
      investmentId: item.investmentId,
      status: item.status,
      gain: item.gain,
      holdingPeriod: item.holdingPeriod,
      rate: item.rate,
      treatment: item.treatment,
    })),
    warnings,
    shortTerm: positives.filter((item) => item.bucket === "short").reduce((sum, item) => sum + item.taxableGain, 0),
    longTerm: positives.filter((item) => item.bucket === "long").reduce((sum, item) => sum + item.taxableGain, 0),
    slabGain: positives.filter((item) => item.specialRate === null).reduce((sum, item) => sum + item.taxableGain, 0),
    specialTaxable: positives.filter((item) => item.specialRate !== null).reduce((sum, item) => sum + item.taxableGain, 0),
    specialTax: positives.reduce((sum, item) => sum + item.taxableGain * (item.specialRate ?? 0), 0),
  };
}

const annualAmount = (source: IncomeSource) => {
  if (source.type === "Salary" && source.salaryDetails) {
    const details = source.salaryDetails;
    return details.grossCTCMode === "manual"
      ? Math.max(0, Number(details.grossCTC) || 0)
      : Math.max(0, (Number(details.basicPay) + Number(details.hra) + Number(details.allowances)) * 12 || 0);
  }
  const amount = Math.max(0, Number(source.amount) || 0);
  return source.frequency === "Monthly" ? amount * 12 : amount;
};

function financialYearBounds(financialYear: TaxFinancialYear) {
  const startYear = Number(financialYear.slice(0, 4));
  return {
    start: new Date(startYear, 3, 1),
    end: new Date(startYear + 1, 2, 31),
  };
}

const monthIndex = (date: Date) => date.getFullYear() * 12 + date.getMonth();

function sourceYearFactor(source: IncomeSource, financialYear: TaxFinancialYear) {
  const { start, end } = financialYearBounds(financialYear);
  const sourceDate = parseDateOnly(source.date);
  if (!Number.isFinite(sourceDate.getTime())) return 0;

  if (source.frequency === "One-time") {
    return sourceDate >= start && sourceDate <= end ? 1 : 0;
  }

  const customEnd = source.incomeEndMode === "custom" && source.incomeEndDate
    ? parseDateOnly(source.incomeEndDate)
    : null;
  if (source.frequency === "Monthly") {
    const firstMonth = Math.max(monthIndex(start), monthIndex(sourceDate));
    const lastMonth = Math.min(
      monthIndex(end),
      customEnd && Number.isFinite(customEnd.getTime())
        ? monthIndex(customEnd)
        : monthIndex(end),
    );
    const activeMonths = Math.max(0, lastMonth - firstMonth + 1);
    return activeMonths / 12;
  }

  const occurrenceYear = sourceDate.getMonth() >= 3
    ? start.getFullYear()
    : end.getFullYear();
  const occurrenceDay = Math.min(
    sourceDate.getDate(),
    new Date(occurrenceYear, sourceDate.getMonth() + 1, 0).getDate(),
  );
  const occurrence = new Date(occurrenceYear, sourceDate.getMonth(), occurrenceDay);
  const endsBeforeOccurrence = customEnd
    && Number.isFinite(customEnd.getTime())
    && monthIndex(customEnd) < monthIndex(occurrence);
  return occurrence >= sourceDate && occurrence >= start && occurrence <= end && !endsBeforeOccurrence
    ? 1
    : 0;
}

const amountInFinancialYear = (source: IncomeSource, financialYear: TaxFinancialYear) =>
  annualAmount(source) * sourceYearFactor(source, financialYear);

export function annualTaxableIncome(
  sources: IncomeSource[],
  financialYear: TaxFinancialYear = "2026-27",
) {
  return sources
    .filter((source) => source.type !== "Capital Gains")
    .reduce((total, source) => total + amountInFinancialYear(source, financialYear), 0);
}

function investmentYearFactor(investment: Investment, financialYear: TaxFinancialYear) {
  if (!investment.contributionStartDate) return 1;
  const { start, end } = financialYearBounds(financialYear);
  const contributionStart = parseDateOnly(investment.contributionStartDate);
  if (!Number.isFinite(contributionStart.getTime())) return 0;
  const customEnd = investment.contributionEndMode === "custom" && investment.contributionEndDate
    ? parseDateOnly(investment.contributionEndDate)
    : null;
  const firstMonth = Math.max(monthIndex(start), monthIndex(contributionStart));
  const lastMonth = Math.min(
    monthIndex(end),
    customEnd && Number.isFinite(customEnd.getTime())
      ? monthIndex(customEnd)
      : monthIndex(end),
  );
  return Math.max(0, lastMonth - firstMonth + 1) / 12;
}

export function eligibleInvestmentDeductions(
  investments: Investment[],
  financialYear: TaxFinancialYear = "2026-27",
) {
  const section80C = investments
    .filter((investment) => ["EPF", "PPF"].includes(investment.assetClass))
    .reduce(
      (total, investment) =>
        total + Math.max(0, Number(investment.monthlyContribution) || 0)
          * 12
          * investmentYearFactor(investment, financialYear),
      0,
    );
  const nps = investments
    .filter((investment) => investment.assetClass === "NPS")
    .reduce(
      (total, investment) =>
        total + Math.max(0, Number(investment.monthlyContribution) || 0)
          * 12
          * investmentYearFactor(investment, financialYear),
      0,
    );
  return Math.min(150_000, section80C) + Math.min(50_000, nps);
}

export function buildTaxSummary(
  sources: IncomeSource[],
  investments: Investment[],
  regime: TaxRegime,
  financialYear: TaxFinancialYear,
): TaxSummary {
  const capitalGains = analyzeCapitalGains(investments, financialYear);
  const salaryIncome = sources
    .filter((source) => ["Salary", "Bonus"].includes(source.type))
    .reduce((total, source) => total + amountInFinancialYear(source, financialYear), 0);
  const investmentDeduction = regime === "old"
    ? eligibleInvestmentDeductions(investments, financialYear)
    : 0;
  const houseProperty = sources
    .filter((source) => source.type === "Rental")
    .reduce((total, source) => total + amountInFinancialYear(source, financialYear), 0);
  const businessOrProfession = sources
    .filter((source) => ["Business", "Freelance/Consulting"].includes(source.type))
    .reduce((total, source) => total + amountInFinancialYear(source, financialYear), 0);
  const otherSources = sources
    .filter((source) => ["Dividends", "Interest", "Other"].includes(source.type))
    .reduce((total, source) => total + amountInFinancialYear(source, financialYear), 0);
  const result = calculateIncomeTax({
    financialYear,
    regime,
    income: {
      salary: salaryIncome,
      houseProperty,
      businessOrProfession,
      otherSources: otherSources + capitalGains.slabGain,
    },
    chapterVIADeductions: investmentDeduction,
  });
  const otherIncome = houseProperty + businessOrProfession + otherSources + capitalGains.slabGain;
  const tdsWithheld = sources
    .filter((source) =>
      source.type === "Salary"
      && source.salaryDetails
      && source.salaryDetails.tdsMode !== "automatic")
    .reduce(
      (total, source) =>
        total + Math.max(0, Number(source.salaryDetails?.tds) || 0)
          * 12
          * sourceYearFactor(source, financialYear),
      0,
    );
  const automaticTdsEstimate = sources
    .filter((source) =>
      source.type === "Salary"
      && source.salaryDetails?.tdsMode === "automatic")
    .reduce(
      (total, source) =>
        total + Math.max(0, Number(source.salaryDetails?.tds) || 0)
          * 12
          * sourceYearFactor(source, financialYear),
      0,
    );
  const recordedCapitalGains = sources
    .filter((source) => source.type === "Capital Gains")
    .reduce((total, source) => total + amountInFinancialYear(source, financialYear), 0);
  const sourceTreatments = sources.map((source) => {
    const amount = amountInFinancialYear(source, financialYear);
    if (amount === 0) {
      return {
        id: source.id,
        name: source.name,
        type: source.type,
        amount,
        status: "excluded" as const,
        treatment: "Outside the selected financial year or saved availability schedule.",
      };
    }
    if (source.type === "Capital Gains") {
      return {
        id: source.id,
        name: source.name,
        type: source.type,
        amount,
        status: "excluded" as const,
        treatment: "Shown separately; excluded until asset, lot, holding-period and exemption details are recorded.",
      };
    }
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      amount,
      status: "included" as const,
      treatment: source.type === "Salary" || source.type === "Bonus"
        ? "Included as salary income at ordinary slab rates."
        : "Included at ordinary slab rates under the recorded income category.",
    };
  });
  const warnings = [
    ...result.warnings,
    ...capitalGains.warnings,
    ...(recordedCapitalGains > 0
      ? ["Recorded capital gains are shown separately but excluded from liability because holding period, asset type, purchase lots and exemptions are not available."]
      : []),
    ...(automaticTdsEstimate > 0
      ? ["Automatic salary TDS estimates are shown separately and are not treated as employer withholding already recorded."]
      : []),
  ];
  const assumptions = [
    ...result.assumptions,
    "The saved source date is treated as its first applicable payment month or occurrence; custom end months are inclusive.",
    "Realized disposal gains use recorded proceeds and explicit saved tax facts; indexed cost and 31 January 2018 grandfathered value are used only for eligible historical disposals, while brokerage, deemed values and unrecorded exemptions are not inferred.",
    "The Debt Mutual Fund option models an unlisted fund; listed debt ETFs and their separate listed-security rules are not represented by this option.",
    "Capital losses are set off within the selected year (LT against LT; ST against ST then LT). Virtual digital asset losses are not set off or carried forward.",
    "Special-rate capital-gains tax is combined with ordinary tax, applicable surcharge (special-rate component capped at 15%) and 4% cess; surcharge marginal relief is not modeled for the combined calculation.",
    ...(regime === "old"
      ? ["Eligible saved monthly EPF, PPF and NPS contributions are prorated to their active months in the selected financial year."]
      : []),
  ];
  const aggregateTaxableIncome = result.taxableIncome + capitalGains.specialTaxable;
  const rule = getIncomeTaxRule(financialYear, regime);
  const surchargeRate = aggregateTaxableIncome > 50_000_000
    ? Math.min(0.37, rule.maximumSurchargeRate)
    : aggregateTaxableIncome > 20_000_000
      ? Math.min(0.25, rule.maximumSurchargeRate)
      : aggregateTaxableIncome > 10_000_000
        ? Math.min(0.15, rule.maximumSurchargeRate)
        : aggregateTaxableIncome > 5_000_000 ? 0.1 : 0;
  // Special-rate income still counts when testing rebate eligibility, but the
  // rebate itself does not reduce tax charged at a special rate.
  const hasSpecialRateTaxableGain = capitalGains.specialTaxable > 0;
  const ordinaryTaxAfterRebate = hasSpecialRateTaxableGain
    ? (aggregateTaxableIncome > rule.rebate.taxableIncomeLimit
      ? result.slabTax
      : result.taxAfterRebate)
    : result.taxAfterRebate;
  // Keep the established calculator's surcharge marginal relief exactly intact
  // unless special-rate gains need a combined liability calculation.
  const surcharge = hasSpecialRateTaxableGain
    ? ordinaryTaxAfterRebate * surchargeRate
      + capitalGains.specialTax * Math.min(0.15, surchargeRate)
    : result.surcharge;
  const cess = hasSpecialRateTaxableGain
    ? (ordinaryTaxAfterRebate + capitalGains.specialTax + surcharge) * 0.04
    : result.cess;
  const totalTax = hasSpecialRateTaxableGain
    ? roundTaxPayable(ordinaryTaxAfterRebate + capitalGains.specialTax + surcharge + cess)
    : result.totalTax;
  const effectiveRebate = hasSpecialRateTaxableGain
    && aggregateTaxableIncome > rule.rebate.taxableIncomeLimit
    ? 0
    : result.rebate + result.rebateMarginalRelief;

  return {
    grossIncome: result.grossIncome + capitalGains.specialTaxable,
    salaryIncome,
    otherIncome,
    standardDeduction: result.salaryStandardDeduction,
    investmentDeduction: result.chapterVIADeductions,
    taxableIncome: aggregateTaxableIncome,
    slabTax: result.slabTax,
    rebate: effectiveRebate,
    surcharge,
    cess,
    totalTax,
    tdsWithheld,
    automaticTdsEstimate,
    balanceTax: totalTax - tdsWithheld,
    recordedCapitalGains,
    shortTermCapitalGains: capitalGains.shortTerm,
    longTermCapitalGains: capitalGains.longTerm,
    taxableCapitalGains: capitalGains.shortTerm + capitalGains.longTerm,
    capitalGainsTax: capitalGains.specialTax,
    slabBreakdown: result.slabBreakdown,
    assumptions,
    warnings,
    sourceTreatments,
    disposalTreatments: capitalGains.treatments,
  };
}