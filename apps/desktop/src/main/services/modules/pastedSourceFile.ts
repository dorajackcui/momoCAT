const INVALID_FILE_NAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
const MAX_SOURCE_SUMMARY_LENGTH = 5;

export function normalizePastedSources(sources: string[]): string[] {
  return sources.map((source) => source.trim()).filter((source) => source.length > 0);
}

export function buildPastedSourceFileName(
  firstSource: string,
  now: Date,
  existingFileNames: string[],
): string {
  const date = formatDate(now);
  const summary = sanitizeFileSummary(firstSource) || 'Pasted Source';
  const baseName = `${summary}-${date}`;
  const existing = new Set(existingFileNames);
  let candidate = `${baseName}.csv`;
  let suffix = 2;

  while (existing.has(candidate)) {
    candidate = `${baseName}-${suffix}.csv`;
    suffix += 1;
  }

  return candidate;
}

export function buildPastedSourceCsv(sources: string[]): string {
  const rows = [['Source', 'Target'], ...sources.map((source) => [source, ''])];
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}

function sanitizeFileSummary(source: string): string {
  const sanitized = Array.from(source)
    .filter((char) => char.charCodeAt(0) > 0x1f && !INVALID_FILE_NAME_CHARS.has(char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(sanitized).slice(0, MAX_SOURCE_SUMMARY_LENGTH).join('').trim();
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  return `${year}-${month}-${day}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

function escapeCsvCell(value: string): string {
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!/[",\n]/.test(normalized)) return normalized;
  return `"${normalized.replace(/"/g, '""')}"`;
}
