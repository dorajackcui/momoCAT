import { describe, expect, it } from 'vitest';
import type { Segment, TBMatch } from '../models';
import { normalizeQASettings } from '../project';
import { evaluateDocumentQa } from './documentQa';
import { evaluateSegmentQa } from './evaluateSegmentQa';

const settings = normalizeQASettings({ enabledRuleIds: ['terminology-consistency'] });
const term: TBMatch = {
  id: 'open',
  tbId: 'tb',
  srcTerm: 'Open',
  tgtTerm: '打开',
  srcNorm: 'open',
  tbName: 'Main TB',
  priority: 1,
  positions: [],
  createdAt: '',
  updatedAt: '',
  usageCount: 0,
};
function row(source: string, target: string, segmentId = 'a'): Segment {
  return {
    segmentId,
    fileId: 1,
    orderIndex: 0,
    status: 'draft',
    sourceTokens: [{ type: 'text', content: source }],
    targetTokens: [{ type: 'text', content: target }],
    tagsSignature: '',
    srcHash: source,
    matchKey: source,
    meta: { updatedAt: '' },
  };
}

describe('instant terminology QA', () => {
  it.each([
    ['[Open]', '[开启]（打开）'],
    ['【Open】', '【开启】（打开）'],
    ['［Open］', '［开启］（打开）'],
  ])(
    'reports a conflicting pair even when the TB target appears elsewhere: %s',
    (source, target) => {
      const segment = row(source, target);
      const instant = evaluateSegmentQa(segment, { settings, termMatches: [term] });
      expect(instant).toHaveLength(1);
      expect(instant[0]).toMatchObject({
        ruleId: 'term-conflict',
        groupLabel: 'Open → 打开',
        origins: ['Main TB'],
      });
      const full = evaluateDocumentQa([segment], {
        settings,
        termMatches: new Map([[segment.segmentId, [term]]]),
      });
      expect(instant[0].message).toBe(full.issues[0].message);
    },
  );

  it('retains missing TB translation feedback', () => {
    expect(
      evaluateSegmentQa(row('[Open]', '[开启]'), { settings, termMatches: [term] }).map(
        (issue) => issue.ruleId,
      ),
    ).toEqual(['term-conflict', 'tb-term-missing']);
  });

  it('detects conflicting repeated pairs within the same row without a TB', () => {
    const issues = evaluateSegmentQa(row('[Open] [Open]', '[打开] [开启]'), { settings });
    expect(issues.map((issue) => issue.ruleId)).toEqual(['term-conflict']);
  });

  it('respects terminology and term-mark switches', () => {
    const segment = row('[Open]', '[开启]（打开）');
    expect(
      evaluateSegmentQa(segment, {
        settings: normalizeQASettings({ enabledRuleIds: [] }),
        termMatches: [term],
      }),
    ).toEqual([]);
    expect(
      evaluateSegmentQa(segment, {
        settings: normalizeQASettings({ ...settings, options: { termMarks: ['corner'] } }),
        termMatches: [term],
      }),
    ).toEqual([]);
    expect(evaluateSegmentQa(row('[Open]', '[打开]'), { settings, termMatches: [term] })).toEqual(
      [],
    );
  });

  it('leaves mark-count checks to the document baseline', () => {
    const segment = row('[Open]', '打开');
    expect(evaluateDocumentQa([segment], { settings }).issues.map((issue) => issue.ruleId)).toEqual(
      ['term-mark-count'],
    );
    expect(
      evaluateDocumentQa([segment, row('[Open]', '[打开]', 'reference')], { settings }).issues,
    ).toEqual([]);
    expect(evaluateSegmentQa(segment, { settings })).toEqual([]);
  });
});
