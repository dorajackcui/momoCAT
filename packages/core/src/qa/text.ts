import type { Segment, Token } from '../models';

export const qaText = (tokens: readonly Token[]) => tokens.map((token) => token.content).join('');
export const qaRow = (segment: Segment) => segment.meta?.rowRef ?? segment.orderIndex + 1;
export const qaKey = (...parts: string[]) => JSON.stringify(parts);
export const caseFold = (text: string) => text.toLowerCase().replace(/ß/g, 'ss').replace(/ς/g, 'σ');

const wrappers = new Map([
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['‘', '’'],
  ['「', '」'],
  ['『', '』'],
  ['«', '»'],
  ['‹', '›'],
  ['＂', '＂'],
  ['＇', '＇'],
  ['【', '】'],
  ['[', ']'],
  ['［', '］'],
  ['(', ')'],
  ['（', '）'],
  ['《', '》'],
  ['〈', '〉'],
  ['〔', '〕'],
  ['〖', '〗'],
]);

export function normalizeQaComparison(text: string): string {
  let result = text.trim();
  while (result.length > 1 && wrappers.get(result[0]) === result.at(-1)) {
    const open = result[0];
    const close = result.at(-1)!;
    let depth = 0;
    let whole = true;
    for (let index = 0; index < result.length - 1; index++) {
      if (open === close) {
        if (index > 0 && result[index] === close) {
          whole = false;
          break;
        }
      } else {
        if (result[index] === open) depth++;
        if (result[index] === close && --depth === 0) {
          whole = false;
          break;
        }
      }
    }
    if (!whole) break;
    result = result.slice(1, -1).trim();
  }
  return result;
}

export function hasAsciiBoundary(text: string, value: string, start: number): boolean {
  const word = /[A-Za-z0-9_]/;
  return (
    !(/[A-Za-z0-9]/.test(value[0]) && start > 0 && word.test(text[start - 1])) &&
    !(/[A-Za-z0-9]/.test(value.at(-1)!) && word.test(text[start + value.length] ?? ''))
  );
}

export function containsQaText(text: string, value: string): boolean {
  for (let start = text.indexOf(value); start >= 0; start = text.indexOf(value, start + 1)) {
    if (hasAsciiBoundary(text, value, start)) return true;
  }
  return false;
}

export interface QaMarker {
  text: string;
  start: number;
  end: number;
}

export function scanQaMarkers(text: string, mode: 'standard' | 'memoq' = 'standard'): QaMarker[] {
  const pattern =
    mode === 'memoq'
      ? /\{\d+(?:\}|>)|<\d+\}/g
      : /<(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^<>"'])*>|\[(?:\/[cC][oO][lL][oO][rR]|[cC][oO][lL][oO][rR]\s*=\s*[^\[\]]+)\]|\{\{[^{}]*\}\}|\{[^{}]*\}|\\n/g;
  const results: QaMarker[] = [];
  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    // A spaced comparison expression is prose, not a tag.
    if (value.startsWith('<') && /^<\s+\S[\s\S]*\s+>$/.test(value)) continue;
    results.push({ text: value, start: match.index!, end: match.index! + value.length });
  }
  return results;
}

export function maskQaMarkers(text: string): string {
  const markers = [...scanQaMarkers(text), ...scanQaMarkers(text, 'memoq')];
  // Preserve memoQ bodies rather than hiding the entire brace expression.
  const ranges = markers.filter(
    (marker) => !/^\{\d+>/.test(marker.text) || /^\{\d+>$/.test(marker.text),
  );
  const chars = text.split('');
  for (const marker of ranges)
    for (let index = marker.start; index < marker.end; index++) chars[index] = ' ';
  return chars.join('');
}

export function countValues(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

export function describeDifference(source: string[], target: string[]): string | null {
  const left = countValues(source),
    right = countValues(target);
  const delta = (a: Map<string, number>, b: Map<string, number>) =>
    [...a].flatMap(([value, count]) => {
      const amount = count - (b.get(value) ?? 0);
      return amount > 0 ? [`${value}${amount > 1 ? ` × ${amount}` : ''}`] : [];
    });
  const missing = delta(left, right),
    extra = delta(right, left);
  return (
    [
      missing.length ? `Missing: ${missing.join(', ')}` : '',
      extra.length ? `Extra: ${extra.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ') || null
  );
}
