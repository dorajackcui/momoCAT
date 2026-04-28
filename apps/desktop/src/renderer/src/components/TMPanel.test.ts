import { describe, expect, it } from 'vitest';
import type { TBMatch } from '@cat/core/models';
import type { TMMatch } from './TMPanel';
import { buildCombinedMatches } from './TMPanel';

function createTMMatch(index: number, similarity: number): TMMatch {
  const now = new Date().toISOString();
  return {
    id: `tm-${index}`,
    projectId: 1,
    srcLang: 'zh-CN',
    tgtLang: 'fr-FR',
    srcHash: `hash-${index}`,
    matchKey: `key-${index}`,
    tagsSignature: '',
    sourceTokens: [{ type: 'text', content: `source-${index}` }],
    targetTokens: [{ type: 'text', content: `target-${index}` }],
    usageCount: index + 1,
    createdAt: now,
    updatedAt: now,
    kind: 'tm',
    rank: similarity,
    similarity,
    tmName: 'Main TM',
    tmType: 'main',
  };
}

function createConcordanceMatch(index: number, rank: number): TMMatch {
  const now = new Date().toISOString();
  return {
    id: `concordance-${index}`,
    projectId: 1,
    srcLang: 'zh-CN',
    tgtLang: 'fr-FR',
    srcHash: `concordance-hash-${index}`,
    matchKey: `concordance-key-${index}`,
    tagsSignature: '',
    sourceTokens: [{ type: 'text', content: `context-source-${index}` }],
    targetTokens: [{ type: 'text', content: `context-target-${index}` }],
    usageCount: index + 1,
    createdAt: now,
    updatedAt: now,
    kind: 'concordance',
    rank,
    tmName: 'Main TM',
    tmType: 'main',
    matchedSourceText: '麦浪农场',
    sourceCoverage: 100,
    entryCoverage: 10,
  };
}

function createTBMatch(index: number): TBMatch {
  const now = new Date().toISOString();
  return {
    id: `tb-${index}`,
    tbId: 'tb-main',
    tbName: 'TB',
    srcTerm: `src-term-${index}`,
    tgtTerm: `tgt-term-${index}`,
    createdAt: now,
    updatedAt: now,
    usageCount: 1,
    note: null,
    positions: [{ start: 0, end: 1 }],
    srcNorm: `src-term-${index}`,
    priority: 10,
  };
}

describe('buildCombinedMatches', () => {
  it('caps TM items to the requested limit', () => {
    const matches = Array.from({ length: 8 }, (_, index) => createTMMatch(index, 100 - index));
    const combined = buildCombinedMatches(matches, [], 5);
    const tmItems = combined.filter((item) => item.kind === 'tm');
    expect(tmItems).toHaveLength(5);
    expect(tmItems[0].id).toContain('tm-0');
    expect(tmItems[4].id).toContain('tm-4');
  });

  it('keeps TB items untouched when TM items are capped', () => {
    const matches = Array.from({ length: 7 }, (_, index) => createTMMatch(index, 95 - index));
    const tbMatches = [createTBMatch(1), createTBMatch(2)];
    const combined = buildCombinedMatches(matches, tbMatches, 5);

    const tmItems = combined.filter((item) => item.kind === 'tm');
    const tbItems = combined.filter((item) => item.kind === 'tb');

    expect(tmItems).toHaveLength(5);
    expect(tbItems).toHaveLength(2);
  });

  it('sorts concordance suggestions by rank without requiring similarity', () => {
    const matches = [createTMMatch(1, 80), createConcordanceMatch(2, 90)];
    const combined = buildCombinedMatches(matches, [], 5);

    expect(combined[0].payload).toMatchObject({
      kind: 'concordance',
      rank: 90,
    });
    expect(combined[0].payload).not.toHaveProperty('similarity');
  });
});
