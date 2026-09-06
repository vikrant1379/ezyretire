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

test('checks only the initial JavaScript entry against the budget', () => {
  const report = createInitialEntryJsReport(bundle, 5);

  assert.equal(report.scope, 'initial-entry-javascript-only');
  assert.equal(report.initialEntryJavaScript.sizeBytes, 5);
  assert.equal(report.withinBudget, true);
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