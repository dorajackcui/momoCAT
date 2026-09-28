export interface SegmentClipboardData {
  text: string;
  html: string;
}

export type ParsedSegmentClipboard =
  | { kind: 'rows'; targets: string[] }
  | { kind: 'text'; text: string; lines: string[] };

const normalizeLines = (text: string) => text.replace(/\r\n?/g, '\n');
const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function serializeSegmentClipboard(
  rows: readonly (readonly [string, string])[],
): SegmentClipboardData {
  const quote = (value: string) =>
    /[\t\r\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return {
    text: rows.map((row) => row.map(quote).join('\t')).join('\n'),
    html: `<table data-momocat-clipboard="source-target"><tbody>${rows
      .map(
        (row) =>
          `<tr>${row.map((cell) => `<td style="white-space: pre-wrap">${escapeHtml(normalizeLines(cell)).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`,
      )
      .join('')}</tbody></table>`,
  };
}

function targetsFromTable(rows: string[][]): string[] {
  const width = rows[0]?.length;
  if (!width || width > 2 || rows.some((row) => row.length !== width)) {
    throw new Error('Paste one Target column or two columns (Source and Target).');
  }
  return rows.map((row) => row[width - 1]);
}

function readHtmlTable(html: string): string[][] | null {
  if (!html) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const tables = doc.querySelectorAll('table');
  if (!tables.length) return null;
  if (tables.length !== 1) throw new Error('Copy a single table without nested tables.');
  const rows = Array.from(tables[0].querySelectorAll('tr')).map((row) =>
    Array.from(row.children)
      .filter((cell) => cell.matches('td, th'))
      .map((cell) => {
        if (
          Number(cell.getAttribute('rowspan') || 1) !== 1 ||
          Number(cell.getAttribute('colspan') || 1) !== 1
        ) {
          throw new Error('Merged cells cannot be pasted into segments.');
        }
        const clone = cell.cloneNode(true) as Element;
        clone.querySelectorAll('script, style').forEach((node) => node.remove());
        clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
        clone.querySelectorAll('p, div').forEach((block) => {
          if (block.nextSibling) block.append('\n');
        });
        return normalizeLines(clone.textContent || '');
      }),
  );
  return rows;
}

// Quotes protect tabs and line breaks inside spreadsheet cells. A terminal
// record separator is not an extra empty row; explicit empty cells are retained.
function readTsv(text: string): { rows: string[][]; structured: boolean } | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  let structured = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        cell += char;
        if (char === '\n' || char === '\t') structured = true;
      }
    } else if (char === '\t' || char === '\n') {
      row.push(cell);
      cell = '';
      closed = false;
      if (char === '\t') structured = true;
      else {
        rows.push(row);
        row = [];
      }
    } else if (closed) {
      return null;
    } else if (char === '"' && cell.length === 0) {
      quoted = true;
    } else {
      cell += char;
    }
  }
  if (quoted) return null;
  if (row.length || cell.length || closed || !text.endsWith('\n')) rows.push([...row, cell]);
  return { rows, structured };
}

export function parseSegmentClipboard({
  text,
  html,
}: SegmentClipboardData): ParsedSegmentClipboard {
  const table = readHtmlTable(html);
  if (table) return { kind: 'rows', targets: targetsFromTable(table) };
  const normalized = normalizeLines(text);
  const tsv = readTsv(normalized);
  if (tsv?.structured) return { kind: 'rows', targets: targetsFromTable(tsv.rows) };
  if (!tsv && normalized.includes('\t'))
    throw new Error('The copied table has incomplete quoted cells.');
  const lines = normalized.split('\n');
  if (normalized.endsWith('\n')) lines.pop();
  return { kind: 'text', text: normalized, lines };
}
