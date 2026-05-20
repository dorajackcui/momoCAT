import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as XLSX from 'xlsx';
import type { TMEntry } from '@cat/core/models';
import { serializeTokensToDisplayText } from '@cat/core/text';
import { CATDatabase } from '../../db/src';
import type { AITransport } from './ports';
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

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
  it('uses Window Mode batches by default and sends later batches only after earlier targets exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-engine-file-job-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('External File Window Batches', 'en', 'en');
      seedApiKey(db);
      const inputPath = join(root, 'window.xlsx');
      const outputPath = join(root, 'window.translated.xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['source', 'target'],
          ['One', ''],
          ['Two', ''],
          ['Three', ''],
          ['Four', ''],
          ['Five', ''],
          ['Six', ''],
        ]),
        'Sheet1',
      );
      XLSX.writeFile(workbook, inputPath);
      const transport = createTransport();
      transport.createResponse
        .mockResolvedValueOnce({
          content: JSON.stringify({
            translations: [
              { id: 'window.xlsx#row-2', text: 'Un' },
              { id: 'window.xlsx#row-3', text: 'Deux' },
              { id: 'window.xlsx#row-4', text: 'Trois' },
              { id: 'window.xlsx#row-5', text: 'Quatre' },
              { id: 'window.xlsx#row-6', text: 'Cinq' },
            ],
          }),
          status: 200,
          endpoint: '/mock',
        })
        .mockImplementationOnce(async (request: { userPrompt: string }) => {
          expect(request.userPrompt).toContain('Previous 5 translated rows');
          expect(request.userPrompt).toContain('One -> Un');
          expect(request.userPrompt).toContain('Five -> Cinq');
          return {
            content: JSON.stringify({
              translations: [{ id: 'window.xlsx#row-7', text: 'Six' }],
            }),
            status: 200,
            endpoint: '/mock',
          };
        });
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

      expect(result.summary).toEqual({ total: 6, translated: 6, skipped: 0, failed: 0 });
      expect(transport.createResponse).toHaveBeenCalledTimes(2);
      const firstPrompt = transport.createResponse.mock.calls[0]?.[0].userPrompt;
      const secondPrompt = transport.createResponse.mock.calls[1]?.[0].userPrompt;
      expect(firstPrompt).toContain(
        'Current ids: window.xlsx#row-2, window.xlsx#row-3, window.xlsx#row-4, window.xlsx#row-5, window.xlsx#row-6',
      );
      expect(secondPrompt).toContain('Current ids: window.xlsx#row-7');
      const written = XLSX.read(await readFile(outputPath), { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(written.Sheets.Sheet1, {
        header: 1,
        defval: '',
      }) as string[][];
      expect(rows.slice(1).map((row) => row[1])).toEqual([
        'Un',
        'Deux',
        'Trois',
        'Quatre',
        'Cinq',
        'Six',
      ]);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

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
      const transport = createTransport(
        JSON.stringify({
          translations: [{ id: 'mt.xlsx#row-2', text: 'Bonjour' }],
        }),
      );
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

  it('preserves skipped target rows when a Window Mode file batch fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-engine-file-job-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('External File Failed Window Skip', 'en', 'fr');
      seedApiKey(db);
      const inputPath = join(root, 'fallback.xlsx');
      const outputPath = join(root, 'fallback.translated.xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['source', 'target'],
          ['First', ''],
          ['Middle', 'Milieu'],
          ['Last', ''],
        ]),
        'Sheet1',
      );
      XLSX.writeFile(workbook, inputPath);
      const transport = createTransport(
        JSON.stringify({
          translations: [{ id: 'fallback.xlsx#row-2', text: 'Premier' }],
        }),
      );
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

      expect(result.summary).toEqual({ total: 3, translated: 0, skipped: 1, failed: 2 });
      expect(result.results).toEqual([
        expect.objectContaining({ id: 'row-2', status: 'failed' }),
        expect.objectContaining({
          id: 'row-3',
          status: 'skipped',
          target: 'Milieu',
        }),
        expect.objectContaining({ id: 'row-4', status: 'failed' }),
      ]);
      const written = XLSX.read(await readFile(outputPath), { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(written.Sheets.Sheet1, {
        header: 1,
        defval: '',
      }) as string[][];
      expect(rows[2][1]).toBe('Milieu');
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

  it('does not reuse explicit-job checkpoints when resolved MT defaults change', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-engine-file-job-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('External File Resolved Fingerprint', 'en', 'fr');
      seedApiKey(db);
      const inputPath = join(root, 'mt.xlsx');
      const outputPath = join(root, 'mt.translated.xlsx');
      const checkpointPath = join(root, 'mt.checkpoint.jsonl');
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
      const transport: MockTransport = {
        testConnection: vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          endpoint: '/mock',
        }),
        createResponse: vi.fn(async (request: { model: string }) => ({
          content: JSON.stringify({
            translations: [{ id: 'mt.xlsx#row-2', text: `${request.model} target` }],
          }),
          status: 200,
          endpoint: '/mock',
        })),
      } as unknown as MockTransport;
      const firstEngine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        aiTransport: transport,
        mt: { model: 'model-a' },
      });
      const secondEngine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        aiTransport: transport,
        mt: { model: 'model-b' },
      });

      await firstEngine.translateFile({
        projectId,
        inputPath,
        outputPath,
        job: { jobId: 'same-job', checkpointPath, maxAttempts: 1 },
      });
      const second = await secondEngine.translateFile({
        projectId,
        inputPath,
        outputPath,
        job: { jobId: 'same-job', checkpointPath, resume: true, maxAttempts: 1 },
      });

      expect(transport.createResponse).toHaveBeenCalledTimes(2);
      expect(second.summary).toEqual({ total: 1, translated: 1, skipped: 0, failed: 0 });
      expect(second.results[0]?.status).toBe('translated');
      expect(second.results[0]?.target).toBe('model-b target');
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not reuse explicit-job checkpoints when mounted TM entries change', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-engine-file-job-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('External File TM Fingerprint', 'en', 'fr');
      seedApiKey(db);
      const tmId = db.createTM('Client Main TM', 'en', 'fr', 'main');
      db.mountTMToProject(projectId, tmId, 10, 'read');
      const oldEntry = createTMEntry({
        tmId,
        projectId,
        sourceText: 'Hello',
        targetText: 'Old reference',
      });
      const oldEntryId = db.upsertTMEntryBySrcHash(oldEntry);
      db.replaceTMFts(
        tmId,
        serializeTokensToDisplayText(oldEntry.sourceTokens),
        serializeTokensToDisplayText(oldEntry.targetTokens),
        oldEntryId,
      );
      const inputPath = join(root, 'mt.xlsx');
      const outputPath = join(root, 'mt.translated.xlsx');
      const checkpointPath = join(root, 'mt.checkpoint.jsonl');
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
      const transport = createTransport(
        JSON.stringify({
          translations: [{ id: 'mt.xlsx#row-2', text: 'First target' }],
        }),
      );
      const engine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        aiTransport: transport,
      });

      await engine.translateFile({
        projectId,
        inputPath,
        outputPath,
        job: { jobId: 'same-job', checkpointPath, maxAttempts: 1 },
      });

      await delay(20);
      const newEntry = createTMEntry({
        tmId,
        projectId,
        sourceText: 'Hello',
        targetText: 'New reference',
      });
      const newEntryId = db.upsertTMEntryBySrcHash(newEntry);
      db.replaceTMFts(
        tmId,
        serializeTokensToDisplayText(newEntry.sourceTokens),
        serializeTokensToDisplayText(newEntry.targetTokens),
        newEntryId,
      );
      transport.createResponse.mockResolvedValueOnce({
        content: JSON.stringify({
          translations: [{ id: 'mt.xlsx#row-2', text: 'Second target' }],
        }),
        status: 200,
        endpoint: '/mock',
      });
      const second = await engine.translateFile({
        projectId,
        inputPath,
        outputPath,
        job: { jobId: 'same-job', checkpointPath, resume: true, maxAttempts: 1 },
      });

      expect(transport.createResponse).toHaveBeenCalledTimes(2);
      expect(second.summary).toEqual({ total: 1, translated: 1, skipped: 0, failed: 0 });
      expect(second.results[0]?.status).toBe('translated');
      expect(second.results[0]?.target).toBe('Second target');
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

      const transport = createTransport(
        JSON.stringify({
          translations: [{ id: 'doc-1#unit-1', text: 'Bonjour le monde' }],
        }),
      );
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
          unitId: 'task-1',
          batch: expect.objectContaining({
            mode: 'window',
            currentIds: ['doc-1#unit-1'],
          }),
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
              unitId: 'blank-source',
              source: '   ',
              sourceHash: 'hash-blank',
            },
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
          unitId: 'blank-source',
          status: 'skipped',
          target: '',
        }),
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
          unit: 'blank-source',
          tm: undefined,
          tb: undefined,
          prompt: undefined,
          result: expect.objectContaining({
            status: 'skipped',
          }),
        }),
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

  it('attaches each current unit own TM and TB references in one Window Mode request', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Task Multi Unit References', 'en', 'fr');
      seedApiKey(db);
      const tmId = db.createTM('Client Main TM', 'en', 'fr', 'main');
      db.mountTMToProject(projectId, tmId, 10, 'read');
      const saveEntry = createTMEntry({
        tmId,
        projectId,
        sourceText: 'Save file',
        targetText: 'Enregistrer le fichier',
      });
      const saveEntryId = db.upsertTMEntryBySrcHash(saveEntry);
      db.replaceTMFts(
        tmId,
        serializeTokensToDisplayText(saveEntry.sourceTokens),
        serializeTokensToDisplayText(saveEntry.targetTokens),
        saveEntryId,
      );
      const closeEntry = createTMEntry({
        tmId,
        projectId,
        sourceText: 'Close window',
        targetText: 'Fermer la fenetre',
      });
      const closeEntryId = db.upsertTMEntryBySrcHash(closeEntry);
      db.replaceTMFts(
        tmId,
        serializeTokensToDisplayText(closeEntry.sourceTokens),
        serializeTokensToDisplayText(closeEntry.targetTokens),
        closeEntryId,
      );
      const tbId = db.createTermBase('Client Terms', 'en', 'fr');
      db.mountTermBaseToProject(projectId, tbId, 20);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'term-save',
        tbId,
        srcLang: 'en',
        srcTerm: 'Save',
        tgtTerm: 'Enregistrer',
        note: 'Use for file actions.',
      });
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'term-close',
        tbId,
        srcLang: 'en',
        srcTerm: 'Close',
        tgtTerm: 'Fermer',
        note: 'Use for window actions.',
      });
      const transport = createTransport(
        JSON.stringify({
          translations: [
            { id: 'doc-1#unit-1', text: 'Enregistrer le fichier' },
            { id: 'doc-1#unit-2', text: 'Fermer la fenetre' },
          ],
        }),
      );
      const engine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        aiTransport: transport,
      });

      const result = await engine.executeTranslationTask(
        {
          taskId: 'task-multi',
          units: [
            {
              documentId: 'doc-1',
              unitId: 'unit-1',
              source: 'Save file',
              sourceHash: 'hash-1',
            },
            {
              documentId: 'doc-1',
              unitId: 'unit-2',
              source: 'Close window',
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
      );

      expect(result.results.map((unit) => unit.target)).toEqual([
        'Enregistrer le fichier',
        'Fermer la fenetre',
      ]);
      expect(transport.createResponse).toHaveBeenCalledTimes(1);
      const prompt = transport.createResponse.mock.calls[0]?.[0].userPrompt;
      expect(prompt).toMatch(
        /id: doc-1#unit-1[\s\S]*Save file[\s\S]*Enregistrer le fichier[\s\S]*Save -> Enregistrer/,
      );
      expect(prompt).toMatch(
        /id: doc-1#unit-2[\s\S]*Close window[\s\S]*Fermer la fenetre[\s\S]*Close -> Fermer/,
      );
    } finally {
      db.close();
    }
  });

  it('uses document-qualified response ids for duplicate unit ids in one Window Mode request', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Task Duplicate Unit Ids', 'en', 'fr');
      seedApiKey(db);
      const transport = createTransport();
      transport.createResponse.mockImplementationOnce(async (request: { userPrompt: string }) => {
        const currentIds = [...request.userPrompt.matchAll(/^id: (.+)$/gm)].map(
          (match) => match[1],
        );

        expect(currentIds).toHaveLength(2);
        expect(new Set(currentIds).size).toBe(2);
        expect(currentIds).not.toEqual(['row-2', 'row-2']);
        expect(request.userPrompt.match(/^id: row-2$/gm) ?? []).toHaveLength(0);

        return {
          content: JSON.stringify({
            translations: [
              { id: currentIds[0], text: 'Enregistrer le fichier' },
              { id: currentIds[1], text: 'Fermer la fenetre' },
            ],
          }),
          status: 200,
          endpoint: '/mock',
        };
      });
      const engine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        aiTransport: transport,
      });

      const result = await engine.executeTranslationTask(
        {
          taskId: 'task-duplicate-unit-ids',
          units: [
            {
              documentId: 'doc-a.xlsx',
              unitId: 'row-2',
              source: 'Save file',
              sourceHash: 'hash-a',
            },
            {
              documentId: 'doc-b.xlsx',
              unitId: 'row-2',
              source: 'Close window',
              sourceHash: 'hash-b',
            },
          ],
        },
        {
          attempt: 1,
          job: {
            id: 'job-duplicate-unit-ids',
            projectId,
            units: [],
          },
        },
      );

      expect(result.results).toEqual([
        expect.objectContaining({
          documentId: 'doc-a.xlsx',
          unitId: 'row-2',
          source: 'Save file',
          target: 'Enregistrer le fichier',
          status: 'translated',
        }),
        expect.objectContaining({
          documentId: 'doc-b.xlsx',
          unitId: 'row-2',
          source: 'Close window',
          target: 'Fermer la fenetre',
          status: 'translated',
        }),
      ]);
      expect(transport.createResponse).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });

  it('keeps skipped target rows between current Window Mode rows as previous context', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Task Interleaved Skip Context', 'en', 'fr');
      seedApiKey(db);
      const transport = createTransport();
      transport.createResponse.mockImplementationOnce(async (request: { userPrompt: string }) => {
        expect(request.userPrompt).toContain(
          'Current ids: sheet.xlsx#row-2, sheet.xlsx#row-4',
        );
        expect(request.userPrompt).toContain('Previous 5 translated rows');
        expect(request.userPrompt).toContain('Middle -> Milieu');
        expect(request.userPrompt).not.toMatch(/^id: sheet\.xlsx#row-3$/m);
        expect(request.userPrompt).not.toMatch(/Next 5 source rows[\s\S]*Middle/);

        return {
          content: JSON.stringify({
            translations: [
              { id: 'sheet.xlsx#row-2', text: 'Debut' },
              { id: 'sheet.xlsx#row-4', text: 'Fin' },
            ],
          }),
          status: 200,
          endpoint: '/mock',
        };
      });
      const engine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        aiTransport: transport,
        defaultTargetScope: 'blank-only',
      });
      const units = [
        {
          documentId: 'sheet.xlsx',
          unitId: 'row-2',
          source: 'Start',
          target: '',
          sourceHash: 'hash-2',
        },
        {
          documentId: 'sheet.xlsx',
          unitId: 'row-3',
          source: 'Middle',
          target: 'Milieu',
          sourceHash: 'hash-3',
        },
        {
          documentId: 'sheet.xlsx',
          unitId: 'row-4',
          source: 'End',
          target: '',
          sourceHash: 'hash-4',
        },
      ];

      const result = await engine.executeTranslationTask(
        {
          taskId: 'task-interleaved-skip-context',
          units,
        },
        {
          attempt: 1,
          job: {
            id: 'job-interleaved-skip-context',
            projectId,
            units,
          },
        },
      );

      expect(transport.createResponse).toHaveBeenCalledTimes(1);
      expect(result.results).toEqual([
        expect.objectContaining({
          documentId: 'sheet.xlsx',
          unitId: 'row-2',
          status: 'translated',
          target: 'Debut',
        }),
        expect.objectContaining({
          documentId: 'sheet.xlsx',
          unitId: 'row-3',
          status: 'skipped',
          target: 'Milieu',
        }),
        expect.objectContaining({
          documentId: 'sheet.xlsx',
          unitId: 'row-4',
          status: 'translated',
          target: 'Fin',
        }),
      ]);
    } finally {
      db.close();
    }
  });
});
