import type { Token } from '../models';

export const getUniqueTagContents = (sourceTokens: Token[]): string[] => {
  const seen = new Set<string>();
  const unique: string[] = [];

  sourceTokens.forEach(token => {
    if (token.type !== 'tag') return;
    if (seen.has(token.content)) return;
    seen.add(token.content);
    unique.push(token.content);
  });

  return unique;
};

export const createTagNumberMap = (sourceTokens: Token[]): Map<string, number> => {
  const unique = getUniqueTagContents(sourceTokens);
  const map = new Map<string, number>();

  unique.forEach((content, index) => {
    map.set(content, index + 1);
  });

  return map;
};

export const getTagContentByMarkerIndex = (sourceTokens: Token[], markerNumber: number): string | undefined => {
  if (markerNumber < 1) return undefined;
  const unique = getUniqueTagContents(sourceTokens);
  return unique[markerNumber - 1];
};
