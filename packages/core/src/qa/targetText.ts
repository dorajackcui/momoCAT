import type { QaIssue } from '../models';
import { describeDifference, maskQaMarkers } from './text';

function urls(text: string): string[] {
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
    return url;
  });
}

function numbers(text: string): string[] {
  let value = text.normalize('NFKC').replace(/[−–—﹣]/g, '-');
  for (const url of urls(value)) value = value.split(url).join(' ');
  value = maskQaMarkers(value).replace(
    /&#(?:x[0-9a-f]+|\d+);|\\(?:u[0-9a-f]{4,8}|x[0-9a-f]{2})/gi,
    ' ',
  );
  return (
    value.match(
      /(?<!\d)[+-]?(?:\d+(?:[.,:/\-'’]\d+)+|\d{1,3}(?:[ '\u00a0\u202f’]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)[%‰]?(?!\d)/g,
    ) ?? []
  );
}

function pairedSymbols(text: string): string | null {
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
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '"') {
      if (stack.at(-1)?.close === char) stack.pop();
      else stack.push({ close: char, index });
    } else if (pairs.has(char)) stack.push({ close: pairs.get(char)!, index });
    else if (closing.has(char)) {
      const expected = stack.pop();
      if (expected?.close !== char)
        problems.push(
          `“${char}” at ${index + 1}: ${expected ? `expected “${expected.close}”` : 'missing opening symbol'}`,
        );
    }
  }
  for (const item of stack)
    problems.push(`Missing “${item.close}” for symbol at ${item.index + 1}`);
  return problems.join('; ') || null;
}

export function checkTextRules(
  source: string,
  target: string,
  enabled: (ruleId: string) => boolean = () => true,
): QaIssue[] {
  const issues: QaIssue[] = [];
  const add = (ruleId: string, message: string | null | false) => {
    if (enabled(ruleId) && message) issues.push({ ruleId, message, severity: 'info' });
  };
  add(
    'empty-target',
    Boolean(source.trim()) && !target.trim() && 'Target is empty or contains only whitespace.',
  );
  if (enabled('number')) add('number', describeDifference(numbers(source), numbers(target)));
  if (enabled('url')) add('url', describeDifference(urls(source), urls(target)));
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
  add('chinese', chinese.length > 0 && `Found: ${chinese.join(' ')}`);
  const punctuation = enabled('abnormal-punctuation')
    ? target.match(/[.．。]{2,}|[,，、]{2,}|[:：]{2,}|[;；]{2,}/g)?.filter((item) => item !== '...')
    : [];
  add(
    'abnormal-punctuation',
    Boolean(punctuation?.length) && `Repeated punctuation: ${punctuation!.join(', ')}`,
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
      )
        mixed.push(`${half} / ${full}`);
    }
    if (/[A-Za-z]/.test(target) && /[Ａ-Ｚａ-ｚ]/.test(target)) mixed.push('letters');
    if (/[0-9]/.test(target) && /[０-９]/.test(target)) mixed.push('digits');
  }
  add('mixed-width', mixed.length > 0 && `Mixed full / half width: ${mixed.join(', ')}`);
  if (enabled('paired-symbols')) add('paired-symbols', pairedSymbols(target));
  return issues;
}
