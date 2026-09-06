import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const WHOLE_DOCUMENT_SAVES = new Set([
  "saveFinancialData",
  "updateFinancialData",
]);
const APPROVED_FILES = new Set([
  "src/hooks/use-financial-write.ts",
  "src/hooks/use-ui-preferences.ts",
  "src/lib/financial-api.ts",
]);

function isProductionSource(relativePath) {
  return (
    /\.(?:ts|tsx)$/.test(relativePath) &&
    !/(?:^|\/)(?:__tests__|test-fixtures)(?:\/|$)/.test(relativePath) &&
    !/\.(?:test|spec)\.(?:ts|tsx)$/.test(relativePath)
  );
}

async function sourceFiles(directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(absolutePath, root);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
      return isProductionSource(relativePath) ? [absolutePath] : [];
    }),
  );
  return files.flat();
}

function financialApiImport(moduleSpecifier) {
  return /(?:^|\/)financial-api(?:\.ts)?$/.test(moduleSpecifier);
}

export function findUnsafeFinancialSaveCalls(source, fileName = "source.ts") {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const directImports = new Map();
  const namespaceImports = new Set();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !financialApiImport(statement.moduleSpecifier.text)
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text;
        if (WHOLE_DOCUMENT_SAVES.has(importedName)) {
          directImports.set(element.name.text, importedName);
        }
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      namespaceImports.add(bindings.name.text);
    }
  }

  const violations = [];
  function visit(node) {
    if (ts.isCallExpression(node)) {
      let apiName;
      if (ts.isIdentifier(node.expression)) {
        apiName = directImports.get(node.expression.text);
      } else if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        namespaceImports.has(node.expression.expression.text) &&
        WHOLE_DOCUMENT_SAVES.has(node.expression.name.text)
      ) {
        apiName = node.expression.name.text;
      }
      if (apiName) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.expression.getStart());
        violations.push({
          apiName,
          line: position.line + 1,
          column: position.character + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return violations;
}

export async function checkFinancialSaveArchitecture(projectRoot) {
  const srcRoot = path.join(projectRoot, "src");
  const violations = [];
  for (const file of await sourceFiles(srcRoot, projectRoot)) {
    const relativePath = path.relative(projectRoot, file).split(path.sep).join("/");
    if (APPROVED_FILES.has(relativePath)) continue;
    const source = await readFile(file, "utf8");
    for (const violation of findUnsafeFinancialSaveCalls(source, relativePath)) {
      violations.push({ relativePath, ...violation });
    }
  }
  return violations;
}

export function formatArchitectureFailure(violations) {
  const locations = violations
    .map(
      ({ relativePath, line, column, apiName }) =>
        `  - ${relativePath}:${line}:${column} calls ${apiName}`,
    )
    .join("\n");
  return [
    "Whole-document financial saves must not bypass account-switch protection.",
    locations,
    "Route the save through the shared account-switch save coordinator in",
    "src/hooks/use-financial-write.ts or src/hooks/use-ui-preferences.ts.",
  ].join("\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const violations = await checkFinancialSaveArchitecture(projectRoot);
  if (violations.length > 0) {
    console.error(formatArchitectureFailure(violations));
    process.exitCode = 1;
  }
}