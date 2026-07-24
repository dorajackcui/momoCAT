import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TBMatch } from '@cat/core/models';
import type { TMMatch } from './TMPanel';
import { buildCombinedMatches, resolveSelectedTMMatch, TMPanel } from './TMPanel';

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

  it('selects the highest-ranked TM by default even when a TB sorts above it', () => {
    const combined = buildCombinedMatches([createTMMatch(1, 80)], [createTBMatch(1)], 5);
    const selected = resolveSelectedTMMatch(combined);

    expect(combined[0].kind).toBe('tb');
    expect(selected?.kind).toBe('tm');
    expect(selected?.payload.id).toBe('tm-1');
  });

  it('preserves an explicit TM selection while it remains available', () => {
    const combined = buildCombinedMatches([createTMMatch(1, 95), createTMMatch(2, 80)], [], 5);
    const secondTM = combined.find((item) => item.kind === 'tm' && item.payload.id === 'tm-2');

    expect(resolveSelectedTMMatch(combined, secondTM?.id)?.payload.id).toBe('tm-2');
  });

  it('renders the source comparison for the default TM selection', () => {
    const html = renderToStaticMarkup(
      React.createElement(TMPanel, {
        matches: [createTMMatch(1, 95)],
        termMatches: [],
        activeSegmentId: 'segment-1',
        currentSourceTokens: [{ type: 'text', content: 'source-updated' }],
        sourceLocale: 'en-US',
        onApply: () => {},
        onApplyTerm: () => {},
      }),
    );

    expect(html).toContain('TM source');
    expect(html).toContain('Current');
    expect(html).toContain('bg-danger-soft');
    expect(html).toContain('bg-success-soft');
    expect(html).toContain('quiet-scrollbar');
    expect(html).toContain('line-clamp-5');
    expect(html).not.toContain('>...<');
    expect(html).not.toContain('>less<');
    expect(html).toContain('border-l-border bg-muted/60');
    expect(html).not.toContain('border-l-brand/70');
    expect(html).not.toContain('bg-brand-soft');
  });

  it('hides the source comparison when only TB matches are available', () => {
    const html = renderToStaticMarkup(
      React.createElement(TMPanel, {
        matches: [],
        termMatches: [createTBMatch(1)],
        activeSegmentId: 'segment-1',
        currentSourceTokens: [{ type: 'text', content: 'source-1' }],
        sourceLocale: 'en-US',
        onApply: () => {},
        onApplyTerm: () => {},
      }),
    );

    expect(html).not.toContain('TM source');
    expect(html).not.toContain('Current source');
  });
});
