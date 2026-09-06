import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  parseBrokerExport,
  parseExcelDate,
  createDisposalImportBatch,
  disposalImportBatchIndexes,
} from "./disposal-import.ts";

function workbookBuffer(rows: Record<string, unknown>[]) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Trades");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" });
}

test("parseBrokerExport identifies purchases, sales, duplicates, and unsupported rows", () => {
  const data = [
    { "Trade Type": "Buy", "Security": "RELIANCE", "Trade Date": "01/01/2023", "Value": 25000 },
    { "Trade Type": "Sell", "Security": "TCS", "Purchase Date": "01/01/2022", "Sale Date": "01/01/2023", "Cost": 10000, "Net Proceeds": 15000 },
    { "Trade Type": "Sell", "Security": "TCS", "Purchase Date": "01/01/2022", "Sale Date": "01/01/2023", "Cost": 10000, "Net Proceeds": 15000 },
    { "Trade Type": "Sell", "Security": "INFY", "Purchase Date": "01/01/2022", "Sale Date": "01/01/2023", "Cost": 10000, "Net Proceeds": 15000 },
    { "Trade Type": "Dividend", "Security": "ITC", "Date": "01/01/2023", "Amount": 500 }
  ];
  
  const existing = [
    {
      id: "1",
      name: "tcs",
      purchaseDate: "2022-01-01",
      saleDate: "2023-01-01",
      costBasis: 10000.00,
      proceeds: 15000.00,
    }
  ];
  
  const result = parseBrokerExport(workbookBuffer(data), existing);

  assert.equal(result.length, 5);

  assert.equal(result[0].status, "purchase");
  assert.equal(result[0].parsed.name, 'RELIANCE');

  assert.equal(result[1].status, "duplicate");
  assert.equal(result[1].parsed.name, 'TCS');

  // The second identical lot is still importable when only one already exists.
  assert.equal(result[2].status, "sale");
  assert.equal(result[2].parsed.name, 'TCS');

  assert.equal(result[3].status, "sale");
  assert.equal(result[3].parsed.name, 'INFY');

  assert.equal(result[4].status, "unsupported");
  assert.match(result[4].reason ?? "", /not recognized/i);
});

test("duplicate matching is count-aware so repeated imports are idempotent", () => {
  const rows = [
    { Action: "Sell", Symbol: "TCS", "Buy Date": "02/01/2022", "Sell Date": "03/01/2023", "Buy Value": "₹10,000", "Sell Value": "₹15,000" },
    { Action: "Sell", Symbol: "TCS", "Buy Date": "02/01/2022", "Sell Date": "03/01/2023", "Buy Value": "₹10,000", "Sell Value": "₹15,000" },
  ];
  const first = parseBrokerExport(workbookBuffer(rows), []);

  assert.deepEqual(first.map((row) => row.status), ["sale", "sale"]);

  const recorded = first.map((row, index) => ({
    id: `sale-${index}`,
    name: row.parsed.name!,
    purchaseDate: row.parsed.purchaseDate,
    saleDate: row.parsed.saleDate,
    costBasis: row.parsed.costBasis,
    proceeds: row.parsed.proceeds,
  }));
  const repeated = parseBrokerExport(workbookBuffer(rows), recorded);

  assert.deepEqual(repeated.map((row) => row.status), ["duplicate", "duplicate"]);
});

test("CSV input and spreadsheet dates map to canonical date-only values", () => {
  const csv = [
    "Transaction Type,Security,Purchase Date,Sale Date,Cost Basis,Proceeds",
    "Sale,INFY,44927,04/01/2023,\"12,500.50\",\"18,000.75\"",
  ].join("\n");
  const bytes = new TextEncoder().encode(csv);
  const result = parseBrokerExport(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    [],
  );

  assert.equal(result[0].status, "sale");
  assert.equal(result[0].parsed.purchaseDate, "2023-01-01");
  assert.equal(result[0].parsed.saleDate, "2023-01-04");
  assert.equal(result[0].parsed.costBasis, 12500.5);
  assert.equal(result[0].parsed.proceeds, 18000.75);
});

test("invalid calendar dates and negative amounts are unsupported", () => {
  const result = parseBrokerExport(workbookBuffer([
    { Type: "Sale", Name: "Bad date", "Purchase Date": "31/02/2023", "Sale Date": "03/03/2023", Cost: 100, Proceeds: 120 },
    { Type: "Sale", Name: "Bad amount", "Purchase Date": "01/02/2023", "Sale Date": "03/03/2023", Cost: -100, Proceeds: 120 },
    { Type: "Sale", Name: "Bad order", "Purchase Date": "04/03/2023", "Sale Date": "03/03/2023", Cost: 100, Proceeds: 120 },
  ]), []);

  assert.deepEqual(result.map((row) => row.status), [
    "unsupported",
    "unsupported",
    "unsupported",
  ]);
  assert.match(result[0].reason ?? "", /purchase date/i);
  assert.match(result[1].reason ?? "", /negative/i);
  assert.match(result[2].reason ?? "", /before purchase/i);
});

test("parseExcelDate supports Indian and ISO dates without rollover", () => {
  assert.equal(parseExcelDate("02/09/2026"), "2026-09-02");
  assert.equal(parseExcelDate("2026-09-02T10:30:00Z"), "2026-09-02");
  assert.equal(parseExcelDate("31/02/2026"), null);
  assert.equal(parseExcelDate("2026-02-31"), null);
  assert.equal(parseExcelDate(""), null);
});

test("createDisposalImportBatch records one stable identifier without file contents", () => {
  const batch = createDisposalImportBatch("batch-123", "2026-09-05T10:00:00.000Z");

  assert.deepEqual(batch, {
    id: "batch-123",
    importedAt: "2026-09-05T10:00:00.000Z",
  });
  assert.equal("file" in batch, false);
});

test("disposalImportBatchIndexes selects only disposals from the requested batch", () => {
  const indexes = disposalImportBatchIndexes([
    {},
    { importBatchId: "batch-one" },
    { importBatchId: "batch-two" },
    { importBatchId: "batch-one" },
  ], "batch-one");

  assert.deepEqual(indexes, [1, 3]);
});
