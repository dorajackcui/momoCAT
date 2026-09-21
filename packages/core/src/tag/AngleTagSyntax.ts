import type { TagType } from '../models';

const isOpeningAngle = (value: string): boolean => /[<❮❰]/.test(value);
const isClosingAngle = (value: string): boolean => /[>❯❱]/.test(value);

interface AngleFrame {
  quote: string | null;
  parentQuote: string | null;
  previous: string;
}

interface AngleRead {
  end: number | null;
  resume: number;
}

/** Read delimiters and attribute quotes without interpreting embedded tag names. */
function readAngleTag(text: string, start: number): AngleRead {
  if (!isOpeningAngle(text[start] ?? '')) return { end: null, resume: start + 1 };
  const frames: AngleFrame[] = [{ quote: null, parentQuote: null, previous: '' }];
  let recoveryEnd = text.length;

  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    const frame = frames[frames.length - 1];

    if (frame.quote !== null) {
      if (character === frame.quote) {
        frame.quote = null;
      } else if (isOpeningAngle(character)) {
        frames.push({ quote: null, parentQuote: frame.quote, previous: '' });
      } else if (frames.length === 1 && isClosingAngle(character) && recoveryEnd === text.length) {
        // If this quote never closes, resume after the first possible outer boundary.
        // Delimiters in complete embedded tags are not recovery boundaries.
        recoveryEnd = index + 1;
      }
    } else if ((character === '"' || character === "'") && frame.previous === '=') {
      frame.quote = character;
    } else if (character === frame.parentQuote) {
      // An opening angle in quoted prose is tentative. Reaching the enclosing
      // quote before its closing angle makes it literal content of that value.
      frames.pop();
      const parent = frames[frames.length - 1];
      parent.quote = null;
      parent.previous = character;
    } else if (isOpeningAngle(character)) {
      // An unquoted opener starts a new candidate; the partial prefix stays literal.
      if (frames.length === 1) return { end: null, resume: index };
      frames[frames.length - 1] = { quote: null, parentQuote: frame.parentQuote, previous: '' };
    } else if (isClosingAngle(character)) {
      frames.pop();
      if (frames.length === 0) return { end: index + 1, resume: index + 1 };
    }

    if (!/\s/.test(character)) frame.previous = character;
  }

  return { end: null, resume: recoveryEnd };
}

export function findNextAngleTag(
  text: string,
  start: number,
): { value: string; index: number } | null {
  const opening = /[<❮❰]/g;
  opening.lastIndex = start;
  let match: RegExpExecArray | null;

  while ((match = opening.exec(text)) !== null) {
    const { end, resume } = readAngleTag(text, match.index);
    if (end !== null && end > match.index + 2) {
      return { value: text.slice(match.index, end), index: match.index };
    }
    opening.lastIndex = resume;
  }

  return null;
}

export function getAngleTagInfo(content: string): { name: string; type: TagType } | null {
  if (readAngleTag(content, 0).end !== content.length) return null;
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
