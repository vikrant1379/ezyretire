import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BANK_STATEMENT_LIMITS,
  bankStatementDateInputValue,
  bankRowsToExpenses,
  isLikelySelfTransfer,
  parseBankStatementFile,
  prepareBankStatementCommit,
} from "./bank-statement-import.ts";
import type { Expense } from "./storage.ts";

function statementFile(contents: string, name = "statement.csv") {
  return new File([contents], name, { type: name.endsWith(".pdf") ? "application/pdf" : "text/csv" });
}

const headers = "Transaction Date,Narration,Debit,Credit,Balance";

function fixtureFile(name: string) {
  const bytes = new Uint8Array(readFileSync(new URL(`./fixtures/bank-statements/${name}`, import.meta.url)));
  return new File([bytes], name, { type: name.endsWith(".pdf") ? "application/pdf" : "text/csv" });
}

test("parses every supported date-only format as UTC in the India timezone", async () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = "Asia/Kolkata";
  try {
    assert.equal(new Date(2026, 0, 15).getTimezoneOffset(), -330);
    for (const value of [
      "15/01/2026",
      "15-01-2026",
      "15/01/26",
      "15-01-26",
      "2026-01-15",
      "2026/01/15",
      "15 Jan 2026",
      "15-Jan-2026",
      "15 January 2026",
    ]) {
      const review = await parseBankStatementFile(statementFile(
        `HDFC Bank\n${headers}\n${value},SHOP,250,,900`,
      ));
      assert.equal(review.rows[0]?.date, "2026-01-15T00:00:00.000Z", value);
      assert.equal(review.rows[0]?.date.slice(0, 10), "2026-01-15", value);
    }
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test("uses the earliest issuing-bank evidence instead of narration matcher order", async () => {
  const review = await parseBankStatementFile(statementFile(
    `HDFC Bank\n${headers}\n15/01/2026,SBI TRANSFER PAYMENT,250,,900`,
  ));
  assert.equal(review.bank, "HDFC");
  assert.equal(review.rows[0]?.description, "SBI TRANSFER PAYMENT");
});

test("surfaces skipped debit date and amount issues and lowers review confidence", async () => {
  const review = await parseBankStatementFile(statementFile(
    `HDFC Bank\n${headers}\n15/01/2026,VALID,100,,900\n2026.01.16,BAD DATE,200,,700\n17 Jan 2026,BAD AMOUNT,not-money,,700\n18 Jan 2026,,50,,650`,
  ));
  assert.deepEqual(review.rows.map((row) => row.merchant), ["VALID"]);
  assert.deepEqual(
    review.issues.map((issue) => [issue.row, issue.field]),
    [[4, "date"], [5, "amount"], [6, "description"]],
  );
  assert.match(review.issues[0]?.message ?? "", /Skipped debit: date/);
  assert.match(review.issues[1]?.message ?? "", /Skipped debit: amount/);
  assert.match(review.issues[2]?.message ?? "", /Skipped debit: description is missing/);
  assert.ok(review.confidence < (review.rows[0]?.confidence ?? 0));
});

test("returns review issues even when every candidate debit is skipped", async () => {
  const review = await parseBankStatementFile(statementFile(
    `HDFC Bank\n${headers}\n15 Jan 2026,,100,,900`,
  ));
  assert.equal(review.rows.length, 0);
  assert.equal(review.issues.length, 1);
  assert.equal(review.issues[0]?.field, "description");
  assert.equal(review.confidence, 0);
  assert.equal(Number.isNaN(review.confidence), false);
});

test("surfaces a non-empty unknown transaction direction instead of dropping it silently", async () => {
  const review = await parseBankStatementFile(statementFile(
    "HDFC Bank\nTransaction Date,Narration,Amount,Dr/Cr,Balance\n15/01/2026,AMBIGUOUS,250,X,1000",
  ));
  assert.equal(review.rows.length, 0);
  assert.equal(review.confidence, 0);
  assert.deepEqual(review.issues.map((issue) => [issue.row, issue.field, issue.value]), [
    [3, "direction", "X"],
  ]);
  assert.match(review.issues[0]?.message ?? "", /direction marker is not recognized/);
});

test("applies the row limit only when accepting a 5,001st valid debit", async () => {
  const rows = Array.from(
    { length: BANK_STATEMENT_LIMITS.rows },
    (_, index) => `15/01/2026,SHOP ${index + 1},1,,900`,
  );
  const review = await parseBankStatementFile(statementFile(
    `HDFC Bank\n${headers}\n${rows.join("\n")}\nStatement footer,,,,`,
  ));
  assert.equal(review.rows.length, BANK_STATEMENT_LIMITS.rows);

  await assert.rejects(() => parseBankStatementFile(statementFile(
    `HDFC Bank\n${headers}\n${rows.join("\n")}\n16/01/2026,ONE TOO MANY,1,,899`,
  )), /more than 5,000 transactions/);
});

test("date input normalization never throws and commit rejects cleared or invalid dates", async () => {
  assert.equal(bankStatementDateInputValue(""), "");
  assert.equal(bankStatementDateInputValue("not-a-date"), "");
  assert.equal(bankStatementDateInputValue("2026-01-15"), "2026-01-15T00:00:00.000Z");

  const review = await parseBankStatementFile(statementFile(
    `HDFC Bank\n${headers}\n15/01/2026,SHOP,100,,900`,
  ));
  review.rows[0]!.date = bankStatementDateInputValue("");
  assert.throws(() => prepareBankStatementCommit(review), /Correct selected dates/);
  review.rows[0]!.date = "2026-02-31";
  assert.throws(() => prepareBankStatementCommit(review), /Correct selected dates/);
});

test("still rejects statements that contain no debit candidates", async () => {
  await assert.rejects(() => parseBankStatementFile(statementFile(
    `HDFC Bank\n${headers}\n15/01/2026,CREDIT ONLY,,100,1000`,
  )), /No debit transactions were found/);
});

test("rejects date rollovers instead of normalizing them into another day", async () => {
  for (const invalid of ["31/02/2026", "31-04-26", "2026-02-29", "2026/13/01"]) {
    const review = await parseBankStatementFile(statementFile(
      `HDFC Bank\n${headers}\n${invalid},INVALID,250,,900\n15/01/2026,VALID,100,,800`,
    ));
    assert.deepEqual(review.rows.map((row) => row.merchant), ["VALID"], invalid);
  }
});

for (const [bank, fixture, date, amount, version] of [
  ["SBI", "sbi-v1.csv", "2026-01-15", 251, "sbi-v1-csv"],
  ["HDFC", "hdfc-v1.csv", "2026-01-16", 252, "hdfc-v1-csv"],
  ["ICICI", "icici-v1.csv", "2026-01-17", 253, "icici-v1-csv"],
  ["Axis", "axis-v1.csv", "2026-01-18", 254, "axis-v1-csv"],
  ["Kotak", "kotak-v1.csv", "2026-01-19", 1_255, "kotak-v1-csv"],
  ["PNB", "pnb-v1.csv", "2026-01-20", 256, "pnb-v1-csv"],
  ["BOB", "bob-v1.csv", "2026-01-21", 257, "bob-v1-csv"],
  ["IndusInd", "indusind-v1.csv", "2026-01-22", 258, "indusind-v1-csv"],
] as const) {
  test(`parses the sanitized ${bank} CSV fixture with its adapter`, async () => {
    const review = await parseBankStatementFile(fixtureFile(fixture));
    assert.equal(review.bank, bank);
    assert.equal(review.version, version);
    assert.equal(review.rows.length, 1);
    assert.equal(review.rows[0]?.date.slice(0, 10), date);
    assert.equal(review.rows[0]?.amount, amount);
    assert.equal(review.rows[0]?.parserVersion, version);
    assert.equal(review.rows[0]?.provenance.fileType, "csv");
  });
}

test("preserves multiline quoted narration in the HDFC CSV fixture", async () => {
  const review = await parseBankStatementFile(fixtureFile("hdfc-v1.csv"));
  assert.equal(review.rows[0]?.description, "CAFE ORDER WITH MULTILINE NOTE");
});

for (const [fixture, bank, date, amount, version] of [
  ["hdfc-v1.pdf", "HDFC", "2026-01-24", 301.5, "hdfc-v1-pdf"],
  ["icici-v1.pdf", "ICICI", "2026-01-26", 302.5, "icici-v1-pdf"],
] as const) {
  test(`parses ${fixture} and excludes its equal-width credit with blank debit semantics`, async () => {
    const review = await parseBankStatementFile(fixtureFile(fixture));
    assert.equal(review.bank, bank);
    assert.equal(review.version, version);
    assert.equal(review.rows.length, 1);
    assert.equal(review.rows[0]?.date.slice(0, 10), date);
    assert.equal(review.rows[0]?.amount, amount);
    assert.equal(review.rows[0]?.parserVersion, version);
    assert.equal(review.rows[0]?.provenance.fileType, "pdf");
    assert.doesNotMatch(review.rows[0]?.description ?? "", /credit/i);
  });
}

test("flags existing and in-file duplicates and excludes them before review commit", async () => {
  const existing: Expense[] = [{
    id: "old", date: "2026-01-15T00:00:00.000Z", amount: 250,
    category: "Miscellaneous", merchant: "SHOP", paymentMethod: "Other",
    reimbursable: false, recurring: false, createdAt: "2026-01-15T00:00:00.000Z",
  }];
  const review = await parseBankStatementFile(statementFile(
    `HDFC Bank\n${headers}\n15/01/2026,SHOP,250,,900\n15/01/2026,SHOP,250,,650`,
  ), existing);
  assert.deepEqual(review.rows.map((row) => [row.duplicate, row.selected]), [[true, true], [true, true]]);
});

test("flags likely self transfers and converts only explicitly selected debits", async () => {
  assert.equal(isLikelySelfTransfer("NEFT TO MY ACCOUNT"), true);
  const review = await parseBankStatementFile(statementFile(
    `ICICI Bank\n${headers}\n15/01/2026,Transfer to my account,500,,900\n16/01/2026,PHARMACY,100,,800`,
  ));
  assert.equal(review.rows[0]?.selfTransfer, true);
  assert.equal(review.rows[0]?.selected, false);
  assert.deepEqual(bankRowsToExpenses(review.rows).map((row) => row.amount), [100]);
});

test("requires a completed review before preparing any save", async () => {
  assert.throws(() => prepareBankStatementCommit(null), /Review the parsed statement/);
  const review = await parseBankStatementFile(statementFile(
    `Axis Bank\n${headers}\n15/01/2026,CAFE,200,,800`,
  ));
  assert.equal(prepareBankStatementCommit(review).length, 1);
  review.rows[0]!.merchant = "";
  assert.throws(() => prepareBankStatementCommit(review), /keep merchants within 160 characters/);
});

test("truncates parsed import text to API limits and validates exact boundaries", async () => {
  const review = await parseBankStatementFile(statementFile(
    `HDFC Bank\n${headers}\n15/01/2026,${"M".repeat(BANK_STATEMENT_LIMITS.note + 1)},200,,800`,
  ));
  assert.equal(review.rows[0]?.description.length, BANK_STATEMENT_LIMITS.note);
  assert.equal(review.rows[0]?.merchant.length, BANK_STATEMENT_LIMITS.merchant);

  review.rows[0]!.merchant = "M".repeat(BANK_STATEMENT_LIMITS.merchant);
  review.rows[0]!.category = "C".repeat(BANK_STATEMENT_LIMITS.category);
  const [expense] = prepareBankStatementCommit(review);
  assert.equal(expense?.merchant.length, 160);
  assert.equal(expense?.category.length, 80);
  assert.equal(expense?.paymentMethod, "Bank transfer");
  assert.ok((expense?.paymentMethod.length ?? 0) <= BANK_STATEMENT_LIMITS.paymentMethod);

  review.rows[0]!.merchant += "M";
  assert.throws(() => prepareBankStatementCommit(review), /merchants within 160 characters/);
  review.rows[0]!.merchant = "M".repeat(BANK_STATEMENT_LIMITS.merchant);
  review.rows[0]!.category += "C";
  assert.throws(() => prepareBankStatementCommit(review), /categories within 80/);
  review.rows[0]!.category = "C".repeat(BANK_STATEMENT_LIMITS.category);
  review.rows[0]!.description += "N";
  assert.throws(() => prepareBankStatementCommit(review), /notes within 2000/);
});

test("rejects malformed, unsupported, encrypted, scanned, and oversized input explicitly", async () => {
  await assert.rejects(() => parseBankStatementFile(statementFile("not a bank statement")), /Unsupported statement/);
  await assert.rejects(() => parseBankStatementFile(statementFile("SBI\nno useful columns")), /statement layout is not recognized/);
  await assert.rejects(() => parseBankStatementFile(statementFile("%PDF-1.7\n/Encrypt 1 0 R", "sbi.pdf")), /encrypted or password-protected/);
  await assert.rejects(() => parseBankStatementFile(statementFile("%PDF-1.7\nState Bank of India image only", "sbi.pdf")), /no extractable text/);
  const oversized = new File([new Uint8Array(BANK_STATEMENT_LIMITS.csvBytes + 1)], "sbi.csv");
  await assert.rejects(() => parseBankStatementFile(oversized), /exceeds the 5 MiB/);
  await assert.rejects(() => parseBankStatementFile(statementFile(
    'HDFC Bank\nDate,Description,Debit,Credit,Balance\n15/01/2026,"UNTERMINATED,250,,900',
  )), /Malformed CSV: unterminated quoted field/);
  await assert.rejects(() => parseBankStatementFile(statementFile(
    "SBI\nDate,Description,Debit,Credit,Balance\n15/01/2026,SHOP,250,,900",
  )), /SBI statement layout is not recognized/);
});

test("never turns credits or ambiguous amount-only rows into expenses", async () => {
  await assert.rejects(() => parseBankStatementFile(statementFile(
    `HDFC Bank\n${headers}\n15/01/2026,REFUND,,250,1000`,
  )), /No debit transactions/);
  await assert.rejects(() => parseBankStatementFile(statementFile(
    "HDFC Bank\nDate,Description,Amount,Balance\n15/01/2026,UNKNOWN,250,1000",
  )), /statement layout is not recognized/);
  const explicit = await parseBankStatementFile(statementFile(
    "HDFC Bank\nTransaction Date,Narration,Amount,Dr/Cr,Balance\n15/01/2026,DEBIT,250,DR,1000\n16/01/2026,CREDIT,400,CR,1400",
  ));
  assert.deepEqual(explicit.rows.map((row) => row.amount), [250]);
});