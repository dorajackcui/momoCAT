import type { Token } from '../models';

export function serializeTokensToDisplayText(tokens: Token[]): string {
  return tokens.map((token) => token.content).join('');
}

export function serializeTokensToTextOnly(tokens: Token[]): string {
  return tokens
    .map((token) => (token.type === 'text' ? token.content : ' '))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

export function serializeTokensToSearchText(tokens: Token[]): string {
  return tokens
    .map((token) => (token.type === 'text' ? token.content : ' '))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SearchTextWithBoundaries {
  text: string;
  hardBoundaryOffsets: number[];
}

export function serializeTokensToSearchTextWithBoundaries(
  tokens: Token[],
): SearchTextWithBoundaries {
  let text = '';
  let inWhitespace = false;
  const hardBoundaryOffsets: number[] = [];

  const addHardBoundaryOffset = (offset: number) => {
    if (offset >= 0 && hardBoundaryOffsets[hardBoundaryOffsets.length - 1] !== offset) {
      hardBoundaryOffsets.push(offset);
    }
  };

  for (const token of tokens) {
    const isHardBoundary = token.type !== 'text';
    const content = isHardBoundary ? ' ' : token.content;

    for (const char of Array.from(content)) {
      if (/\s/u.test(char)) {
        if (text.length === 0) {
          inWhitespace = true;
          continue;
        }

        if (!inWhitespace) {
          text += ' ';
          inWhitespace = true;
        }

        if (isHardBoundary) {
          addHardBoundaryOffset(text.length - 1);
        }
        continue;
      }

      text += char;
      inWhitespace = false;
    }
  }

  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
  }

  return {
    text,
    hardBoundaryOffsets: hardBoundaryOffsets.filter((offset) => offset < text.length),
  };
}

export function computeMatchKey(tokens: Token[]): string {
  return tokens
    .map((token) => (token.type === 'text' ? token.content.toLowerCase().trim() : '{TAG}'))
    .join(' ')
    .replace(/\s+/g, ' ');
}

export function computeSrcHash(matchKey: string, tagsSignature: string): string {
  return `${matchKey}:::${tagsSignature}`;
}
