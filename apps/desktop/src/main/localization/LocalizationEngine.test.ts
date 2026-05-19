import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as XLSX from 'xlsx';
import type { TMEntry } from '@cat/core/models';
import { serializeTokensToDisplayText } from '@cat/core/text';
import { CATDatabase } from '../../../../../packages/db/src';
import type { AITransport } from '../services/ports';
import { LocalizationEngine } from './LocalizationEngine';
import { createLocalizationTaskExecutor } from './job/LocalizationTaskExecutor';
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

  it('keeps constructor MT defaults when call MT fields are explicitly undefined', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Constructor MT Undefined Defaults', 'en', 'fr');
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
        options: {
          mt: {
            model: undefined,
            reasoningEffort: undefined,
            systemPrompt: undefined,
          },
        },
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

describe('LocalizationEngine.translateFile job mode', () => {
  it('translates spreadsheet files through job units without importing the file into the DB', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-engine-file-job-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('External File Job', 'en', 'fr');
      seedApiKey(db);
      const initialFiles = db.listFiles(projectId);
      const inputPath = join(root, 'mt.xlsx');
      const outputPath = join(root, 'mt.translated.xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['source', 'target'],
          ['Hello', ''],
        ]),
        'Sheet1',
      );
      XLSX.writeFile(workbook, inputPath);
      const transport = createTransport('Bonjour');
      const engine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        aiTransport: transport,
      });

      const result = await engine.translateFile({
        projectId,
        inputPath,
        outputPath,
        job: { maxAttempts: 1 },
      });

      expect(result.summary).toEqual({ total: 1, translated: 1, skipped: 0, failed: 0 });
      expect(transport.createResponse).toHaveBeenCalledTimes(1);
      expect(db.listFiles(projectId)).toEqual(initialFiles);
      expect(db.getProjectStats(projectId)).toEqual([]);
      const written = XLSX.read(await readFile(outputPath), { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(written.Sheets.Sheet1, {
        header: 1,
        defval: '',
      }) as string[][];
      expect(rows[1][1]).toBe('Bonjour');
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('honors blank-only target scope without contacting the provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-engine-file-job-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('External File Blank Only', 'en', 'fr');
      const inputPath = join(root, 'mt.xlsx');
      const outputPath = join(root, 'mt.translated.xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['source', 'target'],
          ['Hello', 'Deja traduit'],
        ]),
        'Sheet1',
      );
      XLSX.writeFile(workbook, inputPath);
      const transport = createTransport('Bonjour');
      const engine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        aiTransport: transport,
      });

      const result = await engine.translateFile({
        projectId,
        inputPath,
        outputPath,
        options: { targetScope: 'blank-only' },
        job: { maxAttempts: 1 },
      });

      expect(result.summary).toEqual({ total: 1, translated: 0, skipped: 1, failed: 0 });
      expect(transport.createResponse).not.toHaveBeenCalled();
      const written = XLSX.read(await readFile(outputPath), { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(written.Sheets.Sheet1, {
        header: 1,
        defval: '',
      }) as string[][];
      expect(rows[1][1]).toBe('Deja traduit');
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects dialogue mode before starting a file job', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-engine-file-job-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('External File Dialogue', 'en', 'fr');
      const inputPath = join(root, 'mt.xlsx');
      const outputPath = join(root, 'mt.translated.xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['source', 'target'],
          ['Hello', ''],
        ]),
        'Sheet1',
      );
      XLSX.writeFile(workbook, inputPath);
      const transport = createTransport('Bonjour');
      const engine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        aiTransport: transport,
      });

      await expect(
        engine.translateFile({
          projectId,
          inputPath,
          outputPath,
          options: { mode: 'dialogue' },
          job: { maxAttempts: 1 },
        }),
      ).rejects.toThrow(/dialogue mode is not supported/i);
      expect(transport.createResponse).not.toHaveBeenCalled();
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('honors per-call MT overrides for file jobs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-engine-file-job-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('External File MT Override', 'en', 'fr');
      seedApiKey(db);
      const inputPath = join(root, 'mt.xlsx');
      const outputPath = join(root, 'mt.translated.xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['source', 'target'],
          ['Hello', ''],
        ]),
        'Sheet1',
      );
      XLSX.writeFile(workbook, inputPath);
      const transport = createTransport('Bonjour');
      const engine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        aiTransport: transport,
        mt: {
          model: 'engine-default-model',
          reasoningEffort: 'medium',
          systemPrompt: 'Use engine defaults.',
        },
      });

      await engine.translateFile({
        projectId,
        inputPath,
        outputPath,
        options: {
          mt: {
            model: 'job-call-model',
            reasoningEffort: 'low',
            systemPrompt: 'Use job call options.',
          },
        },
        job: { maxAttempts: 1 },
      });

      const request = transport.createResponse.mock.calls[0]?.[0];
      expect(request.model).toBe('job-call-model');
      expect(request.reasoningEffort).toBe('low');
      expect(request.systemPrompt).toContain('Use job call options.');
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('LocalizationEngine task executor', () => {
  it('translates a task unit without creating files or segment rows and returns artifacts', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Task Executor', 'en', 'fr');
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
      const executor = createLocalizationTaskExecutor(engine);

      const result = await executor(
        {
          taskId: 'task-1',
          units: [
            {
              documentId: 'doc-1',
              unitId: 'unit-1',
              source: 'Hello world',
              sourceHash: 'hash-1',
            },
          ],
        },
        {
          attempt: 1,
          job: {
            id: 'job-1',
            projectId,
            units: [],
          },
        },
      );

      expect(result.results).toEqual([
        {
          jobId: 'job-1',
          documentId: 'doc-1',
          unitId: 'unit-1',
          sourceHash: 'hash-1',
          source: 'Hello world',
          target: 'Bonjour le monde',
          status: 'translated',
          error: undefined,
          metadata: undefined,
        },
      ]);
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts?.[0]).toMatchObject({
        job: 'job-1',
        task: 'task-1',
        doc: 'doc-1',
        unit: 'unit-1',
        tm: {
          selectedReferences: {
            tmReferences: [
              expect.objectContaining({
                tmName: 'Client Main TM',
                targetText: 'Bonjour le monde',
              }),
            ],
          },
        },
        tb: {
          selectedReferences: [
            expect.objectContaining({
              srcTerm: 'world',
              tgtTerm: 'monde',
              note: 'Use the common noun.',
            }),
          ],
        },
        prompt: expect.objectContaining({
          unitId: 'unit-1',
          model: expect.any(String),
          provider: expect.objectContaining({
            id: expect.any(String),
            baseUrl: expect.any(String),
          }),
          userPrompt: expect.stringContaining('Client Main TM'),
        }),
        result: expect.objectContaining({
          status: 'translated',
          target: 'Bonjour le monde',
        }),
      });
      expect(JSON.stringify(result.artifacts)).not.toContain('test-api-key');
      expect(transport.createResponse).toHaveBeenCalledTimes(1);
      expect(db.listFiles(projectId)).toEqual([]);
      expect(db.getProjectStats(projectId)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('skips task units without provider setup when no unit needs translation', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Task Skip Without Key', 'en', 'fr');
      const transport = createTransport('Bonjour');
      const engine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        aiTransport: transport,
        defaultTargetScope: 'blank-only',
      });

      const result = await engine.executeTranslationTask(
        {
          taskId: 'task-skip',
          units: [
            {
              documentId: 'doc-1',
              unitId: 'already-targeted',
              source: 'Hello',
              target: 'Deja traduit',
              sourceHash: 'hash-1',
            },
          ],
        },
        {
          attempt: 1,
          job: {
            id: 'job-skip',
            projectId,
            units: [],
          },
        },
      );

      expect(result.results).toEqual([
        expect.objectContaining({
          jobId: 'job-skip',
          documentId: 'doc-1',
          unitId: 'already-targeted',
          status: 'skipped',
          target: 'Deja traduit',
        }),
      ]);
      expect(result.artifacts).toEqual([
        expect.objectContaining({
          job: 'job-skip',
          task: 'task-skip',
          unit: 'already-targeted',
          tm: undefined,
          tb: undefined,
          prompt: undefined,
          result: expect.objectContaining({
            status: 'skipped',
          }),
        }),
      ]);
      expect(transport.createResponse).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('rejects multi-unit tasks before provider setup', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Task Multi Unit Rejected', 'en', 'fr');
      const transport = createTransport('Bonjour');
      const engine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        aiTransport: transport,
      });

      await expect(
        engine.executeTranslationTask(
          {
            taskId: 'task-multi',
            units: [
              {
                documentId: 'doc-1',
                unitId: 'unit-1',
                source: 'Hello',
                sourceHash: 'hash-1',
              },
              {
                documentId: 'doc-1',
                unitId: 'unit-2',
                source: 'World',
                sourceHash: 'hash-2',
              },
            ],
          },
          {
            attempt: 1,
            job: {
              id: 'job-multi',
              projectId,
              units: [],
            },
          },
        ),
      ).rejects.toThrow('LocalizationEngine task executor supports one unit per task in this MVP');
      expect(transport.createResponse).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });
});
