import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const controls =
  /^(Button|IconButton|ControlGroup|ToggleButton|ChoiceGroup|MenuItem|Input|SearchInput|SearchInputGroup|Select|LanguageSelect|Textarea|Checkbox|Radio)$/;
// Pages own layout/visibility and content typography, but not control appearance.
const controlStyles =
  /(?:^|[\s'"`:{])!?(?:bg-|border(?:-|\b)|rounded(?:-|\b)|shadow(?:-|\b)|ring(?:-|\b)|outline(?:-|\b)|accent-|p[xytrblse]?-|text-(?!left\b|right\b|center\b|justify\b|ellipsis\b|wrap\b|nowrap\b)|font-(?!mono\b)|transition(?:-|\b)|disabled:)/;

function controlViolations(
  relative: string,
  source: ts.SourceFile,
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
) {
  let tag = node.tagName.getText(source);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      const imported = bindings.elements.find((item) => item.name.text === tag);
      if (imported?.propertyName) tag = imported.propertyName.text;
    }
  }
  const attributes = new Map(
    node.attributes.properties
      .filter(ts.isJsxAttribute)
      .map((a) => [a.name.getText(source), a.initializer]),
  );
  const cls = attributes.get('className')?.getText(source) ?? '';
  // Deliberate domain owners: workspace navigation and resize handle.
  const domainButton =
    (relative === 'components/WorkspaceSidebar.tsx' &&
      /^"workspace-(nav-item|project-more|brand|project-heading)"$/.test(cls)) ||
    (relative === 'components/editor/EditorSidebar.tsx' &&
      attributes.get('aria-label')?.getText(source) === '"Resize sidebar"');
  const errors: string[] = [];
  if (tag === 'button' && !domainButton) errors.push('use Button or IconButton');
  if (controls.test(tag)) {
    if (controlStyles.test(cls) || attributes.has('style'))
      errors.push('express control appearance through its props');
    if (tag === 'IconButton' && /\b(?:h|w|size)-/.test(cls)) errors.push('use IconButton size');
  }
  return errors;
}

it('keeps primitive dependencies and standard control markup in the UI owner layer', () => {
  const root = path.resolve('apps/desktop/src/renderer/src');
  const violations: string[] = [];
  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(file);
        continue;
      }
      const relative = path.relative(root, file).replaceAll('\\', '/');
      if (
        !/\.tsx?$/.test(file) ||
        relative.startsWith('components/ui/') ||
        /\.test\.tsx?$/.test(file)
      )
        continue;
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node) => {
        if (
          ts.isImportDeclaration(node) &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          /^(@radix-ui\/|@floating-ui\/|class-variance-authority$)/.test(node.moduleSpecifier.text)
        ) {
          violations.push(`${relative}: import primitives through components/ui`);
        }
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          violations.push(
            ...controlViolations(relative, source, node).map((error) => `${relative}: ${error}`),
          );
          if (/^(input|select|textarea)$/.test(node.tagName.getText(source)))
            violations.push(`${relative}: use the shared form control`);
          for (const attribute of node.attributes.properties) {
            if (!ts.isJsxAttribute(attribute) || !attribute.initializer) continue;
            if (
              attribute.name.getText(source) === 'className' &&
              /\b(modal-backdrop|modal-card|btn-[\w-]+|icon-btn[\w-]*|field-input[\w-]*|ui-button[\w-]*|ui-field[\w-]*|ui-size-[\w-]+|ui-choice[\w-]*|ui-menu-item)\b/.test(
                attribute.initializer.getText(source),
              )
            ) {
              violations.push(
                `${relative}: use the shared control instead of its internal classes`,
              );
            }
            if (
              attribute.name.getText(source) === 'role' &&
              ts.isStringLiteral(attribute.initializer) &&
              /^(dialog|menu|menuitem|tab|tablist|tabpanel)$/.test(attribute.initializer.text)
            ) {
              violations.push(`${relative}: use the shared dialog, menu or tabs`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  walk(root);
  expect(violations).toEqual([]);
});

it('rejects local control styles while allowing page layout classes', () => {
  function check(markup: string) {
    const source = ts.createSourceFile('example.tsx', markup, ts.ScriptTarget.Latest, true);
    const errors: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
        errors.push(...controlViolations('example.tsx', source, node));
      ts.forEachChild(node, visit);
    }
    visit(source);
    return errors;
  }
  for (const markup of [
    '<button onClick={save}>Save</button>',
    '<Input className="bg-surface rounded-lg focus:ring-2" />',
    '<Button className={active ? "text-brand" : "text-text-muted"}>Save</Button>',
    '<Input style={{ borderRadius: 8 }} />',
    '<IconButton className="h-9 w-9" />',
    '<LanguageSelect className="!px-2" />',
    'import { Input as RenamedInput } from "./ui"; <RenamedInput className="bg-surface" />',
  ])
    expect(check(markup)).not.toEqual([]);
  expect(check('<SearchInput className="flex-1 min-w-0 mt-2" />')).toEqual([]);
});
