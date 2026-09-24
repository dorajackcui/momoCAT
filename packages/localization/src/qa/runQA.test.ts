import { describe, expect, it, vi } from 'vitest';
import type { Segment } from '@cat/core/models';
import { normalizeQASettings } from '@cat/core/project';
import { runQA } from './runQA';

function row(segmentId: string, source: string, target: string): Segment {
  return {
    segmentId,
    fileId: 1,
    orderIndex: 0,
    status: 'draft',
    sourceTokens: [{ type: 'text', content: source }],
    targetTokens: [{ type: 'text', content: target }],
    srcHash: '',
    matchKey: '',
    tagsSignature: '',
    meta: { updatedAt: '' },
  };
}

describe('shared QA workflow', () => {
  it('resolves repeated sources once without dropping any affected row', async () => {
    const resolveTermMatches = vi
      .fn()
      .mockResolvedValue([{ srcTerm: 'Open', tgtTerm: '打开', tbName: 'Main', positions: [] }]);
    const report = await runQA({
      segments: [row('a', 'Open', '开启'), row('b', 'Open', '打开'), row('c', 'Open', '开')],
      settings: normalizeQASettings({ enabledRuleIds: ['terminology-consistency'] }),
      resolveTermMatches,
    });
    expect(resolveTermMatches).toHaveBeenCalledTimes(1);
    expect(report.issues.map((issue) => issue.segmentId)).toEqual(['a', 'c']);
  });

  it('does not resolve terminology when disabled and honors cancellation', async () => {
    const resolveTermMatches = vi.fn();
    await runQA({
      segments: [row('a', 'Open', '')],
      resolveTermMatches,
      settings: normalizeQASettings({ enabledRuleIds: ['empty-target'] }),
    });
    expect(resolveTermMatches).not.toHaveBeenCalled();
    await expect(
      runQA({ segments: [row('a', 'Open', '')], signal: AbortSignal.abort() }),
    ).rejects.toThrow();
  });
});
