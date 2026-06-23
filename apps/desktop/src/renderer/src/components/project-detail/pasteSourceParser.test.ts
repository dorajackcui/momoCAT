import { describe, expect, it } from 'vitest';
import { parsePastedSources } from './pasteSourceParser';

describe('parsePastedSources', () => {
  it('reads the first column from HTML tables and preserves cell line breaks', () => {
    const html = `
      <table>
        <tbody>
          <tr><td>A<br>line 2</td><td>ignored target</td></tr>
          <tr><td> BB </td><td>ignored</td></tr>
          <tr><td></td><td>ignored empty source</td></tr>
        </tbody>
      </table>
    `;

    expect(parsePastedSources({ html, text: 'flattened text that should not win' })).toEqual([
      'A\nline 2',
      'BB',
    ]);
  });

  it('uses the first tab-separated column and skips blank first cells', () => {
    expect(
      parsePastedSources({
        html: '',
        text: 'A\ttranslated A\n\tblank source\nBB\ttranslated BB',
      }),
    ).toEqual(['A', 'BB']);
  });

  it('parses quoted TSV cells with embedded newlines', () => {
    expect(
      parsePastedSources({
        html: '',
        text: '"A\nline 2"\tignored\n"BB"\tignored',
      }),
    ).toEqual(['A\nline 2', 'BB']);
  });

  it('preserves literal quotes inside unquoted TSV source cells', () => {
    expect(
      parsePastedSources({
        html: '',
        text: 'He said "hi"\ttarget',
      }),
    ).toEqual(['He said "hi"']);
  });

  it('parses quoted CSV cells with embedded newlines only when quotes indicate CSV', () => {
    expect(
      parsePastedSources({
        html: '',
        text: '"A\nline 2",ignored\n"BB",ignored',
      }),
    ).toEqual(['A\nline 2', 'BB']);
  });

  it('parses escaped quotes inside quoted CSV source cells', () => {
    expect(
      parsePastedSources({
        html: '',
        text: '"He said ""hi""",target',
      }),
    ).toEqual(['He said "hi"']);
  });

  it('parses quoted CSV cells when delimiters are followed by spaces', () => {
    expect(
      parsePastedSources({
        html: '',
        text: '"A", B\n"CC", D',
      }),
    ).toEqual(['A', 'CC']);
  });

  it('falls back to plain text for quoted prose followed by a comma', () => {
    expect(
      parsePastedSources({
        html: '',
        text: '"Hello", she said\nAnother line',
      }),
    ).toEqual(['"Hello", she said', 'Another line']);
  });

  it('falls back to plain text lines and keeps comma text intact', () => {
    expect(
      parsePastedSources({
        html: '',
        text: 'Hello, world\n\nBB',
      }),
    ).toEqual(['Hello, world', 'BB']);
  });

  it('decodes decimal and hex HTML entities in table fallback parsing', () => {
    const originalDOMParser = globalThis.DOMParser;
    // Force the fallback parser used by non-browser tests and older runtimes.
    (globalThis as { DOMParser?: typeof DOMParser }).DOMParser = undefined;
    try {
      expect(
        parsePastedSources({
          html: '<table><tr><td>&#x4E2D;&#25991;&#160;&#38;</td></tr></table>',
          text: '',
        }),
      ).toEqual(['中文\u00A0&']);
    } finally {
      (globalThis as { DOMParser?: typeof DOMParser }).DOMParser = originalDOMParser;
    }
  });
});
