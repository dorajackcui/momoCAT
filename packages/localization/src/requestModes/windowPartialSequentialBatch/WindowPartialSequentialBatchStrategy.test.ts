import { describe, expect, it, vi } from 'vitest';
import type { Project } from '@cat/core/project';
import { parseEditorTextToTokens } from '@cat/core/tag';
import { createTransientSegment } from '../../transientSegment';
import type { PromptArtifact } from '../../artifacts';
import type { JobUnit, TaskExecutionContext, TranslationTask, UnitResult } from '../../job/types';
import type { ResolvedMTConfig } from '../../modules/MTModule';
import type { LocalizationEngineOptions } from '../../types';
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
      results: [units[0], units[2], units[4]].map((unit) => ({
        documentId: unit.documentId,
        unitId: unit.unitId,
        responseId: `sheet.xlsx#${unit.unitId}`,
        targetTokens: parseEditorTextToTokens(`translated ${unit.source}`, segments.get(unit.unitId)?.sourceTokens ?? []),
      })),
      prompt: promptArtifact(['sheet.xlsx#row-1', 'sheet.xlsx#row-3', 'sheet.xlsx#row-5']),
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

    const result = await strategy.translate({
      task: {
        taskId: 'partial-task-1',
        requestMode: 'window-partial',
        units,
        scanWindowUnits: units,
        requestUnitKeys: [units[0], units[2], units[4]].map(key),
      },
      context: executionContext({ job: { units } }),
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
          expect.objectContaining({ unitId: 'row-1' }),
          expect.objectContaining({ unitId: 'row-3' }),
          expect.objectContaining({ unitId: 'row-5' }),
        ],
        previousContext: [],
        nextContext: [],
        readOnlyContextRows: [
          { role: 'current-existing', source: '2', target: 'T2', rowNumber: 2 },
          { role: 'current-existing', source: '4', target: 'T4', rowNumber: 4 },
        ],
        scanWindowCount: 5,
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

  it('uses empty references for custom projects', async () => {
    const unit = jobUnit('row-1', 'One', 'hash-1');
    const segment = createTransientSegment({ id: 'row-1', source: 'One' }, 0);
    const translateBatch = vi.fn().mockResolvedValue({
      results: [{
        documentId: unit.documentId,
        unitId: unit.unitId,
        responseId: 'sheet.xlsx#row-1',
        targetTokens: parseEditorTextToTokens('Un', segment.sourceTokens),
      }],
      prompt: promptArtifact(['sheet.xlsx#row-1']),
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

function executionContext(params: { job?: Partial<TaskExecutionContext['job']> } = {}): TaskExecutionContext {
  return {
    attempt: 1,
    job: { id: 'job-1', projectId: 1, units: [], ...params.job },
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
