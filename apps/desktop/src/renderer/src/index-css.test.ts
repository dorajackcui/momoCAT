import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('renderer editor typography CSS', () => {
  it('uses a stronger shared text weight for source and target cells', () => {
    const css = readFileSync(resolve(__dirname, 'index.css'), 'utf8');

    expect(css).toContain('--font-weight-editor-text: 500;');
    expect(css).toContain('font-weight: var(--font-weight-editor-text);');
  });

  it('keeps target text close to the segment start', () => {
    const css = readFileSync(resolve(__dirname, 'index.css'), 'utf8');

    expect(css).toContain('@apply editor-text-base pl-0.5 pr-12 py-0.5;');
    expect(css).not.toContain('@apply editor-text-base pl-1.5 pr-12 py-0.5;');
  });

  it('keeps a subtle but visible scroll position marker in the editor', () => {
    const css = readFileSync(resolve(__dirname, 'index.css'), 'utf8');

    expect(css).toContain('.editor-scrollbar {');
    expect(css).toContain('scrollbar-color: rgb(var(--color-text-faint) / 0.16) transparent;');
    expect(css).toContain('.editor-scrollbar:hover {');
    expect(css).toContain('scrollbar-color: rgb(var(--color-text-faint) / 0.46) transparent;');
    expect(css).toContain('.editor-scrollbar::-webkit-scrollbar-thumb {');
    expect(css).toContain('background-color: rgb(var(--color-text-faint) / 0.16);');
    expect(css).toContain('.editor-scrollbar::-webkit-scrollbar-thumb:active {');
    expect(css).toContain('border-radius: 999px;');
    expect(css).not.toContain('rgba(var(--color-text-faint),');
  });
});
