import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitialEntryJsReport } from './initial-entry-js-budget.mjs';

const bundle = {
  'assets/index.js': {
    type: 'chunk',
    fileName: 'assets/index.js',
    code: '12345',
    isEntry: true,
    isDynamicEntry: false,
    imports: ['assets/shared.js'],
    viteMetadata: { importedCss: new Set(['assets/index.css']) },
  },
  'assets/shared.js': {
    type: 'chunk',
    fileName: 'assets/shared.js',
    code: 'x'.repeat(1_000),
    isEntry: false,
    isDynamicEntry: false,
  },
  'assets/page.js': {
    type: 'chunk',
    fileName: 'assets/page.js',
    code: 'x'.repeat(2_000),
    isEntry: false,
    isDynamicEntry: true,
  },
  'assets/index.css': {
    type: 'asset',
    fileName: 'assets/index.css',
    source: 'x'.repeat(3_000),
  },
};

test('checks the raw entry and compressed initial JS, CSS, and request budgets', () => {
  const report = createInitialEntryJsReport(bundle, 5, {
    gzipJsBudgetBytes: 2_000,
    gzipCssBudgetBytes: 2_000,
    requestBudget: 3,
  });

  assert.equal(report.scope, 'initial-entry-and-static-dependencies');
  assert.equal(report.initialEntryJavaScript.sizeBytes, 5);
  assert.equal(report.withinBudget, true);
  assert.deepEqual(report.initialJavaScript.map(({ fileName }) => fileName), [
    'assets/index.js',
    'assets/shared.js',
  ]);
  assert.equal(report.initialCss[0].fileName, 'assets/index.css');
  assert.equal(report.totals.assetRequests, 3);
  assert.deepEqual(
    report.chunks.map(({ kind }) => kind),
    [
      'initial-entry-javascript',
      'lazy-entry-javascript',
      'shared-javascript',
    ],
  );
});

test('fails the budget when the initial JavaScript entry is too large', () => {
  const report = createInitialEntryJsReport(bundle, 4);

  assert.equal(report.withinBudget, false);
  assert.equal(report.initialEntryJavaScript.fileName, 'assets/index.js');
});

test('fails independently when the initial request budget is exceeded', () => {
  const report = createInitialEntryJsReport(bundle, 5, {
    gzipJsBudgetBytes: 2_000,
    gzipCssBudgetBytes: 2_000,
    requestBudget: 2,
  });
  assert.equal(report.withinBudget, false);
});