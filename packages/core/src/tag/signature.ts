import type { Token } from '../models';

export function computeTagsSignature(tokens: Token[]): string {
  return tokens
    .filter((token) => token.type === 'tag')
    .map((token) => token.content)
    .join('|');
}

export function extractTags(tokens: Token[]): string[] {
  return tokens
    .filter((token) => token.type === 'tag')
    .map((token) => token.content);
}
