import type { TagMetadata, Token } from '../models';
import { getTagDisplayInfo } from './display';

export interface InsertTagResult {
  tokens: Token[];
  insertedTag: Token;
  insertedIndex: number;
}

export interface InsertAllTagsResult {
  tokens: Token[];
  insertedTags: Array<{ tag: Token; index: number }>;
}

function createTagToken(tagContent: string): Token {
  return {
    type: 'tag',
    content: tagContent,
    meta: { id: tagContent },
  };
}

export function insertTagAtCursor(
  targetTokens: Token[],
  tagContent: string,
  cursorPosition: number,
): InsertTagResult {
  const newTag = createTagToken(tagContent);

  if (targetTokens.length === 0) {
    return {
      tokens: [newTag],
      insertedTag: newTag,
      insertedIndex: 0,
    };
  }

  let charCount = 0;

  for (let i = 0; i < targetTokens.length; i++) {
    const token = targetTokens[i];
    if (token.type !== 'text') {
      continue;
    }

    const tokenLength = token.content.length;

    if (cursorPosition <= charCount) {
      let insertIndex = i;
      while (insertIndex > 0 && targetTokens[insertIndex - 1].type === 'tag') {
        insertIndex--;
      }

      const newTokens = [...targetTokens];
      newTokens.splice(insertIndex, 0, newTag);
      return {
        tokens: newTokens,
        insertedTag: newTag,
        insertedIndex: insertIndex,
      };
    }

    if (cursorPosition < charCount + tokenLength) {
      const positionInToken = cursorPosition - charCount;
      const beforeText = token.content.substring(0, positionInToken);
      const afterText = token.content.substring(positionInToken);

      const newTokens = [...targetTokens];
      newTokens.splice(
        i,
        1,
        { type: 'text', content: beforeText },
        newTag,
        { type: 'text', content: afterText },
      );

      return {
        tokens: newTokens,
        insertedTag: newTag,
        insertedIndex: i + 1,
      };
    }

    if (cursorPosition === charCount + tokenLength) {
      let insertIndex = i + 1;
      while (insertIndex < targetTokens.length && targetTokens[insertIndex].type === 'tag') {
        insertIndex++;
      }

      const newTokens = [...targetTokens];
      newTokens.splice(insertIndex, 0, newTag);
      return {
        tokens: newTokens,
        insertedTag: newTag,
        insertedIndex: insertIndex,
      };
    }

    charCount += tokenLength;
  }

  const newTokens = [...targetTokens, newTag];
  return {
    tokens: newTokens,
    insertedTag: newTag,
    insertedIndex: newTokens.length - 1,
  };
}

export function deleteTagAtIndex(targetTokens: Token[], tagIndex: number): Token[] {
  if (tagIndex < 0 || tagIndex >= targetTokens.length) {
    return targetTokens;
  }

  if (targetTokens[tagIndex].type !== 'tag') {
    return targetTokens;
  }

  return targetTokens.filter((_, index) => index !== tagIndex);
}

export function moveTagBetweenPositions(
  targetTokens: Token[],
  fromIndex: number,
  toPosition: number,
): Token[] {
  if (fromIndex < 0 || fromIndex >= targetTokens.length) {
    return targetTokens;
  }

  if (targetTokens[fromIndex].type !== 'tag') {
    return targetTokens;
  }

  if (toPosition < 0 || toPosition >= targetTokens.length) {
    return targetTokens;
  }

  if (fromIndex === toPosition) {
    return targetTokens;
  }

  const newTokens = [...targetTokens];
  const [movedTag] = newTokens.splice(fromIndex, 1);
  const insertPosition = toPosition <= fromIndex + 1 ? toPosition : toPosition - 1;
  newTokens.splice(insertPosition, 0, movedTag);
  return newTokens;
}

export function findPairedTagIndex(tokens: Token[], tagIndex: number): number | undefined {
  if (tagIndex < 0 || tagIndex >= tokens.length) {
    return undefined;
  }

  const tag = tokens[tagIndex];
  if (tag.type !== 'tag') {
    return undefined;
  }

  const pairedStartMatch = tag.content.match(/^<([^/>]+)>$/);
  const pairedEndMatch = tag.content.match(/^<\/([^>]+)>$/);

  if (pairedStartMatch) {
    const tagName = pairedStartMatch[1];
    const closingPattern = `</${tagName}>`;
    let nestingLevel = 0;

    for (let i = tagIndex + 1; i < tokens.length; i++) {
      if (tokens[i].type !== 'tag') continue;

      const currentContent = tokens[i].content;
      if (currentContent === tag.content) {
        nestingLevel++;
      } else if (currentContent === closingPattern) {
        if (nestingLevel === 0) {
          return i;
        }
        nestingLevel--;
      }
    }

    return undefined;
  }

  if (pairedEndMatch) {
    const tagName = pairedEndMatch[1];
    const openingPattern = `<${tagName}>`;
    let nestingLevel = 0;

    for (let i = tagIndex - 1; i >= 0; i--) {
      if (tokens[i].type !== 'tag') continue;

      const currentContent = tokens[i].content;
      if (currentContent === tag.content) {
        nestingLevel++;
      } else if (currentContent === openingPattern) {
        if (nestingLevel === 0) {
          return i;
        }
        nestingLevel--;
      }
    }

    return undefined;
  }

  return undefined;
}

export function buildTagMetadata(token: Token, index: number, allTokens: Token[]): TagMetadata {
  const tagInfo = getTagDisplayInfo(token.content, index);
  const pairedIndex = findPairedTagIndex(allTokens, index);

  return {
    index,
    type: tagInfo.type,
    pairedIndex,
    isPaired: pairedIndex !== undefined,
    displayText: tagInfo.display,
    validationState: token.meta?.validationState,
  };
}

export function insertAllTagsAtCursor(
  targetTokens: Token[],
  sourceTags: Token[],
  cursorPosition: number,
): InsertAllTagsResult {
  if (sourceTags.length === 0) {
    return { tokens: targetTokens, insertedTags: [] };
  }

  const newTags = sourceTags.map((tag) => createTagToken(tag.content));

  if (targetTokens.length === 0) {
    return {
      tokens: newTags,
      insertedTags: newTags.map((tag, index) => ({ tag, index })),
    };
  }

  let charCount = 0;
  let insertIndex = 0;

  for (let i = 0; i < targetTokens.length; i++) {
    const token = targetTokens[i];
    if (token.type !== 'text') {
      continue;
    }

    const tokenLength = token.content.length;

    if (cursorPosition <= charCount) {
      insertIndex = i;
      while (insertIndex > 0 && targetTokens[insertIndex - 1].type === 'tag') {
        insertIndex--;
      }
      break;
    }

    if (cursorPosition < charCount + tokenLength) {
      const positionInToken = cursorPosition - charCount;
      const beforeText = token.content.substring(0, positionInToken);
      const afterText = token.content.substring(positionInToken);

      const nextTokens = [...targetTokens];
      nextTokens.splice(i, 1, { type: 'text', content: beforeText }, ...newTags, {
        type: 'text',
        content: afterText,
      });

      return {
        tokens: nextTokens,
        insertedTags: newTags.map((tag, idx) => ({ tag, index: i + 1 + idx })),
      };
    }

    if (cursorPosition === charCount + tokenLength) {
      insertIndex = i + 1;
      while (insertIndex < targetTokens.length && targetTokens[insertIndex].type === 'tag') {
        insertIndex++;
      }
      break;
    }

    charCount += tokenLength;
  }

  if (insertIndex === 0 && charCount < cursorPosition) {
    insertIndex = targetTokens.length;
  }

  const nextTokens = [...targetTokens];
  nextTokens.splice(insertIndex, 0, ...newTags);
  return {
    tokens: nextTokens,
    insertedTags: newTags.map((tag, idx) => ({ tag, index: insertIndex + idx })),
  };
}
