import type { QaIssue, Segment } from '../models';
import type { ProjectQASettings } from '../project/qaSettings';
import {
  caseFold,
  containsQaText,
  hasAsciiBoundary,
  normalizeQaComparison,
  qaKey,
  qaRow,
  qaText,
} from './text';

export interface QaDocumentRow {
  segment: Segment;
  source: string;
  target: string;
}
export function prepareQaRows(segments: readonly Segment[]): QaDocumentRow[] {
  return segments.map((segment) => ({
    segment,
    source: normalizeQaComparison(qaText(segment.sourceTokens)),
    target: normalizeQaComparison(qaText(segment.targetTokens)),
  }));
}

export function checkConsistency(
  rows: readonly QaDocumentRow[],
  reverse: boolean,
  add: (segment: Segment, issue: QaIssue) => void,
) {
  const groups = new Map<string, QaDocumentRow[]>();
  for (const row of rows) {
    const key = reverse ? row.target : row.source;
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const ruleId = reverse ? 'target-consistency' : 'source-consistency';
  for (const [key, group] of groups) {
    const variants = [...new Set(group.map((row) => (reverse ? row.source : row.target)))];
    if (variants.length < 2) continue;
    const message = `${variants.length} ${reverse ? 'sources' : 'translations'}: ${variants
      .slice(0, 10)
      .map((value) => (value.length > 120 ? `${value.slice(0, 119)}…` : value || '[empty]'))
      .join(' / ')}${variants.length > 10 ? `; ${variants.length - 10} more` : ''}`;
    for (const row of group)
      add(row.segment, {
        ruleId,
        severity: 'info',
        groupId: qaKey(ruleId, key),
        groupLabel: key,
        message,
      });
  }
}

interface Trie {
  children: Map<string, Trie>;
  value?: string;
}

export function checkSubstrings(
  rows: readonly QaDocumentRow[],
  settings: ProjectQASettings,
  sourceTerms: Set<string>,
  add: (segment: Segment, issue: QaIssue) => void,
) {
  const sources = new Map<string, QaDocumentRow[]>();
  for (const row of rows) {
    if (!row.source || sourceTerms.has(caseFold(row.source))) continue;
    const group = sources.get(row.source) ?? [];
    group.push(row);
    sources.set(row.source, group);
  }
  const trie: Trie = { children: new Map() };
  const references = new Map<string, QaDocumentRow[]>();
  for (const [source, group] of sources) {
    const target = group[0].target;
    if (!target || group.some((row) => row.target !== target)) continue;
    const effective = source.replace(/<[^>]*>|\{[^}]*\}|\[[^\]]*\]|%[-+\d.$]*[a-z]/gi, '');
    const minimum = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
      effective,
    )
      ? (settings.options?.substringMinCjk ?? 3)
      : (settings.options?.substringMinOther ?? 2);
    if (
      (effective.match(/\p{L}/gu) ?? []).length < minimum ||
      !/\p{L}/u.test(target.replace(/<[^>]*>|\{[^}]*\}|\[[^\]]*\]|%[-+\d.$]*[a-z]/gi, ''))
    )
      continue;
    let node = trie;
    for (const char of source) {
      if (!node.children.has(char)) node.children.set(char, { children: new Map() });
      node = node.children.get(char)!;
    }
    node.value = source;
    references.set(source, group);
  }
  for (const [source, group] of sources) {
    const candidates = new Set<string>();
    for (let start = 0; start < source.length; start++) {
      let node: Trie | undefined = trie;
      for (let index = start; index < source.length; ) {
        const char = String.fromCodePoint(source.codePointAt(index)!);
        node = node.children.get(char);
        if (!node) break;
        index += char.length;
        if (node.value && node.value !== source && hasAsciiBoundary(source, node.value, start))
          candidates.add(node.value);
      }
    }
    const byTarget = new Map<string, QaIssue[]>();
    for (const row of group) {
      if (!row.target) continue;
      let findings = byTarget.get(row.target);
      if (!findings) {
        findings = [];
        for (const candidate of candidates) {
          const reference = references.get(candidate)!;
          const target = reference[0].target;
          if (containsQaText(caseFold(row.target), caseFold(target))) continue;
          findings.push({
            ruleId: 'substring-consistency',
            severity: 'info',
            groupId: qaKey('substring', candidate, target),
            groupLabel: `${candidate} → ${target}`,
            message: `Expected reference translation “${target}” (row ${qaRow(reference[0].segment)}).`,
            references: reference.map((item) => ({
              segmentId: item.segment.segmentId,
              row: qaRow(item.segment),
            })),
          });
        }
        byTarget.set(row.target, findings);
      }
      for (const issue of findings) add(row.segment, issue);
    }
  }
}
