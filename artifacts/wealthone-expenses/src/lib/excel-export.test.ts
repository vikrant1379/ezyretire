import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExcelWorkbook,
  datedExcelFilename,
  localDateStamp,
  sanitizeFilename,
  sanitizeSheetName,
} from "./excel-export.ts";
import {
  buildIncomeReportSheets,
  buildInvestmentReportSheets,
  buildLoanReportSheets,
  buildTransactionReportSheets,
} from "./excel-report-builders.ts";
import { investmentProjectedValue } from "./retirement-projection.ts";

const assertDateCell = (cell: { t?: string; v?: unknown }, year: number, month: number, day: number) => {
  assert.equal(cell.t, "d");
  assert.ok(cell.v instanceof Date);
  assert.deepEqual(
    [cell.v.getFullYear(), cell.v.getMonth() + 1, cell.v.getDate()],
    [year, month, day],
  );
};

test("dated filenames use the supplied date's local calendar fields", () => {
  const localDate = new Date(2026, 0, 2, 23, 30);
  assert.equal(localDateStamp(localDate), "2026-01-02");
  assert.equal(datedExcelFilename("income sources report", localDate), "income_sources_report_2026-01-02.xlsx");
  assert.equal(sanitizeFilename("income_sources_report.xlsx.xlsx"), "income_sources_report.xlsx");
});

test("transaction report preserves filtered input order and local UI dates", () => {
  const timestamp = "2026-05-06T22:30:00.000Z";
  const displayed = new Date(timestamp);
  const expenses = [
    { id: "2", merchant: "Second", date: timestamp, amount: 2, category: "Other", paymentMethod: "UPI", reimbursable: false, recurring: false, createdAt: "" },
    { id: "1", merchant: "First", date: "2026-01-02", amount: 1, category: "Other", paymentMethod: "Cash", reimbursable: true, recurring: false, createdAt: "" },
  ] as any;
  const workbook = buildExcelWorkbook(buildTransactionReportSheets(expenses, () => ""));
  assert.equal(workbook.Sheets.Transactions.B2.v, "Second");
  assert.equal(workbook.Sheets.Transactions.B3.v, "First");
  assertDateCell(workbook.Sheets.Transactions.A2, displayed.getFullYear(), displayed.getMonth() + 1, displayed.getDate());
  assertDateCell(workbook.Sheets.Transactions.A3, 2026, 1, 2);
});

test("income report preserves order, status, and typed optional dates", () => {
  const sources = [
    { id: "future", name: "Future", type: "Other", frequency: "One-time", amount: 50, date: "2030-03-04", recurring: false, createdAt: "" },
    { id: "ended", name: "Ended", type: "Rental", frequency: "Monthly", amount: 100, date: "2020-01-02", recurring: true, incomeEndMode: "custom", incomeEndDate: "2024-06-30", createdAt: "" },
  ] as any;
  const workbook = buildExcelWorkbook(buildIncomeReportSheets(sources, { now: new Date(2026, 0, 1) }));
  const sheet = workbook.Sheets["Income Sources"];
  assert.equal(sheet.A2.v, "Future");
  assert.equal(sheet.A3.v, "Ended");
  assert.equal(sheet.M2.v, "Upcoming");
  assert.equal(sheet.M3.v, "Ended");
  assertDateCell(sheet.J2, 2030, 3, 4);
  assert.equal(sheet.L2.v, "");
  assertDateCell(sheet.L3, 2024, 6, 30);
});

test("investment report preserves holdings and typed schedule/fund dates", () => {
  const holdings = [
    { id: "b", name: "B", assetClass: "Bonds", investedAmount: 10, currentValue: 11, monthlyContribution: 1, contributionStartDate: "2027-02-03", contributionEndMode: "custom", contributionEndDate: "2028-04-05", expectedReturn: 8, createdAt: "" },
    { id: "a", name: "A", assetClass: "Gold", investedAmount: 20, currentValue: 21, monthlyContribution: 0, expectedReturn: 6, createdAt: "" },
  ] as any;
  const sheets = buildInvestmentReportSheets({
    holdings, incomes: [], asOf: new Date(2026, 0, 1),
    yearsToRetirement: 10, monthsToRetirement: 120,
    annualFunds: [{ sourceName: "Bonus", sourceType: "Bonus", date: new Date(2027, 6, 8, 15), amount: 100, kind: "recurring-annual", estimated: true }],
    yearlyOutlook: [{ year: 2027, income: 1, annualFunds: 2, living: 3, loanEmi: 4, scheduledInvestments: 5, planningInvestment: 6, surplus: 7 }],
  });
  const workbook = buildExcelWorkbook(sheets);
  assert.deepEqual(workbook.SheetNames, ["Holdings", "Annual Funds", "Yearly Outlook"]);
  assert.equal(workbook.Sheets.Holdings.A2.v, "B");
  assert.equal(workbook.Sheets.Holdings.A3.v, "A");
  assertDateCell(workbook.Sheets.Holdings.G2, 2027, 2, 3);
  assertDateCell(workbook.Sheets.Holdings.I2, 2028, 4, 5);
  assertDateCell(workbook.Sheets["Annual Funds"].C2, 2027, 7, 8);
  assert.equal(workbook.Sheets["Yearly Outlook"].E1.v, "Estimated Surplus / Month");
  assert.equal(
    workbook.Sheets["Yearly Outlook"].F1.v,
    "Annual Funds (Separate from Surplus / Month)",
  );
  assert.equal(workbook.Sheets["Yearly Outlook"].F2.v, 2);

  const holdingsOnly = buildExcelWorkbook(buildInvestmentReportSheets({
    holdings, incomes: [], asOf: new Date(2026, 0, 1),
    yearsToRetirement: 10, monthsToRetirement: 120, annualFunds: [], yearlyOutlook: [],
  }));
  assert.deepEqual(holdingsOnly.SheetNames, ["Holdings"]);
});

test("investment report completes an auto-managed holding when its linked income is missing", () => {
  const asOf = new Date(2026, 0, 1);
  const orphanedHolding = {
    id: "orphaned-pf",
    name: "Orphaned PF",
    assetClass: "EPF",
    investedAmount: 1000,
    currentValue: 1200,
    monthlyContribution: 500,
    autoManagedContribution: true,
    linkedIncomeSourceId: "missing-salary",
    expectedReturn: 8,
    createdAt: "",
  } as any;
  const sheets = buildInvestmentReportSheets({
    holdings: [orphanedHolding],
    incomes: [],
    asOf,
    yearsToRetirement: 10,
    monthsToRetirement: 120,
    annualFunds: [],
    yearlyOutlook: [],
  });
  const row = sheets[0].rows[0] as {
    monthlyContribution: number;
    status: string;
    projectedRetirementValue: number;
  };

  assert.equal(row.monthlyContribution, 0);
  assert.equal(row.status, "Completed");
  assert.equal(
    row.projectedRetirementValue,
    investmentProjectedValue(orphanedHolding, 10, {
      asOf,
      monthsToRetirement: 120,
      incomes: [],
    }),
  );
});

test("loan report preserves order and typed start, payoff, and retirement dates", () => {
  const loans = [
    { id: "b", name: "B", type: "Home", sanctionedPrincipal: 100000, outstandingPrincipal: 50000, annualInterestRate: 8, interestType: "Fixed", totalTenureMonths: 120, startDate: "2025-02-03", emi: 1000, prepayments: 0, createdAt: "" },
    { id: "a", name: "A", type: "Auto", sanctionedPrincipal: 10000, outstandingPrincipal: 5000, annualInterestRate: 7, interestType: "Floating", totalTenureMonths: 24, startDate: "2026-04-05", emi: 500, prepayments: 0, createdAt: "" },
  ] as any;
  const workbook = buildExcelWorkbook(buildLoanReportSheets(loans, {
    now: new Date(2026, 0, 2),
    retirementDate: new Date(2035, 5, 7, 18),
  }));
  const sheet = workbook.Sheets.Loans;
  assert.equal(sheet.A2.v, "B");
  assert.equal(sheet.A3.v, "A");
  assertDateCell(sheet.H2, 2025, 2, 3);
  assert.equal(sheet.M2.t, "d");
  assertDateCell(sheet.O2, 2035, 6, 7);
});

test("filename and worksheet names are safe and bounded", () => {
  assert.equal(sanitizeFilename("../My report?.xlsx.xlsx"), "My_report.xlsx");
  assert.equal(sanitizeSheetName("Loans/[Active]:*?\\ report"), "Loans Active report");
  assert.equal(sanitizeSheetName("x".repeat(40)).length, 31);
});

test("workbook construction preserves useful cell types and skips empty sheets", () => {
  const workbook = buildExcelWorkbook([
    {
      name: "Data",
      rows: [{ name: "Example", amount: 42, active: true }],
      columns: [
        { header: "Name", value: "name" },
        { header: "Amount", value: "amount" },
        { header: "Active", value: "active" },
      ],
    },
    { name: "Empty", rows: [], columns: [{ header: "Value", value: "value" }] },
  ]);
  assert.deepEqual(workbook.SheetNames, ["Data"]);
  assert.equal(workbook.Sheets.Data.B2.v, 42);
  assert.equal(workbook.Sheets.Data.B2.t, "n");
  assert.equal(workbook.Sheets.Data.C2.t, "b");
  assert.ok(workbook.Sheets.Data["!cols"]);
});

test("workbook construction rejects an export with no rows", () => {
  assert.throws(
    () => buildExcelWorkbook([{ name: "Empty", rows: [], columns: [] }]),
    /no rows/i,
  );
});