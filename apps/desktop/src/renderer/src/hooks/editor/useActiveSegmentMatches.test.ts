import { describe, expect, it, vi } from 'vitest';
import type { Segment, TBMatch } from '@cat/core/models';
import type { TMMatch } from '../../../../shared/ipc';

vi.mock('../../services/apiClient', () => ({
  apiClient: {},
}));

import { createActiveSegmentMatchLoader } from './useActiveSegmentMatches';

function createSegment(segmentId: string, srcHash: string): Segment {
  return {
    segmentId,
    fileId: 1,
    orderIndex: 0,
    sourceTokens: [{ type: 'text', content: `Source ${segmentId}` }],
    targetTokens: [],
    status: 'new',
    matchKey: `source-${segmentId}`,
    srcHash,
    tagsSignature: '',
    meta: { updatedAt: '2026-06-24T00:00:00.000Z' },
  };
}

describe('createActiveSegmentMatchLoader', () => {
  it('caches TM and TB matches by project and source hash', async () => {
    const tmMatches = [{ id: 'tm-1' }] as TMMatch[];
    const tbMatches = [{ id: 'tb-1' }] as TBMatch[];
    const getMatches = vi.fn(async () => tmMatches);
    const getTermMatches = vi.fn(async () => tbMatches);
    const loader = createActiveSegmentMatchLoader({ getMatches, getTermMatches });

    const first = await loader.load({
      projectId: 7,
      segment: createSegment('seg-1', 'same-source'),
    });
    const second = await loader.load({
      projectId: 7,
      segment: createSegment('seg-2', 'same-source'),
    });

    expect(first).toEqual({ matches: tmMatches, terms: tbMatches });
    expect(second).toEqual({ matches: tmMatches, terms: tbMatches });
    expect(getMatches).toHaveBeenCalledTimes(1);
    expect(getTermMatches).toHaveBeenCalledTimes(1);
  });

  it('keeps TM matches when TB lookup fails', async () => {
    const tmMatches = [{ id: 'tm-1' }] as TMMatch[];
    const getMatches = vi.fn(async () => tmMatches);
    const getTermMatches = vi.fn(async () => {
      throw new Error('tb unavailable');
    });
    const loader = createActiveSegmentMatchLoader({ getMatches, getTermMatches });

    await expect(
      loader.load({
        projectId: 7,
        segment: createSegment('seg-1', 'source-hash'),
      }),
    ).resolves.toEqual({ matches: tmMatches, terms: [] });
  });
});
