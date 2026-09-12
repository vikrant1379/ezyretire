import { brotliCompressSync, gzipSync } from 'node:zlib';

const DEFAULT_INITIAL_ENTRY_JS_BUDGET_BYTES = 450 * 1024;
const DEFAULT_INITIAL_GZIP_JS_BUDGET_BYTES = 190 * 1024;
const DEFAULT_INITIAL_GZIP_CSS_BUDGET_BYTES = 45 * 1024;
const DEFAULT_INITIAL_ASSET_REQUEST_BUDGET = 12;

function positiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, received "${value}".`);
  }
  return parsed;
}

function compressedSizes(source) {
  const bytes = Buffer.from(typeof source === 'string' ? source : source);
  return {
    rawBytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(bytes).byteLength,
  };
}

export function createInitialEntryJsReport(bundle, configuredBudget, options = {}) {
  const budgetBytes = positiveInteger(
    configuredBudget,
    DEFAULT_INITIAL_ENTRY_JS_BUDGET_BYTES,
    'INITIAL_ENTRY_JS_BUDGET_BYTES',
  );
  const gzipJsBudgetBytes = positiveInteger(
    options.gzipJsBudgetBytes,
    DEFAULT_INITIAL_GZIP_JS_BUDGET_BYTES,
    'INITIAL_GZIP_JS_BUDGET_BYTES',
  );
  const gzipCssBudgetBytes = positiveInteger(
    options.gzipCssBudgetBytes,
    DEFAULT_INITIAL_GZIP_CSS_BUDGET_BYTES,
    'INITIAL_GZIP_CSS_BUDGET_BYTES',
  );
  const requestBudget = positiveInteger(
    options.requestBudget,
    DEFAULT_INITIAL_ASSET_REQUEST_BUDGET,
    'INITIAL_ASSET_REQUEST_BUDGET',
  );

  const chunks = Object.values(bundle)
    .filter((output) => output.type === 'chunk')
    .map((chunk) => ({
      fileName: chunk.fileName,
      sizeBytes: Buffer.byteLength(chunk.code),
      kind: chunk.isEntry
        ? 'initial-entry-javascript'
        : chunk.isDynamicEntry
          ? 'lazy-entry-javascript'
          : 'shared-javascript',
    }))
    .sort((left, right) => left.fileName.localeCompare(right.fileName));
  const initialEntries = chunks.filter(
    (chunk) => chunk.kind === 'initial-entry-javascript',
  );

  if (initialEntries.length !== 1) {
    throw new Error(
      `Expected exactly one initial JavaScript entry chunk, found ${initialEntries.length}.`,
    );
  }

  const initialEntryJavaScript = initialEntries[0];
  const initialChunkNames = new Set();
  const visitChunk = (fileName) => {
    if (initialChunkNames.has(fileName)) return;
    const chunk = bundle[fileName];
    if (!chunk || chunk.type !== 'chunk') return;
    initialChunkNames.add(fileName);
    for (const imported of chunk.imports ?? []) visitChunk(imported);
  };
  visitChunk(initialEntryJavaScript.fileName);

  const initialCssNames = new Set();
  for (const fileName of initialChunkNames) {
    const chunk = bundle[fileName];
    for (const css of chunk.viteMetadata?.importedCss ?? []) initialCssNames.add(css);
  }
  const initialJavaScript = [...initialChunkNames].sort().map((fileName) => ({
    fileName,
    ...compressedSizes(bundle[fileName].code),
  }));
  const initialCss = [...initialCssNames].sort().map((fileName) => ({
    fileName,
    ...compressedSizes(bundle[fileName].source),
  }));
  const totals = {
    javascriptGzipBytes: initialJavaScript.reduce((sum, asset) => sum + asset.gzipBytes, 0),
    cssGzipBytes: initialCss.reduce((sum, asset) => sum + asset.gzipBytes, 0),
    javascriptBrotliBytes: initialJavaScript.reduce((sum, asset) => sum + asset.brotliBytes, 0),
    cssBrotliBytes: initialCss.reduce((sum, asset) => sum + asset.brotliBytes, 0),
    assetRequests: initialJavaScript.length + initialCss.length,
  };
  const budgets = { gzipJsBudgetBytes, gzipCssBudgetBytes, requestBudget };
  const compressedWithinBudget =
    totals.javascriptGzipBytes <= gzipJsBudgetBytes
    && totals.cssGzipBytes <= gzipCssBudgetBytes
    && totals.assetRequests <= requestBudget;

  return {
    schemaVersion: 2,
    scope: 'initial-entry-and-static-dependencies',
    excludes: [
      'lazy JavaScript chunks',
      'CSS referenced only by lazy chunks',
      'images, fonts, and other non-JS/CSS assets',
    ],
    budgetBytes,
    initialEntryJavaScript,
    initialJavaScript,
    initialCss,
    totals,
    budgets,
    withinBudget:
      initialEntryJavaScript.sizeBytes <= budgetBytes && compressedWithinBudget,
    chunks,
  };
}

export function initialEntryJsBudget() {
  return {
    name: 'initial-entry-js-budget',
    apply: 'build',
    generateBundle(_, bundle) {
      let report;

      try {
        report = createInitialEntryJsReport(
          bundle,
          process.env.INITIAL_ENTRY_JS_BUDGET_BYTES,
          {
            gzipJsBudgetBytes: process.env.INITIAL_GZIP_JS_BUDGET_BYTES,
            gzipCssBudgetBytes: process.env.INITIAL_GZIP_CSS_BUDGET_BYTES,
            requestBudget: process.env.INITIAL_ASSET_REQUEST_BUDGET,
          },
        );
      } catch (error) {
        this.error(error instanceof Error ? error.message : String(error));
      }

      this.emitFile({
        type: 'asset',
        fileName: 'initial-entry-js-budget-report.json',
        source: `${JSON.stringify(report, null, 2)}\n`,
      });
      console.log(`INITIAL_ENTRY_JS_BUDGET_REPORT ${JSON.stringify(report)}`);

      if (!report.withinBudget) {
        this.error(
          `Initial asset budget exceeded: raw entry ${report.initialEntryJavaScript.sizeBytes}/${report.budgetBytes} bytes; gzip JS ${report.totals.javascriptGzipBytes}/${report.budgets.gzipJsBudgetBytes}; gzip CSS ${report.totals.cssGzipBytes}/${report.budgets.gzipCssBudgetBytes}; requests ${report.totals.assetRequests}/${report.budgets.requestBudget}.`,
        );
      }
    },
  };
}