import type { TagMetadata, Token } from '../models';
import {
  buildTagMetadata,
  deleteTagAtIndex,
  findPairedTagIndex,
  insertAllTagsAtCursor,
  insertTagAtCursor,
  moveTagBetweenPositions,
} from './operations';

export class TagManager {
  private listeners: Map<string, Array<(data: unknown) => void>> = new Map();

  on(event: string, handler: (data: unknown) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  emit(event: string, data: unknown): void {
    const handlers = this.listeners.get(event) || [];
    handlers.forEach((handler) => handler(data));
  }

  insertTag(targetTokens: Token[], tagContent: string, cursorPosition: number): Token[] {
    const result = insertTagAtCursor(targetTokens, tagContent, cursorPosition);
    this.emit('tagInserted', { tagIndex: result.insertedIndex, tag: result.insertedTag });
    return result.tokens;
  }

  deleteTag(targetTokens: Token[], tagIndex: number): Token[] {
    const nextTokens = deleteTagAtIndex(targetTokens, tagIndex);
    if (nextTokens !== targetTokens) {
      this.emit('tagDeleted', { tagIndex });
    }
    return nextTokens;
  }

  moveTag(targetTokens: Token[], fromIndex: number, toPosition: number): Token[] {
    const nextTokens = moveTagBetweenPositions(targetTokens, fromIndex, toPosition);
    if (nextTokens !== targetTokens) {
      this.emit('tagMoved', { fromIndex, toPosition });
    }
    return nextTokens;
  }

  findPairedTag(tokens: Token[], tagIndex: number): number | undefined {
    return findPairedTagIndex(tokens, tagIndex);
  }

  getTagMetadata(token: Token, index: number, allTokens: Token[]): TagMetadata {
    return buildTagMetadata(token, index, allTokens);
  }

  copyTag(tag: Token): string {
    return tag.content;
  }

  insertAllTags(targetTokens: Token[], sourceTags: Token[], cursorPosition: number): Token[] {
    const result = insertAllTagsAtCursor(targetTokens, sourceTags, cursorPosition);
    result.insertedTags.forEach(({ tag, index }) => {
      this.emit('tagInserted', { tagIndex: index, tag });
    });
    return result.tokens;
  }
}
