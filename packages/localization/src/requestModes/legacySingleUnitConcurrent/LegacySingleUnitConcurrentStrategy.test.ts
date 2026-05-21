import { describe, expect, it, vi } from 'vitest';
import type { Project } from '@cat/core/project';
import { parseEditorTextToTokens } from '@cat/core/tag';
import { createTransientSegment } from '../../transientSegment';
import type { PromptArtifact } from '../../artifacts';
import type { ResolvedMTConfig } from '../../modules/MTModule';
import type { LocalizationEngineOptions } from '../../types';
import { LegacySingleUnitConcurrentStrategy } from './LegacySingleUnitConcurrentStrategy';

describe('LegacySingleUnitConcurrentStrategy', () => {
  it('translates each unit with single-unit MT, preserves order, and includes references', async () => {
    const firstSegment = createTransientSegment(
      { id: 'unit-1', source: 'Save file' },
      0,
      { sourceLanguage: 'en-US', targetLanguage: 'fr-FR' },
    );
    const secondSegment = createTransientSegment({ id: 'unit-2', source: 'Close window' }, 1);
    const firstReferences = references('unit-1', firstSegment.segmentId, 'Save file', 'Enregistrer');
    const secondReferences = references('unit-2', secondSegment.segmentId, 'Close window', 'Fermer');
    const translate = vi.fn().mockImplementation(async ({ unitId, segment }) => ({
      targetTokens: parseEditorTextToTokens(
        unitId === 'unit-1' ? 'Enregistrer le fichier' : 'Fermer la fenetre',
        segment.sourceTokens,
      ),
      prompt: promptArtifact(unitId),
    }));
    const strategy = new LegacySingleUnitConcurrentStrategy({
      tmModule: {
        inspect: vi
          .fn()
          .mockResolvedValueOnce(firstReferences.tm)
          .mockResolvedValueOnce(secondReferences.tm),
      },
      tbModule: {
        inspect: vi
          .fn()
          .mockResolvedValueOnce(firstReferences.tb)
          .mockResolvedValueOnce(secondReferences.tb),
      },
      mtModule: { translate },
    });
    const projectRecord = project();

    const result = await strategy.translateUnits({
      project: projectRecord,
      mtConfig: resolvedMTConfig(),
      mtOptions: mtOptions(),
      includeReferences: true,
      maxConcurrency: 2,
      units: [
        {
          unit: {
            id: 'unit-1',
            source: 'Save file',
            sourceLanguage: 'en-US',
            targetLanguage: 'fr-FR',
            metadata: { row: 1 },
          },
          segment: firstSegment,
        },
        {
          unit: { id: 'unit-2', source: 'Close window' },
          segment: secondSegment,
        },
      ],
    });

    expect(translate).toHaveBeenCalledTimes(2);
    expect(translate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        unitId: 'unit-1',
        project: projectRecord,
        segment: firstSegment,
        tm: firstReferences.tm,
        tb: firstReferences.tb,
        mtOptions: {},
        apiKey: 'secret-api-key',
        baseUrl: 'https://mock.local',
        model: 'mock-model',
        reasoningEffort: 'medium',
        provider: resolvedMTConfig().provider,
        srcLang: 'en-US',
        tgtLang: 'fr-FR',
      }),
    );
    expect(result).toEqual({
      summary: {
        total: 2,
        translated: 2,
        skipped: 0,
        failed: 0,
      },
      results: [
        {
          id: 'unit-1',
          source: 'Save file',
          target: 'Enregistrer le fichier',
          status: 'translated',
          references: firstReferences.engineReferences,
          metadata: { row: 1 },
        },
        {
          id: 'unit-2',
          source: 'Close window',
          target: 'Fermer la fenetre',
          status: 'translated',
          references: secondReferences.engineReferences,
          metadata: undefined,
        },
      ],
    });
  });

  it('converts rejected single-unit requests to failed results while other units succeed', async () => {
    const firstSegment = createTransientSegment({ id: 'unit-1', source: 'Save file' }, 0);
    const secondSegment = createTransientSegment({ id: 'unit-2', source: 'Close window' }, 1);
    const translate = vi.fn().mockImplementation(async ({ unitId, segment }) => {
      if (unitId === 'unit-1') {
        throw new Error('provider unavailable');
      }

      return {
        targetTokens: parseEditorTextToTokens('Fermer la fenetre', segment.sourceTokens),
        prompt: promptArtifact(unitId),
      };
    });
    const strategy = new LegacySingleUnitConcurrentStrategy({
      tmModule: {
        inspect: vi
          .fn()
          .mockResolvedValueOnce(references('unit-1', firstSegment.segmentId, 'Save file', 'Enregistrer').tm)
          .mockResolvedValueOnce(references('unit-2', secondSegment.segmentId, 'Close window', 'Fermer').tm),
      },
      tbModule: {
        inspect: vi
          .fn()
          .mockResolvedValueOnce(references('unit-1', firstSegment.segmentId, 'Save file', 'Enregistrer').tb)
          .mockResolvedValueOnce(references('unit-2', secondSegment.segmentId, 'Close window', 'Fermer').tb),
      },
      mtModule: { translate },
    });

    const result = await strategy.translateUnits({
      project: project(),
      mtConfig: resolvedMTConfig(),
      mtOptions: mtOptions(),
      includeReferences: false,
      units: [
        { unit: { id: 'unit-1', source: 'Save file', target: 'Existing' }, segment: firstSegment },
        { unit: { id: 'unit-2', source: 'Close window' }, segment: secondSegment },
      ],
    });

    expect(result.summary).toEqual({ total: 2, translated: 1, skipped: 0, failed: 1 });
    expect(result.results).toEqual([
      {
        id: 'unit-1',
        source: 'Save file',
        target: 'Existing',
        status: 'failed',
        error: 'provider unavailable',
        metadata: undefined,
      },
      {
        id: 'unit-2',
        source: 'Close window',
        target: 'Fermer la fenetre',
        status: 'translated',
        references: undefined,
        metadata: undefined,
      },
    ]);
  });

  it('honors bounded concurrency for single-unit requests', async () => {
    const segments = [
      createTransientSegment({ id: 'unit-1', source: 'One' }, 0),
      createTransientSegment({ id: 'unit-2', source: 'Two' }, 1),
      createTransientSegment({ id: 'unit-3', source: 'Three' }, 2),
    ];
    let active = 0;
    let maxActive = 0;
    const translate = vi.fn().mockImplementation(async ({ unitId, segment }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(20);
      active -= 1;

      return {
        targetTokens: parseEditorTextToTokens(`${unitId} target`, segment.sourceTokens),
        prompt: promptArtifact(unitId),
      };
    });
    const strategy = new LegacySingleUnitConcurrentStrategy({
      tmModule: { inspect: vi.fn() },
      tbModule: { inspect: vi.fn() },
      mtModule: { translate },
    });

    const result = await strategy.translateUnits({
      project: { ...project(), projectType: 'transcreation' },
      mtConfig: resolvedMTConfig(),
      mtOptions: mtOptions(),
      includeReferences: false,
      maxConcurrency: 2,
      units: segments.map((segment, index) => ({
        unit: { id: `unit-${index + 1}`, source: ['One', 'Two', 'Three'][index] },
        segment,
      })),
    });

    expect(result.results.map((unit) => unit.target)).toEqual([
      'unit-1 target',
      'unit-2 target',
      'unit-3 target',
    ]);
    expect(maxActive).toBe(2);
  });
});

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function project(): Project {
  return {
    id: 1,
    uuid: 'project-uuid',
    name: 'Legacy Project',
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

function promptArtifact(unitId: string): PromptArtifact {
  return {
    unitId,
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
