import type { QaHighlight, QaIssue, QaTextRange } from '../models';
import { describeDifference, maskQaMarkers } from './text';
import { qaHighlight } from './highlights';
import { numberOccurrences, urlOccurrences, occurrenceHighlights } from './textOccurrences';

function pairedSymbols(text: string): { message: string | null; ranges: QaTextRange[] } {
  const value = maskQaMarkers(text);
  const pairs = new Map([
    ['(', ')'],
    ['（', '）'],
    ['[', ']'],
    ['［', '］'],
    ['【', '】'],
    ['{', '}'],
    ['｛', '｝'],
    ['“', '”'],
    ['«', '»'],
  ]);
  const closing = new Set(pairs.values());
  const stack: Array<{ close: string; index: number }> = [];
  const problems: string[] = [];
  const ranges: QaTextRange[] = [];
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '"') {
      if (stack.at(-1)?.close === char) stack.pop();
      else stack.push({ close: char, index });
    } else if (pairs.has(char)) stack.push({ close: pairs.get(char)!, index });
    else if (closing.has(char)) {
      const expected = stack.pop();
      if (expected?.close !== char) {
        ranges.push({ start: index, end: index + 1 });
        if (expected) ranges.push({ start: expected.index, end: expected.index + 1 });
        problems.push(
          `“${char}” at ${index + 1}: ${expected ? `expected “${expected.close}”` : 'missing opening symbol'}`,
        );
      }
    }
  }
  for (const item of stack) {
    problems.push(`Missing “${item.close}” for symbol at ${item.index + 1}`);
    ranges.push({ start: item.index, end: item.index + 1 });
  }
  return { message: problems.join('; ') || null, ranges };
}

export function checkTextRules(
  source: string,
  target: string,
  enabled: (ruleId: string) => boolean = () => true,
): QaIssue[] {
  const issues: QaIssue[] = [];
  const add = (ruleId: string, message: string | null | false, highlights: QaHighlight[] = []) => {
    if (enabled(ruleId) && message)
      issues.push({
        ruleId,
        message,
        severity: 'info',
        ...(highlights.length ? { highlights } : {}),
      });
  };
  const mark = (ranges: QaTextRange[]) => qaHighlight('target', target, ranges);
  const matches = (pattern: RegExp) =>
    [...target.matchAll(pattern)].map((match) => ({
      start: match.index!,
      end: match.index! + match[0].length,
    }));
  add(
    'empty-target',
    Boolean(source.trim()) && !target.trim() && 'Target is empty or contains only whitespace.',
  );
  for (const [ruleId, extract] of [
    ['number', numberOccurrences],
    ['url', urlOccurrences],
  ] as const) {
    if (!enabled(ruleId)) continue;
    const left = extract(source),
      right = extract(target);
    add(
      ruleId,
      describeDifference(
        left.map((item) => item.value),
        right.map((item) => item.value),
      ),
      occurrenceHighlights(source, target, left, right),
    );
  }
  const breaks = (text: string) => (text.match(/\r\n|\r|\n/g) ?? []).length;
  if (enabled('line-break') && breaks(source) !== breaks(target))
    add('line-break', `Source: ${breaks(source)} line breaks; target: ${breaks(target)}.`);
  const chinese = enabled('chinese')
    ? [
        ...new Set(
          target.match(
            /[\p{Script=Han}\u3000-\u303f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65“”‘’·]/gu,
          ) ?? [],
        ),
      ]
    : [];
  add(
    'chinese',
    chinese.length > 0 && `Found: ${chinese.join(' ')}`,
    mark(
      matches(
        /[\p{Script=Han}\u3000-\u303f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65“”‘’·]/gu,
      ),
    ),
  );
  const punctuation = enabled('abnormal-punctuation')
    ? target.match(/[.．。]{2,}|[,，、]{2,}|[:：]{2,}|[;；]{2,}/g)?.filter((item) => item !== '...')
    : [];
  add(
    'abnormal-punctuation',
    Boolean(punctuation?.length) && `Repeated punctuation: ${punctuation!.join(', ')}`,
    mark(
      [...target.matchAll(/[.．。]{2,}|[,，、]{2,}|[:：]{2,}|[;；]{2,}/g)]
        .filter((match) => match[0] !== '...')
        .map((match) => ({ start: match.index!, end: match.index! + match[0].length })),
    ),
  );
  const spaces = enabled('consecutive-spaces') ? target.match(/ {2,}/g) : [];
  add(
    'consecutive-spaces',
    Boolean(spaces?.length) &&
      `Consecutive spaces: ${spaces!.map((item) => item.length).join(', ')}`,
  );
  const head = target.match(/^ +/)?.[0].length ?? 0,
    tail = target.match(/ +$/)?.[0].length ?? 0;
  add(
    'leading-trailing-spaces',
    (head > 0 || tail > 0) && `Leading spaces: ${head}; trailing spaces: ${tail}.`,
  );
  const mixed: string[] = [];
  const mixedChars = new Set<string>();
  if (enabled('mixed-width')) {
    for (const [half, full] of [
      [',', '，'],
      ['.', '．。'],
      [':', '：'],
      [';', '；'],
      ['!', '！'],
      ['?', '？'],
      ['()', '（）'],
      ['[]', '［］'],
      ['{}', '｛｝'],
      ['<>', '＜＞'],
    ]) {
      if (
        [...half].some((char) => target.includes(char)) &&
        [...full].some((char) => target.includes(char))
      ) {
        mixed.push(`${half} / ${full}`);
        for (const char of half + full) mixedChars.add(char);
      }
    }
    if (/[A-Za-z]/.test(target) && /[Ａ-Ｚａ-ｚ]/.test(target)) mixed.push('letters');
    if (/[0-9]/.test(target) && /[０-９]/.test(target)) mixed.push('digits');
  }
  const mixedRanges = [...target.matchAll(/./gu)]
    .filter(
      (match) =>
        mixedChars.has(match[0]) ||
        (mixed.includes('letters') && /[Ａ-Ｚａ-ｚ]/u.test(match[0])) ||
        (mixed.includes('digits') && /[０-９]/u.test(match[0])),
    )
    .map((match) => ({ start: match.index!, end: match.index! + match[0].length }));
  add(
    'mixed-width',
    mixed.length > 0 && `Mixed full / half width: ${mixed.join(', ')}`,
    mark(mixedRanges),
  );
  if (enabled('paired-symbols')) {
    const result = pairedSymbols(target);
    add('paired-symbols', result.message, mark(result.ranges));
  }
  return issues;
}
