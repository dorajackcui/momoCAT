import { describe, expect, it, vi } from 'vitest';
import type { Project } from '@cat/core/project';
import { parseEditorTextToTokens } from '@cat/core/tag';
import { createTransientSegment } from '../../transientSegment';
import { createMemoryTranslationAuditSink } from '../../audit/TranslationAudit';
import type { PromptArtifact } from '../../artifacts';
import type { JobUnit, TaskExecutionContext, TranslationTask, UnitResult } from '../../job/types';
import type { ResolvedMTConfig } from '../../modules/MTModule';
import type { LocalizationEngineOptions } from '../../types';
import type { RequestModeReferenceResolver } from '../shared/references';
import { WindowPartialSequentialBatchStrategy } from './WindowPartialSequentialBatchStrategy';

describe('WindowPartialSequentialBatchStrategy', () => {
  it('sends only requested rows and includes current-existing rows as read-only context', async () => {
    const units = [1, 2, 3, 4, 5].map((row) =>
      jobUnit(`row-${row}`, String(row), `hash-${row}`, { rowNumber: row, target: row % 2 === 0 ? `T${row}` : '' }),
    );
    const segments = new Map(
      [units[0], units[2], units[4]].map((unit, index) => [
        unit.unitId,
        createTransientSegment({ id: unit.unitId, source: unit.source }, index),
      ]),
    );
    const translateBatch = vi.fn().mockResolvedValue({
      results: [units[0], units[2], units[4]].map((unit, index) => ({
        documentId: unit.documentId,
        unitId: unit.unitId,
        responseId: `r${index + 1}`,
        targetTokens: parseEditorTextToTokens(`translated ${unit.source}`, segments.get(unit.unitId)?.sourceTokens ?? []),
      })),
      prompt: promptArtifact(['r1', 'r2', 'r3']),
    });
    const tmInspect = vi.fn().mockImplementation((_projectId, segment) =>
      Promise.resolve(emptyTm(segment.segmentId, segment.unitId)),
    );
    const tbInspect = vi.fn().mockImplementation((_projectId, segment) =>
      Promise.resolve(emptyTb(segment.segmentId, segment.unitId)),
    );
    const strategy = new WindowPartialSequentialBatchStrategy({
      tmModule: { inspect: tmInspect },
      tbModule: { inspect: tbInspect },
      mtModule: { translateBatch },
    });
    const auditSink = createMemoryTranslationAuditSink();

    const result = await strategy.translate({
      task: {
        taskId: 'partial-task-1',
        requestMode: 'window-partial',
        units,
        scanWindowUnits: units,
        requestUnitKeys: [units[0], units[2], units[4]].map(key),
      },
      context: executionContext({ job: { units }, auditSink }),
      project: project(),
      mtConfig: resolvedMTConfig(),
      mtOptions: mtOptions(),
      includeReferences: false,
      captureArtifacts: true,
      translatableUnits: [units[0], units[2], units[4]].map((jobUnit) => ({
        jobUnit,
        segment: segments.get(jobUnit.unitId)!,
      })),
      skippedResults: [unitResult(units[1], 'T2', 'skipped'), unitResult(units[3], 'T4', 'skipped')],
    });

    expect(tmInspect).toHaveBeenCalledTimes(3);
    expect(tbInspect).toHaveBeenCalledTimes(3);
    expect(translateBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        requestMode: 'window-partial',
        current: [
          expect.objectContaining({ responseId: 'r1', unitId: 'row-1', rowNumber: 1 }),
          expect.objectContaining({ responseId: 'r2', unitId: 'row-3', rowNumber: 3 }),
          expect.objectContaining({ responseId: 'r3', unitId: 'row-5', rowNumber: 5 }),
        ],
        previousContext: [],
        nextContext: [],
        readOnlyContextRows: [
          { role: 'current-existing', source: '2', target: 'T2', rowNumber: 2 },
          { role: 'current-existing', source: '4', target: 'T4', rowNumber: 4 },
        ],
        scanWindowCount: 5,
        audit: { jobId: 'job-1', sink: auditSink },
      }),
    );
    expect(result.results.map((unit) => unit.unitId)).toEqual(['row-1', 'row-3', 'row-5']);
    expect(result.artifacts?.[0]?.prompt?.batch).toMatchObject({
      mode: 'window-partial',
      requestCount: 3,
      readOnlyContextCount: 2,
    });
  });

  it('fails clearly when requestUnitKeys are absent', async () => {
    const unit = jobUnit('row-1', 'One', 'hash-1');
    const strategy = new WindowPartialSequentialBatchStrategy({
      tmModule: { inspect: vi.fn() },
      tbModule: { inspect: vi.fn() },
      mtModule: { translateBatch: vi.fn() },
    });

    await expect(
      strategy.translate({
        task: { taskId: 'partial-task-missing-keys', units: [unit], requestMode: 'window-partial' },
        context: executionContext({ job: { units: [unit] } }),
        project: project(),
        mtConfig: resolvedMTConfig(),
        mtOptions: mtOptions(),
        includeReferences: false,
        captureArtifacts: false,
        translatableUnits: [{ jobUnit: unit, segment: createTransientSegment({ id: 'row-1', source: 'One' }, 0) }],
        skippedResults: [],
      }),
    ).rejects.toThrow('Window Partial task is missing requestUnitKeys');
  });

  it('uses an injected reference resolver only for requested rows', async () => {
    const units = [
      jobUnit('row-1', 'One', 'hash-1'),
      jobUnit('row-2', 'Two', 'hash-2'),
      jobUnit('row-3', 'Three', 'hash-3'),
    ];
    const segments = new Map(
      [units[0], units[2]].map((unit, index) => [
        unit.unitId,
        createTransientSegment({ id: unit.unitId, source: unit.source }, index),
      ]),
    );
    const firstReferences = references('row-1', segments.get('row-1')!.segmentId);
    const secondReferences = references('row-3', segments.get('row-3')!.segmentId);
    const referenceResolver: RequestModeReferenceResolver = vi
      .fn()
      .mockResolvedValueOnce(firstReferences)
      .mockResolvedValueOnce(secondReferences);
    const translateBatch = vi.fn().mockResolvedValue({
      results: [units[0], units[2]].map((unit, index) => ({
        documentId: unit.documentId,
        unitId: unit.unitId,
        responseId: `r${index + 1}`,
        targetTokens: parseEditorTextToTokens(
          `translated ${unit.source}`,
          segments.get(unit.unitId)?.sourceTokens ?? [],
        ),
      })),
      prompt: promptArtifact(['r1', 'r2']),
    });
    const tmInspect = vi.fn();
    const tbInspect = vi.fn();
    const strategy = new WindowPartialSequentialBatchStrategy({
      tmModule: { inspect: tmInspect },
      tbModule: { inspect: tbInspect },
      mtModule: { translateBatch },
    });

    await strategy.translate({
      task: {
        taskId: 'partial-task-injected-resolver',
        requestMode: 'window-partial',
        units,
        scanWindowUnits: units,
        requestUnitKeys: [units[0], units[2]].map(key),
      },
      context: executionContext({ job: { units } }),
      project: project(),
      mtConfig: resolvedMTConfig(),
      mtOptions: mtOptions(),
      includeReferences: false,
      captureArtifacts: false,
      translatableUnits: [units[0], units[2]].map((jobUnit) => ({
        jobUnit,
        segment: segments.get(jobUnit.unitId)!,
      })),
      skippedResults: [unitResult(units[1], 'Deux', 'skipped')],
      referenceResolver,
    });

    expect(referenceResolver).toHaveBeenCalledTimes(2);
    expect(referenceResolver).toHaveBeenNthCalledWith(1, {
      projectId: 1,
      segment: segments.get('row-1'),
      tmModule: { inspect: tmInspect },
      tbModule: { inspect: tbInspect },
    });
    expect(referenceResolver).toHaveBeenNthCalledWith(2, {
      projectId: 1,
      segment: segments.get('row-3'),
      tmModule: { inspect: tmInspect },
      tbModule: { inspect: tbInspect },
    });
    expect(tmInspect).not.toHaveBeenCalled();
    expect(tbInspect).not.toHaveBeenCalled();
    expect(translateBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        current: [
          expect.objectContaining({ unitId: 'row-1', tm: firstReferences.tm, tb: firstReferences.tb }),
          expect.objectContaining({ unitId: 'row-3', tm: secondReferences.tm, tb: secondReferences.tb }),
        ],
        readOnlyContextRows: [
          { role: 'current-existing', source: 'Two', target: 'Deux' },
        ],
      }),
    );
  });

  it('records per-result repair prompts on artifacts and falls back to the batch prompt', async () => {
    const units = [
      jobUnit('row-1', 'Save {1}', 'hash-1'),
      jobUnit('row-2', 'Close', 'hash-2', { target: 'Fermer' }),
      jobUnit('row-3', 'Open', 'hash-3'),
    ];
    const row1 = createTransientSegment({ id: 'row-1', source: 'Save {1}' }, 0);
    const row3 = createTransientSegment({ id: 'row-3', source: 'Open' }, 1);
    const batchPrompt = promptArtifact(['r1', 'r2']);
    const repairPrompt: PromptArtifact = {
      ...promptArtifact(['r1']),
      unitId: 'row-1',
      userPrompt: 'repair prompt',
      batch: undefined,
    };
    const translateBatch = vi.fn().mockResolvedValue({
      results: [
        {
          documentId: 'sheet.xlsx',
          unitId: 'row-1',
          responseId: 'r1',
          targetTokens: parseEditorTextToTokens('Enregistrer {1}', row1.sourceTokens),
          prompt: repairPrompt,
        },
        {
          documentId: 'sheet.xlsx',
          unitId: 'row-3',
          responseId: 'r2',
          targetTokens: parseEditorTextToTokens('Ouvrir', row3.sourceTokens),
        },
      ],
      prompt: batchPrompt,
    });
    const strategy = new WindowPartialSequentialBatchStrategy({
      tmModule: {
        inspect: vi
          .fn()
          .mockResolvedValueOnce(emptyTm(row1.segmentId, 'row-1'))
          .mockResolvedValueOnce(emptyTm(row3.segmentId, 'row-3')),
      },
      tbModule: {
        inspect: vi
          .fn()
          .mockResolvedValueOnce(emptyTb(row1.segmentId, 'row-1'))
          .mockResolvedValueOnce(emptyTb(row3.segmentId, 'row-3')),
      },
      mtModule: { translateBatch },
    });

    const result = await strategy.translate({
      task: {
        taskId: 'partial-task-1',
        requestMode: 'window-partial',
        units,
        scanWindowUnits: units,
        requestUnitKeys: [units[0], units[2]].map(key),
      },
      context: executionContext({ job: { units } }),
      project: project(),
      mtConfig: resolvedMTConfig(),
      mtOptions: mtOptions(),
      includeReferences: false,
      captureArtifacts: true,
      translatableUnits: [
        { jobUnit: units[0], segment: row1 },
        { jobUnit: units[2], segment: row3 },
      ],
      skippedResults: [unitResult(units[1], 'Fermer', 'skipped')],
    });

    expect(result.artifacts?.[0]?.prompt).toBe(repairPrompt);
    expect(result.artifacts?.[1]?.prompt).toBe(batchPrompt);
  });

  it('uses empty references for custom projects', async () => {
    const unit = jobUnit('row-1', 'One', 'hash-1');
    const segment = createTransientSegment({ id: 'row-1', source: 'One' }, 0);
    const translateBatch = vi.fn().mockResolvedValue({
      results: [{
        documentId: unit.documentId,
        unitId: unit.unitId,
        responseId: 'r1',
        targetTokens: parseEditorTextToTokens('Un', segment.sourceTokens),
      }],
      prompt: promptArtifact(['r1']),
    });
    const strategy = new WindowPartialSequentialBatchStrategy({
      tmModule: { inspect: vi.fn() },
      tbModule: { inspect: vi.fn() },
      mtModule: { translateBatch },
    });

    await strategy.translate({
      task: { taskId: 'partial-custom', units: [unit], requestMode: 'window-partial', scanWindowUnits: [unit], requestUnitKeys: [key(unit)] },
      context: executionContext({ job: { units: [unit] } }),
      project: { ...project(), projectType: 'custom' },
      mtConfig: resolvedMTConfig(),
      mtOptions: mtOptions(),
      includeReferences: true,
      captureArtifacts: false,
      translatableUnits: [{ jobUnit: unit, segment }],
      skippedResults: [],
    });

    expect(translateBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        current: [expect.objectContaining({
          tm: expect.objectContaining({ rawMatches: [] }),
          tb: expect.objectContaining({ rawMatches: [] }),
        })],
      }),
    );
  });
});

function jobUnit(
  unitId: string,
  source: string,
  sourceHash: string,
  extra: Partial<JobUnit> = {},
): JobUnit {
  return { documentId: 'sheet.xlsx', unitId, source, sourceHash, ...extra };
}

function executionContext(params: {
  job?: Partial<TaskExecutionContext['job']>;
  auditSink?: TaskExecutionContext['auditSink'];
} = {}): TaskExecutionContext {
  return {
    attempt: 1,
    job: { id: 'job-1', projectId: 1, units: [], ...params.job },
    auditSink: params.auditSink,
  };
}

function unitResult(unit: JobUnit, target: string, status: UnitResult['status']): UnitResult {
  return {
    jobId: 'job-1',
    documentId: unit.documentId,
    unitId: unit.unitId,
    sourceHash: unit.sourceHash,
    status,
    source: unit.source,
    target,
  };
}

function key(unit: Pick<JobUnit, 'documentId' | 'unitId'>): string {
  return `${unit.documentId}\u0000${unit.unitId}`;
}

function project(): Project {
  return {
    id: 1,
    uuid: 'project-uuid',
    name: 'Partial Project',
    srcLang: 'en',
    tgtLang: 'fr',
    projectType: 'translation',
    aiPrompt: '',
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z',
  };
}

function mtOptions(): NonNullable<LocalizationEngineOptions['mt']> {
  return {};
}

function resolvedMTConfig(): ResolvedMTConfig {
  return {
    apiKey: 'secret-api-key',
    model: 'mock-model',
    reasoningEffort: 'medium',
    provider: {
      id: 'mock',
      name: 'Mock',
      baseUrl: 'https://mock.local',
      model: 'mock-model',
      protocol: 'chat-completions',
      kind: 'custom',
      apiKeyLast4: '1234',
      createdAt: '2026-05-21T00:00:00.000Z',
      updatedAt: '2026-05-21T00:00:00.000Z',
    },
  };
}

function promptArtifact(currentIds: string[]): PromptArtifact {
  return {
    unitId: 'batch',
    provider: { id: 'mock', name: 'Mock', baseUrl: 'https://mock.local' },
    model: 'mock-model',
    reasoningEffort: 'medium',
    projectPrompt: '',
    projectType: 'translation',
    sourcePayload: '',
    tmPromptBlock: '',
    concordancePromptBlock: '',
    tbPromptBlock: '',
    referencePromptBlock: '',
    systemPrompt: 'system',
    userPrompt: 'user',
    promptChars: { system: 6, user: 4, total: 10 },
    batch: {
      mode: 'window-partial',
      taskId: 'partial-task-1',
      currentIds,
      previousContextCount: 0,
      nextContextCount: 0,
      scanWindowCount: 5,
      requestCount: currentIds.length,
      readOnlyContextCount: 2,
    },
  };
}

function emptyTm(segmentId: string, unitId: string) {
  return {
    unitId,
    segmentId,
    mountedTMs: [],
    rawMatches: [],
    selectedReferences: { tmReferences: [], concordanceReferences: [] },
    selectionPolicy: { maxTmReferences: 0, maxConcordanceReferences: 0 },
    diagnostics: [],
  };
}

function emptyTb(segmentId: string, unitId: string) {
  return {
    unitId,
    segmentId,
    mountedTBs: [],
    rawMatches: [],
    selectedReferences: [],
    selectionPolicy: { maxTbReferences: 0 },
    diagnostics: [],
  };
}

function references(unitId: string, segmentId: string) {
  return {
    engineReferences: {
      tm: [
        {
          kind: 'tm' as const,
          rank: 1,
          tmName: 'Injected TM',
          sourceText: unitId,
          targetText: `${unitId} target`,
          similarity: 100,
        },
      ],
      tb: [
        {
          tbName: 'Injected TB',
          srcTerm: unitId,
          tgtTerm: `${unitId} term`,
          note: null,
        },
      ],
    },
    tm: emptyTm(segmentId, unitId),
    tb: emptyTb(segmentId, unitId),
  };
}
