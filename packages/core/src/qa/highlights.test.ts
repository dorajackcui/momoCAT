import { describe, expect, it } from 'vitest';
import type { QaIssue, Segment, TBMatch } from '../models';
import { normalizeQASettings } from '../project';
import { parseDisplayTextToTokens } from '../tag';
import { evaluateDocumentQa } from './documentQa';
import { evaluateSegmentQa } from './evaluateSegmentQa';

function row(source: string, target: string, protect = false): Segment {
  const tagPolicy = protect ? 'default' : 'none';
  return {
    segmentId: 'row',
    fileId: 1,
    orderIndex: 0,
    status: 'draft',
    sourceTokens: parseDisplayTextToTokens(source, { tagPolicy }),
    targetTokens: parseDisplayTextToTokens(target, { tagPolicy }),
    tagsSignature: '',
    srcHash: '',
    matchKey: '',
    meta: { updatedAt: '' },
  };
}
function marked(issue: QaIssue | undefined) {
  return (
    issue?.highlights?.map(({ side, text, ranges }) => ({
      side,
      parts: ranges.map(({ start, end }) => text.slice(start, end)),
    })) ?? []
  );
}
const settings = normalizeQASettings({
  enabledRuleIds: [
    'tag-integrity',
    'number',
    'url',
    'chinese',
    'target-text',
    'terminology-consistency',
    'line-break',
    'empty-target',
  ],
  disabledCheckIds: [],
});
const run = (source: string, target: string, protect = false) =>
  evaluateDocumentQa([row(source, target, protect)], {
    settings,
    tagPolicy: protect ? 'default' : 'none',
  }).issues;

describe('QA highlight locations', () => {
  it('highlights only source terms learned from marked pairs', () => {
    const baseline = row('[Access token]', '[Credential]');
    baseline.segmentId = 'baseline';
    const actual = row('Keep your Access token safe.', 'Keep it safe.');
    const issue = evaluateDocumentQa([baseline, actual], {
      settings,
      tagPolicy: 'none',
    }).issues.find((issue) => issue.segmentId === 'row' && issue.ruleId === 'tb-term-missing');
    expect(marked(issue)).toEqual([{ side: 'source', parts: ['Access token'] }]);
  });
  it('keeps term spans on text around protected tags and maps them to editor offsets', () => {
    const actual = row('Read <b>Access</b> token now.', 'Read <b>it</b> now.', true);
    const match = { srcTerm: 'Access token', tgtTerm: 'Credential', tbName: 'Demo TB' } as TBMatch;
    const issue = evaluateDocumentQa([actual], {
      settings,
      termMatches: new Map([['row', [match]]]),
    }).issues.find((issue) => issue.ruleId === 'tb-term-missing');
    expect(marked(issue)).toEqual([{ side: 'source', parts: ['Access', ' token'] }]);
    expect(issue?.highlights?.[0].text).toBe('Read {1>Access<2} token now.');
  });
  it('uses locale-aware original source ranges for TB term inflections', () => {
    const actual = row('Accounts are ready.', 'Ready.');
    const match = { srcTerm: 'account', tgtTerm: '账户', tbName: 'Demo TB' } as TBMatch;
    const issue = evaluateDocumentQa([actual], {
      settings,
      sourceLocale: 'en-US',
      termMatches: new Map([['row', [match]]]),
      tagPolicy: 'none',
    }).issues.find((issue) => issue.ruleId === 'tb-term-missing');
    expect(marked(issue)).toEqual([{ side: 'source', parts: ['Accounts'] }]);
  });
  it('uses the existing TB match positions for inflections during sentence QA', () => {
    const actual = row('Accounts are ready.', 'Ready.');
    const match = {
      srcTerm: 'account',
      tgtTerm: '账户',
      tbName: 'Demo TB',
      positions: [{ start: 0, end: 8 }],
    } as TBMatch;
    const issue = evaluateSegmentQa(actual, {
      settings,
      tagPolicy: 'none',
      termMatches: [match],
    }).find((issue) => issue.ruleId === 'tb-term-missing');
    expect(marked(issue)).toEqual([{ side: 'source', parts: ['Accounts'] }]);
  });
  it('keeps numeric ranges in the original full-width and escaped text', () => {
    const issue = run(
      String.raw`{v1} ２０ https://x.test/123 \u0030 ２０`,
      String.raw`{v1} 21 https://x.test/456 \u0030`,
    ).find((issue) => issue.ruleId === 'number');
    expect(marked(issue)).toEqual([
      { side: 'source', parts: ['２０', '２０'] },
      { side: 'target', parts: ['21'] },
    ]);
  });
  it('highlights URL differences without surrounding or trailing punctuation', () => {
    const issue = run('(https://a.test/x).', 'https://b.test/y。').find(
      (issue) => issue.ruleId === 'url',
    );
    expect(marked(issue)).toEqual([
      { side: 'source', parts: ['https://a.test/x'] },
      { side: 'target', parts: ['https://b.test/y'] },
    ]);
  });
  it('maps missing and extra protected tags to complete editor markers', () => {
    const issues = run('{name} text', '{other} text', true);
    expect(marked(issues.find((issue) => issue.ruleId === 'tag-missing'))).toEqual([
      { side: 'source', parts: ['{1}'] },
    ]);
    expect(marked(issues.find((issue) => issue.ruleId === 'tag-extra'))).toEqual([
      { side: 'target', parts: ['{2}'] },
    ]);
  });
  it('marks literal pipe occurrences on the affected sides', () => {
    const issue = run('a||b', 'a|b').find((issue) => issue.ruleId === 'tag-count');
    expect(marked(issue)).toEqual([
      { side: 'source', parts: ['|', '|'] },
      { side: 'target', parts: ['|'] },
    ]);
  });
  it.each([
    ['chinese', 'Keep 保存 now.', ['保', '存']],
    ['abnormal-punctuation', 'Read，， now ...', ['，，']],
    ['mixed-width', 'AＡ, text，', ['Ａ', ',', '，']],
    ['paired-symbols', 'Read (settings]', [']', '(']],
    ['paired-symbols', 'Read “settings', ['“']],
  ])('marks the specific target characters for %s', (ruleId, target, parts) => {
    expect(marked(run('Source.', target).find((issue) => issue.ruleId === ruleId))).toEqual([
      { side: 'target', parts },
    ]);
  });
  it('normalizes CRLF offsets for target editor text', () => {
    const issue = run('Source.', 'First\r\nSecond，，').find(
      (issue) => issue.ruleId === 'abnormal-punctuation',
    );
    expect(issue?.highlights?.[0].text).toBe('First\nSecond，，');
    expect(marked(issue)).toEqual([{ side: 'target', parts: ['，，'] }]);
  });
  it('does not add highlights to excluded whitespace, line-break or empty checks', () => {
    for (const issue of run('One\nTwo', '  ')) expect(issue.highlights).toBeUndefined();
  });
});
