// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseSegmentClipboard, serializeSegmentClipboard } from './segmentClipboard';

describe('segment clipboard formats', () => {
  it('round trips bilingual rows with tags, tabs, quotes, newlines, whitespace and empty targets', () => {
    const rows: [string, string][] = [
      ['<b>& source', ' First\nsecond\t"quoted" '],
      ['source 2', ''],
    ];
    const data = serializeSegmentClipboard(rows);
    expect(data.html).toContain('&lt;b&gt;&amp; source');
    expect(parseSegmentClipboard(data)).toEqual({
      kind: 'rows',
      targets: rows.map((row) => row[1]),
    });
    expect(parseSegmentClipboard({ ...data, html: '' })).toEqual({
      kind: 'rows',
      targets: rows.map((row) => row[1]),
    });
  });

  it('distinguishes spreadsheet rows from embedded line breaks without discarding blank cells', () => {
    expect(
      parseSegmentClipboard({
        text: '',
        html: '<table><tr><td>A<br>B</td></tr><tr><td></td></tr><tr><td><div>C</div><div>D</div></td></tr></table>',
      }),
    ).toEqual({ kind: 'rows', targets: ['A\nB', '', 'C\nD'] });
    expect(parseSegmentClipboard({ text: '"A\r\nB"\r\n""\r\nC\r\n', html: '' })).toEqual({
      kind: 'rows',
      targets: ['A\nB', '', 'C'],
    });
  });

  it('leaves ordinary multiline text ambiguous and preserves literal quotes', () => {
    expect(parseSegmentClipboard({ text: '"Hello"\r\n\r\nWorld\r\n', html: '' })).toEqual({
      kind: 'text',
      text: '"Hello"\n\nWorld\n',
      lines: ['"Hello"', '', 'World'],
    });
  });

  it.each([
    '<table><tr><td colspan="2">merged</td></tr></table>',
    '<table><tr><td>A</td><td>B</td><td>C</td></tr></table>',
    '<table><tr><td>A</td></tr><tr><td>B</td><td>C</td></tr></table>',
  ])('rejects unsupported tables without silently losing columns', (html) => {
    expect(() => parseSegmentClipboard({ text: 'fallback', html })).toThrow();
  });

  it('rejects incomplete TSV quoting', () => {
    expect(() => parseSegmentClipboard({ text: 'source\t"unfinished\nnext', html: '' })).toThrow(
      /incomplete/,
    );
  });
});
