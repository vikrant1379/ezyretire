import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("monthly report print rules exclude application chrome and unselected reports", async () => {
  const css = await readFile(
    new URL("../src/index.css", import.meta.url),
    "utf8",
  );
  const reports = await readFile(
    new URL("../src/components/planner/reports-view.tsx", import.meta.url),
    "utf8",
  );
  const planner = await readFile(
    new URL("../src/pages/planner.tsx", import.meta.url),
    "utf8",
  );

  assert.match(css, /body\[data-monthly-report-print="true"\] \[data-testid="desktop-sidebar"\]/);
  assert.match(css, /body\[data-monthly-report-print="true"\] \[data-testid="mobile-header"\]/);
  assert.match(css, /body\[data-monthly-report-print="true"\] \[data-testid="mobile-bottom-navigation"\]/);
  assert.match(css, /body\[data-monthly-report-print="true"\] \[data-app-toast-viewport="true"\]/);
  assert.match(css, /\.monthly-report-card:not\(\[data-print-selected="true"\]\)/);
  assert.match(reports, /document\.body\.dataset\.monthlyReportPrint = "true"/);
  assert.match(reports, /data-print-selected=\{printingId === report\.id/);
  assert.match(planner, /data-testid="planner-heading"[\s\S]*?print:hidden/);
  assert.match(planner, /TabsList className="[^"]*print:hidden/);
});