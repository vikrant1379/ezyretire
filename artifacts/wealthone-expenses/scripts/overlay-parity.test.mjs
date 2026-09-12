import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const app = new URL('../src/components/ui/', import.meta.url);
const shared = new URL('../../wealthone-design-system/src/components/ui/', import.meta.url);
const read = (base, name) => readFileSync(new URL(`${name}.tsx`, base), 'utf8');

// Compatibility exceptions are exact strings, not broad exclusions. The shared
// dialog supports a mobile width override; local dialogs retain their old width.
// Sheet padding/close offsets retain their existing appearance and touch targets.
const width = 'calc(var(--app-visual-width,100vw)-2rem-var(--app-safe-left,0px)-var(--app-safe-right,0px))';
const compatibility = new Map([
  [`!w-[var(--dialog-safe-width,${width})]`, `w-[${width}]`],
  [`lg:!w-[${width}]`, ''],
  ...['bottom', 'left', 'right', 'top'].map((side) => [
    `p${side[0]}-[calc(1.5rem+var(--app-safe-${side},0px))]`, '',
  ]),
  ['right-[calc(1rem+var(--app-safe-right,0px))]', ''],
  ['top-[calc(1rem+var(--app-safe-top,0px))]', ''],
]);
const equivalentClasses = new Map([
  ['-translate-x-1/2', 'translate-x-[-50%]'],
  ['-translate-y-1/2', 'translate-y-[-50%]'],
]);

function safetyClasses(text) {
  return text.split(/\s+/).map((token) => compatibility.get(token) ?? equivalentClasses.get(token) ?? token)
    .filter((token) => /--app-|--dialog-|--radix-.*(?:height|width)|(?:^|:)!?(?:overflow-|max-h-|min-h-)|overscroll-|^(?:fixed|relative|z-\d+|translate-[xy]-)/.test(token))
    .sort();
}

// Inspect JSX structurally, not formatting. Keep portal ancestry, ordered
// attributes (including spread order), refs, handlers and collision options.
// Cosmetic classes and icon/header styling intentionally remain app-specific.
function contract(source) {
  const file = ts.createSourceFile('overlay.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result = [];
  const printer = ts.createPrinter({ removeComments: true });
  const print = (node) => printer.printNode(ts.EmitHint.Unspecified, node, file).replaceAll("'", '"').replace(/\s+/g, '');
  function visit(node, ancestry = []) {
    if (ts.isJsxElement(node)) {
      visit(node.openingElement, ancestry);
      const tag = node.openingElement.tagName.getText(file);
      for (const child of node.children) visit(child, [...ancestry, tag]);
      return;
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(file);
      if (/(?:Portal|Overlay|Content|Viewport|ScrollUpButton|ScrollDownButton|Primitive.Close)$/.test(tag)) {
        const attributes = node.attributes.properties.map((attribute) => {
          if (ts.isJsxAttribute(attribute) && attribute.name.getText(file) === 'className') {
            const classes = [];
            const strings = (n) => {
              if (ts.isStringLiteral(n)) classes.push(...safetyClasses(n.text));
              ts.forEachChild(n, strings);
            };
            strings(attribute);
            return ['className', classes.sort()];
          }
          return print(attribute);
        });
        result.push({ tag, ancestry, attributes });
      }
    }
    // Sheet placement lives in cva rather than the Content JSX.
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'sheetVariants') {
      const classes = [];
      const strings = (n) => {
        if (ts.isStringLiteral(n)) classes.push(safetyClasses(n.text));
        ts.forEachChild(n, strings);
      };
      strings(node);
      result.push({ sheetVariants: classes });
    }
    ts.forEachChild(node, (child) => visit(child, ancestry));
  }
  visit(file);
  return result;
}

test('compatibility exceptions remain explicit and cannot silently expand or disappear', () => {
  for (const name of ['dialog', 'alert-dialog', 'sheet', 'select']) {
    const strings = (source) => {
      const tokens = [];
      const file = ts.createSourceFile('overlay.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node) => {
        if (ts.isStringLiteral(node)) tokens.push(...node.text.split(/\s+/));
        ts.forEachChild(node, visit);
      };
      visit(file);
      return tokens;
    };
    for (const [base, canonical] of [[shared, true], [app, false]]) {
      const tokens = strings(read(base, name));
      for (const token of compatibility.keys()) {
        const isWidth = token.includes('--dialog-safe-width') || token.startsWith('lg:!w-');
        const expected = canonical && (isWidth ? name.includes('dialog') : name === 'sheet') ? 1 : 0;
        assert.equal(tokens.filter((value) => value === token).length, expected, `${name}: ${token}`);
      }
    }
  }
});

for (const name of ['dialog', 'alert-dialog', 'sheet', 'select']) {
  test(`${name}: local viewport, scroll and portal contract matches canonical`, () => {
    const canonical = contract(read(shared, name));
    assert.ok(canonical.some((entry) => entry.tag?.endsWith('Content')));
    assert.deepEqual(contract(read(app, name)), canonical);
  });
}

test('popover remains a direct canonical re-export with the same public API', () => {
  const source = ts.createSourceFile('popover.tsx', read(app, 'popover'), ts.ScriptTarget.Latest, true);
  assert.equal(source.statements.length, 1);
  const statement = source.statements[0];
  assert.ok(ts.isExportDeclaration(statement));
  assert.equal(statement.moduleSpecifier.text, '@workspace/wealthone-design-system/components/ui/popover');
  assert.deepEqual(statement.exportClause.elements.map((element) => element.name.text).sort(),
    ['Popover', 'PopoverAnchor', 'PopoverContent', 'PopoverTrigger']);
});

test('parity guard detects bounds, scroll, portal and prop regressions', () => {
  const source = read(shared, 'select');
  for (const [from, to] of [
    ['--app-visual-height', '--incorrect-height'],
    ['--app-safe-top', '--incorrect-safe-top'],
    ['overflow-y-auto', 'overflow-hidden'],
    ['overscroll-contain', 'overscroll-auto'],
    ['relative z-50', 'relative z-50 max-h-screen'],
    ['SelectPrimitive.Portal', 'div'],
    ['collisionPadding={16}', 'collisionPadding={0}'],
    ['ref={ref}', 'ref={undefined}'],
    ['{...props}', ''],
  ]) {
    assert.notEqual(source.replaceAll(from, to), source, `mutation must apply: ${from}`);
    assert.notDeepEqual(contract(source.replaceAll(from, to)), contract(source), from);
  }
});