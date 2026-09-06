const DEFAULT_INITIAL_ENTRY_JS_BUDGET_BYTES = 450 * 1024;

export function createInitialEntryJsReport(bundle, configuredBudget) {
  const budgetBytes = Number(
    configuredBudget ?? DEFAULT_INITIAL_ENTRY_JS_BUDGET_BYTES,
  );

  if (!Number.isSafeInteger(budgetBytes) || budgetBytes <= 0) {
    throw new Error(
      `INITIAL_ENTRY_JS_BUDGET_BYTES must be a positive integer, received "${configuredBudget}".`,
    );
  }

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

  return {
    schemaVersion: 1,
    scope: 'initial-entry-javascript-only',
    excludes: [
      'lazy JavaScript chunks',
      'shared JavaScript chunks',
      'stylesheets and other assets',
    ],
    budgetBytes,
    initialEntryJavaScript,
    withinBudget: initialEntryJavaScript.sizeBytes <= budgetBytes,
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
          `Initial JavaScript entry ${report.initialEntryJavaScript.fileName} is ${report.initialEntryJavaScript.sizeBytes} bytes, exceeding the ${report.budgetBytes}-byte budget.`,
        );
      }
    },
  };
}