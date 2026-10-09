import type { QaHighlight } from '../models';
import { countValues, maskQaMarkers } from './text';
import { qaHighlight } from './highlights';

export interface TextOccurrence {
  value: string;
  start: number;
  end: number;
}

export function urlOccurrences(text: string): TextOccurrence[] {
  return [
    ...text.matchAll(
      /(?<![\p{L}\p{N}_@])(?:https?:\/\/|ftp:\/\/|file:\/\/|mailto:|www\.)[^\s<>"'“”‘’]+/giu,
    ),
  ].map((match) => {
    let url = match[0];
    const pairs = new Map(
      [
        ['(', ')'],
        ['[', ']'],
        ['{', '}'],
        ['（', '）'],
        ['【', '】'],
        ['《', '》'],
        ['「', '」'],
        ['『', '』'],
      ].map(([open, close]) => [close, open]),
    );
    for (;;) {
      url = url.replace(/[.,，。;；!！?？:：、…]+$/, '');
      const close = url.at(-1) ?? '',
        open = pairs.get(close);
      if (!open || url.split(close).length <= url.split(open).length) break;
      url = url.slice(0, -1);
    }
    return { value: url, start: match.index!, end: match.index! + url.length };
  });
}

/** Retain original offsets through the existing number normalization and masking. */
export function numberOccurrences(text: string): TextOccurrence[] {
  let value = '';
  let starts: number[] = [],
    ends: number[] = [];
  for (let offset = 0; offset < text.length; ) {
    const char = String.fromCodePoint(text.codePointAt(offset)!);
    const normalized = char.normalize('NFKC').replace(/[−–—﹣]/g, '-');
    for (let index = 0; index < normalized.length; index++) {
      starts.push(offset);
      ends.push(offset + char.length);
    }
    value += normalized;
    offset += char.length;
  }
  const replace = (pattern: RegExp) => {
    let next = '',
      cursor = 0;
    const nextStarts: number[] = [],
      nextEnds: number[] = [];
    for (const match of value.matchAll(pattern)) {
      const start = match.index!,
        end = start + match[0].length;
      next += value.slice(cursor, start) + ' ';
      for (let index = cursor; index < start; index++) {
        nextStarts.push(starts[index]);
        nextEnds.push(ends[index]);
      }
      nextStarts.push(starts[start]);
      nextEnds.push(ends[end - 1]);
      cursor = end;
    }
    next += value.slice(cursor);
    for (let index = cursor; index < starts.length; index++) {
      nextStarts.push(starts[index]);
      nextEnds.push(ends[index]);
    }
    value = next;
    starts = nextStarts;
    ends = nextEnds;
  };
  for (const url of urlOccurrences(value)) {
    const escaped = url.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    replace(new RegExp(escaped, 'g'));
  }
  value = maskQaMarkers(value);
  replace(/&#(?:x[0-9a-f]+|\d+);|\\(?:u[0-9a-f]{4,8}|x[0-9a-f]{2})/gi);
  return [
    ...value.matchAll(
      /(?<!\d)[+-]?(?:\d+(?:[.,:/\-'’]\d+)+|\d{1,3}(?:[ '\u00a0\u202f’]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)[%‰]?(?!\d)/g,
    ),
  ].map((match) => ({
    value: match[0],
    start: starts[match.index!],
    end: ends[match.index! + match[0].length - 1],
  }));
}

export function occurrenceHighlights(
  source: string,
  target: string,
  left: TextOccurrence[],
  right: TextOccurrence[],
): QaHighlight[] {
  const a = countValues(left.map((item) => item.value)),
    b = countValues(right.map((item) => item.value));
  const different = ({ value }: TextOccurrence) => (a.get(value) ?? 0) !== (b.get(value) ?? 0);
  return [
    ...qaHighlight(
      'source',
      source,
      left.filter(different).map(({ start, end }) => ({ start, end })),
    ),
    ...qaHighlight(
      'target',
      target,
      right.filter(different).map(({ start, end }) => ({ start, end })),
    ),
  ];
}
