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
    .filter((token) => token.type === 'text')
    .map((token) => token.content)
    .join('');
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
