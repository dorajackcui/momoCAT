import { describe, expect, it, vi } from 'vitest';
import type { Segment, TMEntry } from '@cat/core/models';
import { TMService } from './TMService';
import { ProjectRepository, TMRepository } from './ports';

function createSegment(sourceText: string, srcHash: string): Segment {
  return {
    segmentId: `seg-${srcHash}`,
    fileId: 1,
    orderIndex: 0,
    sourceTokens: [{ type: 'text', content: sourceText }],
    targetTokens: [],
    status: 'new',
    tagsSignature: '',
    matchKey: sourceText.toLowerCase(),
    srcHash,
    meta: { updatedAt: new Date().toISOString() },
  };
}

function createTaggedSegment(sourceText: string, srcHash: string): Segment {
  return {
    segmentId: `seg-${srcHash}`,
    fileId: 1,
    orderIndex: 0,
    sourceTokens: [
      { type: 'text', content: sourceText },
      { type: 'tag', content: '<b>' },
    ],
    targetTokens: [],
    status: 'new',
    tagsSignature: '<b>',
    matchKey: `${sourceText.toLowerCase()} {tag}`,
    srcHash,
    meta: { updatedAt: new Date().toISOString() },
  };
}

function createTMEntry(params: {
  srcHash: string;
  sourceText: string;
  targetText?: string;
  usageCount?: number;
  tagsSignature?: string;
}): TMEntry {
  const now = new Date().toISOString();
  return {
    id: `entry-${params.srcHash}`,
    projectId: 1,
    srcLang: 'zh-CN',
    tgtLang: 'fr-FR',
    srcHash: params.srcHash,
    matchKey: params.sourceText.toLowerCase(),
    tagsSignature: params.tagsSignature ?? '',
    sourceTokens: [{ type: 'text', content: params.sourceText }],
    targetTokens: [{ type: 'text', content: params.targetText ?? `tgt-${params.srcHash}` }],
    usageCount: params.usageCount ?? 1,
    createdAt: now,
    updatedAt: now,
  };
}

function createConcordanceEntry(
  tmId: string,
  params: {
    srcHash: string;
    sourceText: string;
    targetText?: string;
    usageCount?: number;
  },
): TMEntry & { tmId: string } {
  return {
    ...createTMEntry(params),
    tmId,
  };
}

function createService(params: {
  mountedTMs: Array<{ id: string; name: string; type: 'working' | 'main' }>;
  exactMatchByHash?: Record<string, TMEntry | undefined>;
  concordanceEntries?: Array<TMEntry & { tmId: string }>;
}): TMService {
  const projectRepo = {
    getProject: vi.fn().mockReturnValue({
      id: 1,
      srcLang: 'zh-CN',
      tgtLang: 'fr-FR',
    }),
  } as unknown as ProjectRepository;

  const tmRepo = {
    getProjectMountedTMs: vi.fn().mockReturnValue(
      params.mountedTMs.map((tm) => ({
        ...tm,
        srcLang: 'zh-CN',
        tgtLang: 'fr-FR',
        priority: 10,
        permission: tm.type === 'working' ? 'readwrite' : 'read',
        isEnabled: 1,
      })),
    ),
    findTMEntryByHash: vi
      .fn()
      .mockImplementation((_: string, srcHash: string) => params.exactMatchByHash?.[srcHash]),
    searchConcordance: vi.fn().mockReturnValue(params.concordanceEntries ?? []),
  } as unknown as TMRepository;

  return new TMService(projectRepo, tmRepo);
}

describe('TMService.findMatches', () => {
  it('returns at most top 10 matches', async () => {
    const source = '这是一个用于测试TM匹配结果截断的示例句子';
    const service = createService({
      mountedTMs: [{ id: 'tm-main', name: 'Main TM', type: 'main' }],
      concordanceEntries: Array.from({ length: 25 }, (_, index) =>
        createConcordanceEntry('tm-main', {
          srcHash: `cand-${index}`,
          sourceText: `${source}${index}`,
          usageCount: 25 - index,
        }),
      ),
    });

    const matches = await service.findMatches(1, createSegment(source, 'source-hash'));
    expect(matches.length).toBe(10);
  });

  it('matches near-identical CJK sentence when one character differs at the beginning', async () => {
    const source = '乙组是怎么成为临时项目的负责人的？';
    const service = createService({
      mountedTMs: [{ id: 'tm-main', name: 'Main TM', type: 'main' }],
      concordanceEntries: [
        createConcordanceEntry('tm-main', {
          srcHash: 'near-hash',
          sourceText: '甲组是怎么成为临时项目的负责人的？',
          usageCount: 1,
        }),
        createConcordanceEntry('tm-main', {
          srcHash: 'noise-hash',
          sourceText: '今天临时项目进度怎么样？',
          usageCount: 20,
        }),
      ],
    });

    const matches = await service.findMatches(1, createSegment(source, 'source-hash'));
    const nearMatch = matches.find((match) => match.srcHash === 'near-hash');
    expect(nearMatch).toBeDefined();
    if (!nearMatch) return;

    const noiseMatch = matches.find((match) => match.srcHash === 'noise-hash');
    if (noiseMatch) {
      expect(nearMatch.similarity).toBeGreaterThan(noiseMatch.similarity);
    }
  });

  it('matches near-identical CJK sentence when pronoun differs at tail position', async () => {
    const source = '这份样本从录入到完成是需要时间的，没关系，我等你们！';
    const service = createService({
      mountedTMs: [{ id: 'tm-main', name: 'Main TM', type: 'main' }],
      concordanceEntries: [
        createConcordanceEntry('tm-main', {
          srcHash: 'near-hash',
          sourceText: '这份样本从录入到完成是需要时间的，没关系，我等你！',
          usageCount: 1,
        }),
        createConcordanceEntry('tm-main', {
          srcHash: 'noise-hash',
          sourceText: '没关系，我们还有其他方案。',
          usageCount: 10,
        }),
      ],
    });

    const matches = await service.findMatches(1, createSegment(source, 'source-hash'));
    const nearMatch = matches.find((match) => match.srcHash === 'near-hash');
    expect(nearMatch).toBeDefined();
    if (!nearMatch) return;
    expect(nearMatch.similarity).toBeGreaterThanOrEqual(90);
  });

  it('keeps exact hash match at similarity 100 ahead of fuzzy 99 matches and sorts fuzzy ties by usage', async () => {
    const source = 'Hello world from CAT tool';
    const exactHash = 'exact-hash';
    const service = createService({
      mountedTMs: [{ id: 'tm-main', name: 'Main TM', type: 'main' }],
      exactMatchByHash: {
        [exactHash]: createTMEntry({
          srcHash: exactHash,
          sourceText: source,
          usageCount: 1,
        }),
      },
      concordanceEntries: [
        createConcordanceEntry('tm-main', {
          srcHash: 'fuzzy-high-usage',
          sourceText: source,
          usageCount: 8,
        }),
        createConcordanceEntry('tm-main', {
          srcHash: 'fuzzy-low-usage',
          sourceText: source,
          usageCount: 2,
        }),
      ],
    });

    const matches = await service.findMatches(1, createSegment(source, exactHash));
    expect(matches[0].srcHash).toBe(exactHash);
    expect(matches[0].similarity).toBe(100);

    const fuzzyMatches = matches.filter((match) => match.similarity === 99);
    expect(fuzzyMatches[0].srcHash).toBe('fuzzy-high-usage');
    expect(fuzzyMatches[1].srcHash).toBe('fuzzy-low-usage');
  });

  it('keeps identical normalized text with different tags at similarity 99', async () => {
    const source = 'Hello world';
    const service = createService({
      mountedTMs: [{ id: 'tm-main', name: 'Main TM', type: 'main' }],
      concordanceEntries: [
        createConcordanceEntry('tm-main', {
          srcHash: 'same-text-different-tags',
          sourceText: source,
          tagsSignature: '',
        }),
      ],
    });

    const matches = await service.findMatches(1, createTaggedSegment(source, 'tagged-hash'));
    expect(matches).toHaveLength(1);
    expect(matches[0].srcHash).toBe('same-text-different-tags');
    expect(matches[0].similarity).toBe(99);
  });

  it('caps fuzzy weighted matches at similarity 99 even when the computed score would round to 100', async () => {
    const source = 'Translation memory scoring example';
    const service = createService({
      mountedTMs: [{ id: 'tm-main', name: 'Main TM', type: 'main' }],
      concordanceEntries: [
        createConcordanceEntry('tm-main', {
          srcHash: 'fuzzy-almost-exact',
          sourceText: 'Translation memory scoring examplex',
          usageCount: 3,
        }),
      ],
    });

    const matches = await service.findMatches(1, createSegment(source, 'source-hash'));
    expect(matches).toHaveLength(1);
    expect(matches[0].srcHash).toBe('fuzzy-almost-exact');
    expect(matches[0].similarity).toBe(99);
  });

  it('matches short CJK item names by strong local overlap', async () => {
    const source = '织云木种子';
    const service = createService({
      mountedTMs: [{ id: 'tm-main', name: 'Main TM', type: 'main' }],
      concordanceEntries: [
        createConcordanceEntry('tm-main', {
          srcHash: 'soft-pink-cloudwood',
          sourceText: '柔粉织云木',
        }),
        createConcordanceEntry('tm-main', {
          srcHash: 'green-cloudwood',
          sourceText: '岚绿织云木',
        }),
      ],
    });

    const matches = await service.findMatches(1, createSegment(source, 'source-hash'));
    expect(matches.map((match) => match.srcHash)).toEqual([
      'soft-pink-cloudwood',
      'green-cloudwood',
    ]);
    expect(matches[0].similarity).toBeGreaterThanOrEqual(50);
  });

  it('matches delimiter-separated CJK item names by either side of the name', async () => {
    const source = '晴日裱花·困梦';
    const service = createService({
      mountedTMs: [{ id: 'tm-main', name: 'Main TM', type: 'main' }],
      concordanceEntries: [
        createConcordanceEntry('tm-main', {
          srcHash: 'sunny-icing',
          sourceText: '晴日裱花',
        }),
        createConcordanceEntry('tm-main', {
          srcHash: 'remote-dream',
          sourceText: '遥梦花笺·困梦',
        }),
      ],
    });

    const matches = await service.findMatches(1, createSegment(source, 'source-hash'));
    expect(matches.map((match) => match.srcHash)).toEqual(['sunny-icing', 'remote-dream']);
    expect(matches[0].similarity).toBeGreaterThan(matches[1].similarity);
    expect(matches[1].similarity).toBeGreaterThanOrEqual(50);
  });

  it('matches a short CJK component inside a longer delimiter-separated entry', async () => {
    const service = createService({
      mountedTMs: [{ id: 'tm-main', name: 'Main TM', type: 'main' }],
      concordanceEntries: [
        createConcordanceEntry('tm-main', {
          srcHash: 'remote-dream',
          sourceText: '遥梦花笺·困梦',
        }),
      ],
    });

    const matches = await service.findMatches(1, createSegment('困梦', 'source-hash'));
    expect(matches.map((match) => match.srcHash)).toEqual(['remote-dream']);
    expect(matches[0].similarity).toBeGreaterThanOrEqual(50);
  });

  it('does not promote sparse CJK local overlap to the minimum threshold', async () => {
    const source = '织云木种子';
    const service = createService({
      mountedTMs: [{ id: 'tm-main', name: 'Main TM', type: 'main' }],
      concordanceEntries: [
        createConcordanceEntry('tm-main', {
          srcHash: 'long-weak-overlap',
          sourceText: '远古织云木机关碎片',
        }),
      ],
    });

    const matches = await service.findMatches(1, createSegment(source, 'source-hash'));
    expect(matches).toHaveLength(0);
  });
});
