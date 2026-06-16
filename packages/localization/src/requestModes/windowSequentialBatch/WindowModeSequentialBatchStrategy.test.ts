import { describe, expect, it, vi } from 'vitest';
import type { Project } from '@cat/core/project';
import { parseEditorTextToTokens } from '@cat/core/tag';
import { createTransientSegment } from '../../transientSegment';
import type { PromptArtifact } from '../../artifacts';
import type { JobUnit, TaskExecutionContext, TranslationTask, UnitResult } from '../../job/types';
import type { ResolvedMTConfig } from '../../modules/MTModule';
import type { LocalizationEngineOptions } from '../../types';
import type { RequestModeReferenceResolver } from '../shared/references';
import { WindowModeSequentialBatchStrategy } from './WindowModeSequentialBatchStrategy';

describe('WindowModeSequentialBatchStrategy', () => {
  it('passes per-current-unit references and context windows to translateBatch, then maps results and artifacts', async () => {
    const units = [
      jobUnit('window.xlsx', 'row-1', 'Previous', 'hash-1'),
      jobUnit('window.xlsx', 'row-2', 'Save file', 'hash-2', { context: 'button label' }),
      jobUnit('window.xlsx', 'row-3', 'Close window', 'hash-3'),
      jobUnit('window.xlsx', 'row-4', 'Next source', 'hash-4'),
    ];
    const task = translationTask(units.slice(1, 3));
    const context = executionContext({
      job: { units },
      completedResults: new Map([[unitKey(units[0]), unitResult(units[0], 'Precedent')]]),
    });
    const projectRecord = project();
    const row2 = createTransientSegment(
      { id: 'row-2', source: 'Save file' },
      1,
      { sourceLanguage: 'en-US', targetLanguage: 'fr-FR' },
    );
    const row3 = createTransientSegment({ id: 'row-3', source: 'Close window' }, 2);
    const firstReferences = references('row-2', row2.segmentId, 'Save file', 'Enregistrer');
    const secondReferences = references('row-3', row3.segmentId, 'Close window', 'Fermer');
    const translateBatch = vi.fn().mockResolvedValue({
      results: [
        {
          documentId: 'window.xlsx',
          unitId: 'row-3',
          responseId: 'r2',
          targetTokens: parseEditorTextToTokens('Fermer la fenetre', row3.sourceTokens),
        },
        {
          documentId: 'window.xlsx',
          unitId: 'row-2',
          responseId: 'r1',
          targetTokens: parseEditorTextToTokens('Enregistrer le fichier', row2.sourceTokens),
        },
      ],
      prompt: promptArtifact(['r1', 'r2']),
    });
    const strategy = new WindowModeSequentialBatchStrategy({
      tmModule: { inspect: vi.fn().mockResolvedValueOnce(firstReferences.tm).mockResolvedValueOnce(secondReferences.tm) },
      tbModule: { inspect: vi.fn().mockResolvedValueOnce(firstReferences.tb).mockResolvedValueOnce(secondReferences.tb) },
      mtModule: { translateBatch },
    });

    const result = await strategy.translate({
      task,
      context,
      project: projectRecord,
      mtConfig: resolvedMTConfig(),
      mtOptions: mtOptions(),
      includeReferences: true,
      captureArtifacts: true,
      translatableUnits: [
        { jobUnit: units[1], segment: row2 },
        { jobUnit: units[2], segment: row3 },
      ],
      skippedResults: [],
    });

    expect(translateBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'window-task-1',
        project: projectRecord,
        current: [
          expect.objectContaining({
            responseId: 'r1',
            documentId: 'window.xlsx',
            unitId: 'row-2',
            segment: row2,
            tm: firstReferences.tm,
            tb: firstReferences.tb,
            context: 'button label',
          }),
          expect.objectContaining({
            responseId: 'r2',
            documentId: 'window.xlsx',
            unitId: 'row-3',
            segment: row3,
            tm: secondReferences.tm,
            tb: secondReferences.tb,
          }),
        ],
        previousContext: [{ source: 'Previous', target: 'Precedent' }],
        nextContext: [{ source: 'Next source' }],
        apiKey: 'secret-api-key',
        baseUrl: 'https://mock.local',
        model: 'mock-model',
        reasoningEffort: 'medium',
        provider: resolvedMTConfig().provider,
        srcLang: 'en-US',
        tgtLang: 'fr-FR',
      }),
    );
    expect(result.results).toEqual([
      expect.objectContaining({
        jobId: 'job-1',
        documentId: 'window.xlsx',
        unitId: 'row-2',
        sourceHash: 'hash-2',
        status: 'translated',
        source: 'Save file',
        target: 'Enregistrer le fichier',
        references: firstReferences.engineReferences,
      }),
      expect.objectContaining({
        documentId: 'window.xlsx',
        unitId: 'row-3',
        target: 'Fermer la fenetre',
        references: secondReferences.engineReferences,
      }),
    ]);
    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts?.[0]).toMatchObject({
      job: 'job-1',
      task: 'window-task-1',
      doc: 'window.xlsx',
      unit: 'row-2',
      tm: firstReferences.tm,
      tb: firstReferences.tb,
      prompt: expect.objectContaining({
        batch: expect.objectContaining({
          mode: 'window',
          currentIds: ['r1', 'r2'],
        }),
      }),
      result: expect.objectContaining({ target: 'Enregistrer le fichier' }),
    });
  });

  it('includes skipped rows with existing targets in previous context', async () => {
    const units = [
      jobUnit('sheet.xlsx', 'row-2', 'Start', 'hash-2'),
      jobUnit('sheet.xlsx', 'row-3', 'Middle', 'hash-3'),
      jobUnit('sheet.xlsx', 'row-4', 'End', 'hash-4'),
    ];
    const row2 = createTransientSegment({ id: 'row-2', source: 'Start' }, 0);
    const row4 = createTransientSegment({ id: 'row-4', source: 'End' }, 2);
    const translateBatch = vi.fn().mockResolvedValue({
      results: [
        {
          documentId: 'sheet.xlsx',
          unitId: 'row-2',
          responseId: 'r1',
          targetTokens: parseEditorTextToTokens('Debut', row2.sourceTokens),
        },
        {
          documentId: 'sheet.xlsx',
          unitId: 'row-4',
          responseId: 'r2',
          targetTokens: parseEditorTextToTokens('Fin', row4.sourceTokens),
        },
      ],
      prompt: promptArtifact(['r1', 'r2']),
    });
    const strategy = new WindowModeSequentialBatchStrategy({
      tmModule: {
        inspect: vi
          .fn()
          .mockResolvedValueOnce(references('row-2', row2.segmentId, 'Start', 'Debut').tm)
          .mockResolvedValueOnce(references('row-4', row4.segmentId, 'End', 'Fin').tm),
      },
      tbModule: {
        inspect: vi
          .fn()
          .mockResolvedValueOnce(references('row-2', row2.segmentId, 'Start', 'Debut').tb)
          .mockResolvedValueOnce(references('row-4', row4.segmentId, 'End', 'Fin').tb),
      },
      mtModule: { translateBatch },
    });

    await strategy.translate({
      task: translationTask([units[0], units[2]], 'task-interleaved-skip-context'),
      context: executionContext({ job: { units } }),
      project: project(),
      mtConfig: resolvedMTConfig(),
      mtOptions: mtOptions(),
      includeReferences: false,
      captureArtifacts: false,
      translatableUnits: [
        { jobUnit: units[0], segment: row2 },
        { jobUnit: units[2], segment: row4 },
      ],
      skippedResults: [unitResult(units[1], 'Milieu', 'skipped')],
    });

    expect(translateBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        previousContext: [{ source: 'Middle', target: 'Milieu' }],
        nextContext: [],
      }),
    );
  });

  it('uses an injected reference resolver for requested units', async () => {
    const unit = jobUnit('window.xlsx', 'row-2', 'Save file', 'hash-2');
    const segment = createTransientSegment({ id: 'row-2', source: 'Save file' }, 0);
    const injectedReferences = references('row-2', segment.segmentId, 'Save file', 'Sauvegarder');
    const referenceResolver: RequestModeReferenceResolver = vi.fn().mockResolvedValue(injectedReferences);
    const translateBatch = vi.fn().mockResolvedValue({
      results: [
        {
          documentId: 'window.xlsx',
          unitId: 'row-2',
          responseId: 'r1',
          targetTokens: parseEditorTextToTokens('Sauvegarder', segment.sourceTokens),
        },
      ],
      prompt: promptArtifact(['r1']),
    });
    const tmInspect = vi.fn();
    const tbInspect = vi.fn();
    const strategy = new WindowModeSequentialBatchStrategy({
      tmModule: { inspect: tmInspect },
      tbModule: { inspect: tbInspect },
      mtModule: { translateBatch },
    });

    const result = await strategy.translate({
      task: translationTask([unit]),
      context: executionContext({ job: { units: [unit] } }),
      project: project(),
      mtConfig: resolvedMTConfig(),
      mtOptions: mtOptions(),
      includeReferences: true,
      captureArtifacts: false,
      translatableUnits: [{ jobUnit: unit, segment }],
      skippedResults: [],
      referenceResolver,
    });

    expect(referenceResolver).toHaveBeenCalledWith({
      projectId: 1,
      segment,
      tmModule: { inspect: tmInspect },
      tbModule: { inspect: tbInspect },
    });
    expect(tmInspect).not.toHaveBeenCalled();
    expect(tbInspect).not.toHaveBeenCalled();
    expect(translateBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        current: [
          expect.objectContaining({
            tm: injectedReferences.tm,
            tb: injectedReferences.tb,
          }),
        ],
      }),
    );
    expect(result.results[0]?.references).toBe(injectedReferences.engineReferences);
  });

  it('does not include the API key in results or artifacts JSON', async () => {
    const unit = jobUnit('window.xlsx', 'row-2', 'Save file', 'hash-2');
    const segment = createTransientSegment({ id: 'row-2', source: 'Save file' }, 0);
    const translateBatch = vi.fn().mockResolvedValue({
      results: [
        {
          documentId: 'window.xlsx',
          unitId: 'row-2',
          responseId: 'r1',
          targetTokens: parseEditorTextToTokens('Enregistrer', segment.sourceTokens),
        },
      ],
      prompt: promptArtifact(['r1']),
    });
    const strategy = new WindowModeSequentialBatchStrategy({
      tmModule: {
        inspect: vi
          .fn()
          .mockResolvedValueOnce(references('row-2', segment.segmentId, 'Save file', 'Enregistrer').tm),
      },
      tbModule: {
        inspect: vi
          .fn()
          .mockResolvedValueOnce(references('row-2', segment.segmentId, 'Save file', 'Enregistrer').tb),
      },
      mtModule: { translateBatch },
    });

    const result = await strategy.translate({
      task: translationTask([unit]),
      context: executionContext({ job: { units: [unit] } }),
      project: project(),
      mtConfig: resolvedMTConfig(),
      mtOptions: mtOptions(),
      includeReferences: true,
      captureArtifacts: true,
      translatableUnits: [{ jobUnit: unit, segment }],
      skippedResults: [],
    });

    expect(JSON.stringify(result)).not.toContain('secret-api-key');
  });

  it('rejects when translateBatch omits a requested response id', async () => {
    const unit = jobUnit('window.xlsx', 'row-2', 'Save file', 'hash-2');
    const segment = createTransientSegment({ id: 'row-2', source: 'Save file' }, 0);
    const translateBatch = vi.fn().mockResolvedValue({
      results: [],
      prompt: promptArtifact(['r1']),
    });
    const strategy = new WindowModeSequentialBatchStrategy({
      tmModule: {
        inspect: vi
          .fn()
          .mockResolvedValueOnce(references('row-2', segment.segmentId, 'Save file', 'Enregistrer').tm),
      },
      tbModule: {
        inspect: vi
          .fn()
          .mockResolvedValueOnce(references('row-2', segment.segmentId, 'Save file', 'Enregistrer').tb),
      },
      mtModule: { translateBatch },
    });

    await expect(
      strategy.translate({
        task: translationTask([unit]),
        context: executionContext({ job: { units: [unit] } }),
        project: project(),
        mtConfig: resolvedMTConfig(),
        mtOptions: mtOptions(),
        includeReferences: false,
        captureArtifacts: false,
        translatableUnits: [{ jobUnit: unit, segment }],
        skippedResults: [],
      }),
    ).rejects.toThrow('MT batch did not return a result for unit: row-2');
  });
});

function jobUnit(
  documentId: string,
  unitId: string,
  source: string,
  sourceHash: string,
  extra: Partial<JobUnit> = {},
): JobUnit {
  return {
    documentId,
    unitId,
    source,
    sourceHash,
    ...extra,
  };
}

function translationTask(units: JobUnit[], taskId = 'window-task-1'): TranslationTask {
  return { taskId, units };
}

function executionContext(params: {
  job?: Partial<TaskExecutionContext['job']>;
  completedResults?: ReadonlyMap<string, UnitResult>;
} = {}): TaskExecutionContext {
  return {
    attempt: 1,
    job: {
      id: 'job-1',
      projectId: 1,
      units: [],
      ...params.job,
    },
    completedResults: params.completedResults,
  };
}

function unitResult(
  unit: JobUnit,
  target: string,
  status: UnitResult['status'] = 'translated',
): UnitResult {
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

function unitKey(unit: Pick<JobUnit, 'documentId' | 'unitId'>): string {
  return `${unit.documentId}\u0000${unit.unitId}`;
}

function project(): Project {
  return {
    id: 1,
    uuid: 'project-uuid',
    name: 'Window Project',
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
      mode: 'window',
      taskId: 'window-task-1',
      currentIds,
      previousContextCount: 1,
      nextContextCount: 1,
    },
  };
}

function references(unitId: string, segmentId: string, sourceText: string, targetText: string) {
  const tm = {
    unitId,
    segmentId,
    mountedTMs: [],
    rawMatches: [
      {
        kind: 'tm' as const,
        rank: 1,
        tmName: 'Main TM',
        tmType: 'main' as const,
        similarity: 100,
        id: `${unitId}-tm`,
        tmId: 'tm-1',
        projectId: 1,
        srcLang: 'en',
        tgtLang: 'fr',
        srcHash: `${unitId}-src-hash`,
        matchKey: `${unitId}-match-key`,
        tagsSignature: '',
        sourceTokens: parseEditorTextToTokens(sourceText, []),
        targetTokens: parseEditorTextToTokens(targetText, []),
        usageCount: 1,
        createdAt: '2026-05-21T00:00:00.000Z',
        updatedAt: '2026-05-21T00:00:00.000Z',
      },
    ],
    selectedReferences: {
      tmReferences: [
        {
          similarity: 100,
          tmName: 'Main TM',
          sourceText,
          targetText,
        },
      ],
      concordanceReferences: [],
    },
    selectionPolicy: {
      maxTmReferences: 3,
      maxConcordanceReferences: 3,
    },
    diagnostics: [],
  };
  const tb = {
    unitId,
    segmentId,
    mountedTBs: [],
    rawMatches: [
      {
        tbName: 'Terms',
        srcTerm: sourceText.split(' ')[0],
        tgtTerm: targetText.split(' ')[0],
      },
    ],
    selectedReferences: [
      {
        srcTerm: sourceText.split(' ')[0],
        tgtTerm: targetText.split(' ')[0],
        note: null,
      },
    ],
    selectionPolicy: {
      maxTbReferences: 100,
    },
    diagnostics: [],
  };

  return {
    engineReferences: {
      tm: [
        {
          kind: 'tm' as const,
          rank: 1,
          tmName: 'Main TM',
          sourceText,
          targetText,
          similarity: 100,
        },
      ],
      tb: [
        {
          tbName: 'Terms',
          srcTerm: sourceText.split(' ')[0],
          tgtTerm: targetText.split(' ')[0],
          note: null,
        },
      ],
    },
    tm,
    tb,
  };
}
