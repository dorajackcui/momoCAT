import type { Token } from '../models';
import {
  EditorMarkerPattern,
  DisplayTagRule,
  getDisplayTagRules,
  getEditorMarkerPatterns,
} from './TagPatternRegistry';
import { findNextAngleTag, getAngleTagInfo } from './AngleTagSyntax';
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

const findNextProtectedLineBreakEscape = (
  text: string,
  startIndex: number,
): { value: string; index: number } | null => {
  for (let index = startIndex; index < text.length - 1; index += 1) {
    if (text[index] !== '\\') continue;
    const escaped = text[index + 1];
    if (escaped === 'r' || escaped === 'n') {
      return { value: text.substring(index, index + 2), index };
    }
  }
  return null;
};

const isActualLineBreak = (content: string): boolean =>
  content === '\r' || content === '\n';

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
  return getCandidateLength(candidate) > getCandidateLength(current);
};

type DisplayCandidate =
  | { kind: 'display'; value: string; index: number }
  | { kind: 'protected-escape'; value: string; index: number };

type CandidateMatch = DisplayCandidate
  | { kind: 'marker'; marker: EditorMarkerPattern; match: RegExpExecArray; index: number };

const getCandidateLength = (candidate: CandidateMatch): number => (
  candidate.kind === 'marker'
    ? candidate.match[0].length
    : candidate.value.length
);

function* findDisplayCandidates(
  text: string,
  startIndex: number,
  rules: DisplayTagRule[],
): Generator<DisplayCandidate> {
  const escape = findNextProtectedLineBreakEscape(text, startIndex);
  if (escape) yield { kind: 'protected-escape', ...escape };

  for (const rule of rules) {
    if (rule.kind === 'angle') {
      const match = findNextAngleTag(text, startIndex);
      if (match) yield { kind: 'display', ...match };
    } else {
      rule.regex.lastIndex = startIndex;
      const match = rule.regex.exec(text);
      if (match && match[0].length > 0) {
        yield { kind: 'display', value: match[0], index: match.index };
      }
    }
  }
}

const findNextCandidate = (
  text: string,
  startIndex: number,
  markerPatterns: EditorMarkerPattern[],
  displayRules: DisplayTagRule[]
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

  for (const candidate of findDisplayCandidates(text, startIndex, displayRules)) {
    if (isBetterMatch(candidate, next)) next = candidate;
  }

  return next;
};

export function formatTagAsMemoQMarker(tagContent: string, tagNumber: number): string {
  const safeNumber = tagNumber > 0 ? tagNumber : 1;
  const type = getAngleTagInfo(tagContent)?.type ?? 'standalone';

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
      if (isActualLineBreak(token.content)) return token.content;
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
  if (!hasCustomPatterns && !/[<❮❰{%\\]/.test(text)) {
    return [{ type: 'text', content: text }];
  }

  const rules = getDisplayTagRules(customPatterns);
  const tokens: Token[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    let nextCandidate: DisplayCandidate | null = null;

    for (const candidate of findDisplayCandidates(text, cursor, rules)) {
      if (!nextCandidate || candidate.index < nextCandidate.index) {
        nextCandidate = candidate;
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
  const displayRules = getDisplayTagRules(options?.displayTagPatterns);
  const tokens: Token[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const candidate = findNextCandidate(text, cursor, markerPatterns, displayRules);

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
        content: candidate.value,
        meta: { id: candidate.value }
      });
    }

    cursor = candidate.index + getCandidateLength(candidate);
  }

  return tokens.length > 0 ? tokens : [{ type: 'text', content: text }];
}
