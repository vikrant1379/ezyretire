import assert from "node:assert/strict";
import test from "node:test";
import { buildTaxSummary } from "./tax-summary.ts";
import type { IncomeSource, Investment } from "./storage.ts";

const baseIncome = {
  date: "2025-04-01",
  recurring: true,
  createdAt: "2025-04-01T00:00:00.000Z",
} as const;

const salaryDetails = (
  grossCTC: number,
  tds: number,
  tdsMode: "automatic" | "manual",
) => ({
  grossCTC,
  grossCTCMode: "manual" as const,
  basicPay: grossCTC / 24,
  hra: grossCTC / 48,
  allowances: grossCTC / 48,
  employeePF: 0,
  professionalTax: 0,
  tds,
  tdsMode,
  otherDeductions: 0,
});

test("tax summary aggregates supported ordinary income and excludes capital gains", () => {
  const sources: IncomeSource[] = [
    {
      ...baseIncome,
      id: "salary",
      name: "Salary",
      type: "Salary",
      frequency: "Monthly",
      amount: 0,
      salaryDetails: {
        grossCTC: 1_200_000,
        grossCTCMode: "manual",
        basicPay: 50_000,
        hra: 25_000,
        allowances: 25_000,
        employeePF: 0,
        professionalTax: 0,
        tds: 0,
        otherDeductions: 0,
      },
    },
    { ...baseIncome, id: "rent", name: "Rent", type: "Rental", frequency: "Monthly", amount: 10_000 },
    { ...baseIncome, id: "gain", name: "Shares", type: "Capital Gains", frequency: "Annual", amount: 500_000 },
  ];

  const result = buildTaxSummary(sources, [], "new", "2025-26");
  assert.equal(result.salaryIncome, 1_200_000);
  assert.equal(result.otherIncome, 120_000);
  assert.equal(result.grossIncome, 1_320_000);
});

test("old regime applies only supported capped investment contributions", () => {
  const investments: Investment[] = [
    {
      id: "ppf",
      name: "PPF",
      assetClass: "PPF",
      investedAmount: 0,
      currentValue: 0,
      monthlyContribution: 20_000,
      expectedReturn: 7,
      createdAt: "",
    },
    {
      id: "nps",
      name: "NPS",
      assetClass: "NPS",
      investedAmount: 0,
      currentValue: 0,
      monthlyContribution: 10_000,
      expectedReturn: 9,
      createdAt: "",
    },
  ];
  const salary: IncomeSource = {
    ...baseIncome,
    id: "salary",
    name: "Salary",
    type: "Salary",
    frequency: "Monthly",
    amount: 0,
    salaryDetails: {
      grossCTC: 1_000_000,
      grossCTCMode: "manual",
      basicPay: 50_000,
      hra: 20_000,
      allowances: 10_000,
      employeePF: 0,
      professionalTax: 0,
      tds: 0,
      otherDeductions: 0,
    },
  };

  assert.equal(buildTaxSummary([salary], investments, "old", "2025-26").investmentDeduction, 200_000);
  assert.equal(buildTaxSummary([salary], investments, "new", "2025-26").investmentDeduction, 0);
});

test("selected FY includes only scheduled occurrences and prorates monthly sources", () => {
  const sources: IncomeSource[] = [
    {
      ...baseIncome,
      id: "partial-salary",
      name: "Partial salary",
      type: "Salary",
      frequency: "Monthly",
      date: "2026-10-01",
      amount: 0,
      salaryDetails: salaryDetails(120_000, 0, "manual"),
    },
    {
      ...baseIncome,
      id: "ended-rent",
      name: "Ended rent",
      type: "Rental",
      frequency: "Monthly",
      amount: 10_000,
      incomeEndMode: "custom",
      incomeEndDate: "2026-03-31",
    },
    {
      ...baseIncome,
      id: "future-interest",
      name: "Future interest",
      type: "Interest",
      frequency: "Monthly",
      date: "2027-04-01",
      amount: 10_000,
    },
    {
      ...baseIncome,
      id: "annual-interest",
      name: "Annual interest",
      type: "Interest",
      frequency: "Annual",
      date: "2025-01-15",
      amount: 20_000,
    },
    {
      ...baseIncome,
      id: "ended-annual-interest",
      name: "Ended annual interest",
      type: "Interest",
      frequency: "Annual",
      date: "2025-01-15",
      amount: 40_000,
      incomeEndMode: "custom",
      incomeEndDate: "2026-12-31",
    },
    {
      ...baseIncome,
      id: "bonus",
      name: "Bonus",
      type: "Bonus",
      frequency: "One-time",
      date: "2026-08-01",
      recurring: false,
      amount: 30_000,
    },
  ];

  const result = buildTaxSummary(sources, [], "new", "2026-27");
  assert.equal(result.salaryIncome, 90_000);
  assert.equal(result.otherIncome, 20_000);
  assert.equal(result.grossIncome, 110_000);
  assert.equal(result.sourceTreatments.find((item) => item.id === "ended-rent")?.status, "excluded");
  assert.equal(result.sourceTreatments.find((item) => item.id === "annual-interest")?.status, "included");
});

test("recorded manual TDS is separated from automatic estimates within the FY", () => {
  const sources: IncomeSource[] = [
    {
      ...baseIncome,
      id: "manual-salary",
      name: "Manual salary",
      type: "Salary",
      frequency: "Monthly",
      date: "2026-04-01",
      amount: 0,
      salaryDetails: salaryDetails(1_200_000, 10_000, "manual"),
    },
    {
      ...baseIncome,
      id: "automatic-salary",
      name: "Automatic salary",
      type: "Salary",
      frequency: "Monthly",
      date: "2026-04-01",
      amount: 0,
      salaryDetails: salaryDetails(600_000, 5_000, "automatic"),
    },
    {
      ...baseIncome,
      id: "ended-manual-salary",
      name: "Ended manual salary",
      type: "Salary",
      frequency: "Monthly",
      date: "2025-04-01",
      incomeEndMode: "custom",
      incomeEndDate: "2026-03-31",
      amount: 0,
      salaryDetails: salaryDetails(900_000, 8_000, "manual"),
    },
  ];

  const result = buildTaxSummary(sources, [], "new", "2026-27");
  assert.equal(result.tdsWithheld, 120_000);
  assert.equal(result.automaticTdsEstimate, 60_000);
  assert.equal(result.balanceTax, result.totalTax - 120_000);
});

test("old-regime investment deductions follow saved FY contribution schedules", () => {
  const investments: Investment[] = [
    {
      id: "partial-ppf",
      name: "Partial PPF",
      assetClass: "PPF",
      investedAmount: 0,
      currentValue: 0,
      monthlyContribution: 10_000,
      contributionStartDate: "2026-10-01",
      contributionEndMode: "retirement",
      expectedReturn: 7,
      createdAt: "",
    },
    {
      id: "future-epf",
      name: "Future EPF",
      assetClass: "EPF",
      investedAmount: 0,
      currentValue: 0,
      monthlyContribution: 10_000,
      contributionStartDate: "2027-04-01",
      contributionEndMode: "retirement",
      expectedReturn: 7,
      createdAt: "",
    },
    {
      id: "ended-ppf",
      name: "Ended PPF",
      assetClass: "PPF",
      investedAmount: 0,
      currentValue: 0,
      monthlyContribution: 10_000,
      contributionStartDate: "2025-04-01",
      contributionEndMode: "custom",
      contributionEndDate: "2026-03-31",
      expectedReturn: 7,
      createdAt: "",
    },
    {
      id: "nps",
      name: "NPS",
      assetClass: "NPS",
      investedAmount: 0,
      currentValue: 0,
      monthlyContribution: 10_000,
      expectedReturn: 9,
      createdAt: "",
    },
  ];

  const result = buildTaxSummary([], investments, "old", "2026-27");
  assert.equal(result.investmentDeduction, 110_000);
});

const investmentWithDisposals = (disposals: Investment["disposals"]): Investment => ({
  id: "shares",
  name: "Share lots",
  assetClass: "Direct Equity",
  investedAmount: 0,
  currentValue: 0,
  expectedReturn: 0,
  createdAt: "",
  disposals,
});

test("FY 2024-25 applies the equity rate change and shared LTCG exemption", () => {
  const result = buildTaxSummary([], [investmentWithDisposals([
    {
      id: "pre-change-st",
      name: "Pre-change ST",
      purchaseDate: "2024-01-01",
      saleDate: "2024-07-22",
      costBasis: 100_000,
      proceeds: 200_000,
      assetType: "Listed Equity",
    },
    {
      id: "post-change-st",
      name: "Post-change ST",
      purchaseDate: "2024-01-01",
      saleDate: "2024-07-23",
      costBasis: 100_000,
      proceeds: 200_000,
      assetType: "Listed Equity",
    },
    {
      id: "long",
      name: "Long",
      purchaseDate: "2023-01-01",
      saleDate: "2025-01-02",
      costBasis: 100_000,
      proceeds: 300_000,
      assetType: "Listed Equity",
    },
  ])], "new", "2024-25");

  assert.equal(result.shortTermCapitalGains, 200_000);
  assert.equal(result.longTermCapitalGains, 75_000);
  assert.equal(result.capitalGainsTax, 44_375);
  assert.equal(result.totalTax, 46_150);
});

test("FY 2024-25 Section 112A exemption transitions cumulatively on 23 July", () => {
  const result = buildTaxSummary([], [investmentWithDisposals([
    {
      id: "july-22",
      name: "LTCG through 22 July",
      purchaseDate: "2023-06-01",
      saleDate: "2024-07-22",
      costBasis: 100_000,
      proceeds: 250_000,
      assetType: "Listed Equity",
    },
    {
      id: "july-23",
      name: "LTCG from 23 July",
      purchaseDate: "2023-06-01",
      saleDate: "2024-07-23",
      costBasis: 100_000,
      proceeds: 200_000,
      assetType: "Equity Mutual Fund",
    },
  ])], "new", "2024-25");

  // The 22 July lot consumes the old ₹1 lakh ceiling. The 23 July lot can
  // receive only the ₹25,000 increase, not another independent ₹1.25 lakh.
  assert.equal(result.disposalTreatments[0].rate, 0.1);
  assert.equal(result.disposalTreatments[1].rate, 0.125);
  assert.equal(result.longTermCapitalGains, 125_000);
  assert.equal(result.capitalGainsTax, 14_375);
});

test("holding-period boundary is short-term and losses follow capital set-off rules", () => {
  const result = buildTaxSummary([], [investmentWithDisposals([
    {
      id: "boundary",
      name: "Exactly twelve months",
      purchaseDate: "2024-05-01",
      saleDate: "2025-05-01",
      costBasis: 100_000,
      proceeds: 200_000,
      assetType: "Listed Equity",
    },
    {
      id: "st-loss",
      name: "ST loss",
      purchaseDate: "2025-04-01",
      saleDate: "2025-06-01",
      costBasis: 160_000,
      proceeds: 100_000,
      assetType: "Listed Equity",
    },
    {
      id: "crypto-loss",
      name: "Crypto loss",
      purchaseDate: "2025-04-01",
      saleDate: "2025-07-01",
      costBasis: 200_000,
      proceeds: 100_000,
      assetType: "Crypto",
    },
  ])], "new", "2025-26");

  assert.equal(result.shortTermCapitalGains, 40_000);
  assert.equal(result.capitalGainsTax, 8_000);
});

test("same-day purchase and sale is a valid short-term disposal", () => {
  const result = buildTaxSummary([], [investmentWithDisposals([{
    id: "same-day",
    name: "Same-day equity sale",
    purchaseDate: "2025-08-01",
    saleDate: "2025-08-01",
    costBasis: 10_000,
    proceeds: 20_000,
    assetType: "Listed Equity",
  }])], "new", "2025-26");

  assert.equal(result.disposalTreatments[0].status, "included");
  assert.equal(result.shortTermCapitalGains, 10_000);
  assert.equal(result.capitalGainsTax, 2_000);
});

test("only sufficiently documented supported disposals sold in the FY contribute", () => {
  const result = buildTaxSummary([], [investmentWithDisposals([
    { id: "missing", name: "Missing cost", purchaseDate: "2024-01-01", saleDate: "2025-06-01", proceeds: 20_000, assetType: "Gold" },
    { id: "unsupported", name: "Collectible", purchaseDate: "2024-01-01", saleDate: "2025-06-01", costBasis: 10_000, proceeds: 20_000, assetType: "Art" },
    { id: "outside", name: "Outside", purchaseDate: "2023-01-01", saleDate: "2024-01-01", costBasis: 10_000, proceeds: 20_000, assetType: "Gold" },
  ])], "new", "2025-26");

  assert.equal(result.taxableCapitalGains, 0);
  assert.equal(result.disposalTreatments.every((item) => item.status === "excluded"), true);
  assert.match(result.warnings.join(" "), /incomplete disposal facts/);
  assert.match(result.warnings.join(" "), /unsupported asset type/);
});

test("a recorded eligible exemption reduces special-rate taxable gain and tax", () => {
  const result = buildTaxSummary([], [investmentWithDisposals([{
    id: "property-sale",
    name: "Property sale with recorded exemption",
    purchaseDate: "2022-05-01",
    saleDate: "2025-06-01",
    costBasis: 1_000_000,
    proceeds: 1_100_000,
    assetType: "Real Estate",
    eligibleExemption: 40_000,
  }])], "new", "2025-26");

  // This is an explicit recorded exemption, not the separate 112A equity
  // threshold (which does not apply to real estate).
  assert.equal(result.longTermCapitalGains, 60_000);
  assert.equal(result.taxableCapitalGains, 60_000);
  assert.equal(result.capitalGainsTax, 7_500);
  assert.match(result.disposalTreatments[0].treatment, /₹40000 recorded exemption/);
});

test("debt mutual fund transition uses documented short and long-term rules", () => {
  const fy2024 = buildTaxSummary([], [investmentWithDisposals([
    {
      id: "legacy-debt-short",
      name: "Legacy debt short term",
      purchaseDate: "2021-07-22",
      saleDate: "2024-07-22",
      costBasis: 100_000,
      proceeds: 120_000,
      assetType: "Debt Mutual Fund",
    },
    {
      id: "legacy-debt-indexed",
      name: "Legacy debt long term",
      purchaseDate: "2021-07-21",
      saleDate: "2024-07-22",
      costBasis: 100_000,
      indexedCostBasis: 108_000,
      proceeds: 120_000,
      assetType: "Debt Mutual Fund",
    },
    {
      id: "post-change-debt-long",
      name: "Post-change debt long term",
      purchaseDate: "2022-06-01",
      saleDate: "2024-08-01",
      costBasis: 100_000,
      proceeds: 200_000,
      assetType: "Debt Mutual Fund",
    },
  ])], "new", "2024-25");
  assert.equal(fy2024.disposalTreatments[0].status, "included");
  assert.equal(fy2024.disposalTreatments[0].rate, "slab");
  assert.equal(fy2024.disposalTreatments[1].status, "included");
  assert.equal(fy2024.disposalTreatments[1].gain, 12_000);
  assert.equal(fy2024.disposalTreatments[1].rate, 0.2);
  assert.equal(fy2024.disposalTreatments[2].rate, 0.125);
  assert.equal(fy2024.capitalGainsTax, 14_900);

  const fy2025 = buildTaxSummary([], [investmentWithDisposals([{
    id: "new-debt-deemed-short",
    name: "New debt deemed short term",
    purchaseDate: "2023-04-01",
    saleDate: "2025-08-01",
    costBasis: 100_000,
    proceeds: 200_000,
    assetType: "Debt Mutual Fund",
  }])], "new", "2025-26");
  assert.equal(fy2025.disposalTreatments[0].holdingPeriod, "short-term");
  assert.equal(fy2025.disposalTreatments[0].rate, "slab");
});

test("pre-23 July 2024 long-term property uses recorded indexed cost and guides when missing", () => {
  const result = buildTaxSummary([], [investmentWithDisposals([
    {
      id: "property-indexed",
      name: "Indexed property sale",
      purchaseDate: "2015-01-01",
      saleDate: "2024-06-01",
      costBasis: 2_000_000,
      indexedCostBasis: 2_600_000,
      proceeds: 3_000_000,
      assetType: "Real Estate",
    },
    {
      id: "property-missing-index",
      name: "Property missing indexed cost",
      purchaseDate: "2015-01-01",
      saleDate: "2024-06-01",
      costBasis: 2_000_000,
      proceeds: 3_000_000,
      assetType: "Real Estate",
    },
  ])], "new", "2024-25");

  assert.equal(result.disposalTreatments[0].status, "included");
  assert.equal(result.disposalTreatments[0].gain, 400_000);
  assert.equal(result.disposalTreatments[0].rate, 0.2);
  assert.equal(result.disposalTreatments[1].status, "excluded");
  assert.match(result.disposalTreatments[1].treatment, /Enter the indexed cost basis/);
});

test("grandfathered value applies only to eligible historical long-term equity", () => {
  const result = buildTaxSummary([], [investmentWithDisposals([
    {
      id: "eligible-grandfathering",
      name: "Eligible equity sale",
      purchaseDate: "2017-01-01",
      saleDate: "2024-06-01",
      costBasis: 100_000,
      grandfatheredValue: 160_000,
      proceeds: 200_000,
      assetType: "Listed Equity",
    },
    {
      id: "later-equity-purchase",
      name: "Later equity sale",
      purchaseDate: "2019-01-01",
      saleDate: "2024-06-01",
      costBasis: 100_000,
      grandfatheredValue: 160_000,
      proceeds: 200_000,
      assetType: "Listed Equity",
    },
  ])], "new", "2024-25");

  assert.equal(result.disposalTreatments[0].gain, 40_000);
  assert.match(result.disposalTreatments[0].treatment, /grandfathered value/);
  assert.equal(result.disposalTreatments[1].gain, 100_000);
  assert.doesNotMatch(result.disposalTreatments[1].treatment, /grandfathered value/);
});

test("special-rate gains crossing the FY rebate limit report no effective rebate", () => {
  const salary: IncomeSource = {
    ...baseIncome,
    id: "salary-at-rebate-limit",
    name: "Salary",
    type: "Salary",
    frequency: "Monthly",
    amount: 0,
    salaryDetails: salaryDetails(1_275_000, 0, "manual"),
  };
  const result = buildTaxSummary([salary], [investmentWithDisposals([{
    id: "special-gain",
    name: "Listed share gain",
    purchaseDate: "2025-04-01",
    saleDate: "2025-08-01",
    costBasis: 100_000,
    proceeds: 200_000,
    assetType: "Listed Equity",
  }])], "new", "2025-26");

  assert.equal(result.taxableIncome, 1_300_000);
  assert.equal(result.rebate, 0);
  assert.ok(result.capitalGainsTax > 0);
});