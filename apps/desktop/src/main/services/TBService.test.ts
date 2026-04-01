import { describe, expect, it, vi } from 'vitest';
import type { Segment, Token } from '@cat/core/models';
import { TBService } from './TBService';
import type { ProjectRepository, TBRepository } from './ports';

function buildSegment(sourceText: string | Token[]): Segment {
  const sourceTokens = Array.isArray(sourceText)
    ? sourceText
    : [{ type: 'text', content: sourceText }];

  return {
    segmentId: 'seg-1',
    fileId: 1,
    orderIndex: 0,
    sourceTokens,
    targetTokens: [],
    status: 'new',
    tagsSignature: '',
    matchKey: 'source-hash',
    srcHash: 'source-hash',
    meta: {
      updatedAt: new Date().toISOString(),
    },
  };
}

function createServiceWithEntries(
  entries: ReturnType<TBRepository['listProjectTermEntries']>,
  options?: {
    searchEntries?: ReturnType<TBRepository['searchProjectTermEntries']>;
    srcLang?: string;
    tgtLang?: string;
  },
) {
  const projectRepoMock = {
    getProject: () => ({
      id: 1,
      srcLang: options?.srcLang ?? 'en-US',
      tgtLang: options?.tgtLang ?? 'fr-FR',
    }),
  } satisfies Pick<ProjectRepository, 'getProject'>;
  const dbMock = {
    listProjectTermEntries: () => entries,
    searchProjectTermEntries: () => options?.searchEntries ?? entries,
  } satisfies Pick<TBRepository, 'listProjectTermEntries' | 'searchProjectTermEntries'>;
  return new TBService(projectRepoMock as ProjectRepository, dbMock as TBRepository);
}

describe('TBService', () => {
  it('matches latin term with word boundary and ignores partial word match', async () => {
    const service = createServiceWithEntries([
      {
        id: 'tb-1',
        tbId: 'tb-a',
        srcTerm: 'winter',
        tgtTerm: 'hiver',
        srcNorm: 'winter',
        note: null,
        createdAt: '',
        updatedAt: '',
        usageCount: 1,
        tbName: 'Season TB',
        priority: 1,
      },
      {
        id: 'tb-2',
        tbId: 'tb-a',
        srcTerm: 'win',
        tgtTerm: '胜利',
        srcNorm: 'win',
        note: null,
        createdAt: '',
        updatedAt: '',
        usageCount: 1,
        tbName: 'Noise TB',
        priority: 2,
      },
    ]);

    const matches = await service.findMatches(1, buildSegment('Warmth Amid Winter'));
    expect(matches).toHaveLength(1);
    expect(matches[0].srcTerm).toBe('winter');
    expect(matches[0].tgtTerm).toBe('hiver');
  });

  it('matches cjk term in sentence', async () => {
    const service = createServiceWithEntries([
      {
        id: 'tb-3',
        tbId: 'tb-b',
        srcTerm: '设置',
        tgtTerm: 'settings',
        srcNorm: '设置',
        note: null,
        createdAt: '',
        updatedAt: '',
        usageCount: 1,
        tbName: 'UI TB',
        priority: 1,
      },
    ]);

    const matches = await service.findMatches(1, buildSegment('请点击设置按钮然后保存'));
    expect(matches).toHaveLength(1);
    expect(matches[0].positions.length).toBe(1);
    expect(matches[0].positions[0].start).toBe(3);
  });

  it('matches source term across tags because TB lookup uses text-only matching', async () => {
    const service = createServiceWithEntries([
      {
        id: 'tb-3b',
        tbId: 'tb-b',
        srcTerm: 'API key',
        tgtTerm: 'APIキー',
        srcNorm: 'api key',
        note: null,
        createdAt: '',
        updatedAt: '',
        usageCount: 1,
        tbName: 'UI TB',
        priority: 1,
      },
    ]);

    const matches = await service.findMatches(
      1,
      buildSegment([
        { type: 'text', content: 'Use your API ' },
        { type: 'tag', content: '<b>' },
        { type: 'text', content: 'key' },
        { type: 'tag', content: '</b>' },
        { type: 'text', content: ' to sign in.' },
      ]),
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].srcTerm).toBe('API key');
  });

  it('matches width-normalized latin term in source text', async () => {
    const service = createServiceWithEntries([
      {
        id: 'tb-3c',
        tbId: 'tb-b',
        srcTerm: 'API key',
        tgtTerm: 'API key',
        srcNorm: 'api key',
        note: null,
        createdAt: '',
        updatedAt: '',
        usageCount: 1,
        tbName: 'UI TB',
        priority: 1,
      },
    ]);

    const matches = await service.findMatches(1, buildSegment('请保管好ＡＰＩ key。'));
    expect(matches).toHaveLength(1);
  });

  it('sorts by longer source term first', async () => {
    const service = createServiceWithEntries([
      {
        id: 'tb-4',
        tbId: 'tb-c',
        srcTerm: 'Winter',
        tgtTerm: 'Hiver',
        srcNorm: 'winter',
        note: null,
        createdAt: '',
        updatedAt: '',
        usageCount: 1,
        tbName: 'TB 1',
        priority: 1,
      },
      {
        id: 'tb-5',
        tbId: 'tb-c',
        srcTerm: 'Amid Winter',
        tgtTerm: "au coeur de l'hiver",
        srcNorm: 'amid winter',
        note: null,
        createdAt: '',
        updatedAt: '',
        usageCount: 1,
        tbName: 'TB 1',
        priority: 1,
      },
    ]);

    const matches = await service.findMatches(1, buildSegment('Warmth Amid Winter'));
    expect(matches).toHaveLength(2);
    expect(matches[0].srcTerm).toBe('Amid Winter');
    expect(matches[1].srcTerm).toBe('Winter');
  });

  it('deduplicates by normalized source term and keeps higher-priority mounted term base entry', async () => {
    const service = createServiceWithEntries([
      {
        id: 'tb-6',
        tbId: 'tb-priority-1',
        srcTerm: 'API Key',
        tgtTerm: 'clé API',
        srcNorm: 'api key',
        note: null,
        createdAt: '',
        updatedAt: '',
        usageCount: 1,
        tbName: 'Priority TB',
        priority: 1,
      },
      {
        id: 'tb-7',
        tbId: 'tb-priority-9',
        srcTerm: 'api key',
        tgtTerm: "clef d'API",
        srcNorm: 'api key',
        note: null,
        createdAt: '',
        updatedAt: '',
        usageCount: 1,
        tbName: 'Low Priority TB',
        priority: 9,
      },
    ]);

    const matches = await service.findMatches(1, buildSegment('Please keep your API key secure.'));
    expect(matches).toHaveLength(1);
    expect(matches[0].tbName).toBe('Priority TB');
    expect(matches[0].tgtTerm).toBe('clé API');
  });

  it('falls back to full mounted term scan when FTS candidate search returns no rows', async () => {
    const entries = [
      {
        id: 'tb-fallback',
        tbId: 'tb-fallback-base',
        srcTerm: 'Settings',
        tgtTerm: '设置',
        srcNorm: 'settings',
        note: null,
        createdAt: '',
        updatedAt: '',
        usageCount: 1,
        tbName: 'Fallback TB',
        priority: 1,
      },
    ];
    const service = createServiceWithEntries(entries, { searchEntries: [], srcLang: 'en-US' });

    const matches = await service.findMatches(1, buildSegment('Open Settings now.'));
    expect(matches).toHaveLength(1);
    expect(matches[0].tbName).toBe('Fallback TB');
  });

  it('passes project source locale into candidate search and final term matching', async () => {
    const searchProjectTermEntries = vi.fn().mockReturnValue([
      {
        id: 'tb-locale',
        tbId: 'tb-locale-base',
        srcTerm: 'API key',
        tgtTerm: 'API 키',
        srcNorm: 'api key',
        note: null,
        createdAt: '',
        updatedAt: '',
        usageCount: 1,
        tbName: 'Locale TB',
        priority: 1,
      },
    ]);
    const projectRepoMock = {
      getProject: () => ({
        id: 1,
        srcLang: 'en-US',
        tgtLang: 'ko-KR',
      }),
    } satisfies Pick<ProjectRepository, 'getProject'>;
    const dbMock = {
      listProjectTermEntries: () => [],
      searchProjectTermEntries,
    } satisfies Pick<TBRepository, 'listProjectTermEntries' | 'searchProjectTermEntries'>;
    const service = new TBService(projectRepoMock as ProjectRepository, dbMock as TBRepository);

    const matches = await service.findMatches(1, buildSegment('Please keep your API key secure.'));

    expect(matches).toHaveLength(1);
    expect(searchProjectTermEntries).toHaveBeenCalledWith(
      1,
      'Please keep your API key secure.',
      expect.objectContaining({
        srcLang: 'en-US',
      }),
    );
  });

  it('supplements FTS candidates with short terms from the full mounted scan', async () => {
    const entries = [
      {
        id: 'tb-short',
        tbId: 'tb-short-base',
        srcTerm: '设置',
        tgtTerm: 'settings',
        srcNorm: '设置',
        note: null,
        createdAt: '',
        updatedAt: '',
        usageCount: 1,
        tbName: 'Short TB',
        priority: 2,
      },
    ];
    const service = createServiceWithEntries(entries, {
      srcLang: 'zh-CN',
      searchEntries: [
        {
          id: 'tb-long',
          tbId: 'tb-long-base',
          srcTerm: '设置页面',
          tgtTerm: 'settings page',
          srcNorm: '设置页面',
          note: null,
          createdAt: '',
          updatedAt: '',
          usageCount: 1,
          tbName: 'Long TB',
          priority: 1,
        },
      ],
    });

    const matches = await service.findMatches(1, buildSegment('请打开设置页面。'));
    expect(matches.map((match) => match.srcTerm)).toEqual(
      expect.arrayContaining(['设置页面', '设置']),
    );
  });
  it('supplements FTS candidates with 3-character Chinese terms from the full mounted scan', async () => {
    const entries = [
      {
        id: 'tb-name',
        tbId: 'tb-name-base',
        srcTerm: '示例项',
        tgtTerm: 'Generic Name',
        srcNorm: '示例项',
        note: null,
        createdAt: '',
        updatedAt: '',
        usageCount: 1,
        tbName: 'Name TB',
        priority: 2,
      },
    ];
    const service = createServiceWithEntries(entries, {
      srcLang: 'zh-CN',
      searchEntries: [
        {
          id: 'tb-title',
          tbId: 'tb-title-base',
          srcTerm: '通用标题',
          tgtTerm: 'Generic Title',
          srcNorm: '通用标题',
          note: null,
          createdAt: '',
          updatedAt: '',
          usageCount: 1,
          tbName: 'Title TB',
          priority: 1,
        },
      ],
    });

    const matches = await service.findMatches(
      1,
      buildSegment('完成任务后可获得限定称号【示例项·通用标题】'),
    );
    expect(matches.map((match) => match.srcTerm)).toEqual(
      expect.arrayContaining(['示例项', '通用标题']),
    );
  });
});
