import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateIncomeTax,
  calculateSlabTax,
  financialYearForDate,
  getIncomeTaxRule,
  roundTaxPayable,
} from "./income-tax.ts";

test("financial years change exactly at the 1 April boundary", () => {
  assert.equal(financialYearForDate("2025-03-31"), "2024-25");
  assert.equal(financialYearForDate("2025-04-01"), "2025-26");
  assert.equal(financialYearForDate("2026-03-31"), "2025-26");
  assert.equal(financialYearForDate("2026-04-01"), "2026-27");
  assert.throws(() => financialYearForDate("2025-02-29"), /valid calendar/);
  assert.throws(() => financialYearForDate("01-04-2025"), /YYYY-MM-DD/);
});

test("FY 2024-25 new-regime slabs apply progressively", () => {
  const slabs = getIncomeTaxRule("2024-25", "new").slabs;
  assert.equal(calculateSlabTax(300_000, slabs), 0);
  assert.equal(calculateSlabTax(700_000, slabs), 20_000);
  assert.equal(calculateSlabTax(1_000_000, slabs), 50_000);
  assert.equal(calculateSlabTax(1_500_000, slabs), 140_000);
  assert.equal(calculateSlabTax(2_000_000, slabs), 290_000);
});

test("FY 2025-26 new-regime slabs and rebate are versioned independently", () => {
  const atLimit = calculateIncomeTax({
    financialYear: "2025-26",
    regime: "new",
    income: { otherSources: 1_200_000 },
  });
  assert.equal(atLimit.slabTax, 60_000);
  assert.equal(atLimit.rebate, 60_000);
  assert.equal(atLimit.totalTax, 0);

  const priorYear = calculateIncomeTax({
    financialYear: "2024-25",
    regime: "new",
    income: { otherSources: 1_200_000 },
  });
  assert.equal(priorYear.slabTax, 80_000);
  assert.equal(priorYear.rebate, 0);
  assert.equal(priorYear.totalTax, 83_200);
});

test("FY 2026-27 keeps the enacted rates in its own rule version", () => {
  const currentYear = calculateIncomeTax({
    financialYear: "2026-27",
    regime: "new",
    income: { salary: 1_800_000 },
  });
  const priorYear = calculateIncomeTax({
    financialYear: "2025-26",
    regime: "new",
    income: { salary: 1_800_000 },
  });

  assert.equal(currentYear.ruleVersion, "india-income-tax/FY-2026-27");
  assert.equal(currentYear.totalTax, priorYear.totalTax);
  assert.deepEqual(currentYear.slabBreakdown, priorYear.slabBreakdown);
});

test("new-regime rebate marginal relief applies just above twelve lakh", () => {
  const result = calculateIncomeTax({
    financialYear: "2025-26",
    regime: "new",
    income: { otherSources: 1_210_000 },
  });
  assert.equal(result.slabTax, 61_500);
  assert.equal(result.rebate, 0);
  assert.equal(result.rebateMarginalRelief, 51_500);
  assert.equal(result.taxAfterRebate, 10_000);
  assert.equal(result.totalTax, 10_400);
});

test("old-regime slabs, deductions, rebate and age bands remain available", () => {
  const individual = calculateIncomeTax({
    financialYear: "2025-26",
    regime: "old",
    income: { salary: 650_000 },
    chapterVIADeductions: 100_000,
  });
  assert.equal(individual.salaryStandardDeduction, 50_000);
  assert.equal(individual.taxableIncome, 500_000);
  assert.equal(individual.slabTax, 12_500);
  assert.equal(individual.rebate, 12_500);
  assert.equal(individual.totalTax, 0);

  assert.equal(calculateSlabTax(
    500_000,
    getIncomeTaxRule("2025-26", "old", "senior").slabs,
  ), 10_000);
  assert.equal(calculateSlabTax(
    500_000,
    getIncomeTaxRule("2025-26", "old", "super-senior").slabs,
  ), 0);
});

test("new regime ignores caller-supplied Chapter VI-A deductions", () => {
  const result = calculateIncomeTax({
    financialYear: "2025-26",
    regime: "new",
    income: { salary: 2_000_000 },
    chapterVIADeductions: 500_000,
  });
  assert.equal(result.salaryStandardDeduction, 75_000);
  assert.equal(result.chapterVIADeductions, 0);
  assert.equal(result.taxableIncome, 1_925_000);
});

test("salary and supported ordinary non-salary heads aggregate before slabs", () => {
  const result = calculateIncomeTax({
    financialYear: "2025-26",
    regime: "new",
    income: {
      salary: 1_000_000,
      houseProperty: 200_000,
      businessOrProfession: 300_000,
      otherSources: 100_000,
    },
  });
  assert.equal(result.grossIncome, 1_600_000);
  assert.equal(result.salaryStandardDeduction, 75_000);
  assert.equal(result.taxableIncome, 1_525_000);
  assert.equal(result.slabTax, 108_750);
});

test("standard deduction cannot exceed salary and malformed amounts do not leak NaN", () => {
  const result = calculateIncomeTax({
    financialYear: "2025-26",
    regime: "new",
    income: {
      salary: 20_000,
      houseProperty: Number.POSITIVE_INFINITY,
      otherSources: -50,
    },
  });
  assert.equal(result.grossIncome, 20_000);
  assert.equal(result.salaryStandardDeduction, 20_000);
  assert.equal(result.taxableIncome, 0);
  Object.values(result)
    .filter((value): value is number => typeof value === "number")
    .forEach((value) => assert.ok(Number.isFinite(value)));
});

test("surcharge tiers are capped at 25% under new regime and cess follows surcharge", () => {
  const result = calculateIncomeTax({
    financialYear: "2025-26",
    regime: "new",
    income: { otherSources: 60_000_000 },
  });
  assert.equal(result.surchargeRate, 0.25);
  assert.equal(result.surcharge, result.taxAfterRebate * 0.25);
  assert.equal(result.cess, (result.taxAfterRebate + result.surcharge) * 0.04);

  const old = calculateIncomeTax({
    financialYear: "2025-26",
    regime: "old",
    income: { otherSources: 60_000_000 },
  });
  assert.equal(old.surchargeRate, 0.37);
});

test("surcharge marginal relief limits tax growth just above a threshold", () => {
  const threshold = calculateIncomeTax({
    financialYear: "2025-26",
    regime: "old",
    income: { otherSources: 5_000_000 },
  });
  const justAbove = calculateIncomeTax({
    financialYear: "2025-26",
    regime: "old",
    income: { otherSources: 5_000_100 },
  });
  assert.ok(justAbove.surchargeMarginalRelief > 0);
  assert.equal(
    justAbove.taxAfterRebate + justAbove.surcharge,
    threshold.taxAfterRebate + 100,
  );
});

test("final liability uses deterministic nearest-ten rounding", () => {
  assert.equal(roundTaxPayable(104), 100);
  assert.equal(roundTaxPayable(105), 110);
  assert.equal(roundTaxPayable(109.999999), 110);
  assert.equal(roundTaxPayable(Number.NaN), 0);

  const first = calculateIncomeTax({
    financialYear: "2024-25",
    regime: "old",
    income: { otherSources: 500_123 },
  });
  const second = calculateIncomeTax({
    financialYear: "2024-25",
    regime: "old",
    income: { otherSources: 500_123 },
  });
  assert.equal(first.totalTax, 13_030);
  assert.deepEqual(first, second);
});