import type { QaIssue, Segment, TBMatch } from '../models';
import type { ProjectQASettings } from '../project/qaSettings';
import { findTermPositionsInText, serializeTokensToSearchText } from '../text';
import { caseFold, normalizeQaComparison, qaKey, qaText, scanQaMarkers } from './text';

interface Term {
  source: string;
  target: string;
  origins: Set<string>;
}
export interface DocumentTerminology {
  issues: Map<string, QaIssue[]>;
  sourceTerms: Set<string>;
}

function plainTerm(text: string): string {
  let result = text;
  for (const marker of scanQaMarkers(text).reverse())
    result = result.slice(0, marker.start) + result.slice(marker.end);
  return normalizeQaComparison(result);
}

function markedTerms(text: string, marks: Array<'square' | 'corner'>): string[] {
  return [...text.matchAll(/【([^【】]*)】|\[([^[\]]*)\]|［([^［］]*)］/g)].flatMap((match) => {
    if (!marks.includes(match[1] !== undefined ? 'corner' : 'square')) return [];
    const value = plainTerm(match[1] ?? match[2] ?? match[3]);
    return !/^(?:\/color|color\s*=.*)$/i.test(value) &&
      /\p{L}/u.test(value) &&
      !/^[A-Za-z]$/.test(value)
      ? [value]
      : [];
  });
}

export function checkDocumentTerminology(
  segments: readonly Segment[],
  matches: ReadonlyMap<string, TBMatch[]>,
  settings: ProjectQASettings,
  sourceLocale?: string,
  targetLocale?: string,
): DocumentTerminology {
  const terms = new Map<string, Term>();
  const issues = new Map<string, QaIssue[]>();
  const add = (
    segment: Segment,
    ruleId: string,
    source: string,
    target: string,
    message: string,
    origins?: Set<string>,
  ) => {
    const list = issues.get(segment.segmentId) ?? [];
    const groupId = qaKey('term', caseFold(source), caseFold(target));
    if (!list.some((item) => item.ruleId === ruleId && item.groupId === groupId))
      list.push({
        ruleId,
        severity: 'info',
        groupId,
        groupLabel: `${source} → ${target || '[missing translation]'}`,
        message,
        origins: origins ? [...origins] : undefined,
      });
    issues.set(segment.segmentId, list);
  };
  // Existing TB matches win over learned pairs. Resolve all rows before learning any pair.
  for (const rowMatches of matches.values())
    for (const match of rowMatches) {
      const source = plainTerm(match.srcTerm),
        target = plainTerm(match.tgtTerm);
      if (!source || !target) continue;
      const key = caseFold(source),
        previous = terms.get(key);
      if (!previous) terms.set(key, { source, target, origins: new Set([match.tbName]) });
      else if (caseFold(previous.target) === caseFold(target)) previous.origins.add(match.tbName);
    }
  const marks = settings.options?.termMarks ?? ['square', 'corner'];
  const marked = segments.map((segment) => ({
    segment,
    source: markedTerms(qaText(segment.sourceTokens), marks),
    target: markedTerms(qaText(segment.targetTokens), marks),
  }));
  for (const { segment, source, target } of marked) {
    if (source.length !== target.length) continue;
    const staged = new Map<string, Term>();
    let conflict = false;
    source.forEach((value, index) => {
      const key = caseFold(value),
        previous = terms.get(key) ?? staged.get(key);
      if (previous?.target && caseFold(previous.target) !== caseFold(target[index])) {
        conflict = true;
        add(
          segment,
          'term-conflict',
          previous.source,
          previous.target,
          `Expected “${previous.target}”, found “${target[index]}” (${[...previous.origins].join(', ')}).`,
          previous.origins,
        );
      } else
        staged.set(key, {
          source: value,
          target: target[index],
          origins: previous?.origins ?? new Set(['Current file']),
        });
    });
    if (!conflict) for (const [key, term] of staged) terms.set(key, term);
  }
  const learnedBySource = new Map<string, Term[]>();
  const targetPresence = new Map<string, Map<string, boolean>>();
  for (const { segment, source, target } of marked) {
    const sourceText = serializeTokensToSearchText(segment.sourceTokens);
    const targetText = serializeTokensToSearchText(segment.targetTokens);
    const presence = targetPresence.get(targetText) ?? new Map<string, boolean>();
    targetPresence.set(targetText, presence);
    const containsTarget = (text: string) => {
      let found = presence.get(text);
      if (found === undefined) {
        found = findTermPositionsInText(targetText, text, { locale: targetLocale }).length > 0;
        presence.set(text, found);
      }
      return found;
    };
    if (source.length !== target.length)
      for (const value of source) {
        const reference = terms.get(caseFold(value));
        if (!reference?.target || !containsTarget(reference.target))
          add(
            segment,
            'term-mark-count',
            value,
            reference?.target ?? '',
            `Source has ${source.length} marked terms; target has ${target.length}. Missing pair for “${value}”.`,
            reference?.origins,
          );
      }
    // Historical matches keep the existing matching/locale policy, including inflections.
    const candidates = new Map<string, Term>();
    for (const match of matches.get(segment.segmentId) ?? []) {
      const source = plainTerm(match.srcTerm),
        target = plainTerm(match.tgtTerm);
      if (source && target) {
        const key = qaKey(caseFold(source), caseFold(target));
        const term = candidates.get(key) ?? { source, target, origins: new Set<string>() };
        term.origins.add(match.tbName);
        candidates.set(key, term);
      }
    }
    let learned = learnedBySource.get(sourceText);
    if (!learned) {
      learned = [...terms.values()].filter(
        (term) =>
          term.origins.has('Current file') &&
          findTermPositionsInText(sourceText, term.source, { locale: sourceLocale }).length > 0,
      );
      learnedBySource.set(sourceText, learned);
    }
    for (const term of learned)
      candidates.set(qaKey(caseFold(term.source), caseFold(term.target)), term);
    for (const term of candidates.values())
      if (!containsTarget(term.target)) {
        add(
          segment,
          'tb-term-missing',
          term.source,
          term.target,
          `“${term.source}” expects “${term.target}” (${[...term.origins].join(', ')}).`,
          term.origins,
        );
      }
  }
  return {
    issues,
    sourceTerms: new Set(
      [...terms.values()]
        .filter((term) => term.target)
        .map((term) => caseFold(normalizeQaComparison(term.source))),
    ),
  };
}
