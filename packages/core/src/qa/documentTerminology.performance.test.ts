import { describe, expect, it, vi } from 'vitest';
import type { Segment } from '../models';
import { normalizeQASettings } from '../project';
import * as normalization from '../text/termNormalization';
import { evaluateDocumentQa } from './documentQa';

describe('learned terminology at document scale', () => {
  it('checks learned terms before and after their defining rows without scanning the full vocabulary per row', () => {
    const rows: Segment[] = [];
    const add = (source: string, target: string) =>
      rows.push({
        segmentId: String(rows.length),
        fileId: 1,
        orderIndex: rows.length,
        sourceTokens: [{ type: 'text', content: source }],
        targetTokens: [{ type: 'text', content: target }],
        status: 'draft',
        srcHash: '',
        matchKey: '',
        tagsSignature: '',
        meta: { updatedAt: '' },
      });
    add('术语00299之前', 'wrong');
    for (let index = 0; index < 300; index++) {
      const suffix = String(index).padStart(5, '0');
      add(`【术语${suffix}】`, `【term${suffix}】`);
    }
    add('术语00000之后', 'wrong');
    const normalize = vi.spyOn(normalization, 'normalizeTextWithIndexMap');
    try {
      const report = evaluateDocumentQa(rows, {
        settings: normalizeQASettings({ enabledRuleIds: ['terminology-consistency'] }),
        sourceLocale: 'zh-CN',
        targetLocale: 'en-US',
        tagPolicy: 'none',
      });
      expect(
        report.issues.map((issue) => [issue.segmentId, issue.ruleId, issue.groupLabel]),
      ).toEqual([
        ['0', 'tb-term-missing', '术语00299 → term00299'],
        ['301', 'tb-term-missing', '术语00000 → term00000'],
      ]);
      // A per-row vocabulary loop would exceed 180k normalizations on this fixture.
      expect(normalize.mock.calls.length).toBeLessThan(4000);
    } finally {
      normalize.mockRestore();
    }
  });
});
