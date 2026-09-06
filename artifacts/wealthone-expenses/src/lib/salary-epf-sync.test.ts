import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIncomeSchedule, synchronizeSalaryEPF, type IncomeSource, type Investment } from "./storage.ts";

const salary = (
  id: string,
  employeePF: number,
  frequency: IncomeSource["frequency"] = "Monthly",
): IncomeSource => ({
  id,
  name: `Salary ${id}`,
  type: "Salary",
  frequency,
  amount: 0,
  date: "2026-01-01T00:00:00.000Z",
  recurring: true,
  salaryDetails: {
    grossCTC: 0,
    basicPay: 100000,
    hra: 0,
    allowances: 0,
    employeePF,
    professionalTax: 0,
    tds: 0,
    otherDeductions: 0,
  },
  createdAt: "2026-01-01T00:00:00.000Z",
});

const epf = (overrides: Partial<Investment> = {}): Investment => ({
  id: "epf-1",
  name: "Existing EPF",
  assetClass: "EPF",
  investedAmount: 500000,
  currentValue: 650000,
  monthlyContribution: 10000,
  expectedReturn: 8.15,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

test("migrated legacy annual salary creates its monthly PF contribution", () => {
  const legacy = salary("income-1", 120000, "Annual");
  const migrated = normalizeIncomeSchedule(legacy);
  const [existing] = synchronizeSalaryEPF([migrated], [epf()]);

  assert.equal(migrated.frequency, "Monthly");
  assert.equal(migrated.salaryDetails?.employeePF, 10000);
  assert.equal(existing.linkedIncomeSourceId, "income-1");
  assert.equal(existing.autoManagedContribution, true);
  assert.equal(existing.monthlyContribution, 10000);
  assert.equal(existing.currentValue, 650000);
});

test("retains corpus and stops contribution when the linked salary is removed", () => {
  const linked = epf({
    linkedIncomeSourceId: "income-1",
    autoManagedContribution: true,
    monthlyContribution: 12000,
  });
  const [result] = synchronizeSalaryEPF([], [linked]);

  assert.equal(result.currentValue, 650000);
  assert.equal(result.monthlyContribution, 0);
  assert.equal(result.linkedIncomeSourceId, "income-1");
});

test("stops a linked PF after the salary's inclusive custom end month", () => {
  const linked = epf({
    linkedIncomeSourceId: "income-1",
    autoManagedContribution: true,
    monthlyContribution: 12000,
  });
  const endingSalary = {
    ...salary("income-1", 12000),
    incomeEndMode: "custom" as const,
    incomeEndDate: "2026-09-01",
  };

  const [duringEndMonth] = synchronizeSalaryEPF(
    [endingSalary],
    [linked],
    new Date(2026, 8, 30),
  );
  const [afterEndMonth] = synchronizeSalaryEPF(
    [endingSalary],
    [linked],
    new Date(2026, 9, 1),
  );

  assert.equal(duringEndMonth.monthlyContribution, 12000);
  assert.equal(afterEndMonth.monthlyContribution, 0);
  assert.equal(afterEndMonth.currentValue, 650000);
});

test("does not arbitrarily take over one manual EPF when multiple salaries exist", () => {
  const results = synchronizeSalaryEPF(
    [salary("income-1", 10000), salary("income-2", 15000)],
    [epf()],
  );

  const manual = results.find((investment) => investment.id === "epf-1");
  assert.equal(manual?.autoManagedContribution, undefined);
  assert.equal(manual?.monthlyContribution, 10000);
  assert.equal(results.filter((investment) => investment.autoManagedContribution).length, 2);
});

test("only one managed contribution remains active per salary", () => {
  const results = synchronizeSalaryEPF(
    [salary("income-1", 12000)],
    [
      epf({
        id: "managed-small",
        currentValue: 100000,
        linkedIncomeSourceId: "income-1",
        autoManagedContribution: true,
      }),
      epf({
        id: "managed-large",
        currentValue: 800000,
        linkedIncomeSourceId: "income-1",
        autoManagedContribution: true,
      }),
    ],
  );

  const active = results.filter((investment) => investment.autoManagedContribution);
  assert.equal(active.length, 1);
  assert.equal(active[0].id, "managed-large");
  assert.equal(active[0].monthlyContribution, 12000);
  assert.equal(results.find((investment) => investment.id === "managed-small")?.monthlyContribution, 0);
});