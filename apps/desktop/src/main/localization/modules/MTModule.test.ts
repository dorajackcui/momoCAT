import type { Segment, TBMatch } from '@cat/core/models';
import { serializeTokensToDisplayText } from '@cat/core/text';
import { CATDatabase } from '../../../../../../packages/db/src';
import { describe, expect, it, vi } from 'vitest';
import { SqliteSettingsRepository } from '../../services/adapters/SqliteSettingsRepository';
import { AIProviderCatalogService } from '../../services/modules/ai/AIProviderCatalogService';
import type { AIRuntimeConfigProvider, AITransport } from '../../services/ports';
import type { TMMatch } from '../../services/TMService';
import type { TBArtifact, TMArtifact } from '../artifacts';
import { createTransientSegment } from '../transientSegment';
import { MTModule } from './MTModule';

type MockTransport = AITransport & {
  testConnection: ReturnType<typeof vi.fn>;
  createResponse: ReturnType<typeof vi.fn>;
};

describe('MTModule', () => {
  it('composes prompts from structured TM and TB artifacts with provider metadata and char counts', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Prompt', 'en', 'fr');
      db.setSetting('openai_api_key', 'test-api-key');
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const segment = createTransientSegment({ id: 'unit-1', source: 'Hello world' }, 0, {
        projectId,
        sourceLanguage: 'en',
        targetLanguage: 'fr',
      });
      const transport = createTransport();
      const module = createModule(db, transport, 'high');

      const artifact = await module.composePrompt({
        unitId: 'unit-1',
        project,
        segment,
        tm: createTMArtifact(segment),
        tb: createTBArtifact(segment),
        mtOptions: {
          model: 'test-model',
          reasoningEffort: 'low',
          systemPrompt: 'Use a concise style.',
        },
      });

      expect(artifact.provider).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        baseUrl: 'https://api.openai.com/v1',
      });
      expect(artifact.model).toBe('test-model');
      expect(artifact.reasoningEffort).toBe('low');
      expect(artifact.projectPrompt).toBe('Use a concise style.');
      expect(artifact.projectType).toBe('translation');
      expect(artifact.sourcePayload).toBe('Hello world');
      expect(artifact.tmPromptBlock).toContain('Client Main TM');
      expect(artifact.tmPromptBlock).toContain('Bonjour le monde');
      expect(artifact.tbPromptBlock).toContain('world');
      expect(artifact.tbPromptBlock).toContain('monde');
      expect(artifact.userPrompt).toContain(artifact.tmPromptBlock);
      expect(artifact.userPrompt).toContain(artifact.tbPromptBlock);
      expect(artifact.promptChars).toEqual({
        system: artifact.systemPrompt.length,
        user: artifact.userPrompt.length,
        total: artifact.systemPrompt.length + artifact.userPrompt.length,
      });
    } finally {
      db.close();
    }
  });

  it('does not call provider transport while composing a prompt', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT No Transport', 'en', 'fr');
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const segment = createTransientSegment({ id: 'unit-1', source: 'Hello world' }, 0);
      const transport = createTransport();

      const artifact = await createModule(db, transport).composePrompt({
        unitId: 'unit-1',
        project,
        segment,
        tm: createTMArtifact(segment),
        tb: createTBArtifact(segment),
      });

      expect(artifact.provider).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        baseUrl: 'https://api.openai.com/v1',
      });
      expect(artifact.model).toBeTruthy();
      expect(artifact.reasoningEffort).toBe('medium');
      expect(transport.createResponse).not.toHaveBeenCalled();
      expect(transport.testConnection).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('translates through AITextTranslator and returns provider text as tokens', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Translate', 'en', 'fr');
      db.setSetting('openai_api_key', 'test-api-key');
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const segment = createTransientSegment({ id: 'unit-1', source: 'Hello world' }, 0);
      const transport = createTransport('Bonjour le monde');
      const module = createModule(db, transport);
      const config = await module.resolveConfig(project, {
        model: 'test-model',
        reasoningEffort: 'medium',
      });

      const result = await module.translate({
        unitId: 'unit-1',
        project,
        segment,
        tm: createTMArtifact(segment),
        tb: createTBArtifact(segment),
        apiKey: config.apiKey,
        baseUrl: config.provider.baseUrl,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        provider: config.provider,
        srcLang: 'en',
        tgtLang: 'fr',
      });

      expect(serializeTokensToDisplayText(result.targetTokens)).toBe('Bonjour le monde');
      expect(result.prompt.userPrompt).toContain('Client Main TM');
      expect(result.prompt.userPrompt).toContain('monde');
      expect(transport.createResponse).toHaveBeenCalledTimes(1);
      const request = transport.createResponse.mock.calls[0]?.[0];
      expect(request).toMatchObject({
        apiKey: 'test-api-key',
        baseUrl: 'https://api.openai.com/v1',
        model: 'test-model',
        reasoningEffort: 'medium',
      });
      expect(request.systemPrompt).toBe(result.prompt.systemPrompt);
      expect(request.userPrompt).toBe(result.prompt.userPrompt);
    } finally {
      db.close();
    }
  });
});

function createTransport(content = 'Bonjour'): MockTransport {
  return {
    testConnection: vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      endpoint: '/mock',
    }),
    createResponse: vi.fn().mockResolvedValue({
      content,
      status: 200,
      endpoint: '/mock',
    }),
  } as unknown as MockTransport;
}

function createModule(
  db: CATDatabase,
  transport: AITransport,
  reasoningEffort: 'low' | 'medium' | 'high' = 'medium',
): MTModule {
  const runtimeConfigProvider: AIRuntimeConfigProvider = {
    getModelConfig: vi.fn().mockResolvedValue({ reasoningEffort }),
  };

  return new MTModule({
    providerCatalogService: new AIProviderCatalogService(
      new SqliteSettingsRepository(db),
      transport,
    ),
    aiRuntimeConfigProvider: runtimeConfigProvider,
    aiTransport: transport,
  });
}

function createTMArtifact(segment: Segment): TMArtifact {
  const rawMatches: TMMatch[] = [
    {
      id: 'tm-match-1',
      projectId: 1,
      srcLang: 'en',
      tgtLang: 'fr',
      srcHash: segment.srcHash,
      matchKey: segment.matchKey,
      tagsSignature: segment.tagsSignature,
      sourceTokens: segment.sourceTokens,
      targetTokens: [{ type: 'text', content: 'Bonjour le monde' }],
      createdAt: '',
      updatedAt: '',
      usageCount: 1,
      rank: 100,
      tmName: 'Client Main TM',
      tmType: 'main',
      kind: 'tm',
      similarity: 100,
    },
  ];

  return {
    unitId: 'unit-1',
    segmentId: segment.segmentId,
    mountedTMs: [],
    rawMatches,
    selectedReferences: {
      tmReferences: [
        {
          similarity: 100,
          tmName: 'Client Main TM',
          sourceText: 'Hello world',
          targetText: 'Bonjour le monde',
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
}

function createTBArtifact(segment: Segment): TBArtifact {
  const rawMatches: TBMatch[] = [
    {
      id: 'tb-match-1',
      tbId: 'tb-1',
      srcTerm: 'world',
      tgtTerm: 'monde',
      srcNorm: 'world',
      note: 'Use the common noun.',
      createdAt: '',
      updatedAt: '',
      usageCount: 1,
      tbName: 'Client Terms',
      priority: 1,
      positions: [{ start: 6, end: 11 }],
    },
  ];

  return {
    unitId: 'unit-1',
    segmentId: segment.segmentId,
    mountedTBs: [],
    rawMatches,
    selectedReferences: [
      {
        srcTerm: 'world',
        tgtTerm: 'monde',
        note: 'Use the common noun.',
      },
    ],
    selectionPolicy: {
      maxTbReferences: 100,
    },
    diagnostics: [],
  };
}
