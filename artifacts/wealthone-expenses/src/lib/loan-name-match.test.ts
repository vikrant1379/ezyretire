import assert from "node:assert/strict";
import test from "node:test";
import { matchLoanByName, type Loan } from "./storage.ts";

const loan = (id: string, name: string): Loan => ({
  id,
  name,
  type: "Home",
  sanctionedPrincipal: 1,
  outstandingPrincipal: 1,
  annualInterestRate: 1,
  interestType: "Fixed",
  totalTenureMonths: 1,
  startDate: "2026-01-01T00:00:00.000Z",
  emi: 1,
  prepayments: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
});

test("matches a uniquely named loan using normalized text", () => {
  const result = matchLoanByName("  HDFC home-loan ", [
    loan("loan-1", "HDFC Home Loan"),
    loan("loan-2", "SBI Car Loan"),
  ]);

  assert.equal(result.status, "matched");
  if (result.status === "matched") assert.equal(result.loan.id, "loan-1");
});

test("reports a missing loan name", () => {
  assert.deepEqual(
    matchLoanByName("Unknown Loan", [loan("loan-1", "HDFC Home Loan")]),
    { status: "missing" },
  );
});

test("does not link an ambiguous normalized loan name", () => {
  assert.deepEqual(
    matchLoanByName("HDFC Home Loan", [
      loan("loan-1", "HDFC Home Loan"),
      loan("loan-2", "HDFC home-loan"),
    ]),
    { status: "ambiguous" },
  );
});