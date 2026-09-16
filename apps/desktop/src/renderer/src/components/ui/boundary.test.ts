import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

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
          /^(@radix-ui\/|@floating-ui\/)/.test(node.moduleSpecifier.text)
        ) {
          violations.push(`${relative}: import primitives through components/ui`);
        }
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          if (/^(input|select|textarea)$/.test(node.tagName.getText(source)))
            violations.push(`${relative}: use the shared form control`);
          for (const attribute of node.attributes.properties) {
            if (!ts.isJsxAttribute(attribute) || !attribute.initializer) continue;
            if (
              attribute.name.getText(source) === 'className' &&
              /\b(modal-backdrop|modal-card|btn-primary|btn-secondary|btn-soft|btn-danger|btn-ghost|field-input)\b/.test(
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
