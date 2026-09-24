import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Segment } from '@cat/core/models';
import { apiClient } from '../../services/apiClient';
import { feedbackService } from '../../services/feedbackService';
import { createEditorSegmentStore } from './editorSegmentStore';
import { refreshInstantQA } from './refreshInstantQA';

vi.mock('../../services/apiClient', () => ({ apiClient: { checkSegmentQA: vi.fn() } }));
vi.mock('../../services/feedbackService', () => ({ feedbackService: { info: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
const row = (): Segment => ({
  segmentId: 'a',
  fileId: 1,
  orderIndex: 0,
  status: 'confirmed',
  sourceTokens: [],
  targetTokens: [{ type: 'text', content: 'Target' }],
  tagsSignature: '',
  matchKey: '',
  srcHash: '',
});

describe('advisory instant QA', () => {
  it('does not replace current findings when instant QA is disabled', async () => {
    const segment = {
      ...row(),
      qaIssues: [{ ruleId: 'number', severity: 'info' as const, message: 'Current result' }],
    };
    const store = createEditorSegmentStore([segment]);
    const publish = vi.fn();
    vi.mocked(apiClient.checkSegmentQA).mockResolvedValue(null);
    await refreshInstantQA(['a'], store, publish);
    expect(publish).not.toHaveBeenCalled();
    expect(store.getSegment('a')?.qaIssues).toEqual(segment.qaIssues);
  });
  it('updates findings without changing confirmed state', async () => {
    const segment = row();
    const store = createEditorSegmentStore([segment]);
    const qaIssues = [{ ruleId: 'tag-missing', severity: 'info' as const, message: 'Missing' }];
    vi.mocked(apiClient.checkSegmentQA).mockResolvedValue({
      segment: { ...segment, qaIssues },
      stale: false,
    });
    await refreshInstantQA(['a'], store, vi.fn());
    expect(store.getSegment('a')).toMatchObject({ status: 'confirmed', qaIssues });
  });
  it('reports a check failure independently of the successful confirmation', async () => {
    const store = createEditorSegmentStore([row()]);
    vi.mocked(apiClient.checkSegmentQA).mockRejectedValue(new Error('TB unavailable'));
    await expect(refreshInstantQA(['a'], store, vi.fn())).resolves.toBeUndefined();
    expect(store.getSegment('a')?.status).toBe('confirmed');
    expect(feedbackService.info).toHaveBeenCalledWith('Instant QA failed: TB unavailable');
  });
  it('discards delayed findings after local edits', async () => {
    const segment = row();
    const store = createEditorSegmentStore([segment]);
    let finish!: (result: Awaited<ReturnType<typeof apiClient.checkSegmentQA>>) => void;
    vi.mocked(apiClient.checkSegmentQA).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const publish = vi.fn();
    const pending = refreshInstantQA(['a'], store, publish);
    store.applyUpdates(
      new Map([
        ['a', { ...segment, status: 'draft', targetTokens: [{ type: 'text', content: 'Edited' }] }],
      ]),
    );
    finish({
      segment: {
        ...segment,
        qaIssues: [{ ruleId: 'number', severity: 'info', message: 'Old result' }],
      },
      stale: false,
    });
    await pending;
    expect(publish).not.toHaveBeenCalled();
    expect(store.getSegment('a')?.qaIssues).toBeUndefined();
    expect(store.getSegment('a')?.status).toBe('draft');
  });
});
