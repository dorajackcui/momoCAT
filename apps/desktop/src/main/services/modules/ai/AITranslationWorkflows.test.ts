import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Segment } from '@cat/core/models';
import type { Project } from '@cat/core/project';
import { TagValidator } from '@cat/core/qa';
import { runStandardFileTranslation } from './fileTranslationWorkflow';
import { runDialogueFileTranslation } from './dialogueTranslationWorkflow';
import { AI_BATCH_DEBUG_ENV } from './aiBatchDebug';

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
    aiModel: 'gpt-5.4-mini',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('AI translation workflows', () => {
  afterEach(() => {
    delete process.env[AI_BATCH_DEBUG_ENV];
    vi.restoreAllMocks();
  });

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
      model: 'gpt-5.4-mini',
      runtimeConfig: { reasoningEffort: 'medium' },
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
      model: 'gpt-5.4-mini',
      runtimeConfig: { reasoningEffort: 'medium' },
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

  it('logs batch diagnostic events around segment translation and writeback', async () => {
    process.env[AI_BATCH_DEBUG_ENV] = '1';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const segments = [
      createSegment({ segmentId: 'diag-ok', sourceText: 'Hello' }),
      createSegment({ segmentId: 'diag-fail', sourceText: 'World' }),
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
      translateSegment: vi
        .fn()
        .mockResolvedValueOnce([{ type: 'text', content: 'Done' }])
        .mockRejectedValueOnce(new Error('provider failed')),
    };

    await runStandardFileTranslation({
      fileId: 9,
      projectId: 11,
      project: createProject(),
      apiKey: 'test-key',
      baseUrl: 'https://api.example.test/v1',
      model: 'gpt-5.4-mini',
      runtimeConfig: { reasoningEffort: 'medium' },
      targetScope: 'blank-only',
      segmentPagingIterator: segmentPagingIterator as never,
      textTranslator: textTranslator as never,
      segmentService: { updateSegment: vi.fn().mockResolvedValue(undefined) } as never,
      resolveTranslationPromptReferences: vi.fn().mockResolvedValue({}),
      intervalMs: 0,
      maxConcurrency: 1,
    });

    const messages = logSpy.mock.calls.map(([message]) => String(message));
    expect(messages.some((message) => message.includes('event=standard_file_start'))).toBe(true);
    expect(
      messages.some(
        (message) => message.includes('event=segment_start') && message.includes('diag-ok'),
      ),
    ).toBe(true);
    expect(
      messages.some(
        (message) => message.includes('event=segment_write_success') && message.includes('diag-ok'),
      ),
    ).toBe(true);
    expect(
      messages.some(
        (message) =>
          message.includes('event=segment_failed') &&
          message.includes('diag-fail') &&
          message.includes('stage=translate'),
      ),
    ).toBe(true);

    warnSpy.mockRestore();
  });

  it('runs standard file workflow with bounded concurrency when requested', async () => {
    const segments = [
      createSegment({ segmentId: 'custom-1', sourceText: 'One' }),
      createSegment({ segmentId: 'custom-2', sourceText: 'Two' }),
      createSegment({ segmentId: 'custom-3', sourceText: 'Three' }),
    ];
    const pending = new Map<string, ReturnType<typeof createDeferred<Segment['targetTokens']>>>();
    const completedProgress: number[] = [];

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
      translateSegment: vi.fn().mockImplementation(({ segmentId }: { segmentId: string }) => {
        const deferred = createDeferred<Segment['targetTokens']>();
        pending.set(segmentId, deferred);
        return deferred.promise;
      }),
    };

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    };

    const task = runStandardFileTranslation({
      fileId: 1,
      projectId: 11,
      project: createProject({ projectType: 'custom' }),
      apiKey: 'test-key',
      baseUrl: 'https://api.example.test/v1',
      model: 'gpt-5.4-mini',
      runtimeConfig: { reasoningEffort: 'medium' },
      targetScope: 'blank-only',
      segmentPagingIterator: segmentPagingIterator as never,
      textTranslator: textTranslator as never,
      segmentService: segmentService as never,
      resolveTranslationPromptReferences: vi.fn().mockResolvedValue({}),
      intervalMs: 0,
      maxConcurrency: 2,
      onProgress: (event) => completedProgress.push(event.current),
    });

    await flushPromises();
    const initiallyStarted = Array.from(pending.keys());
    const resolved = new Set<string>();

    if (pending.has('custom-2')) {
      pending.get('custom-2')?.resolve([{ type: 'text', content: 'Second done' }]);
      resolved.add('custom-2');
    }
    await flushPromises();
    const startedAfterOneCompletion = Array.from(pending.keys());

    for (const segment of segments) {
      if (resolved.has(segment.segmentId)) continue;
      while (!pending.has(segment.segmentId)) {
        await flushPromises();
      }
      pending
        .get(segment.segmentId)
        ?.resolve([{ type: 'text', content: `${segment.segmentId} done` }]);
      resolved.add(segment.segmentId);
      await flushPromises();
    }

    const result = await task;

    expect(initiallyStarted).toEqual(['custom-1', 'custom-2']);
    expect(startedAfterOneCompletion).toEqual(['custom-1', 'custom-2', 'custom-3']);
    expect(result).toEqual({ translated: 3, skipped: 0, failed: 0, total: 3 });
    expect(segmentService.updateSegment).toHaveBeenCalledTimes(3);
    expect(completedProgress).toEqual([1, 2, 3]);
  });

  it('keeps bounded concurrent standard file workflow running after one segment fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const segments = [
      createSegment({ segmentId: 'custom-ok-1', sourceText: 'One' }),
      createSegment({ segmentId: 'custom-fail', sourceText: 'Two' }),
      createSegment({ segmentId: 'custom-ok-2', sourceText: 'Three' }),
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
      translateSegment: vi
        .fn()
        .mockResolvedValueOnce([{ type: 'text', content: 'First done' }])
        .mockRejectedValueOnce(new Error('provider failed'))
        .mockResolvedValueOnce([{ type: 'text', content: 'Third done' }]),
    };

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    };

    const result = await runStandardFileTranslation({
      fileId: 2,
      projectId: 11,
      project: createProject({ projectType: 'custom' }),
      apiKey: 'test-key',
      baseUrl: 'https://api.example.test/v1',
      model: 'gpt-5.4-mini',
      runtimeConfig: { reasoningEffort: 'medium' },
      targetScope: 'blank-only',
      segmentPagingIterator: segmentPagingIterator as never,
      textTranslator: textTranslator as never,
      segmentService: segmentService as never,
      resolveTranslationPromptReferences: vi.fn().mockResolvedValue({}),
      intervalMs: 0,
      maxConcurrency: 2,
    });

    expect(result).toEqual({ translated: 2, skipped: 0, failed: 1, total: 3 });
    expect(segmentService.updateSegment).toHaveBeenCalledTimes(2);
    expect(segmentService.updateSegment).toHaveBeenNthCalledWith(
      1,
      'custom-ok-1',
      expect.any(Array),
      'translated',
    );
    expect(segmentService.updateSegment).toHaveBeenNthCalledWith(
      2,
      'custom-ok-2',
      expect.any(Array),
      'translated',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      '[AITranslationOrchestrator] Failed to translate segment in file workflow',
      expect.objectContaining({ fileId: 2, segmentId: 'custom-fail' }),
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
      createResponse: vi.fn().mockRejectedValue(new Error('group translation failed')),
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
      model: 'gpt-5.4-mini',
      runtimeConfig: { reasoningEffort: 'medium' },
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
