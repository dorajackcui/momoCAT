import { describe, expect, it } from 'vitest';
import type { Segment, TBMatch } from '../models';
import {
  normalizeQASettings,
  isQASettings,
  QA_OPTIONAL_CHECK_IDS,
  QA_RULE_GROUPS,
  type SegmentQaRuleId,
} from '../project';
import { evaluateDocumentQa as evaluate, type DocumentQaOptions } from './documentQa';
const evaluateDocumentQa = (rows: Segment[], options: DocumentQaOptions = {}) =>
  evaluate(rows, { tagPolicy: 'none', ...options });
import { normalizeQaComparison } from './text';

function row(id: string, source: string, target: string, fileId = 1): Segment {
  return {
    segmentId: id,
    fileId,
    orderIndex: Number(id.replace(/\D/g, '')) || 0,
    sourceTokens: [{ type: 'text', content: source }],
    targetTokens: [{ type: 'text', content: target }],
    status: target ? 'draft' : 'empty',
    matchKey: source,
    srcHash: source,
    tagsSignature: '',
    meta: { updatedAt: '' },
  };
}
const settings = (...enabledRuleIds: SegmentQaRuleId[]) =>
  normalizeQASettings({ enabledRuleIds, options: { tagMode: 'standard' } });
const term = (source: string, target: string, tbName = 'Main TB'): TBMatch => ({
  id: source,
  tbId: 'tb',
  srcTerm: source,
  tgtTerm: target,
  srcNorm: source.toLowerCase(),
  tbName,
  priority: 1,
  positions: [],
  createdAt: '',
  updatedAt: '',
  usageCount: 0,
});

describe('document QA', () => {
  it('reports finding and affected-row counts without legacy severity totals', () => {
    const report = evaluateDocumentQa(
      [row('1', '1 https://source.test', '2 https://target.test'), row('2', 'Clean', 'Clean')],
      { settings: settings('number', 'url') },
    );
    expect(report).toMatchObject({ checkedSegments: 2, issueCount: 2, affectedSegments: 1 });
    expect(report.issues).toHaveLength(2);
    expect(report).not.toHaveProperty('errorCount');
    expect(report).not.toHaveProperty('warningCount');
    expect(evaluateDocumentQa([])).toEqual({
      fileId: 0,
      checkedSegments: 0,
      issueCount: 0,
      affectedSegments: 0,
      issues: [],
    });
  });
  it('normalizes only whole matching wrappers, retaining internal punctuation and case', () => {
    expect(normalizeQaComparison(' 【 ‘Open’ 】 ')).toBe('Open');
    expect(normalizeQaComparison('“Open” and “Save”')).toBe('“Open” and “Save”');
    expect(normalizeQaComparison('(one) (two)')).toBe('(one) (two)');
    expect(normalizeQaComparison('{name}')).toBe('{name}');
  });
  it('groups all rows of conflicting source translations, including an empty variant', () => {
    const report = evaluateDocumentQa(
      [row('1', 'Open', '打开'), row('2', '“Open”', '开启'), row('3', 'Open', '')],
      { settings: settings('source-consistency') },
    );
    expect(report.affectedSegments).toBe(3);
    expect(new Set(report.issues.map((issue) => issue.groupId)).size).toBe(1);
    expect(report.issues[0].message).toContain('[empty]');
  });
  it('never compares rows from different files', () => {
    expect(
      evaluateDocumentQa([row('1', 'Open', '打开', 1), row('2', 'Open', '开启', 2)], {
        settings: settings('source-consistency'),
      }).issues,
    ).toEqual([]);
  });
  it('skips empty targets for reverse consistency', () => {
    expect(
      evaluateDocumentQa([row('1', 'A', ''), row('2', 'B', '')], {
        settings: settings('target-consistency'),
      }).issues,
    ).toEqual([]);
    expect(
      evaluateDocumentQa([row('1', 'A', 'a'), row('2', 'B', 'a')], {
        settings: settings('target-consistency'),
      }).affectedSegments,
    ).toBe(2);
  });
  it('honors both group switches and individual subchecks, including empty target', () => {
    const config = settings('empty-target', 'target-text');
    config.disabledCheckIds = ['leading-trailing-spaces', 'consecutive-spaces'];
    expect(
      evaluateDocumentQa([row('1', 'A', '  \u00a0')], { settings: config }).issues.map(
        (issue) => issue.ruleId,
      ),
    ).toEqual(['empty-target']);
    config.enabledRuleIds = [];
    expect(evaluateDocumentQa([row('1', 'A', '')], { settings: config }).issues).toEqual([]);
  });
  it('compares numbers as repeated expressions, ignoring URL, marker and escape numbers', () => {
    const report = evaluateDocumentQa(
      [
        row(
          '1',
          '{v1} ２０２６-09-23 100; 100 https://x.test/123 \\u1234',
          '{v1} 2026-09-23 100 https://x.test/456 \\u5678',
        ),
      ],
      { settings: settings('number', 'url') },
    );
    expect(report.issues.find((issue) => issue.ruleId === 'number')?.message).toBe('Missing: 100');
    expect(report.issues.find((issue) => issue.ruleId === 'url')?.message).toContain(
      'https://x.test/123',
    );
  });
  it('allows reordered numbers and URLs and excludes sentence punctuation', () => {
    expect(
      evaluateDocumentQa([row('1', '1 2 (https://a.test/x).', 'https://a.test/x 2 1')], {
        settings: settings('number', 'url'),
      }).issues,
    ).toEqual([]);
  });
  it('counts real line breaks separately from literal newline markers', () => {
    const report = evaluateDocumentQa([row('1', 'a\r\nb\nc\\n', 'a\rb\\n')], {
      settings: settings('line-break'),
    });
    expect(report.issues[0].message).toBe('Source: 2 line breaks; target: 1.');
  });
  it('checks tag occurrences and nesting, allowing sibling reorder by default', () => {
    const report = evaluateDocumentQa([row('1', '<b>x</b><i>y</i>{a}{a}', '<i>x</i><b>y</b>{a}')], {
      settings: settings('tag-integrity'),
    });
    expect(report.issues.map((issue) => issue.ruleId)).toEqual(['tag-count']);
    const bad = evaluateDocumentQa([row('1', '<b><i>x</i></b>', '<b><i>x</b></i>')], {
      settings: settings('tag-integrity'),
    });
    expect(bad.issues.map((issue) => issue.ruleId)).toEqual(['tag-structure']);
  });
  it('checks selected raw tag types and ignores the legacy mode choice', () => {
    const config = settings('tag-integrity');
    config.options = { ...config.options, tagTypes: ['brace'] };
    const segment = row('1', '<b>Text</b>[color=red]red[/color]{name}\\n', 'Text');
    expect(
      evaluateDocumentQa([segment], { settings: config }).issues.map((issue) => issue.message),
    ).toEqual(['Missing: {name}']);
    config.options.tagTypes = [];
    expect(evaluateDocumentQa([segment], { settings: config }).issues).toEqual([]);
    config.options.tagMode = 'memoq';
    expect(evaluateDocumentQa([row('1', '{1}Text', 'Text')], { settings: config }).issues).toEqual(
      [],
    );
  });
  it('always checks the basics when their parent is enabled, including legacy disabled settings', () => {
    const config = settings('tag-integrity', 'terminology-consistency');
    config.disabledCheckIds = [
      'tag-missing',
      'tag-extra',
      'tag-count',
      'tag-structure',
      'tb-term-missing',
      'term-conflict',
      'tag-order',
    ];
    expect(normalizeQASettings(config).disabledCheckIds).toEqual(['tag-order']);
    expect(
      evaluateDocumentQa([row('1', '{a}', '{b}')], { settings: config }).issues.map(
        (issue) => issue.ruleId,
      ),
    ).toEqual(['tag-missing', 'tag-extra']);
    expect(
      evaluateDocumentQa([row('1', 'Open', '开启')], {
        settings: config,
        termMatches: new Map([['1', [term('Open', '打开')]]]),
      }).issues[0].ruleId,
    ).toBe('tb-term-missing');
    expect(isQASettings({ ...config, options: { tagTypes: ['unknown'] } })).toBe(false);
  });
  it('recognizes quoted tag attributes, memoQ markers, optional ordering and ignored tags', () => {
    const config = settings('tag-integrity');
    config.disabledCheckIds = [];
    expect(
      evaluateDocumentQa([row('1', '<x a=">">{a}</x>', '<x a=">">{a}</x>')], { settings: config })
        .issues,
    ).toEqual([]);
    config.options = { tagMode: 'memoq' };
    expect(
      evaluateDocumentQa([row('1', '{first}{second}Ice', '{second}冰{first}')], {
        settings: config,
      }).issues.map((issue) => issue.ruleId),
    ).toEqual(['tag-order']);
    config.options = { ignoredTags: ['<br/>'] };
    expect(evaluateDocumentQa([row('1', '<br/>A', 'A')], { settings: config }).issues).toEqual([]);
    expect(
      evaluateDocumentQa([row('1', '{x}', 'a')], { settings: config, tagPolicy: 'default' }).issues,
    ).toEqual([]);
  });
  it('checks punctuation, ASCII spaces, widths and pairs without flagging apostrophes or ellipses', () => {
    expect(
      evaluateDocumentQa([row('1', '', `don't l’orage ... … !! ??`)], {
        settings: settings('target-text'),
      }).issues,
    ).toEqual([]);
    const report = evaluateDocumentQa([row('1', '', '  AＡ ([)] .. ')], {
      settings: settings('target-text'),
    });
    expect(report.issues.map((issue) => issue.ruleId)).toEqual(
      expect.arrayContaining([
        'abnormal-punctuation',
        'consecutive-spaces',
        'leading-trailing-spaces',
        'mixed-width',
        'paired-symbols',
      ]),
    );
  });
  it('groups term violations by pair, deduplicating mounted sources', () => {
    const matches = new Map([
      ['1', [term('Open', '打开'), term('Open', '打开', 'Other TB')]],
      ['2', [term('Open', '打开')]],
    ]);
    const report = evaluateDocumentQa(
      [row('1', 'Open', '开启'), row('2', 'Open file', '开启文件')],
      { settings: settings('terminology-consistency'), termMatches: matches },
    );
    expect(report.issues).toHaveLength(2);
    expect(report.issues[0].groupLabel).toBe('Open → 打开');
    expect(report.issues[0].groupId).toBe(report.issues[1].groupId);
    expect(report.issues[0].message).toContain('Other TB');
    expect(report.issues[0].origins).toEqual(['Main TB', 'Other TB']);
  });
  it('learns marked terms and checks earlier unmarked rows without changing TB', () => {
    const report = evaluateDocumentQa(
      [row('1', 'Open file', '开启文件'), row('2', '[Open]', '[打开]')],
      { settings: settings('terminology-consistency'), sourceLocale: 'en', targetLocale: 'zh' },
    );
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({
      segmentId: '1',
      groupLabel: 'Open → 打开',
      origins: ['Current file'],
    });
  });
  it('rejects an entire conflicting marked row as a learning baseline', () => {
    const report = evaluateDocumentQa(
      [row('1', '[Open] [Save]', '[开启] [存档]'), row('2', 'Save', '保存')],
      {
        settings: settings('terminology-consistency'),
        termMatches: new Map([['1', [term('Open', '打开')]]]),
      },
    );
    expect(report.issues.some((issue) => issue.segmentId === '2')).toBe(false);
    expect(report.issues.some((issue) => issue.ruleId === 'term-conflict')).toBe(true);
  });
  it('checks all valid substring relationships and retains reference row identity', () => {
    const report = evaluateDocumentQa(
      [row('1', 'Open', '打开'), row('2', 'Open file', '开启文件')],
      { settings: settings('substring-consistency') },
    );
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({
      segmentId: '2',
      references: [{ segmentId: '1', row: 2 }],
    });
    expect(
      evaluateDocumentQa([row('1', 'he', '他'), row('2', 'the', '这')], {
        settings: settings('substring-consistency'),
      }).issues,
    ).toEqual([]);
  });
  it('does not use conflicting or empty-target references for substring checks', () => {
    expect(
      evaluateDocumentQa(
        [row('1', 'Open', ''), row('2', 'Open', '打开'), row('3', 'Open file', '开启文件')],
        { settings: settings('substring-consistency') },
      ).issues,
    ).toEqual([]);
  });
  it('validates nested settings at the public boundary', () => {
    expect(isQASettings(settings('number'))).toBe(true);
    expect(isQASettings({ ...settings('number'), options: { substringMinCjk: -1 } })).toBe(false);
    expect(isQASettings({ ...settings('number'), disabledCheckIds: ['unknown'] })).toBe(false);
  });
  it('accepts only independently optional checks in new settings, while normalizing legacy data', () => {
    for (const id of QA_RULE_GROUPS.flatMap((group) => group.checks.map((check) => check[0]))) {
      const config = { ...settings('tag-integrity'), disabledCheckIds: [id] };
      const optional = QA_OPTIONAL_CHECK_IDS.includes(id);
      expect(isQASettings(config), id).toBe(optional);
      expect(normalizeQASettings(config).disabledCheckIds, id).toEqual(optional ? [id] : []);
    }
    expect(isQASettings({ ...settings('number'), disabledCheckIds: new Array(1) })).toBe(false);
  });
});
