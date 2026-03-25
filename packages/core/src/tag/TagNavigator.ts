import type { Token } from '../models';

export class TagNavigator {
  getTagIndices(tokens: Token[]): number[] {
    return tokens
      .map((token, index) => (token.type === 'tag' ? index : -1))
      .filter((index) => index !== -1);
  }

  focusNextTag(currentIndex: number, tokens: Token[]): number {
    const tagIndices = this.getTagIndices(tokens);
    if (tagIndices.length === 0) return currentIndex;

    const nextIndex = tagIndices.find((index) => index > currentIndex);
    return nextIndex !== undefined ? nextIndex : tagIndices[0];
  }

  focusPreviousTag(currentIndex: number, tokens: Token[]): number {
    const tagIndices = this.getTagIndices(tokens);
    if (tagIndices.length === 0) return currentIndex;

    const reversedIndices = [...tagIndices].reverse();
    const previousIndex = reversedIndices.find((index) => index < currentIndex);
    return previousIndex !== undefined ? previousIndex : tagIndices[tagIndices.length - 1];
  }
}
