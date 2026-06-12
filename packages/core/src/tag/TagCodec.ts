import type { Token, TagType } from '../models';
import {
  EditorMarkerPattern,
  getDisplayTagPatterns,
  getEditorMarkerPatterns
} from './TagPatternRegistry';
import { createTagNumberResolver, getTagContentByMarkerIndex, getUniqueTagContents } from './TagMapper';

export type TagPolicy = 'default' | 'none';

export interface ParseDisplayTextOptions {
  displayTagPatterns?: RegExp[];
  tagPolicy?: TagPolicy;
}

export interface ParseEditorTextOptions extends ParseDisplayTextOptions {
  editorMarkerPatterns?: EditorMarkerPattern[];
}

type ParseDisplayTextArgument = RegExp[] | ParseDisplayTextOptions;

function resolveTagPolicy(policy?: TagPolicy): TagPolicy {
  return policy ?? 'default';
}

function normalizeDisplayOptions(options?: ParseDisplayTextArgument): ParseDisplayTextOptions {
  if (Array.isArray(options)) {
    return { displayTagPatterns: options };
  }

  return options ?? {};
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

const pushTagToken = (tokens: Token[], value: string): void => {
  tokens.push({
    type: 'tag',
    content: value,
    meta: { id: value },
  });
};

const findNextProtectedLineBreak = (
  text: string,
  startIndex: number,
): { value: string; index: number } | null => {
  for (let index = startIndex; index < text.length; index += 1) {
    const value = text[index];
    if (value === '\r' || value === '\n') {
      return { value, index };
    }
  }
  return null;
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
  const resolveTagNumber = createTagNumberResolver(sourceTokens);
  let fallbackTagNumber = getUniqueTagContents(sourceTokens).length + 1;

  return tokens
    .map(token => {
      if (token.type !== 'tag') return token.content;
      const tagNumber = resolveTagNumber(token) ?? fallbackTagNumber++;
      return formatTagAsMemoQMarker(token.content, tagNumber);
    })
    .join('');
}

export function parseDisplayTextToTokens(
  text: string,
  options?: ParseDisplayTextArgument
): Token[] {
  const normalizedOptions = normalizeDisplayOptions(options);

  if (resolveTagPolicy(normalizedOptions.tagPolicy) === 'none') {
    return [{ type: 'text', content: text }];
  }

  if (!text) {
    return [{ type: 'text', content: text }];
  }

  // Fast path for common plain-text rows.
  const customPatterns = normalizedOptions.displayTagPatterns;
  const hasCustomPatterns = Array.isArray(customPatterns) && customPatterns.length > 0;
  if (!hasCustomPatterns && !/[<{%\r\n]/.test(text)) {
    return [{ type: 'text', content: text }];
  }

  const patterns = getDisplayTagPatterns(customPatterns);
  const tokens: Token[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    let nextCandidate = findNextProtectedLineBreak(text, cursor);

    for (const pattern of patterns) {
      pattern.lastIndex = cursor;
      const match = pattern.exec(text);
      if (!match || match[0].length === 0) continue;
      if (!nextCandidate || match.index < nextCandidate.index) {
        nextCandidate = { value: match[0], index: match.index };
      }
    }

    if (!nextCandidate) {
      pushTextToken(tokens, text.substring(cursor));
      break;
    }

    if (nextCandidate.index > cursor) {
      pushTextToken(tokens, text.substring(cursor, nextCandidate.index));
    }

    pushTagToken(tokens, nextCandidate.value);

    cursor = nextCandidate.index + nextCandidate.value.length;
  }

  return tokens.length > 0 ? tokens : [{ type: 'text', content: text }];
}

export function parseEditorTextToTokens(
  text: string,
  sourceTokens: Token[],
  options?: ParseEditorTextOptions
): Token[] {
  if (resolveTagPolicy(options?.tagPolicy) === 'none') {
    return [{ type: 'text', content: text }];
  }

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
