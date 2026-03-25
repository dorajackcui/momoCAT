import { describe, expect, it, vi } from 'vitest';
import type { Segment } from '@cat/core/models';
import type { Project } from '@cat/core/project';
import { TagValidator } from '@cat/core/qa';
import { runStandardFileTranslation } from './fileTranslationWorkflow';
import { runDialogueFileTranslation } from './dialogueTranslationWorkflow';

function createSegment(params: {
  segmentId: string;
  sourceText: string;
  targetText?: string;
  status?: Segment['status'];
  context?: string;
}): Segment {
  const sourceTokens = params.sourceText
    ? [{ type: 'text', content: params.sourceText as string }]
    : [];
  const targetTokens = params.targetText
    ? [{ type: 'text', content: params.targetText as string }]
    : [];
  return {
    segmentId: params.segmentId,
    fileId: 1,
    orderIndex: 0,
    sourceTokens,
    targetTokens,
    status: params.status ?? 'new',
    tagsSignature: '',
    matchKey: params.sourceText.toLowerCase(),
    srcHash: `hash-${params.segmentId}`,
    meta: {
      context: params.context,
      updatedAt: new Date().toISOString(),
    },
  };
}

function createProject(overrides?: Partial<Project>): Project {
  return {
    id: 11,
    uuid: 'project-11',
    name: 'demo',
    srcLang: 'en',
    tgtLang: 'zh',
    projectType: 'translation',
    aiPrompt: '',
    aiTemperature: 0.2,
    aiModel: 'gpt-4o',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('AI translation workflows', () => {
  it('supports overwrite-non-confirmed in standard file workflow', async () => {
    const segments = [
      createSegment({ segmentId: 's1', sourceText: 'Hello' }),
      createSegment({
        segmentId: 's2',
        sourceText: 'World',
        targetText: '旧译文',
        status: 'draft',
      }),
      createSegment({
        segmentId: 's3',
        sourceText: 'Confirmed',
        targetText: '已确认',
        status: 'confirmed',
      }),
    ];

    const segmentPagingIterator = {
      countFileSegments: vi.fn().mockReturnValue(segments.length),
      countMatchingSegments: vi
        .fn()
        .mockImplementation(
          (_fileId: number, predicate: (segment: Segment) => boolean) =>
            segments.filter(predicate).length,
        ),
      iterateFileSegments: vi.fn().mockReturnValue(segments.values()),
    };

    const textTranslator = {
      translateSegment: vi.fn().mockResolvedValue([{ type: 'text', content: '新译文' }]),
    };

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    };

    const result = await runStandardFileTranslation({
      fileId: 1,
      projectId: 11,
      project: createProject(),
      apiKey: 'test-key',
      model: 'gpt-4o',
      temperature: 0.2,
      targetScope: 'overwrite-non-confirmed',
      segmentPagingIterator: segmentPagingIterator as never,
      textTranslator: textTranslator as never,
      segmentService: segmentService as never,
      resolveTranslationPromptReferences: vi.fn().mockResolvedValue({}),
      intervalMs: 0,
    });

    expect(result).toEqual({ translated: 2, skipped: 1, failed: 0, total: 3 });
    expect(segmentService.updateSegment).toHaveBeenCalledTimes(2);
    expect(segmentService.updateSegment).toHaveBeenNthCalledWith(
      1,
      's1',
      expect.any(Array),
      'translated',
    );
    expect(segmentService.updateSegment).toHaveBeenNthCalledWith(
      2,
      's2',
      expect.any(Array),
      'translated',
    );
  });

  it('logs and counts failures in standard file workflow without changing return shape', async () => {
    const segments = [createSegment({ segmentId: 'failed-segment', sourceText: 'Hello' })];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const segmentPagingIterator = {
      countFileSegments: vi.fn().mockReturnValue(segments.length),
      countMatchingSegments: vi
        .fn()
        .mockImplementation(
          (_fileId: number, predicate: (segment: Segment) => boolean) =>
            segments.filter(predicate).length,
        ),
      iterateFileSegments: vi.fn().mockReturnValue(segments.values()),
    };

    const textTranslator = {
      translateSegment: vi.fn().mockRejectedValue(new Error('network timeout')),
    };

    const result = await runStandardFileTranslation({
      fileId: 9,
      projectId: 11,
      project: createProject(),
      apiKey: 'test-key',
      model: 'gpt-4o',
      temperature: 0.2,
      targetScope: 'blank-only',
      segmentPagingIterator: segmentPagingIterator as never,
      textTranslator: textTranslator as never,
      segmentService: { updateSegment: vi.fn() } as never,
      resolveTranslationPromptReferences: vi.fn().mockResolvedValue({}),
      intervalMs: 0,
    });

    expect(result).toEqual({ translated: 0, skipped: 0, failed: 1, total: 1 });
    expect(warnSpy).toHaveBeenCalledWith(
      '[AITranslationOrchestrator] Failed to translate segment in file workflow',
      expect.objectContaining({ fileId: 9, segmentId: 'failed-segment' }),
    );

    warnSpy.mockRestore();
  });

  it('falls back to per-segment translation when dialogue group translation fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const segments = [
      createSegment({ segmentId: 'd1', sourceText: 'Hello', context: 'Alice' }),
      createSegment({ segmentId: 'd2', sourceText: 'How are you?', context: 'Alice' }),
    ];

    const segmentPagingIterator = {
      countFileSegments: vi.fn().mockReturnValue(segments.length),
      iterateFileSegments: vi.fn().mockReturnValue(segments.values()),
    };

    const transport = {
      chatCompletions: vi.fn().mockRejectedValue(new Error('group translation failed')),
    };

    const segmentService = {
      updateSegmentsAtomically: vi.fn(),
      updateSegment: vi.fn().mockResolvedValue(undefined),
    };

    const textTranslator = {
      translateSegment: vi.fn().mockResolvedValue([{ type: 'text', content: '回退译文' }]),
    };

    const result = await runDialogueFileTranslation({
      fileId: 10,
      project: createProject(),
      apiKey: 'test-key',
      model: 'gpt-4o',
      temperature: 0.2,
      targetScope: 'overwrite-non-confirmed',
      transport: transport as never,
      tagValidator: new TagValidator(),
      textTranslator: textTranslator as never,
      segmentService: segmentService as never,
      segmentPagingIterator: segmentPagingIterator as never,
      resolveTranslationPromptReferences: vi.fn().mockResolvedValue({}),
      intervalMs: 0,
    });

    expect(result).toEqual({ translated: 2, skipped: 0, failed: 0, total: 2 });
    expect(segmentService.updateSegmentsAtomically).not.toHaveBeenCalled();
    expect(segmentService.updateSegment).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      '[AITranslationOrchestrator] Dialogue group translation failed; falling back to per-segment mode',
      expect.objectContaining({ fileId: 10, projectId: 11, groupSize: 2 }),
    );

    warnSpy.mockRestore();
  });
});
