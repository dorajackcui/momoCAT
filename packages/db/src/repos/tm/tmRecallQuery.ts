import type { TMRecallOptions } from '../../types';

export const ONLY_CJK_RE = /^[一-龥]+$/;
export const WEAK_SHORT_CJK_TERMS = new Set(['前往', '可选']);

export function buildFtsRecallQuery(terms: string[], scope: TMRecallOptions['scope']): string {
  const query = terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ');
  if ((scope ?? 'source') === 'source') {
    return `srcText : (${query})`;
  }
  return query;
}

export function extractCjkComponents(text: string): string[] {
  return text
    .split(/[^\u4e00-\u9fa5]+/g)
    .map((component) => component.trim())
    .filter((component) => component.length > 0);
}

export function buildCjkWindows(text: string, size: number): string[] {
  const chars = Array.from(text);
  if (chars.length < size) return [];
  if (chars.length === size) return [text];

  const windows: string[] = [];
  for (let index = 0; index <= chars.length - size; index += 1) {
    windows.push(chars.slice(index, index + size).join(''));
  }
  return windows;
}

export function uniqueTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const term of terms) {
    const normalized = term.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

export function selectSpreadFragments(fragments: string[], limit: number): string[] {
  const unique = uniqueTerms(fragments);
  if (unique.length <= limit) return unique;
  if (limit <= 1) return unique.slice(0, limit);

  const selected: string[] = [];
  const selectedIndexes = new Set<number>();
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round((index * (unique.length - 1)) / (limit - 1));
    if (selectedIndexes.has(sourceIndex)) continue;
    selectedIndexes.add(sourceIndex);
    selected.push(unique[sourceIndex]);
  }
  return selected;
}

export function chunkTerms(terms: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < terms.length; index += size) {
    chunks.push(terms.slice(index, index + size));
  }
  return chunks;
}

export function extractSearchTerms(query: string): string[] {
  return query
    .replace(/["()]/g, ' ')
    .replace(/\b(?:AND|OR|NOT)\b/gi, ' ')
    .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')
    .replace(/([\u4e00-\u9fa5])(\d)/g, '$1 $2')
    .replace(/(\d)([\u4e00-\u9fa5])/g, '$1 $2')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && !/^\d+$/.test(term));
}

export function escapeLikePattern(value: string): string {
  return value.replace(/([/%_])/g, '/$1');
}
