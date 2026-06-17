import type { Segment, TBMatch } from '@cat/core/models';
import { serializeTokensToDisplayText } from '@cat/core/text';
import { CATDatabase } from '../../../db/src';
import { describe, expect, it, vi } from 'vitest';
import { SqliteSettingsRepository } from '../adapters/sqlite/SqliteSettingsRepository';
import { AIProviderCatalogService } from '../providers/AIProviderCatalogService';
import type { AIRuntimeConfigProvider, AITransport } from '../ports';
import type { TagValidator } from '@cat/core/qa';
import type { TMMatch } from '../internalServices';
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
      seedConfiguredAIProvider(db, projectId);
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
        id: 'provider:gpt-demo',
        name: 'Test / gpt-demo',
        baseUrl: 'https://example.com/v1',
      });
      expect(artifact.model).toBe('test-model');
      expect(artifact.reasoningEffort).toBe('low');
      expect(artifact.projectPrompt).toBe('Use a concise style.');
      expect(artifact.projectType).toBe('translation');
      expect(artifact.sourcePayload).toBe('Hello world');
      expect(artifact.tmPromptBlock).toContain('Client Main TM');
      expect(artifact.tmPromptBlock).toContain('Bonjour le monde');
      expect(artifact.concordancePromptBlock).toContain('Concordance Suggestions:');
      expect(artifact.concordancePromptBlock).toContain('Client Concordance TM');
      expect(artifact.tbPromptBlock).toContain('world');
      expect(artifact.tbPromptBlock).toContain('monde');
      expect(artifact.referencePromptBlock).toContain(artifact.concordancePromptBlock);
      expect(artifact.userPrompt).toContain(artifact.tmPromptBlock);
      expect(artifact.userPrompt).toContain(artifact.concordancePromptBlock);
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
      seedConfiguredAIProvider(db, projectId);
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
        id: 'provider:gpt-demo',
        name: 'Test / gpt-demo',
        baseUrl: 'https://example.com/v1',
      });
      expect(artifact.model).toBe('gpt-demo');
      expect(artifact.reasoningEffort).toBe('medium');
      expect(transport.createResponse).not.toHaveBeenCalled();
      expect(transport.testConnection).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('composes prompts with current translation repair context', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Repair Prompt', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const segment = createTransientSegment({ id: 'unit-1', source: 'Save {1}' }, 0, {
        projectId,
        sourceLanguage: 'en',
        targetLanguage: 'fr',
      });
      const transport = createTransport();
      const module = createModule(db, transport);

      const artifact = await module.composePrompt({
        unitId: 'unit-1',
        project,
        segment,
        tm: createTMArtifact(segment),
        tb: createTBArtifact(segment),
        currentTranslationPayload: 'Broken translation',
        refinementInstruction: 'Repair only the placeholder mismatch.',
        validationFeedback: 'Missing marker: {1}',
      });

      expect(artifact.userPrompt).toContain('Current Translation:');
      expect(artifact.userPrompt).toContain('Broken translation');
      expect(artifact.userPrompt).toContain('Refinement Instruction:');
      expect(artifact.userPrompt).toContain('Repair only the placeholder mismatch.');
      expect(artifact.userPrompt).toContain('Validation feedback from previous attempt:');
      expect(artifact.userPrompt).toContain('Missing marker: {1}');
    } finally {
      db.close();
    }
  });

  it('passes marker-like source text as ordinary payload when tag policy is none', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Plain Marker Payload', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const segment = createTransientSegment(
        { id: 'unit-1', source: 'Save {1} {1>name<2} <b>x</b> %s' },
        0,
        { projectId, sourceLanguage: 'en', targetLanguage: 'fr' },
        { tagPolicy: 'none' },
      );
      const transport = createTransport();
      const module = createModule(db, transport);

      const artifact = await module.composePrompt({
        unitId: 'unit-1',
        project,
        segment,
        tm: createTMArtifact(segment),
        tb: createTBArtifact(segment),
        tagPolicy: 'none',
      });

      expect(artifact.sourcePayload).toBe('Save {1} {1>name<2} <b>x</b> %s');
      expect(artifact.userPrompt).toContain('Save {1} {1>name<2} <b>x</b> %s');
      expect(artifact.userPrompt).not.toContain('{1>x<2}');
      expect(transport.createResponse).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('falls old built-in provider ids back to the first configured provider at runtime', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Legacy Provider Fallback', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      db.updateProjectAISettings(projectId, null, 'builtin:openai:gpt-5-mini');
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const transport = createTransport();
      const module = createModule(db, transport);

      const config = await module.resolveConfig(project);

      expect(config.provider).toMatchObject({
        id: 'provider:gpt-demo',
        baseUrl: 'https://example.com/v1',
        model: 'gpt-demo',
      });
      expect(config.model).toBe('gpt-demo');
      expect(config.apiKey).toBe('test-api-key');

      const overrideConfig = await module.resolveConfig(project, {
        model: 'override-model',
      });
      expect(overrideConfig.provider).toMatchObject({
        id: 'provider:gpt-demo',
        baseUrl: 'https://example.com/v1',
        model: 'gpt-demo',
      });
      expect(overrideConfig.model).toBe('override-model');
      expect(overrideConfig.apiKey).toBe('test-api-key');
    } finally {
      db.close();
    }
  });

  it('translates through AITextTranslator and returns provider text as tokens', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Translate', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
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
        baseUrl: 'https://example.com/v1',
        model: 'test-model',
        reasoningEffort: 'medium',
      });
      expect(request.systemPrompt).toBe(result.prompt.systemPrompt);
      expect(request.userPrompt).toBe(result.prompt.userPrompt);
    } finally {
      db.close();
    }
  });

  it('protects literal newline escape sequences as markers in MT prompts and retries when one is dropped', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Newline Markers', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const segment = createTransientSegment({ id: 'unit-1', source: 'Hello\\nworld\\nagain' }, 0);
      const transport = createTransport();
      transport.createResponse
        .mockResolvedValueOnce({
          content: 'Bonjour{1}monde',
          status: 200,
          endpoint: '/mock',
        })
        .mockResolvedValueOnce({
          content: 'Bonjour{1}monde{2}encore',
          status: 200,
          endpoint: '/mock',
        });
      const module = createModule(db, transport);
      const config = await module.resolveConfig(project);

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

      expect(result.prompt.sourcePayload).toBe('Hello{1}world{2}again');
      expect(result.prompt.userPrompt).toContain('Hello{1}world{2}again');
      expect(serializeTokensToDisplayText(result.targetTokens)).toBe('Bonjour\\nmonde\\nencore');
      expect(transport.createResponse).toHaveBeenCalledTimes(2);
      const secondRequest = transport.createResponse.mock.calls[1]?.[0];
      expect(secondRequest.userPrompt).toContain('Previous translation was invalid.');
      expect(result.prompt.userPrompt).toBe(secondRequest.userPrompt);
    } finally {
      db.close();
    }
  });

  it('accepts provider text that is identical to the source text', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Unchanged', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const segment = createTransientSegment({ id: 'unit-1', source: 'Hello world' }, 0);
      const transport = createTransport('Hello world');
      const module = createModule(db, transport);
      const config = await module.resolveConfig(project);

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

      expect(serializeTokensToDisplayText(result.targetTokens)).toBe('Hello world');
      expect(transport.createResponse).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });

  it('parses marker-like provider text as plain text and skips tag retry when tag policy is none', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Plain Marker Response', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const segment = createTransientSegment(
        { id: 'unit-1', source: 'Save {1} <b>x</b>' },
        0,
        {},
        { tagPolicy: 'none' },
      );
      const transport = createTransport('<b>Enregistrer</b> {1>nom<2}');
      const tagValidator = createFailingTagValidator();
      const module = createModule(db, transport, 'medium', tagValidator);
      const config = await module.resolveConfig(project);

      const result = await module.translate({
        unitId: 'unit-1',
        project,
        segment,
        tm: createTMArtifact(segment),
        tb: createTBArtifact(segment),
        tagPolicy: 'none',
        apiKey: config.apiKey,
        baseUrl: config.provider.baseUrl,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        provider: config.provider,
        srcLang: 'en',
        tgtLang: 'fr',
      });

      expect(result.targetTokens).toEqual([
        { type: 'text', content: '<b>Enregistrer</b> {1>nom<2}' },
      ]);
      expect(serializeTokensToDisplayText(result.targetTokens)).toBe('<b>Enregistrer</b> {1>nom<2}');
      expect(transport.createResponse).toHaveBeenCalledTimes(1);
      expect(tagValidator.validate).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('composes a Window Mode batch prompt without calling provider transport', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Batch Prompt', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const row2 = createTransientSegment(
        { id: 'row-2', source: 'Save file', fileName: 'doc.xlsx' },
        1,
      );
      const row3 = createTransientSegment(
        { id: 'row-3', source: 'Close', fileName: 'doc.xlsx' },
        2,
      );
      const transport = createTransport();
      const module = createModule(db, transport);

      const artifact = await module.composeBatchPrompt({
        taskId: 'window-task-1',
        project,
        current: [
          {
            responseId: 'r1',
            documentId: 'doc.xlsx',
            unitId: 'unit-2',
            segment: row2,
            tm: createTMArtifact(row2),
            tb: createTBArtifact(row2),
          },
          {
            responseId: 'r2',
            documentId: 'doc.xlsx',
            unitId: 'unit-3',
            segment: row3,
            tm: createTMArtifact(row3),
            tb: createTBArtifact(row3),
          },
        ],
        previousContext: [{ source: 'Open', target: 'Ouvrir' }],
        nextContext: [{ source: 'Preferences' }],
      });

      expect(artifact.batch).toEqual({
        mode: 'window',
        taskId: 'window-task-1',
        currentIds: ['r1', 'r2'],
        responseIdMap: [
          { responseId: 'r1', documentId: 'doc.xlsx', unitId: 'unit-2' },
          { responseId: 'r2', documentId: 'doc.xlsx', unitId: 'unit-3' },
        ],
        previousContextCount: 1,
        nextContextCount: 1,
      });
      expect(artifact.userPrompt).toContain('Current segments');
      expect(artifact.userPrompt).toContain('id: r1');
      expect(artifact.userPrompt).toContain('Previous 5 translated rows');
      expect(artifact.userPrompt).toContain('Open -> Ouvrir');
      expect(artifact.userPrompt).toContain('Next 5 source rows');
      expect(artifact.userPrompt).not.toContain('documentId');
      expect(artifact.userPrompt).not.toContain('doc.xlsx');
      expect(artifact.tmPromptBlock).toContain('Client Main TM');
      expect(artifact.tmPromptBlock).toContain('Bonjour le monde');
      expect(artifact.tmPromptBlock).not.toContain('Source:');
      expect(artifact.tbPromptBlock).toContain('world -> monde');
      expect(artifact.tbPromptBlock).not.toContain('Source:');
      expect(transport.createResponse).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('passes marker-like Window Mode source payload as ordinary text when tag policy is none', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Batch Plain Marker Payload', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const row2 = createTransientSegment(
        { id: 'row-2', source: 'Save {1} {1>name<2} <b>x</b> %s' },
        0,
        {},
        { tagPolicy: 'none' },
      );
      const transport = createTransport();
      const module = createModule(db, transport);

      const artifact = await module.composeBatchPrompt({
        taskId: 'window-task-plain-markers',
        project,
        current: [
          {
            responseId: 'row-2',
            documentId: 'doc.xlsx',
            unitId: 'row-2',
            segment: row2,
            tm: createTMArtifact(row2),
            tb: createTBArtifact(row2),
          },
        ],
        previousContext: [],
        nextContext: [],
        tagPolicy: 'none',
      });

      expect(artifact.sourcePayload).toBe('row-2: Save {1} {1>name<2} <b>x</b> %s');
      expect(artifact.userPrompt).toContain('Save {1} {1>name<2} <b>x</b> %s');
      expect(artifact.userPrompt).not.toContain('{1>x<2}');
      expect(transport.createResponse).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('composes partial Window Mode metadata with request ids and optional counts', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Partial Batch Prompt', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const row2 = createTransientSegment(
        { id: 'row-2', source: 'Save file', fileName: 'doc.xlsx' },
        1,
      );
      const transport = createTransport();
      const module = createModule(db, transport);

      const artifact = await module.composeBatchPrompt({
        taskId: 'window-task-1',
        project,
        requestMode: 'window-partial',
        current: [
          {
            responseId: 'r1',
            documentId: 'doc.xlsx',
            unitId: 'unit-2',
            segment: row2,
            tm: createTMArtifact(row2),
            tb: createTBArtifact(row2),
          },
        ],
        previousContext: [],
        nextContext: [],
        readOnlyContextRows: [
          { role: 'previous', source: 'Open', target: 'Ouvrir', rowNumber: 1 },
          { role: 'next', source: 'Close', rowNumber: 3 },
        ],
        scanWindowCount: 3,
      });

      expect(artifact.batch).toEqual({
        mode: 'window-partial',
        taskId: 'window-task-1',
        currentIds: ['r1'],
        responseIdMap: [
          { responseId: 'r1', documentId: 'doc.xlsx', unitId: 'unit-2' },
        ],
        previousContextCount: 0,
        nextContextCount: 0,
        scanWindowCount: 3,
        requestCount: 1,
        readOnlyContextCount: 2,
      });
      expect(artifact.userPrompt).toContain('Return target text for ids: r1');
      expect(artifact.userPrompt).toContain(
        'Read-only context rows. Do not produce output or return ids for these rows.',
      );
      expect(artifact.userPrompt).toContain('Rows requiring target text. Return exactly these ids.');
      expect(artifact.userPrompt).toContain('<target text>');
      expect(artifact.userPrompt).not.toContain('id: Open');
      expect(transport.createResponse).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('translates Window Mode strict JSON responses into per-unit tokens', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Batch Translate', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const row2 = createTransientSegment({ id: 'row-2', source: 'Save file' }, 1);
      const row3 = createTransientSegment({ id: 'row-3', source: 'Close' }, 2);
      const transport = createTransport(
        JSON.stringify({
          translations: [
            { id: 'row-3', text: 'Fermer' },
            { id: 'row-2', text: 'Enregistrer le fichier' },
          ],
        }),
      );
      const module = createModule(db, transport);
      const config = await module.resolveConfig(project, {
        model: 'test-model',
        reasoningEffort: 'medium',
      });

      const result = await module.translateBatch({
        taskId: 'window-task-1',
        project,
        current: [
          {
            responseId: 'row-2',
            documentId: 'doc.xlsx',
            unitId: 'unit-2',
            segment: row2,
            tm: createTMArtifact(row2),
            tb: createTBArtifact(row2),
          },
          {
            responseId: 'row-3',
            documentId: 'doc.xlsx',
            unitId: 'unit-3',
            segment: row3,
            tm: createTMArtifact(row3),
            tb: createTBArtifact(row3),
          },
        ],
        previousContext: [],
        nextContext: [],
        apiKey: config.apiKey,
        baseUrl: config.provider.baseUrl,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        provider: config.provider,
        srcLang: 'en',
        tgtLang: 'fr',
      });

      expect(result.results.map((unit) => unit.responseId)).toEqual(['row-2', 'row-3']);
      expect(serializeTokensToDisplayText(result.results[0].targetTokens)).toBe(
        'Enregistrer le fichier',
      );
      expect(serializeTokensToDisplayText(result.results[1].targetTokens)).toBe('Fermer');
      expect(transport.createResponse).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });

  it('accepts Window Mode translations that are identical to their source text', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Batch Unchanged', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const row2 = createTransientSegment({ id: 'row-2', source: 'Save file' }, 1);
      const transport = createTransport(
        JSON.stringify({
          translations: [{ id: 'row-2', text: 'Save file' }],
        }),
      );
      const module = createModule(db, transport);
      const config = await module.resolveConfig(project);

      const result = await module.translateBatch({
        taskId: 'window-task-1',
        project,
        current: [
          {
            responseId: 'row-2',
            documentId: 'doc.xlsx',
            unitId: 'unit-2',
            segment: row2,
            tm: createTMArtifact(row2),
            tb: createTBArtifact(row2),
          },
        ],
        previousContext: [],
        nextContext: [],
        apiKey: config.apiKey,
        baseUrl: config.provider.baseUrl,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        provider: config.provider,
        srcLang: 'en',
        tgtLang: 'fr',
      });

      expect(serializeTokensToDisplayText(result.results[0].targetTokens)).toBe('Save file');
      expect(transport.createResponse).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });

  it('does not retry Window Mode tag validation when tag policy is none', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Batch No Tag Retry', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const row2 = createTransientSegment(
        { id: 'row-2', source: 'Save {1} <b>x</b>' },
        1,
        {},
        { tagPolicy: 'none' },
      );
      const transport = createTransport(
        JSON.stringify({
          translations: [{ id: 'row-2', text: 'Enregistrer sans marqueur' }],
        }),
      );
      const tagValidator = createFailingTagValidator();
      const module = createModule(db, transport, 'medium', tagValidator);
      const config = await module.resolveConfig(project);

      const result = await module.translateBatch({
        taskId: 'window-task-1',
        project,
        current: [
          {
            responseId: 'row-2',
            documentId: 'doc.xlsx',
            unitId: 'unit-2',
            segment: row2,
            tm: createTMArtifact(row2),
            tb: createTBArtifact(row2),
          },
        ],
        previousContext: [],
        nextContext: [],
        tagPolicy: 'none',
        apiKey: config.apiKey,
        baseUrl: config.provider.baseUrl,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        provider: config.provider,
        srcLang: 'en',
        tgtLang: 'fr',
      });

      expect(serializeTokensToDisplayText(result.results[0].targetTokens)).toBe(
        'Enregistrer sans marqueur',
      );
      expect(transport.createResponse).toHaveBeenCalledTimes(1);
      expect(tagValidator.validate).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('does not retry Window Mode tag validation for custom projects', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Batch Custom No Tag Retry', 'en', 'fr', 'custom');
      seedConfiguredAIProvider(db, projectId);
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const row2 = createTransientSegment({ id: 'row-2', source: 'Save {1} <b>x</b>' }, 1);
      const transport = createTransport(
        JSON.stringify({
          translations: [{ id: 'row-2', text: 'Enregistrer sans marqueur' }],
        }),
      );
      const tagValidator = createFailingTagValidator();
      const module = createModule(db, transport, 'medium', tagValidator);
      const config = await module.resolveConfig(project);

      const result = await module.translateBatch({
        taskId: 'window-task-1',
        project,
        current: [
          {
            responseId: 'row-2',
            documentId: 'doc.xlsx',
            unitId: 'unit-2',
            segment: row2,
            tm: createTMArtifact(row2),
            tb: createTBArtifact(row2),
          },
        ],
        previousContext: [],
        nextContext: [],
        apiKey: config.apiKey,
        baseUrl: config.provider.baseUrl,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        provider: config.provider,
        srcLang: 'en',
        tgtLang: 'fr',
      });

      expect(project.projectType).toBe('custom');
      expect(serializeTokensToDisplayText(result.results[0].targetTokens)).toBe(
        'Enregistrer sans marqueur',
      );
      expect(transport.createResponse).toHaveBeenCalledTimes(1);
      expect(tagValidator.validate).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('repairs only the invalid Window Mode unit with a single-segment prompt', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Batch Retry', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const row2 = createTransientSegment({ id: 'row-2', source: 'Save {1}' }, 1);
      const row3 = createTransientSegment({ id: 'row-3', source: 'Close' }, 2);
      const transport = createTransport();
      transport.createResponse
        .mockResolvedValueOnce({
          content: JSON.stringify({
            translations: [
              { id: 'r1', text: 'Enregistrer' },
              { id: 'r2', text: 'Fermer' },
            ],
          }),
          status: 200,
          endpoint: '/mock',
        })
        .mockResolvedValueOnce({
          content: 'Enregistrer {1}',
          status: 200,
          endpoint: '/mock',
        });
      const module = createModule(db, transport);
      const config = await module.resolveConfig(project, {
        model: 'test-model',
        reasoningEffort: 'medium',
      });

      const result = await module.translateBatch({
        taskId: 'window-task-1',
        project,
        current: [
          {
            responseId: 'r1',
            documentId: 'doc.xlsx',
            unitId: 'unit-2',
            segment: row2,
            tm: createTMArtifact(row2),
            tb: createTBArtifact(row2),
          },
          {
            responseId: 'r2',
            documentId: 'doc.xlsx',
            unitId: 'unit-3',
            segment: row3,
            tm: createTMArtifact(row3),
            tb: createTBArtifact(row3),
          },
        ],
        previousContext: [],
        nextContext: [],
        apiKey: config.apiKey,
        baseUrl: config.provider.baseUrl,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        provider: config.provider,
        srcLang: 'en',
        tgtLang: 'fr',
      });

      expect(transport.createResponse).toHaveBeenCalledTimes(2);
      const firstRequest = transport.createResponse.mock.calls[0]?.[0];
      const secondRequest = transport.createResponse.mock.calls[1]?.[0];
      expect(firstRequest.userPrompt).toContain('Current segments');
      expect(firstRequest.userPrompt).toContain('id: r1');
      expect(firstRequest.userPrompt).toContain('id: r2');
      expect(secondRequest.userPrompt).not.toContain('Current segments');
      expect(secondRequest.userPrompt).toContain('Current Translation:');
      expect(secondRequest.userPrompt).toContain('Enregistrer');
      expect(secondRequest.userPrompt).toContain('Refinement Instruction:');
      expect(secondRequest.userPrompt).toContain('Validation feedback');
      expect(secondRequest.userPrompt).not.toContain('r2');
      expect(secondRequest.userPrompt).not.toContain('Fermer');
      expect(result.results.map((unit) => unit.unitId)).toEqual(['unit-2', 'unit-3']);
      expect(serializeTokensToDisplayText(result.results[0].targetTokens)).toBe(
        'Enregistrer {1}',
      );
      expect(serializeTokensToDisplayText(result.results[1].targetTokens)).toBe('Fermer');
      expect(result.results[0]).toHaveProperty('prompt.userPrompt', secondRequest.userPrompt);
      expect(result.results[1]).not.toHaveProperty('prompt');
      expect(result.prompt.userPrompt).toBe(firstRequest.userPrompt);
    } finally {
      db.close();
    }
  });

  it('carries Window Mode unit context into a single-segment repair prompt', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Batch Repair Context', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const row2 = createTransientSegment({ id: 'row-2', source: 'Save {1}' }, 1);
      const transport = createTransport();
      transport.createResponse
        .mockResolvedValueOnce({
          content: JSON.stringify({
            translations: [{ id: 'r1', text: 'Enregistrer' }],
          }),
          status: 200,
          endpoint: '/mock',
        })
        .mockResolvedValueOnce({
          content: 'Enregistrer {1}',
          status: 200,
          endpoint: '/mock',
        });
      const module = createModule(db, transport);
      const config = await module.resolveConfig(project);

      const result = await module.translateBatch({
        taskId: 'window-task-1',
        project,
        current: [
          {
            responseId: 'r1',
            documentId: 'doc.xlsx',
            unitId: 'unit-2',
            segment: row2,
            tm: createTMArtifact(row2),
            tb: createTBArtifact(row2),
            context: 'Toolbar button label',
          },
        ],
        previousContext: [],
        nextContext: [],
        apiKey: config.apiKey,
        baseUrl: config.provider.baseUrl,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        provider: config.provider,
        srcLang: 'en',
        tgtLang: 'fr',
      });

      expect(transport.createResponse).toHaveBeenCalledTimes(2);
      const firstRequest = transport.createResponse.mock.calls[0]?.[0];
      const repairRequest = transport.createResponse.mock.calls[1]?.[0];
      expect(firstRequest.userPrompt).toContain('Toolbar button label');
      expect(repairRequest.userPrompt).toContain('Context: Toolbar button label');
      expect(result.results[0]).toHaveProperty('prompt.userPrompt', repairRequest.userPrompt);
    } finally {
      db.close();
    }
  });

  it('rejects when single-segment repair cannot fix an invalid Window Mode unit', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Batch Repair Failure', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const row2 = createTransientSegment({ id: 'row-2', source: 'Save {1}' }, 1);
      const row3 = createTransientSegment({ id: 'row-3', source: 'Close' }, 2);
      const transport = createTransport();
      transport.createResponse
        .mockResolvedValueOnce({
          content: JSON.stringify({
            translations: [
              { id: 'r1', text: 'Enregistrer' },
              { id: 'r2', text: 'Fermer' },
            ],
          }),
          status: 200,
          endpoint: '/mock',
        })
        .mockResolvedValue({
          content: 'Enregistrer',
          status: 200,
          endpoint: '/mock',
        });
      const module = createModule(db, transport);
      const config = await module.resolveConfig(project);

      await expect(
        module.translateBatch({
          taskId: 'window-task-1',
          project,
          current: [
            {
              responseId: 'r1',
              documentId: 'doc.xlsx',
              unitId: 'unit-2',
              segment: row2,
              tm: createTMArtifact(row2),
              tb: createTBArtifact(row2),
            },
            {
              responseId: 'r2',
              documentId: 'doc.xlsx',
              unitId: 'unit-3',
              segment: row3,
              tm: createTMArtifact(row3),
              tb: createTBArtifact(row3),
            },
          ],
          previousContext: [],
          nextContext: [],
          apiKey: config.apiKey,
          baseUrl: config.provider.baseUrl,
          model: config.model,
          reasoningEffort: config.reasoningEffort,
          provider: config.provider,
          srcLang: 'en',
          tgtLang: 'fr',
        }),
      ).rejects.toThrow(/Tag validation failed after 3 attempts/);

      expect(transport.createResponse).toHaveBeenCalledTimes(4);
      const repairRequests = transport.createResponse.mock.calls.slice(1).map((call) => call[0]);
      expect(repairRequests).toHaveLength(3);
      for (const request of repairRequests) {
        expect(request.userPrompt).toContain('Current Translation:');
        expect(request.userPrompt).toContain('Enregistrer');
        expect(request.userPrompt).not.toContain('r2');
        expect(request.userPrompt).not.toContain('Fermer');
      }
    } finally {
      db.close();
    }
  });

  it('rejects Window Mode responses with missing current ids', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Batch Missing', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const row2 = createTransientSegment({ id: 'row-2', source: 'Save file' }, 1);
      const transport = createTransport(JSON.stringify({ translations: [] }));
      const module = createModule(db, transport);
      const config = await module.resolveConfig(project);

      await expect(
        module.translateBatch({
          taskId: 'window-task-1',
          project,
          current: [
            {
              responseId: 'row-2',
              documentId: 'doc.xlsx',
              unitId: 'unit-2',
              segment: row2,
              tm: createTMArtifact(row2),
              tb: createTBArtifact(row2),
            },
          ],
          previousContext: [],
          nextContext: [],
          apiKey: config.apiKey,
          baseUrl: config.provider.baseUrl,
          model: config.model,
          reasoningEffort: config.reasoningEffort,
          provider: config.provider,
          srcLang: 'en',
          tgtLang: 'fr',
        }),
      ).rejects.toThrow(/missing translation id: row-2/i);
    } finally {
      db.close();
    }
  });

  it('rejects Window Mode invalid strict JSON responses from provider', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Batch Invalid JSON', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const row2 = createTransientSegment({ id: 'row-2', source: 'Save file' }, 1);
      const transport = createTransport('```json\n{"translations":[]}\n```');
      const module = createModule(db, transport);
      const config = await module.resolveConfig(project);

      await expect(
        module.translateBatch({
          taskId: 'window-task-1',
          project,
          current: [
            {
              responseId: 'row-2',
              documentId: 'doc.xlsx',
              unitId: 'unit-2',
              segment: row2,
              tm: createTMArtifact(row2),
              tb: createTBArtifact(row2),
            },
          ],
          previousContext: [],
          nextContext: [],
          apiKey: config.apiKey,
          baseUrl: config.provider.baseUrl,
          model: config.model,
          reasoningEffort: config.reasoningEffort,
          provider: config.provider,
          srcLang: 'en',
          tgtLang: 'fr',
        }),
      ).rejects.toThrow(/invalid strict json/i);
      expect(transport.createResponse).toHaveBeenCalledTimes(1);
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
  tagValidator?: TagValidator,
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
    tagValidator,
  });
}

function createFailingTagValidator(): TagValidator {
  return {
    validate: vi.fn(() => ({
      issues: [{ ruleId: 'tag-missing', severity: 'error' as const, message: 'Should not run' }],
      suggestions: [],
    })),
    generateAutoFix: vi.fn(() => null),
  };
}

function seedConfiguredAIProvider(db: CATDatabase, projectId: number): void {
  db.setSetting(
    'ai_connection_catalog_v1',
    JSON.stringify([
      {
        id: 'connection:test',
        name: 'Test Connection',
        baseUrl: 'https://example.com/v1',
        protocol: 'chat-completions',
        kind: 'openai-compatible',
        apiKeyLast4: 'key',
        discoveredModels: ['gpt-demo'],
        createdAt: '2026-05-22T00:00:00.000Z',
        updatedAt: '2026-05-22T00:00:00.000Z',
      },
    ]),
  );
  db.setSetting('ai_connection_key::connection:test', 'test-api-key');
  db.setSetting(
    'ai_provider_catalog_v2',
    JSON.stringify([
      {
        id: 'provider:gpt-demo',
        name: 'Test / gpt-demo',
        connectionId: 'connection:test',
        model: 'gpt-demo',
        protocol: 'chat-completions',
        kind: 'configured',
        createdAt: '2026-05-22T00:00:00.000Z',
        updatedAt: '2026-05-22T00:00:00.000Z',
      },
    ]),
  );
  db.updateProjectAISettings(projectId, null, 'provider:gpt-demo');
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
      concordanceReferences: [
        {
          tmName: 'Client Concordance TM',
          matchedSourceText: 'world',
          sourceText: 'World menu',
          targetText: 'Menu monde',
        },
      ],
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
