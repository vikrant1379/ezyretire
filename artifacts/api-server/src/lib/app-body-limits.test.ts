import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import app, {
  BANK_STATEMENT_IMPORT_JSON_LIMIT,
  DEFAULT_API_JSON_LIMIT,
  FINANCIAL_SAVE_JSON_LIMIT,
  MONTHLY_REPORT_JSON_LIMIT,
  RESTORE_JSON_LIMIT,
} from "../app.js";

async function withServer(
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${port}/api`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
}

const postJson = (url: string, body: unknown, method = "POST") => fetch(url, {
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

test("production middleware parses a 5,000-row import and resulting financial save on exact methods", async () => {
  const rows = Array.from({ length: 5_000 }, (_, index) => ({
    importId: "a".repeat(64),
    sourceRowId: `statement-row-${index + 1}`,
    bank: "HDFC",
    parserVersion: "hdfc-v1-csv",
    date: "2026-09-10",
    amount: 1_234.56,
    category: "Food & Dining",
    merchant: `Representative statement merchant ${index + 1} ${"purchase detail ".repeat(5)}`,
    paymentMethod: "Bank transfer",
    note: "Reviewed from a five-thousand-row annual statement import. ".repeat(3),
    reimbursable: false,
    recurring: false,
  }));
  const reviewedImport = { expectedAccountId: "body-limit-test", rows };
  const reviewedImportBytes = Buffer.byteLength(JSON.stringify(reviewedImport));
  assert.ok(reviewedImportBytes > DEFAULT_API_JSON_LIMIT);
  assert.ok(reviewedImportBytes < BANK_STATEMENT_IMPORT_JSON_LIMIT);
  const savedFinancialData = {
    expenses: rows.map(({
      date, amount, category, merchant, paymentMethod, note, reimbursable, recurring,
    }, index) => ({
      id: `bank-statement-import-${String(index + 1).padStart(5, "0")}`,
      date,
      amount,
      category,
      merchant,
      paymentMethod,
      note,
      reimbursable,
      recurring,
    })),
  };
  const savedFinancialDataBytes = Buffer.byteLength(JSON.stringify(savedFinancialData));
  assert.ok(savedFinancialDataBytes > DEFAULT_API_JSON_LIMIT);
  assert.ok(savedFinancialDataBytes < FINANCIAL_SAVE_JSON_LIMIT);

  await withServer(async (baseUrl) => {
    const importResponse = await postJson(
      `${baseUrl}/financial-data/bank-statement-import`,
      reviewedImport,
    );
    assert.equal(importResponse.status, 401);
    assert.deepEqual(await importResponse.json(), { error: "Login required" });

    const wrongMethodResponse = await postJson(
      `${baseUrl}/financial-data/bank-statement-import`,
      reviewedImport,
      "PUT",
    );
    assert.equal(wrongMethodResponse.status, 413);
    assert.deepEqual(await wrongMethodResponse.json(), { error: "Request body is too large" });

    const saveResponse = await postJson(
      `${baseUrl}/financial-data`,
      savedFinancialData,
      "PUT",
    );
    assert.equal(saveResponse.status, 401);
    assert.deepEqual(await saveResponse.json(), { error: "Login required" });

    const wrongSaveMethodResponse = await postJson(
      `${baseUrl}/financial-data`,
      savedFinancialData,
    );
    assert.equal(wrongSaveMethodResponse.status, 413);
    assert.deepEqual(await wrongSaveMethodResponse.json(), { error: "Request body is too large" });

    const unrelatedResponse = await postJson(
      `${baseUrl}/unhandled-default-limit`,
      reviewedImport,
    );
    assert.equal(unrelatedResponse.status, 413);
    assert.deepEqual(await unrelatedResponse.json(), { error: "Request body is too large" });
  });
});

test("production middleware applies bounded route-specific JSON limits", async () => {
  const expenses = Array.from({ length: 200 }, (_, index) => ({
    id: `expense-${index}`,
    date: "2026-09-10",
    amount: index + 0.5,
    category: "Historical",
    merchant: `Merchant ${index}`,
    note: "historical expense detail ".repeat(20),
  }));
  const projectionInput = {
    assumptions: Array.from({ length: 1_400 }, (_, index) => ({
      month: `projection-${index}`,
      value: index,
      source: "historical forecast projection input",
    })),
  };
  const ordinaryDocument = { expenses };
  const restoreDocument = {
    ...ordinaryDocument,
    monthlyReports: [
      { id: "report-a", retirementForecast: { projectionInputs: projectionInput } },
      { id: "report-b", retirementForecast: { projectionInputs: projectionInput } },
    ],
  };
  assert.ok(JSON.stringify(ordinaryDocument).length > 100 * 1024);
  assert.ok(JSON.stringify(restoreDocument).length > JSON.stringify(ordinaryDocument).length);

  const report = {
    id: "monthly-report-2026-08",
    month: "2026-08",
    generatedAt: "2026-09-01T00:00:00.000Z",
    sections: Array.from({ length: 8 }, (_, index) => ({
      id: `section-${index}`,
      title: `Section ${index}`,
      metrics: Object.fromEntries(Array.from({ length: 900 }, (__, metric) =>
        [`metric-${metric}`, metric])),
      metricFormats: Object.fromEntries(Array.from({ length: 900 }, (__, metric) =>
        [`metric-${metric}`, "number"])),
      actions: [],
    })),
  };
  const reportBytes = JSON.stringify(report).length;
  assert.ok(reportBytes > 100 * 1024 && reportBytes < MONTHLY_REPORT_JSON_LIMIT);

  await withServer(async (baseUrl) => {
    assert.equal((await postJson(`${baseUrl}/financial-data/restore`, restoreDocument)).status, 401);
    assert.equal((await postJson(`${baseUrl}/financial-data`, ordinaryDocument, "PUT")).status, 401);
    assert.equal((await postJson(`${baseUrl}/financial-data/monthly-reports`, report)).status, 401);

    for (const [path, size] of [
      ["financial-data/restore", RESTORE_JSON_LIMIT],
      ["financial-data/monthly-reports", MONTHLY_REPORT_JSON_LIMIT],
      ["financial-data/bank-statement-import", BANK_STATEMENT_IMPORT_JSON_LIMIT],
      ["financial-data", FINANCIAL_SAVE_JSON_LIMIT],
      ["unhandled-default-limit", DEFAULT_API_JSON_LIMIT],
    ] as const) {
      const response = await postJson(
        `${baseUrl}/${path}`,
        { payload: "x".repeat(size + 1) },
        path === "financial-data" ? "PUT" : "POST",
      );
      assert.equal(response.status, 413);
      assert.deepEqual(await response.json(), { error: "Request body is too large" });
    }
  });
});