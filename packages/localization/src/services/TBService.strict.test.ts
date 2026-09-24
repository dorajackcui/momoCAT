import { describe, expect, it, vi } from 'vitest';
import type { Segment } from '@cat/core/models';
import type { ProjectRepository, TBRepository } from '../ports';
import { TBService } from './TBService';

type Entry = ReturnType<TBRepository['listProjectTermEntries']>[number];
const entry = (id: string, srcTerm: string, priority = 1): Entry => ({
  id,
  srcTerm,
  srcNorm: srcTerm.toLowerCase(),
  tgtTerm: `target-${id}`,
  tbId: id,
  tbName: id,
  priority,
  usageCount: 0,
  createdAt: '',
  updatedAt: '',
  note: null,
});
const segment = (source: string): Segment => ({
  segmentId: 'row',
  fileId: 1,
  orderIndex: 0,
  sourceTokens: [{ type: 'text', content: source }],
  targetTokens: [],
  status: 'empty',
  srcHash: '',
  matchKey: '',
  tagsSignature: '',
  meta: { updatedAt: '' },
});
function setup(initial: Entry[]) {
  const state = { entries: initial, version: 0, locale: 'zh-CN' };
  const list = vi.fn(() => state.entries);
  const search = vi.fn<() => Entry[]>(() => []);
  const service = new TBService(
    { getProject: () => ({ srcLang: state.locale }) } as unknown as ProjectRepository,
    {
      getTBDataVersion: () => state.version,
      listProjectTermEntries: list,
      searchProjectTermEntries: search,
    } as unknown as TBRepository,
  );
  return { state, list, search, service };
}

describe('CJK mounted terminology index', () => {
  it('loads the fallback snapshot once across unrelated rows and keeps matches complete', async () => {
    const env = setup([entry('garden', '花园'), entry('menu', '设置')]);
    for (let index = 0; index < 150; index++)
      expect(await env.service.findMatches(1, segment(`普通正文${index}`))).toEqual([]);
    const matches = await env.service.findMatches(1, segment('设置花园'));
    expect(matches.map((match) => match.id)).toEqual(['garden', 'menu']);
    expect(matches[0].positions).toEqual([{ start: 2, end: 4 }]);
    expect(env.list).toHaveBeenCalledTimes(1);
    expect(env.search).toHaveBeenCalledTimes(151);
  });

  it('retains recalled candidates instead of widening a nonempty recall to the whole TB', async () => {
    const env = setup([entry('garden', '花园'), entry('menu', '设置')]);
    env.search.mockReturnValue([env.state.entries[0]]);
    expect(
      (await env.service.findMatches(1, segment('设置花园'))).map((match) => match.id),
    ).toEqual(['garden']);
    expect(env.list).not.toHaveBeenCalled();
  });

  it('preserves priority, nested suppression and separate shorter occurrences', async () => {
    const env = setup([
      entry('preferred', '花园', 1),
      entry('other', '花园', 2),
      entry('long', '秘密花园', 3),
      entry('latin', 'Settings'),
      entry('noise', 'set'),
    ]);
    const matches = await env.service.findMatches(1, segment('秘密花园 花园 Settings unset'));
    expect(matches.map((match) => match.id)).toEqual(['latin', 'long', 'preferred']);
    expect(matches.find((match) => match.id === 'preferred')?.positions).toEqual([
      { start: 5, end: 7 },
    ]);
  });

  it('rebuilds on term changes, locale changes and explicit cross-connection invalidation', async () => {
    const env = setup([entry('first', '花园')]);
    expect((await env.service.findMatches(1, segment('花园')))[0].id).toBe('first');
    env.state.entries = [entry('new', '花园')];
    env.state.version++;
    expect((await env.service.findMatches(1, segment('花园')))[0].id).toBe('new');
    env.state.locale = 'ja-JP';
    await env.service.findMatches(1, segment('花园'));
    expect(env.list).toHaveBeenCalledTimes(3);
    env.state.entries = [];
    env.service.invalidateCachedIndexes();
    expect(await env.service.findMatches(1, segment('花园'))).toEqual([]);
    expect(env.list).toHaveBeenCalledTimes(4);
  });

  it('bounds the cache to two projects and refreshes recency on use', async () => {
    const env = setup([entry('garden', '花园')]);
    for (const projectId of [1, 2, 1, 3, 1])
      await env.service.findMatches(projectId, segment('花园'));
    expect(env.list).toHaveBeenCalledTimes(3);
    await env.service.findMatches(2, segment('花园'));
    expect(env.list).toHaveBeenCalledTimes(4);
  });
});
