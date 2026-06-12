import type { Token } from '../models';

const isOccurrenceScopedTagContent = (content: string): boolean =>
  content === '\r' || content === '\n';

export const getUniqueTagContents = (sourceTokens: Token[]): string[] => {
  const seen = new Set<string>();
  const markerContents: string[] = [];

  sourceTokens.forEach(token => {
    if (token.type !== 'tag') return;
    if (isOccurrenceScopedTagContent(token.content)) {
      markerContents.push(token.content);
      return;
    }
    if (seen.has(token.content)) return;
    seen.add(token.content);
    markerContents.push(token.content);
  });

  return markerContents;
};

export const createTagNumberMap = (sourceTokens: Token[]): Map<string, number> => {
  const markerContents = getUniqueTagContents(sourceTokens);
  const map = new Map<string, number>();

  markerContents.forEach((content, index) => {
    if (isOccurrenceScopedTagContent(content)) return;
    if (map.has(content)) return;
    map.set(content, index + 1);
  });

  return map;
};

export const createTagNumberResolver = (sourceTokens: Token[]): ((token: Token) => number | undefined) => {
  const tagNumberByContent = createTagNumberMap(sourceTokens);
  const occurrenceNumbersByContent = new Map<string, number[]>();
  const occurrenceCursorByContent = new Map<string, number>();

  getUniqueTagContents(sourceTokens).forEach((content, index) => {
    if (!isOccurrenceScopedTagContent(content)) return;
    const numbers = occurrenceNumbersByContent.get(content) ?? [];
    numbers.push(index + 1);
    occurrenceNumbersByContent.set(content, numbers);
  });

  return (token: Token): number | undefined => {
    if (token.type !== 'tag') return undefined;
    if (!isOccurrenceScopedTagContent(token.content)) {
      return tagNumberByContent.get(token.content);
    }

    const numbers = occurrenceNumbersByContent.get(token.content);
    if (!numbers || numbers.length === 0) return undefined;

    const cursor = occurrenceCursorByContent.get(token.content) ?? 0;
    const number = numbers[cursor];
    if (number === undefined) return undefined;

    occurrenceCursorByContent.set(token.content, cursor + 1);
    return number;
  };
};

export const getTagContentByMarkerIndex = (sourceTokens: Token[], markerNumber: number): string | undefined => {
  if (markerNumber < 1) return undefined;
  const markerContents = getUniqueTagContents(sourceTokens);
  return markerContents[markerNumber - 1];
};
