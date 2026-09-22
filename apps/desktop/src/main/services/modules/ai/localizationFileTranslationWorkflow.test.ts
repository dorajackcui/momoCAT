import { describe, expect, it, vi } from 'vitest';
import { CATDatabase } from '@cat/db';
import { LocalizationEngine } from '@cat/localization';
import type { Segment } from '@cat/core/models';
import type { Project } from '@cat/core/project';
import { runLocalizationFileTranslation } from './localizationFileTranslationWorkflow';
import { AITranslationOrchestrator } from './AITranslationOrchestrator';

function segment(id: string, orderIndex: number, target = '', confirmed = false): Segment {
  return {
    segmentId: id,
    fileId: 1,
    orderIndex,
    sourceTokens: [{ type: 'text', content: `Source-${id}` }],
    targetTokens: target ? [{ type: 'text', content: target }] : [],
    status: confirmed ? 'confirmed' : target ? 'draft' : 'empty',
    tagsSignature: '',
    matchKey: id,
    srcHash: id,
    meta: { context: 'name' },
  };
}

function configureProvider(db: CATDatabase, projectId: number) {
  const timestamp = '2026-01-01T00:00:00.000Z';
  db.setSetting(
    'ai_connection_catalog_v1',
    JSON.stringify([
      {
        id: 'connection:test',
        name: 'Test',
        baseUrl: 'https://example.test/v1',
        protocol: 'chat-completions',
        kind: 'openai-compatible',
        apiKeyLast4: 'test',
        discoveredModels: ['gpt-demo'],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]),
  );
  db.setSetting('ai_connection_key::connection:test', 'test-key');
  db.setSetting(
    'ai_provider_catalog_v2',
    JSON.stringify([
      {
        id: 'provider:test',
        name: 'Test model',
        connectionId: 'connection:test',
        model: 'gpt-demo',
        protocol: 'chat-completions',
        kind: 'configured',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]),
  );
  db.updateProjectAISettings(projectId, null, 'provider:test');
}

describe('filtered localization file translation', () => {
  it.each(['use-current-targets', 'ignore-current-targets'] as const)(
    'builds windows from non-adjacent selected rows, retaining IDs and %s',
    async (targetBaseline) => {
      const db = new CATDatabase(':memory:');
      try {
        const projectId = db.createProject('Names', 'en', 'fr');
        configureProvider(db, projectId);
        const selected = [
          segment('s10', 9),
          segment('s30', 29, 'Existing name'),
          segment('s40', 39, 'Confirmed name', true),
          segment('s50', 49),
          segment('s70', 69),
          segment('s80', 79),
        ];
        const all = [
          segment('outside-before', 0),
          ...selected.flatMap((row) => [
            row,
            segment(`outside-${row.segmentId}`, row.orderIndex + 1, 'Outside target'),
          ]),
        ];
        const prompts: string[] = [];
        const createResponse = vi.fn(async (request: { userPrompt: string }) => {
          prompts.push(request.userPrompt);
          const ids = [...request.userPrompt.matchAll(/^id: (.+)$/gm)].map((match) => match[1]);
          return {
            content: JSON.stringify({
              translations: ids
                .map((id, index) => ({
                  id,
                  text: `Translated-${prompts.length}-${index}`,
                }))
                .reverse(),
            }),
            status: 200,
            endpoint: '/mock',
          };
        });
        const engine = new LocalizationEngine(db, {
          dbPath: ':memory:',
          aiTransport: { createResponse, testConnection: vi.fn() },
          aiRuntimeConfigProvider: { getModelConfig: async () => ({ reasoningEffort: 'medium' }) },
        });
        const updateSegment = vi.fn().mockResolvedValue(undefined);
        const onProgress = vi.fn();
        const result = await runLocalizationFileTranslation({
          fileId: 1,
          fileName: 'names.xlsx',
          project: db.getProject(projectId)!,
          // Deliberately reverse and duplicate IDs; file order defines the context sequence.
          segmentIds: [...selected.map((row) => row.segmentId).reverse(), 's10'],
          targetBaseline,
          tagPolicy: 'none',
          localizationEngine: engine,
          segmentPagingIterator: { iterateFileSegments: () => all.values() } as never,
          segmentService: { updateSegment } as never,
          onProgress,
        });
        const overwrite = targetBaseline === 'ignore-current-targets';
        expect(result).toEqual({
          translated: overwrite ? 5 : 4,
          skipped: overwrite ? 1 : 2,
          failed: 0,
          total: 6,
        });
        expect(prompts).toHaveLength(2);
        expect([...prompts[0].matchAll(/^id: (.+)$/gm)]).toHaveLength(overwrite ? 4 : 3);
        expect([...prompts[1].matchAll(/^id: (.+)$/gm)]).toHaveLength(1);
        expect(prompts.join('\n')).not.toContain('outside');
        expect(prompts[0]).toContain('Confirmed name');
        expect(prompts[0].includes('Existing name')).toBe(!overwrite);
        expect(prompts[1]).toContain('Translated-1-0');
        expect(updateSegment.mock.calls.map(([id]) => id)).toEqual(
          overwrite ? ['s10', 's30', 's50', 's70', 's80'] : ['s10', 's50', 's70', 's80'],
        );
        expect(updateSegment).toHaveBeenNthCalledWith(
          1,
          's10',
          [{ type: 'text', content: 'Translated-1-0' }],
          'draft',
        );
        expect(onProgress).toHaveBeenLastCalledWith(
          expect.objectContaining({ current: 6, total: 6 }),
        );
      } finally {
        db.close();
      }
    },
  );

  it.each([[], ['other-file-id'], ['s10', 'deleted-id']].map((segmentIds) => ({ segmentIds })))(
    'rejects invalid scope $segmentIds without engine calls or writes',
    async ({ segmentIds }) => {
      const translateProjectSegments = vi.fn();
      const updateSegment = vi.fn();
      await expect(
        runLocalizationFileTranslation({
          fileId: 1,
          fileName: 'names.xlsx',
          project: { id: 1 } as Project,
          segmentIds,
          targetBaseline: 'use-current-targets',
          tagPolicy: 'none',
          localizationEngine: { translateProjectSegments },
          segmentPagingIterator: {
            iterateFileSegments: () => [segment('s10', 9)].values(),
          } as never,
          segmentService: { updateSegment } as never,
        }),
      ).rejects.toThrow();
      expect(translateProjectSegments).not.toHaveBeenCalled();
      expect(updateSegment).not.toHaveBeenCalled();
    },
  );

  it('does not write an out-of-scope engine result', async () => {
    const updateSegment = vi.fn();
    await runLocalizationFileTranslation({
      fileId: 1,
      fileName: 'names.xlsx',
      project: { id: 1 } as Project,
      segmentIds: ['s10'],
      targetBaseline: 'use-current-targets',
      tagPolicy: 'none',
      localizationEngine: {
        translateProjectSegments: async (input) => {
          await input.onResult?.({
            id: 'outside',
            source: 'outside',
            target: 'Unwanted',
            status: 'translated',
          });
          return { summary: { total: 1, translated: 0, skipped: 1, failed: 0 }, results: [] };
        },
      },
      segmentPagingIterator: {
        iterateFileSegments: () => [segment('s10', 9), segment('outside', 10)].values(),
      } as never,
      segmentService: { updateSegment } as never,
    });
    expect(updateSegment).not.toHaveBeenCalled();
  });

  it.each(['dialogue', 'review', 'legacy'])(
    'rejects filtered scope on the unsupported %s route',
    async (route) => {
      const orchestrator = new AITranslationOrchestrator(
        {
          getFile: () => ({ projectId: 1 }),
          getProject: () => ({ projectType: route === 'review' ? 'review' : 'translation' }),
        } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {},
        route === 'legacy' ? undefined : { translateProjectSegments: vi.fn() },
      );
      await expect(
        orchestrator.aiTranslateFile(1, {
          segmentIds: ['s10'],
          mode: route === 'dialogue' ? 'dialogue' : 'default',
        }),
      ).rejects.toThrow('requires the window translation workflow');
    },
  );
});
