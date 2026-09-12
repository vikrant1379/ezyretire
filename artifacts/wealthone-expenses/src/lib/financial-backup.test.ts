import assert from "node:assert/strict";
import test from "node:test";
import type { FinancialData } from "./financial-api.ts";
import {
  CURRENT_FINANCIAL_BACKUP_VERSION,
  parseFinancialBackup,
  serializeFinancialBackup,
} from "./financial-backup.ts";

test("a complete backup preserves partial fund allocations and their occurrence links", () => {
  const backup = {
    expenses: [{ id: "expense-1", amount: 1200 }],
    budgets: [{ category: "Food", monthlyLimit: 20000 }],
    incomeSources: [{
      id: "bonus-1",
      name: "Annual bonus",
      type: "Bonus",
      frequency: "Annual",
      amount: 100000,
      date: "2025-04-15",
      recurring: true,
      createdAt: "2025-01-01T00:00:00.000Z",
    }],
    incomeReceipts: [{
      id: "receipt-1",
      incomeSourceId: "bonus-1",
      receivedDate: "2026-04-15",
      amount: 90_000,
      note: "Net bonus received",
      createdAt: "2026-04-15T12:00:00.000Z",
    }],
    investments: [{
      id: "fund-1",
      name: "Index fund",
      type: "Mutual Fund",
      currentValue: 250000,
      fundAllocations: [{
        id: "allocation-1",
        sourceId: "bonus-1",
        opportunityDate: "2026-04-15",
        investmentDate: "2026-04-20",
        amount: 40000,
        createdAt: "2026-04-15T00:00:00.000Z",
      }],
    }],
    loans: [{ id: "loan-1", name: "Home loan", outstandingPrincipal: 500000 }],
    retirementInputs: {
      dateOfBirth: "1990-01-01",
      targetRetirementAge: 60,
      lifeExpectancy: 85,
      generalInflation: 6,
      salaryGrowth: 8,
      monthlyContributionOverride: 10000,
      investSurplus: true,
    },
    profileInputs: {
      fullName: "Backup User",
      dateOfBirth: "1990-01-01",
      targetRetirementAge: 60,
      lifeExpectancy: 85,
      riskPreference: "Balanced",
      onboardingCompleted: true,
    },
    uiPreferences: {
      investmentOrder: ["fund-1"],
      investmentSort: { by: "manual", direction: "asc" },
      loanOrder: ["loan-1"],
      loanSort: { by: "manual", direction: "asc" },
    },
  } as FinancialData;

  const restored = parseFinancialBackup(serializeFinancialBackup(backup));

  assert.deepEqual(restored, backup);
  assert.deepEqual(restored.investments[0].fundAllocations, [{
    id: "allocation-1",
    sourceId: "bonus-1",
    opportunityDate: "2026-04-15",
    investmentDate: "2026-04-20",
    amount: 40000,
    createdAt: "2026-04-15T00:00:00.000Z",
  }]);
  assert.deepEqual(restored.incomeReceipts, backup.incomeReceipts);
});

test("new backups declare their format version", () => {
  const data = createMinimalFinancialData();
  const serialized = JSON.parse(serializeFinancialBackup(data));

  assert.equal(serialized.formatVersion, CURRENT_FINANCIAL_BACKUP_VERSION);
  assert.deepEqual(serialized.data, data);
});

test("archived planning categories round trip through backups", () => {
  const data = createMinimalFinancialData();
  data.uiPreferences.archivedPlanningCategories = ["Pet care"];

  assert.deepEqual(
    parseFinancialBackup(serializeFinancialBackup(data)).uiPreferences.archivedPlanningCategories,
    ["Pet care"],
  );
});

test("lifetime budget windows round trip through backups", () => {
  const data = createMinimalFinancialData();
  data.budgets = [{
    category: "Lifestyle",
    monthlyLimit: 0,
    windows: [{
      id: "retirement-home",
      monthlyLimit: 75_000,
      startDate: "2045-06-01",
      endMode: "lifelong",
    }],
  }];
  assert.deepEqual(
    parseFinancialBackup(serializeFinancialBackup(data)).budgets,
    data.budgets,
  );
});

test("yearly budget cadence and due month round trip through backups", () => {
  const data = createMinimalFinancialData();
  data.budgets = [{
    category: "Insurance",
    monthlyLimit: 0,
    windows: [{
      id: "annual-premium",
      monthlyLimit: 120_000,
      cadence: "yearly",
      annualMonth: 2,
      startDate: "2026-03-01",
      endMode: "lifelong",
    }],
  }];
  assert.deepEqual(
    parseFinancialBackup(serializeFinancialBackup(data)).budgets,
    data.budgets,
  );
});

test("salary calculation intent and tax rule metadata round trip through backups", () => {
  const data = createMinimalFinancialData();
  data.incomeSources = [{
    id: "salary-1",
    name: "Primary salary",
    type: "Salary",
    frequency: "Monthly",
    amount: 100_000,
    date: "2025-04-01",
    recurring: true,
    salaryDetails: {
      grossCTC: 1_500_000,
      grossCTCMode: "automatic",
      basicPay: 60_000,
      hra: 25_000,
      allowances: 20_000,
      employeePF: 7_200,
      professionalTax: 200,
      tds: 12_345,
      tdsMode: "automatic",
      taxRegime: "new",
      financialYear: "2025-26",
      taxRuleVersion: "india-fy2025-26-v1",
      otherDeductions: 500,
    },
    createdAt: "2025-04-01T00:00:00.000Z",
  }];

  const restored = parseFinancialBackup(serializeFinancialBackup(data));
  assert.deepEqual(restored.incomeSources[0], data.incomeSources[0]);
});

test("realized investment disposals round trip through backups", () => {
  const data = createMinimalFinancialData();
  data.investments = [{
    id: "equity-1",
    name: "Listed shares",
    assetClass: "Direct Equity",
    investedAmount: 100000,
    currentValue: 150000,
    expectedReturn: 10,
    createdAt: "2024-01-01T00:00:00.000Z",
    disposals: [{
      id: "sale-1",
      name: "FY25 sale",
      purchaseDate: "2023-06-01",
      saleDate: "2025-08-01",
      costBasis: 100000,
      proceeds: 180000,
      assetType: "Listed Equity",
      eligibleExemption: 5000,
    }],
  }];

  const restored = parseFinancialBackup(serializeFinancialBackup(data));
  assert.deepEqual(restored.investments[0].disposals, data.investments[0].disposals);
});

test("legacy unversioned backups are deliberately migrated from version 0", () => {
  const legacyBackup = createMinimalFinancialData();

  assert.deepEqual(parseFinancialBackup(JSON.stringify(legacyBackup)), legacyBackup);
});

test("backups created before the ezyRetire rename remain restorable", () => {
  const preRenameVersionOneBackup = {
    formatVersion: 1,
    data: createMinimalFinancialData(),
  };

  assert.deepEqual(
    parseFinancialBackup(JSON.stringify(preRenameVersionOneBackup)),
    preRenameVersionOneBackup.data,
  );
});

test("unsupported backup versions are rejected with a compatibility message", () => {
  const unsupportedBackup = {
    formatVersion: CURRENT_FINANCIAL_BACKUP_VERSION + 1,
    data: createMinimalFinancialData(),
  };

  assert.throws(
    () => parseFinancialBackup(JSON.stringify(unsupportedBackup)),
    /unsupported format version 3.*supports backup format version 2/,
  );
});

test("invalid JSON backups are rejected before restore", () => {
  assert.throws(
    () => parseFinancialBackup(JSON.stringify({ expenses: [], investments: [] })),
    /not a valid ezyRetire backup/,
  );
});

function createMinimalFinancialData(): FinancialData {
  return {
    expenses: [],
    budgets: [],
    incomeSources: [],
    incomeReceipts: [],
    investments: [],
    loans: [],
    retirementInputs: {},
    profileInputs: {},
    uiPreferences: {
      investmentOrder: [],
      investmentSort: { by: "manual", direction: "asc" },
      loanOrder: [],
      loanSort: { by: "manual", direction: "asc" },
      incomeOrder: [],
      incomeSort: { by: "manual", direction: "asc" },
      archivedPlanningCategories: [],
    },
  } as FinancialData;
}