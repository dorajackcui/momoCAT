import type { TagType } from '../models';

const isOpeningAngle = (value: string): boolean => value === '<' || value === '❮' || value === '❰';
const isClosingAngle = (value: string): boolean => value === '>' || value === '❯' || value === '❱';

/** Scan forward without interpreting embedded tag names or retrying quoted spans. */
export function findNextAngleTag(
  text: string,
  start: number,
): { value: string; index: number } | null {
  // Each embedded tag owns its quotes; closing it resumes the enclosing value.
  const quotes: (string | null)[] = [];
  let tagStart = start;
  let previous = '';

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    const depth = quotes.length - 1;
    const quote = depth >= 0 ? quotes[depth] : null;

    if (isOpeningAngle(character)) {
      // Outside an attribute, a new outer opener replaces an unfinished prefix.
      if (quotes.length === 0 || (quotes.length === 1 && quote === null)) {
        tagStart = index;
        quotes.length = 0;
      }
      quotes.push(null);
    } else if (quotes.length === 0) {
      continue;
    } else if (quote !== null) {
      if (character === quote) quotes[depth] = null;
    } else if ((character === '"' || character === "'") && previous === '=') {
      quotes[depth] = character;
    } else if (isClosingAngle(character)) {
      quotes.pop();
      if (quotes.length === 0 && index > tagStart + 1) {
        return { value: text.slice(tagStart, index + 1), index: tagStart };
      }
    }

    if (!/\s/.test(character)) previous = character;
  }

  return null;
}

export function getAngleTagInfo(content: string): { name: string; type: TagType } | null {
  if (!isOpeningAngle(content[0] ?? '')) return null;
  const tag = findNextAngleTag(content, 0);
  if (tag?.index !== 0 || tag.value.length !== content.length) return null;
  const body = content.slice(1, -1);
  // Nameless closing tags remain paired-end markers, but have no name to pair by.
  const closing = body.match(/^\/([^\s/<>❮❰❯❱]*)\s*$/);
  if (closing) return { name: closing[1], type: 'paired-end' };

  const opening = body.match(/^([^\s/<>❮❰❯❱]+)(?=[\s/]|$)/);
  if (!opening) return null;
  return {
    name: opening[1],
    type: body.trimEnd().endsWith('/') ? 'standalone' : 'paired-start',
  };
}
