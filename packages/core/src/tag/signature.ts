import type { Token } from '../models';

export function isActualLineBreakTagContent(content: string): boolean {
  return content === '\r' || content === '\n';
}

export function isOccurrenceScopedTagContent(content: string): boolean {
  return content === '\\r' || content === '\\n';
}

function isSignatureTag(token: Token): boolean {
  return token.type === 'tag' && !isActualLineBreakTagContent(token.content);
}

export function computeTagsSignature(tokens: Token[]): string {
  return extractTags(tokens).join('|');
}

export function extractTags(tokens: Token[]): string[] {
  return tokens
    .filter(isSignatureTag)
    .map((token) => token.content);
}
