import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateLifeCover,
  DECISION_TOOL_ASSUMPTIONS,
  isAssumptionStale,
  recommendHealthCover,
  simulatePrepayVsInvest,
  simulateRentVsBuy,
  staleAssumptionWarnings,
} from "./decision-tools.ts";

test("assumptions are versioned, source-dated and become stale on the exact boundary", () => {
  for (const assumption of Object.values(DECISION_TOOL_ASSUMPTIONS)) {
    assert.match(assumption.version, /\d{4}/);
    assert.match(assumption.sourceDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(assumption.sources.length > 0);
  }
  assert.equal(isAssumptionStale({ sourceDate: "2025-01-01", staleAfterMonths: 12 }, "2025-12-31"), false);
  assert.equal(isAssumptionStale({ sourceDate: "2025-01-01", staleAfterMonths: 12 }, "2026-01-01"), true);
  assert.equal(isAssumptionStale({ sourceDate: "bad", staleAfterMonths: 12 }, "2025-01-01"), true);
  assert.ok(staleAssumptionWarnings("2030-01-01").length === 4);
});

test("life HLV handles growing income, obligations, protection and premium range", () => {
  const result = calculateLifeCover({
    annualIncomeReplacement: 1_000_000,
    replacementYears: 10,
    annualIncomeGrowthRate: 5,
    annualDiscountRate: 5,
    liabilities: 2_000_000,
    plannedObligations: 1_000_000,
    existingCover: 3_000_000,
    earmarkedAssets: 1_000_000,
    age: 35,
  });
  assert.ok(Math.abs(result.incomeReplacement - 10_000_000 / 1.05) < 0.01);
  assert.equal(result.humanLifeValue, result.incomeReplacement + 3_000_000);
  assert.equal(result.coverGap, result.humanLifeValue - 4_000_000);
  assert.ok(result.estimatedAnnualPremiumRange.high > result.estimatedAnnualPremiumRange.low);
  assert.equal(result.estimatedAnnualPremiumRange.confirmed, false);
});

test("life cover clamps malformed and over-insured cases without NaN", () => {
  const result = calculateLifeCover({
    annualIncomeReplacement: Number.POSITIVE_INFINITY,
    replacementYears: -20,
    annualIncomeGrowthRate: 999,
    annualDiscountRate: Number.NaN,
    existingCover: 5_000_000,
  });
  assert.equal(result.incomeReplacement, 0);
  assert.equal(result.coverGap, 0);
  assert.ok(result.warnings.some(warning => warning.includes("clamped")));
  assert.ok(Object.values(result).every(value => typeof value !== "number" || Number.isFinite(value)));
});

test("health recommendation responds to city, age and family and deducts cover by layer", () => {
  const result = recommendHealthCover({
    cityTier: "tier-1",
    age: 60,
    adults: 2,
    children: 2,
    employerCover: 500_000,
    existingFloaterCover: 1_000_000,
    existingTopUpCover: 1_000_000,
    topUpMultiple: 2,
  });
  assert.equal(result.ageFactor, 1.75);
  assert.equal(result.familyFactor, 2);
  assert.equal(result.recommendedBase, 5_250_000);
  assert.equal(result.baseGap, 3_750_000);
  assert.equal(result.topUpGap, 4_250_000);
  assert.equal(result.estimatedAnnualPremiumRange.confirmed, false);
  assert.match(result.warnings[0], /unconfirmed/);
});

test("health age loading is configurable", () => {
  const standard = recommendHealthCover({
    cityTier: "tier-2", age: 55, adults: 1, children: 0, ageLoadingRate: 3,
  });
  const conservative = recommendHealthCover({
    cityTier: "tier-2", age: 55, adults: 1, children: 0, ageLoadingRate: 5,
  });
  assert.equal(standard.ageFactor, 1.6);
  assert.equal(conservative.ageFactor, 2);
  assert.ok(conservative.recommendedBase > standard.recommendedBase);
});

test("health recommendation allows a configurable benchmark and never reports negative gaps", () => {
  const result = recommendHealthCover({
    cityTier: "tier-3", age: -1, adults: 0, children: -5,
    benchmarkByCity: { "tier-3": 2_000_000 },
    employerCover: 99_000_000,
  });
  assert.equal(result.benchmark, 2_000_000);
  assert.equal(result.familyFactor, 1);
  assert.equal(result.baseGap, 0);
  assert.equal(result.topUpGap, 0);
});

test("rent versus buy models financing, deposit, escalation and equal-horizon net worth", () => {
  const result = simulateRentVsBuy({
    propertyPrice: 10_000_000,
    downPayment: 2_000_000,
    loanAnnualRate: 8,
    loanTenureMonths: 240,
    monthlyRent: 25_000,
    rentalDeposit: 100_000,
    annualRentEscalationRate: 5,
    annualAppreciationRate: 6,
    annualOpportunityReturnRate: 8,
    monthlyOwnershipCosts: 3_000,
    horizonMonths: 120,
  });
  assert.equal(result.loanPrincipal, 8_000_000);
  assert.ok(result.monthlyLoanPayment > 0);
  assert.equal(result.timeline.length, 120);
  assert.ok(result.timeline[119].rent > result.timeline[0].rent);
  assert.ok(Number.isFinite(result.renterNetWorth));
  assert.ok(Number.isFinite(result.buyerNetWorth));
  assert.ok(result.breakEvenMonth === null || result.breakEvenMonth >= 1);
});

test("rent versus buy clamps down payment and supports a zero-month horizon", () => {
  const result = simulateRentVsBuy({
    propertyPrice: 1_000_000, downPayment: 2_000_000,
    loanAnnualRate: Number.NaN, loanTenureMonths: 0,
    monthlyRent: -1, horizonMonths: 0,
  });
  assert.equal(result.downPayment, 1_000_000);
  assert.equal(result.loanPrincipal, 0);
  assert.equal(result.monthlyLoanPayment, 0);
  assert.equal(result.timeline.length, 0);
});

test("rent versus buy preserves equal starting wealth when a rental deposit exceeds the initial budget", () => {
  const result = simulateRentVsBuy({
    propertyPrice: 1_000_000,
    downPayment: 100_000,
    purchaseCostRate: 5,
    rentalDeposit: 900_000,
    loanAnnualRate: 8,
    loanTenureMonths: 120,
    monthlyRent: 10_000,
    horizonMonths: 0,
  });
  assert.equal(result.rentalDeposit, 150_000);
  assert.equal(result.renterInvestmentBalance + result.rentalDeposit, 150_000);
});

for (const repaymentType of ["emi", "bullet", "interest-only-plus-bullet"] as const) {
  test(`prepay versus invest supports ${repaymentType} over an equal horizon`, () => {
    const result = simulatePrepayVsInvest({
      principal: 1_000_000,
      annualLoanRate: 10,
      remainingMonths: 60,
      repaymentType,
      initialExtraPayment: 100_000,
      monthlyExtraPayment: 5_000,
      horizonMonths: 84,
      annualInvestmentReturn: 9,
      annualReturnRiskRange: { low: 4, high: 14 },
      investmentTaxRate: 20,
    });
    assert.equal(result.repaymentType, repaymentType);
    assert.equal(result.horizonMonths, 84);
    assert.ok(result.interestSaved >= 0);
    assert.ok(result.investmentValues.low < result.investmentValues.expected);
    assert.ok(result.investmentValues.expected < result.investmentValues.high);
    assert.ok(Number.isFinite(result.expectedAdvantage));
    assert.ok(result.breakEvenInvestmentReturn === null || Number.isFinite(result.breakEvenInvestmentReturn));
    assert.match(result.warnings[0], /not guaranteed/);
  });
}

for (const repaymentType of ["emi", "bullet", "interest-only-plus-bullet"] as const) {
  test(`prepay cash budget identity holds for ${repaymentType}`, () => {
    const result = simulatePrepayVsInvest({
      principal: 120_000,
      annualLoanRate: 12,
      remainingMonths: 12,
      repaymentType,
      emi: repaymentType === "emi" ? 10_661.85 : undefined,
      initialExtraPayment: 12_000,
      monthlyExtraPayment: 1_000,
      horizonMonths: 18,
      annualInvestmentReturn: 0,
      investmentTaxRate: 0,
    });
    assert.ok(Math.abs(result.baselineCashBudgetUsed - result.prepayCashBudgetUsed) < 0.01);
    assert.equal(result.baseline.balance, 0);
    assert.equal(result.prepay.balance, 0);
    // At zero return, the incremental terminal portfolio is exactly the loan
    // interest saved because every unused rupee is invested without growth.
    assert.ok(Math.abs(result.terminalIncrementalPortfolioValues.expected - result.interestSaved) < 0.01);
  });
}

test("bullet maturity includes simple accrued interest and releases maturity cash after prepayment", () => {
  const result = simulatePrepayVsInvest({
    principal: 100_000,
    annualLoanRate: 12,
    remainingMonths: 12,
    repaymentType: "bullet",
    initialExtraPayment: 50_000,
    horizonMonths: 12,
    annualInvestmentReturn: 0,
  });
  assert.equal(result.baseline.interestPaid, 12_000);
  assert.equal(result.prepay.interestPaid, 6_000);
  assert.equal(result.interestSaved, 6_000);
  assert.equal(result.terminalIncrementalPortfolioValues.expected, 6_000);
  assert.equal(result.prepay.payoffMonth, 12);
});

test("bullet prepayment that clears principal early still settles accrued interest at maturity", () => {
  const result = simulatePrepayVsInvest({
    principal: 100_000,
    annualLoanRate: 12,
    remainingMonths: 12,
    repaymentType: "bullet",
    initialExtraPayment: 50_000,
    monthlyExtraPayment: 10_000,
    horizonMonths: 12,
    annualInvestmentReturn: 0,
  });
  assert.equal(result.prepay.interestPaid, 1_500);
  assert.equal(result.interestSaved, 10_500);
  assert.equal(result.terminalIncrementalPortfolioValues.expected, 10_500);
  assert.equal(result.prepay.payoffMonth, 12);
});

test("rent versus buy reports balances and only a durable break-even", () => {
  const result = simulateRentVsBuy({
    propertyPrice: 1_000_000, downPayment: 900_000, loanAnnualRate: 0,
    loanTenureMonths: 12, monthlyRent: 100_000, annualAppreciationRate: 0,
    annualOpportunityReturnRate: 0, annualRentEscalationRate: 0, horizonMonths: 12,
  });
  assert.ok(Number.isFinite(result.renterInvestmentBalance));
  assert.ok(Number.isFinite(result.buyerHomeEquity));
  if (result.breakEvenMonth !== null) {
    assert.ok(result.timeline
      .filter(point => point.month >= result.breakEvenMonth!)
      .every(point => point.buyerNetWorth >= point.renterNetWorth));
  }
});

test("prepay versus invest clamps unsafe money, rates, taxes and horizons", () => {
  const result = simulatePrepayVsInvest({
    principal: Number.POSITIVE_INFINITY,
    annualLoanRate: Number.NaN,
    remainingMonths: -1,
    repaymentType: "emi",
    initialExtraPayment: -5,
    monthlyExtraPayment: Number.NaN,
    horizonMonths: 0,
    annualInvestmentReturn: Number.POSITIVE_INFINITY,
    investmentTaxRate: 500,
  });
  assert.equal(result.horizonMonths, 1);
  assert.equal(result.interestSaved, 0);
  assert.deepEqual(result.investmentValues, { low: 0, expected: 0, high: 0 });
});

test("prepay versus invest discloses the effective through-payoff horizon", () => {
  const result = simulatePrepayVsInvest({
    principal: 1_000_000,
    annualLoanRate: 8,
    remainingMonths: 240,
    repaymentType: "emi",
    horizonMonths: 120,
    annualInvestmentReturn: 8,
  });
  assert.equal(result.horizonMonths, 240);
});