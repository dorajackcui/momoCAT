import { describe, expect, it } from 'vitest';
import type { Segment } from '../models';
import { normalizeQASettings, type SegmentQaRuleId } from '../project';
import { evaluateDocumentQa } from './documentQa';

// Compared with QAtools 5ed84103f3936473cf519b9c23f7acb154d10808.
const cases: Array<[string, SegmentQaRuleId, string, string, boolean]> = [
  ['full-width numbers', 'number', '１２３％', '123%', false],
  ['thousands separators remain significant', 'number', "1'234", '1 234', true],
  ['encoded characters are not numbers', 'number', '&#123;', '&#456;', false],
  ['dash normalization', 'number', '10–20', '10-20', false],
  ['per mille is part of the number', 'number', '10‰', '10', true],
  ['URL quotes', 'url', "'https://a.test/x'", 'https://a.test/x', false],
  ['URL Chinese wrappers', 'url', '【https://a.test/x】', 'https://a.test/x', false],
  ['URL word boundary', 'url', 'awww.test.com', '', false],
  ['uppercase color tags', 'tag-integrity', '[COLOR=red]x[/COLOR]', 'x', true],
  ['spaced color tags', 'tag-integrity', '[color = red]x', 'x', true],
  ['literal newline is case sensitive', 'tag-integrity', '\\N', '', false],
  ['mixed repeated dots', 'target-text', '', '．。', true],
  ['equivalent full-width period', 'target-text', '', 'a. b。', true],
  ['allowed punctuation', 'target-text', '', "don't l’orage ... … !! ??", false],
];

const row = (id: number, source: string, target: string): Segment => ({
  segmentId: String(id),
  fileId: 1,
  orderIndex: id,
  sourceTokens: [{ type: 'text', content: source }],
  targetTokens: [{ type: 'text', content: target }],
  status: 'draft',
  tagsSignature: '',
  srcHash: source,
  matchKey: source,
  meta: { updatedAt: '' },
});

describe('QAtools content-check compatibility', () => {
  it.each(cases)('%s', (_label, rule, source, target, expected) => {
    const report = evaluateDocumentQa([row(1, source, target)], {
      tagPolicy: 'none',
      settings: normalizeQASettings({ enabledRuleIds: [rule] }),
    });
    expect(report.issues.length > 0).toBe(expected);
  });

  it('does not use a printf-only translation as a substring reference', () => {
    expect(
      evaluateDocumentQa([row(1, 'Name', '%s'), row(2, 'Name field', '字段')], {
        settings: normalizeQASettings({ enabledRuleIds: ['substring-consistency'] }),
      }).issues,
    ).toEqual([]);
  });
});
