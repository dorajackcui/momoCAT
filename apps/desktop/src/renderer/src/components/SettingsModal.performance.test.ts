import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rendererRoot = resolve(__dirname, '..');

function readRendererFile(path: string): string {
  return readFileSync(resolve(rendererRoot, path), 'utf8');
}

describe('SettingsModal rendering performance guard', () => {
  it('uses a non-blurred backdrop so typing in inputs does not repaint through backdrop-filter', () => {
    const component = readRendererFile('components/SettingsModal.tsx');
    const css = readRendererFile('index.css');

    expect(component).toContain('settings-modal-backdrop');
    expect(css).toContain('.settings-modal-backdrop');

    const classBlock = css.match(/\.settings-modal-backdrop\s*\{[^}]*\}/s)?.[0] ?? '';
    expect(classBlock).not.toContain('backdrop-blur');
    expect(classBlock).not.toContain('backdrop-filter');
  });
});
