export interface PastedClipboardData {
  html?: string;
  text?: string;
}

export function parsePastedSources(data: PastedClipboardData): string[] {
  const htmlSources = parseHtmlTableSources(data.html || '');
  if (htmlSources.length > 0) return htmlSources;

  const text = data.text || '';
  const tableTextSources = parseStructuredTextSources(text);
  if (tableTextSources.length > 0) return tableTextSources;

  return normalizeSourceCells(text.split(/\r\n|\n|\r/));
}

function parseHtmlTableSources(html: string): string[] {
  if (!html.trim()) return [];
  if (typeof DOMParser === 'undefined') return parseHtmlTableSourcesFromMarkup(html);

  const document = new DOMParser().parseFromString(html, 'text/html');
  const rows = Array.from(document.querySelectorAll('tr'));
  if (rows.length === 0) return [];

  return normalizeSourceCells(
    rows.map((row) => {
      const firstCell = row.querySelector('td,th');
      return firstCell ? getHtmlCellText(firstCell) : '';
    }),
  );
}

function getHtmlCellText(cell: Element): string {
  const clone = cell.cloneNode(true) as Element;
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  return clone.textContent || '';
}

function parseHtmlTableSourcesFromMarkup(html: string): string[] {
  const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  if (rows.length === 0) return [];

  return normalizeSourceCells(
    rows.map((row) => {
      const firstCell = row.match(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/i);
      return firstCell ? getHtmlMarkupCellText(firstCell[1]) : '';
    }),
  );
}

function getHtmlMarkupCellText(cellHtml: string): string {
  return decodeHtmlEntities(
    cellHtml
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  );
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, value: string) => decodeCodePoint(value, 16))
    .replace(/&#(\d+);/g, (_match, value: string) => decodeCodePoint(value, 10));
}

function parseStructuredTextSources(text: string): string[] {
  if (!text.trim()) return [];

  if (text.includes('\t')) {
    return normalizeSourceCells(parseDelimitedRows(text, '\t').map((row) => row[0] || ''));
  }

  if (looksLikeQuotedCsv(text)) {
    return normalizeSourceCells(parseDelimitedRows(text, ',').map((row) => row[0] || ''));
  }

  return [];
}

function looksLikeQuotedCsv(text: string): boolean {
  let index = 0;

  while (/\s/.test(text[index] || '')) {
    index += 1;
  }

  if (text[index] !== '"') return false;
  index += 1;

  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && next === '"') {
      index += 2;
      continue;
    }

    if (char === '"') {
      index += 1;
      break;
    }

    index += 1;
  }

  while (/[ \t]/.test(text[index] || '')) {
    index += 1;
  }

  if (text[index] !== ',') return false;

  const rows = parseDelimitedRows(text, ',').filter((row) =>
    row.some((cell) => cell.trim().length > 0),
  );
  return rows.length > 0 && rows.every((row) => row.length > 1);
}

function parseDelimitedRows(text: string, delimiter: '\t' | ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
        continue;
      }

      if (inQuotes) {
        inQuotes = false;
        continue;
      }

      if (cell.length === 0) {
        inQuotes = true;
        continue;
      }

      cell += char;
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell);
      cell = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function normalizeSourceCells(cells: string[]): string[] {
  return cells.map((cell) => cell.trim()).filter((cell) => cell.length > 0);
}

function decodeCodePoint(value: string, radix: number): string {
  const codePoint = Number.parseInt(value, radix);
  if (!Number.isFinite(codePoint)) return '';

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return '';
  }
}
