import type { Token, TagType } from '../models';
import {
  EditorMarkerPattern,
  getDisplayTagPatterns,
  getEditorMarkerPatterns
} from './TagPatternRegistry';
import { createTagNumberMap, getTagContentByMarkerIndex, getUniqueTagContents } from './TagMapper';

export interface ParseEditorTextOptions {
  displayTagPatterns?: RegExp[];
  editorMarkerPatterns?: EditorMarkerPattern[];
}

const pushTextToken = (tokens: Token[], value: string): void => {
  if (!value) return;
  const lastToken = tokens[tokens.length - 1];
  if (lastToken && lastToken.type === 'text') {
    lastToken.content += value;
    return;
  }
  tokens.push({ type: 'text', content: value });
};

const detectTagType = (tagContent: string): TagType => {
  // Allow nameless closing tags like </> as paired-end markers.
  if (/^<\/[^>]*>$/.test(tagContent)) return 'paired-end';
  if (/^<([^/>]+)>$/.test(tagContent)) return 'paired-start';
  return 'standalone';
};

const isBetterMatch = (
  candidate: CandidateMatch,
  current: CandidateMatch | null
): boolean => {
  if (!current) return true;
  if (candidate.index !== current.index) return candidate.index < current.index;

  // On same index, prioritize marker patterns over raw display tags.
  if (candidate.kind !== current.kind) {
    return candidate.kind === 'marker';
  }

  // If still tied, prefer longer match.
  return candidate.match[0].length > current.match[0].length;
};

type CandidateMatch =
  | { kind: 'marker'; marker: EditorMarkerPattern; match: RegExpExecArray; index: number }
  | { kind: 'display'; match: RegExpExecArray; index: number };

const findNextCandidate = (
  text: string,
  startIndex: number,
  markerPatterns: EditorMarkerPattern[],
  displayPatterns: RegExp[]
): CandidateMatch | null => {
  let next: CandidateMatch | null = null;

  markerPatterns.forEach(marker => {
    marker.regex.lastIndex = startIndex;
    const match = marker.regex.exec(text);
    if (!match || match[0].length === 0) return;
    const candidate: CandidateMatch = {
      kind: 'marker',
      marker,
      match,
      index: match.index
    };
    if (isBetterMatch(candidate, next)) next = candidate;
  });

  displayPatterns.forEach(regex => {
    regex.lastIndex = startIndex;
    const match = regex.exec(text);
    if (!match || match[0].length === 0) return;
    const candidate: CandidateMatch = {
      kind: 'display',
      match,
      index: match.index
    };
    if (isBetterMatch(candidate, next)) next = candidate;
  });

  return next;
};

export function formatTagAsMemoQMarker(tagContent: string, tagNumber: number): string {
  const safeNumber = tagNumber > 0 ? tagNumber : 1;
  const type = detectTagType(tagContent);

  if (type === 'paired-start') return `{${safeNumber}>`;
  if (type === 'paired-end') return `<${safeNumber}}`;
  return `{${safeNumber}}`;
}

export function serializeTokensToEditorText(tokens: Token[], sourceTokens: Token[]): string {
  const tagNumberByContent = createTagNumberMap(sourceTokens);
  let fallbackTagNumber = getUniqueTagContents(sourceTokens).length + 1;

  return tokens
    .map(token => {
      if (token.type !== 'tag') return token.content;
      const tagNumber = tagNumberByContent.get(token.content) ?? fallbackTagNumber++;
      return formatTagAsMemoQMarker(token.content, tagNumber);
    })
    .join('');
}

export function parseDisplayTextToTokens(text: string, customPatterns?: RegExp[]): Token[] {
  if (!text) {
    return [{ type: 'text', content: text }];
  }

  // Fast path for common plain-text rows.
  const hasCustomPatterns = Array.isArray(customPatterns) && customPatterns.length > 0;
  if (!hasCustomPatterns && !/[<{%]/.test(text)) {
    return [{ type: 'text', content: text }];
  }

  const patterns = getDisplayTagPatterns(customPatterns);
  const tokens: Token[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    let nextCandidate: { match: RegExpExecArray; index: number } | null = null;

    for (const pattern of patterns) {
      pattern.lastIndex = cursor;
      const match = pattern.exec(text);
      if (!match || match[0].length === 0) continue;
      if (!nextCandidate || match.index < nextCandidate.index) {
        nextCandidate = { match, index: match.index };
      }
    }

    if (!nextCandidate) {
      pushTextToken(tokens, text.substring(cursor));
      break;
    }

    if (nextCandidate.index > cursor) {
      pushTextToken(tokens, text.substring(cursor, nextCandidate.index));
    }

    tokens.push({
      type: 'tag',
      content: nextCandidate.match[0],
      meta: { id: nextCandidate.match[0] }
    });

    cursor = nextCandidate.index + nextCandidate.match[0].length;
  }

  return tokens.length > 0 ? tokens : [{ type: 'text', content: text }];
}

export function parseEditorTextToTokens(
  text: string,
  sourceTokens: Token[],
  options?: ParseEditorTextOptions
): Token[] {
  const markerPatterns = getEditorMarkerPatterns(options?.editorMarkerPatterns);
  const displayPatterns = getDisplayTagPatterns(options?.displayTagPatterns);
  const tokens: Token[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const candidate = findNextCandidate(text, cursor, markerPatterns, displayPatterns);

    if (!candidate) {
      pushTextToken(tokens, text.substring(cursor));
      break;
    }

    if (candidate.index > cursor) {
      pushTextToken(tokens, text.substring(cursor, candidate.index));
    }

    if (candidate.kind === 'marker') {
      const indexValue = candidate.match.groups?.index ?? candidate.match[1];
      const markerNumber = indexValue ? Number.parseInt(indexValue, 10) : Number.NaN;
      const mappedContent = Number.isNaN(markerNumber)
        ? undefined
        : getTagContentByMarkerIndex(sourceTokens, markerNumber);

      if (mappedContent) {
        tokens.push({
          type: 'tag',
          content: mappedContent,
          meta: { id: mappedContent }
        });
      } else {
        pushTextToken(tokens, candidate.match[0]);
      }
    } else {
      tokens.push({
        type: 'tag',
        content: candidate.match[0],
        meta: { id: candidate.match[0] }
      });
    }

    cursor = candidate.index + candidate.match[0].length;
  }

  return tokens.length > 0 ? tokens : [{ type: 'text', content: text }];
}
