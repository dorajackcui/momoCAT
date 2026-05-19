import { describe, expect, it, vi } from 'vitest';
import type { TMEntry } from '@cat/core/models';
import { serializeTokensToDisplayText } from '@cat/core/text';
import { CATDatabase } from '../../../../../packages/db/src';
import type { AITransport } from '../services/ports';
import { LocalizationEngine } from './LocalizationEngine';
import { createTransientSegment } from './transientSegment';

type MockTransport = AITransport & {
  testConnection: ReturnType<typeof vi.fn>;
  createResponse: ReturnType<typeof vi.fn>;
};

function createTransport(content = 'Bonjour le monde'): MockTransport {
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

function seedApiKey(db: CATDatabase): void {
  db.setSetting('openai_api_key', 'test-api-key');
}

function createTMEntry(params: {
  tmId: string;
  projectId: number;
  sourceText: string;
  targetText: string;
}): TMEntry & { tmId: string } {
  const transient = createTransientSegment(
    {
      id: `seed-${params.sourceText}`,
      source: params.sourceText,
      target: params.targetText,
    },
    0,
  );
  const now = new Date().toISOString();

  return {
    id: `tm-${transient.srcHash}`,
    tmId: params.tmId,
    projectId: params.projectId,
    srcLang: 'en',
    tgtLang: 'fr',
    srcHash: transient.srcHash,
    matchKey: transient.matchKey,
    tagsSignature: transient.tagsSignature,
    sourceTokens: transient.sourceTokens,
    targetTokens: transient.targetTokens,
    usageCount: 1,
    createdAt: now,
    updatedAt: now,
  };
}

describe('LocalizationEngine.translateUnits', () => {
  it('translates external units through project MT without creating files or segments', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('External MT', 'en', 'fr');
      seedApiKey(db);
      const initialFiles = db.listFiles(projectId);
      const transport = createTransport('Bonjour');
      const engine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        aiTransport: transport,
      });

      const result = await engine.translateUnits({
        projectId,
        units: [{ id: 'unit-1', source: 'Hello' }],
      });

      expect(result.summary).toEqual({
        total: 1,
        translated: 1,
        skipped: 0,
        failed: 0,
      });
      expect(result.results).toEqual([
        {
          id: 'unit-1',
          source: 'Hello',
          target: 'Bonjour',
          status: 'translated',
          metadata: undefined,
          references: undefined,
        },
      ]);
      expect(transport.createResponse).toHaveBeenCalledTimes(1);
      expect(db.listFiles(projectId)).toEqual(initialFiles);
      expect(db.getProjectStats(projectId)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('resolves TM and TB references for transient units without persisting file records', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('External References', 'en', 'fr');
      seedApiKey(db);
      const tmId = db.createTM('Client Main TM', 'en', 'fr', 'main');
      db.mountTMToProject(projectId, tmId, 10, 'read');
      const tmEntry = createTMEntry({
        tmId,
        projectId,
        sourceText: 'Hello world',
        targetText: 'Bonjour le monde',
      });
      const tmEntryId = db.upsertTMEntryBySrcHash(tmEntry);
      db.replaceTMFts(
        tmId,
        serializeTokensToDisplayText(tmEntry.sourceTokens),
        serializeTokensToDisplayText(tmEntry.targetTokens),
        tmEntryId,
      );

      const tbId = db.createTermBase('Client Terms', 'en', 'fr');
      db.mountTermBaseToProject(projectId, tbId, 20);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'term-world',
        tbId,
        srcLang: 'en',
        srcTerm: 'world',
        tgtTerm: 'monde',
        note: 'Use the common noun.',
      });

      const transport = createTransport('Bonjour le monde');
      const engine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        aiTransport: transport,
      });

      const result = await engine.translateUnits({
        projectId,
        units: [{ id: 'unit-1', source: 'Hello world' }],
        options: { includeReferences: true },
      });

      expect(result.summary).toEqual({
        total: 1,
        translated: 1,
        skipped: 0,
        failed: 0,
      });
      expect(result.results[0]).toMatchObject({
        id: 'unit-1',
        target: 'Bonjour le monde',
        status: 'translated',
        references: {
          tm: [
            expect.objectContaining({
              kind: 'tm',
              tmName: 'Client Main TM',
              sourceText: 'Hello world',
              targetText: 'Bonjour le monde',
              similarity: 100,
            }),
          ],
          tb: [
            expect.objectContaining({
              tbName: 'Client Terms',
              srcTerm: 'world',
              tgtTerm: 'monde',
              note: 'Use the common noun.',
            }),
          ],
        },
      });
      const request = transport.createResponse.mock.calls[0]?.[0];
      expect(request.userPrompt).toMatch(/Client Main TM[\s\S]*Use the common noun\./);
      expect(request.userPrompt).toContain('Client Main TM');
      expect(request.userPrompt).toContain('Bonjour le monde');
      expect(request.userPrompt).toContain('world');
      expect(request.userPrompt).toContain('monde');
      expect(db.listFiles(projectId)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('skips non-empty targets in blank-only mode without calling provider transport', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Blank Only', 'en', 'fr');
      seedApiKey(db);
      const transport = createTransport('Bonjour');
      const engine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        aiTransport: transport,
      });

      const result = await engine.translateUnits({
        projectId,
        units: [{ id: 'unit-1', source: 'Hello', target: 'Already translated' }],
        options: { targetScope: 'blank-only' },
      });

      expect(result.summary).toEqual({
        total: 1,
        translated: 0,
        skipped: 1,
        failed: 0,
      });
      expect(result.results).toEqual([
        {
          id: 'unit-1',
          source: 'Hello',
          target: 'Already translated',
          status: 'skipped',
          metadata: undefined,
        },
      ]);
      expect(transport.createResponse).not.toHaveBeenCalled();
      expect(db.listFiles(projectId)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('does not require provider setup for skip-only batches without an API key', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Skip Without Key', 'en', 'fr');
      const transport = createTransport('Bonjour');
      const engine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        aiTransport: transport,
      });

      const result = await engine.translateUnits({
        projectId,
        units: [
          { id: 'blank-source', source: '   ' },
          { id: 'already-targeted', source: 'Hello', target: 'Deja traduit' },
        ],
        options: { targetScope: 'blank-only' },
      });

      expect(result.summary).toEqual({
        total: 2,
        translated: 0,
        skipped: 2,
        failed: 0,
      });
      expect(result.results).toEqual([
        {
          id: 'blank-source',
          source: '   ',
          target: '',
          status: 'skipped',
          metadata: undefined,
        },
        {
          id: 'already-targeted',
          source: 'Hello',
          target: 'Deja traduit',
          status: 'skipped',
          metadata: undefined,
        },
      ]);
      expect(transport.createResponse).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('applies constructor MT defaults when call options omit them', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Constructor MT Defaults', 'en', 'fr');
      seedApiKey(db);
      const transport = createTransport('Salut');
      const engine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        aiTransport: transport,
        mt: {
          model: 'engine-default-model',
          reasoningEffort: 'low',
          systemPrompt: 'Use nautical tone.',
        },
      });

      await engine.translateUnits({
        projectId,
        units: [{ id: 'unit-1', source: 'Hello' }],
      });

      const request = transport.createResponse.mock.calls[0]?.[0];
      expect(request.model).toBe('engine-default-model');
      expect(request.reasoningEffort).toBe('low');
      expect(request.systemPrompt).toContain('Use nautical tone.');
    } finally {
      db.close();
    }
  });

  it('rejects dialogue mode for external units without contacting the provider', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Dialogue External', 'en', 'fr');
      const transport = createTransport('Bonjour');
      const engine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        aiTransport: transport,
      });

      await expect(
        engine.translateUnits({
          projectId,
          units: [{ id: 'unit-1', source: 'Hello' }],
          options: { mode: 'dialogue' },
        }),
      ).rejects.toThrow(/dialogue mode is not supported/i);
      expect(transport.createResponse).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });
});
