import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkFinancialSaveArchitecture,
  findUnsafeFinancialSaveCalls,
  formatArchitectureFailure,
} from "./check-financial-save-architecture.mjs";

test("finds named, aliased, and namespace whole-document save calls", () => {
  const source = `
    import {
      saveFinancialData as replaceEverything,
      updateFinancialData
    } from "@/lib/financial-api";
    import * as financialApi from "../lib/financial-api.ts";
    replaceEverything(data);
    updateFinancialData(current => current);
    financialApi.saveFinancialData(data);
  `;

  assert.deepEqual(
    findUnsafeFinancialSaveCalls(source, "unsafe.ts").map(({ apiName }) => apiName),
    ["saveFinancialData", "updateFinancialData", "saveFinancialData"],
  );
});

test("ignores harmless imports and unrelated functions with the same name", () => {
  const source = `
    import { saveFinancialData, type FinancialData } from "@/lib/financial-api";
    import { updateFinancialData as updateOtherData } from "@/lib/other-api";
    type Save = typeof saveFinancialData;
    updateOtherData();
  `;

  assert.deepEqual(findUnsafeFinancialSaveCalls(source), []);
});

test("allows implementation, approved hooks, and test fixtures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "save-architecture-"));
  try {
    const files = {
      "src/lib/financial-api.ts": `saveFinancialData(data);`,
      "src/hooks/use-financial-write.ts": `
        import { saveFinancialData } from "@/lib/financial-api";
        saveFinancialData(data);
      `,
      "src/hooks/use-ui-preferences.ts": `
        import { updateFinancialData } from "@/lib/financial-api";
        updateFinancialData(update);
      `,
      "src/components/example.test.ts": `
        import { saveFinancialData } from "@/lib/financial-api";
        saveFinancialData(data);
      `,
      "src/test-fixtures/direct-save.ts": `
        import { saveFinancialData } from "@/lib/financial-api";
        saveFinancialData(data);
      `,
    };
    await Promise.all(
      Object.entries(files).map(async ([relativePath, source]) => {
        const file = path.join(root, relativePath);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, source);
      }),
    );

    assert.deepEqual(await checkFinancialSaveArchitecture(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports the production call site and points to the shared coordinator hooks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "save-architecture-"));
  try {
    const file = path.join(root, "src/components/unsafe.tsx");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      `import { saveFinancialData } from "@/lib/financial-api";\nsaveFinancialData(data);\n`,
    );

    const violations = await checkFinancialSaveArchitecture(root);
    assert.deepEqual(violations, [
      {
        relativePath: "src/components/unsafe.tsx",
        apiName: "saveFinancialData",
        line: 2,
        column: 1,
      },
    ]);
    assert.match(formatArchitectureFailure(violations), /account-switch save coordinator/);
    assert.match(formatArchitectureFailure(violations), /use-financial-write\.ts/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});