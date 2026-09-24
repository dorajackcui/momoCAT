import { describe, expect, it } from 'vitest';
import type { Segment } from '../models';
import { normalizeQASettings } from '../project';
import { parseDisplayTextToTokens } from '../tag';
import { evaluateDocumentQa, evaluateSegmentQa, TagValidator } from './index';

function segment(source: string, target: string): Segment {
  return {
    segmentId: 'row',
    fileId: 1,
    orderIndex: 0,
    status: 'draft',
    sourceTokens: parseDisplayTextToTokens(source),
    targetTokens: parseDisplayTextToTokens(target),
    tagsSignature: '',
    srcHash: '',
    matchKey: '',
    meta: {},
  };
}

describe('shared tag rules across document, segment and compatibility QA', () => {
  it.each([
    ['missing', '{name}', '', ['tag-missing']],
    ['extra', '{name}', '{name}{other}', ['tag-extra']],
    ['fewer occurrences', '{name}{name}', '{name}', ['tag-count']],
    ['more occurrences', '{name}', '{name}{name}', ['tag-count']],
    ['printf occurrences', '%s %s', '%s', ['tag-count']],
    ['escaped newline occurrences', 'a\\nb\\nc', 'a\\nb', ['tag-count']],
    ['escaped carriage return occurrences', 'a\\rb\\rc', 'a\\rb', ['tag-count']],
    ['nesting', '<b><i>x</i></b>', '<i><b>x</b></i>', ['tag-structure']],
    ['invalid closing', '<b><i>x</i></b>', '<b><i>x</b></i>', ['tag-structure']],
    ['Unicode nesting', '❮b❯❮i❯x❮/i❯❮/b❯', '❮i❯❮b❯x❮/b❯❮/i❯', ['tag-structure']],
    ['missing closing', '<b>x</b>', '<b>x', ['tag-missing', 'tag-structure']],
    ['order only', '<b>x</b><i>y</i>', '<i>y</i><b>x</b>', ['tag-order']],
    ['identical repeated tags', '{name}{name}', '{name}{name}', []],
    ['real line breaks', 'a\nb\rc', 'abc', []],
    ['invalid source structure', '<b><i>x</b></i>', '<i><b>x</b></i>', ['tag-order']],
  ] as const)('%s', (_name, source, target, expected) => {
    const row = segment(source, target);
    const settings = normalizeQASettings({
      enabledRuleIds: ['tag-integrity'],
      disabledCheckIds: [],
    });
    const fileIssues = evaluateDocumentQa([row], { settings }).issues;
    const sentenceIssues = evaluateSegmentQa(row, { settings });
    const compatibilityIssues = new TagValidator().validate(
      row.sourceTokens,
      row.targetTokens,
    ).issues;
    for (const issues of [fileIssues, sentenceIssues, compatibilityIssues]) {
      expect(
        issues.filter((issue) => issue.ruleId !== 'tag-order').map((issue) => issue.ruleId),
      ).toEqual(expected.filter((rule) => rule !== 'tag-order'));
    }
    expect(
      compatibilityIssues
        .filter((issue) => issue.ruleId !== 'tag-order')
        .map(({ ruleId, message }) => ({ ruleId, message })),
    ).toEqual(sentenceIssues.map(({ ruleId, message }) => ({ ruleId, message })));
  });

  it('ignores the legacy mode setting and cannot disable protected integrity', () => {
    const settings = normalizeQASettings({
      enabledRuleIds: [],
      instantQaOnConfirm: false,
      options: { tagMode: 'standard', tagTypes: [], ignoredTags: ['<b>', '</b>'] },
    });
    expect(settings.options?.tagMode).toBeUndefined();
    const issues = evaluateDocumentQa([segment('<b>x</b>', 'x')], { settings }).issues;
    expect(issues.map((issue) => issue.ruleId)).toEqual(['tag-missing', 'tag-structure']);
  });

  it('checks configured standard syntax only in Plain files without blocking', () => {
    const row = segment('<b>{name}</b>', '{name}');
    const settings = normalizeQASettings({
      enabledRuleIds: ['tag-integrity'],
      options: { tagTypes: ['brace'] },
    });
    expect(evaluateDocumentQa([row], { settings, tagPolicy: 'none' }).issues).toEqual([]);
    settings.options!.tagTypes = ['angle'];
    const issues = evaluateDocumentQa([row], { settings, tagPolicy: 'none' }).issues;
    expect(issues.map((issue) => issue.ruleId)).toEqual(['tag-missing', 'tag-structure']);
    settings.options!.ignoredTags = ['<b>', '</b>'];
    expect(evaluateDocumentQa([row], { settings, tagPolicy: 'none' }).issues).toEqual([]);
    expect(evaluateDocumentQa([row], { settings }).issues.length).toBeGreaterThan(0);
  });

  it('does not promote literal marker-looking text into protected tokens', () => {
    const row = segment('x', 'x');
    row.sourceTokens = [{ type: 'text', content: '{1} <color=red>' }];
    expect(evaluateSegmentQa(row)).toEqual([]);
    expect(new TagValidator().validate(row.sourceTokens, row.targetTokens).issues).toEqual([]);
  });

  it('counts original tags rather than collapsing them into editor marker numbers', () => {
    const row = segment('{first}{second}', '{first}{third}');
    expect(evaluateSegmentQa(row).map((issue) => issue.ruleId)).toEqual([
      'tag-missing',
      'tag-extra',
    ]);
  });
});
