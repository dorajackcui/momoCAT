import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Segment, TMEntry } from '@cat/core/models';
import { serializeTokensToDisplayText } from '@cat/core/text';
import { CATDatabase } from '../../../../../packages/db/src';
import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import type { AITransport } from '../services/ports';
import type { PromptArtifact } from './artifacts';
import { LocalizationInspector } from './LocalizationInspector';
import { createTransientSegment } from './transientSegment';

type MockTransport = AITransport & {
  testConnection: ReturnType<typeof vi.fn>;
  createResponse: ReturnType<typeof vi.fn>;
};

describe('LocalizationInspector.inspectFile', () => {
  it('inspects a file without an API key and without calling provider transport', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-inspector-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('No Key Inspect', 'en', 'fr');
      const inputPath = writeInputWorkbook(root, [
        ['source', 'target'],
        ['Hello world', ''],
      ]);
      const outputPath = join(root, 'inspect.xlsx');
      const transport = createTransport();
      const inspector = new LocalizationInspector(db, {
        aiTransport: transport,
        aiRuntimeConfigProvider: runtimeConfigProvider(),
      });

      const result = await inspector.inspectFile({ projectId, inputPath, outputPath });

      expect(result.summary.ready).toBeGreaterThan(0);
      expect(result.outputPath).toBe(outputPath);
      expect(result.jsonOutputPath).toBe(join(root, 'inspect.json'));
      expect(transport.createResponse).not.toHaveBeenCalled();
      expect(transport.testConnection).not.toHaveBeenCalled();
      expect(XLSX.read(await readFile(outputPath), { type: 'buffer' }).SheetNames).toEqual([
        'Segments',
        'MT_SystemPrompt',
      ]);
      expect(JSON.parse(await readFile(result.jsonOutputPath, 'utf8')).units[0].status).toBe(
        'ready',
      );
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not create project files or segments in the database', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-inspector-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('No Writes Inspect', 'en', 'fr');
      const inputPath = writeInputWorkbook(root, [
        ['source', 'target'],
        ['Hello', ''],
      ]);
      const initialFiles = db.listFiles(projectId);
      const initialStats = db.getProjectStats(projectId);
      const inspector = new LocalizationInspector(db, {
        aiTransport: createTransport(),
        aiRuntimeConfigProvider: runtimeConfigProvider(),
      });

      await inspector.inspectFile({
        projectId,
        inputPath,
        outputPath: join(root, 'inspect.xlsx'),
      });

      expect(db.listFiles(projectId)).toEqual(initialFiles);
      expect(db.getProjectStats(projectId)).toEqual(initialStats);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes inspect workbook sheets, appended columns, statuses, and user prompt content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-inspector-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Workbook Inspect', 'en', 'fr');
      const inputPath = writeInputWorkbook(root, [
        ['source', 'target', 'note'],
        ['Hello world', '', 'menu'],
        ['', '', 'blank'],
      ]);
      const outputPath = join(root, 'inspect.xlsx');
      const inspector = new LocalizationInspector(db, {
        aiTransport: createTransport(),
        aiRuntimeConfigProvider: runtimeConfigProvider(),
      });

      await inspector.inspectFile({ projectId, inputPath, outputPath });

      const written = XLSX.read(await readFile(outputPath), { type: 'buffer' });
      expect(written.SheetNames).toEqual(['Segments', 'MT_SystemPrompt']);

      const segmentRows = XLSX.utils.sheet_to_json(written.Sheets.Segments, {
        header: 1,
        defval: '',
      }) as string[][];
      expect(segmentRows[0]).toEqual([
        'source',
        'target',
        'note',
        '_tm_for_mt',
        '_tb_for_mt',
        '_mt_user_prompt',
        '_inspect_status',
        '_inspect_json_ref',
      ]);
      expect(segmentRows[1][0]).toBe('Hello world');
      expect(segmentRows[1][5]).toContain('Hello world');
      expect(segmentRows[1][6]).toBe('ready');
      expect(segmentRows[1][7]).toBe('#/units/0');
      expect(segmentRows[2]).toEqual(['', '', 'blank', '', '', '', 'skipped-empty-source', '']);

      const promptRows = XLSX.utils.sheet_to_json(written.Sheets.MT_SystemPrompt, {
        header: 1,
        defval: '',
      }) as Array<[string, string | number | boolean]>;
      expect(promptRows).toContainEqual(['project_id', projectId]);
      expect(promptRows).toContainEqual(['systemPrompt', expect.any(String)]);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves full prompt, TM, and TB artifacts in the JSON sidecar', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-inspector-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Full Json Inspect', 'en', 'fr');
      mountReferenceData(db, projectId);
      const inputPath = writeInputWorkbook(root, [
        ['source', 'target'],
        ['Hello world', ''],
      ]);
      const inspector = new LocalizationInspector(db, {
        aiTransport: createTransport(),
        aiRuntimeConfigProvider: runtimeConfigProvider(),
      });

      const result = await inspector.inspectFile({
        projectId,
        inputPath,
        outputPath: join(root, 'inspect.xlsx'),
      });
      const json = JSON.parse(await readFile(result.jsonOutputPath, 'utf8'));

      expect(json.units[0].tm.rawMatches[0]).toMatchObject({
        tmName: 'Client Main TM',
        kind: 'tm',
      });
      expect(json.units[0].tb.selectedReferences[0]).toMatchObject({
        srcTerm: 'world',
        tgtTerm: 'monde',
      });
      expect(json.units[0].mt.tmPromptBlock).toContain('Bonjour le monde');
      expect(json.units[0].mt.concordancePromptBlock).toBe('');
      expect(json.units[0].mt.tbPromptBlock).toContain('monde');
      expect(json.units[0].mt.referencePromptBlock).toContain(json.units[0].mt.tmPromptBlock);
      expect(json.units[0].mt.userPrompt).toContain(json.units[0].mt.tmPromptBlock);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('truncates xlsx cells while preserving full prompt fields in JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-inspector-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Truncate Inspect', 'en', 'fr');
      const inputPath = writeInputWorkbook(root, [
        ['source', 'target'],
        ['Hello', ''],
      ]);
      const longPrompt = 'A'.repeat(200);
      const inspector = new LocalizationInspector(db, {
        aiTransport: createTransport(),
        aiRuntimeConfigProvider: runtimeConfigProvider(),
        mtModule: {
          composePrompt: vi
            .fn()
            .mockImplementation(({ unitId, project, segment }) =>
              Promise.resolve(
                createPromptArtifact(unitId, project.projectType, segment, longPrompt),
              ),
            ),
        },
      });

      const result = await inspector.inspectFile({
        projectId,
        inputPath,
        outputPath: join(root, 'inspect.xlsx'),
        maxCellChars: 80,
      });

      const written = XLSX.read(await readFile(result.outputPath), { type: 'buffer' });
      const segmentRows = XLSX.utils.sheet_to_json(written.Sheets.Segments, {
        header: 1,
        defval: '',
      }) as string[][];
      expect(segmentRows[1][4]).toContain('[TRUNCATED: see #/units/0/mt/userPrompt]');
      expect(result.artifact.units[0].xlsx.truncated.mtUserPrompt).toBe(true);
      expect(result.artifact.units[0].mt.userPrompt).toBe(longPrompt);
      expect(JSON.parse(await readFile(result.jsonOutputPath, 'utf8')).units[0].mt.userPrompt).toBe(
        longPrompt,
      );
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('includes concordance prompt blocks in JSON and TM-for-MT xlsx output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-inspector-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Concordance Inspect', 'en', 'fr');
      const inputPath = writeInputWorkbook(root, [
        ['source', 'target'],
        ['Hello world', ''],
      ]);
      const inspector = new LocalizationInspector(db, {
        aiTransport: createTransport(),
        aiRuntimeConfigProvider: runtimeConfigProvider(),
        mtModule: {
          composePrompt: vi.fn().mockImplementation(({ unitId, project, segment }) =>
            Promise.resolve(
              createPromptArtifact(unitId, project.projectType, segment, 'FULL_PROMPT', {
                tmPromptBlock: 'TM prompt block',
                concordancePromptBlock: 'Concordance Suggestions:\nMatch: world',
                tbPromptBlock: 'TB prompt block',
                referencePromptBlock:
                  'TM prompt block\n\nConcordance Suggestions:\nMatch: world\n\nTB prompt block',
              }),
            ),
          ),
        },
      });

      const result = await inspector.inspectFile({
        projectId,
        inputPath,
        outputPath: join(root, 'inspect.xlsx'),
      });

      expect(result.artifact.units[0].mt.concordancePromptBlock).toContain(
        'Concordance Suggestions:',
      );
      const written = XLSX.read(await readFile(result.outputPath), { type: 'buffer' });
      const segmentRows = XLSX.utils.sheet_to_json(written.Sheets.Segments, {
        header: 1,
        defval: '',
      }) as string[][];
      expect(segmentRows[1][2]).toContain('TM prompt block');
      expect(segmentRows[1][2]).toContain('Concordance Suggestions:');
      expect(segmentRows[1][7]).toBe('#/units/0');
      expect(JSON.parse(await readFile(result.jsonOutputPath, 'utf8')).units[0].mt).toMatchObject({
        concordancePromptBlock: 'Concordance Suggestions:\nMatch: world',
        referencePromptBlock:
          'TM prompt block\n\nConcordance Suggestions:\nMatch: world\n\nTB prompt block',
      });
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('limits inspected source-bearing rows and marks later source rows not-inspected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-inspector-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Limited Inspect', 'en', 'fr');
      const inputPath = writeInputWorkbook(root, [
        ['source', 'target'],
        ['First', ''],
        ['Second', ''],
      ]);
      const inspector = new LocalizationInspector(db, {
        aiTransport: createTransport(),
        aiRuntimeConfigProvider: runtimeConfigProvider(),
      });

      const result = await inspector.inspectFile({
        projectId,
        inputPath,
        outputPath: join(root, 'inspect.xlsx'),
        unitLimit: 1,
      });

      expect(result.summary).toEqual({ total: 1, ready: 1, error: 0 });
      const written = XLSX.read(await readFile(result.outputPath), { type: 'buffer' });
      const segmentRows = XLSX.utils.sheet_to_json(written.Sheets.Segments, {
        header: 1,
        defval: '',
      }) as string[][];
      expect(segmentRows[1][5]).toBe('ready');
      expect(segmentRows[2][5]).toBe('not-inspected');
      expect(segmentRows[2][5]).not.toBe('error');
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('captures per-unit errors in the artifact summary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-inspector-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Error Inspect', 'en', 'fr');
      const inputPath = writeInputWorkbook(root, [
        ['source', 'target'],
        ['Break me', ''],
      ]);
      const inspector = new LocalizationInspector(db, {
        aiTransport: createTransport(),
        aiRuntimeConfigProvider: runtimeConfigProvider(),
        mtModule: {
          composePrompt: vi.fn().mockRejectedValue(new Error('controlled compose failure')),
        },
      });

      const result = await inspector.inspectFile({
        projectId,
        inputPath,
        outputPath: join(root, 'inspect.xlsx'),
      });

      expect(result.summary).toEqual({ total: 1, ready: 0, error: 1 });
      expect(result.artifact.units[0]).toMatchObject({
        status: 'error',
        error: 'mt: controlled compose failure',
      });
      const written = XLSX.read(await readFile(result.outputPath), { type: 'buffer' });
      const segmentRows = XLSX.utils.sheet_to_json(written.Sheets.Segments, {
        header: 1,
        defval: '',
      }) as string[][];
      expect(segmentRows[1][5]).toBe('error');
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves TM and TB artifacts when MT compose fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-inspector-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Preserve Stage Artifacts', 'en', 'fr');
      mountReferenceData(db, projectId);
      const inputPath = writeInputWorkbook(root, [
        ['source', 'target'],
        ['Hello world', ''],
      ]);
      const inspector = new LocalizationInspector(db, {
        aiTransport: createTransport(),
        aiRuntimeConfigProvider: runtimeConfigProvider(),
        mtModule: {
          composePrompt: vi.fn().mockRejectedValue(new Error('controlled compose failure')),
        },
      });

      const result = await inspector.inspectFile({
        projectId,
        inputPath,
        outputPath: join(root, 'inspect.xlsx'),
      });
      const json = JSON.parse(await readFile(result.jsonOutputPath, 'utf8'));

      expect(result.summary).toEqual({ total: 1, ready: 0, error: 1 });
      expect(json.units[0].status).toBe('error');
      expect(json.units[0].error).toBe('mt: controlled compose failure');
      expect(json.units[0].tm.rawMatches[0]).toMatchObject({
        tmName: 'Client Main TM',
        kind: 'tm',
      });
      expect(json.units[0].tb.selectedReferences[0]).toMatchObject({
        srcTerm: 'world',
        tgtTerm: 'monde',
      });
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses the same ready unit for system prompt value and metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-inspector-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Prompt Metadata Inspect', 'en', 'fr');
      const inputPath = writeInputWorkbook(root, [
        ['source', 'target'],
        ['First fails', ''],
        ['Second ready', ''],
      ]);
      const inspector = new LocalizationInspector(db, {
        aiTransport: createTransport(),
        aiRuntimeConfigProvider: runtimeConfigProvider(),
        mtModule: {
          composePrompt: vi.fn().mockImplementation(({ unitId, project, segment }) => {
            if (unitId === 'row-2') {
              return Promise.reject(new Error('first compose failure'));
            }

            return Promise.resolve(
              createPromptArtifact(unitId, project.projectType, segment, 'SECOND_SYSTEM', {
                providerId: 'ready-provider',
                providerName: 'Ready Provider',
                model: 'ready-model',
                reasoningEffort: 'high',
              }),
            );
          }),
        },
      });

      const result = await inspector.inspectFile({
        projectId,
        inputPath,
        outputPath: join(root, 'inspect.xlsx'),
      });

      expect(result.artifact.systemPrompt.value).toBe('SECOND_SYSTEM');
      const written = XLSX.read(await readFile(result.outputPath), { type: 'buffer' });
      const promptRows = XLSX.utils.sheet_to_json(written.Sheets.MT_SystemPrompt, {
        header: 1,
        defval: '',
      }) as Array<[string, string | number | boolean]>;
      expect(promptRows).toContainEqual(['provider_id', 'ready-provider']);
      expect(promptRows).toContainEqual(['provider_name', 'Ready Provider']);
      expect(promptRows).toContainEqual(['model', 'ready-model']);
      expect(promptRows).toContainEqual(['reasoning_effort', 'high']);
      expect(promptRows).toContainEqual(['systemPrompt', 'SECOND_SYSTEM']);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['unitLimit', 0],
    ['unitLimit', -1],
    ['unitLimit', 1.5],
    ['unitLimit', Number.POSITIVE_INFINITY],
    ['maxCellChars', 0],
    ['maxCellChars', -1],
    ['maxCellChars', 1.5],
    ['maxCellChars', Number.NaN],
  ] as const)('rejects invalid %s values', async (field, value) => {
    const root = await mkdtemp(join(tmpdir(), 'cat-inspector-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject(`Invalid ${field}`, 'en', 'fr');
      const inputPath = writeInputWorkbook(root, [
        ['source', 'target'],
        ['Hello', ''],
      ]);
      const inspector = new LocalizationInspector(db, {
        aiTransport: createTransport(),
        aiRuntimeConfigProvider: runtimeConfigProvider(),
      });

      await expect(
        inspector.inspectFile({
          projectId,
          inputPath,
          outputPath: join(root, 'inspect.xlsx'),
          [field]: value,
        }),
      ).rejects.toThrow(`${field} must be a positive integer.`);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

function createTransport(): MockTransport {
  return {
    testConnection: vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      endpoint: '/mock',
    }),
    createResponse: vi.fn().mockResolvedValue({
      content: 'Bonjour',
      status: 200,
      endpoint: '/mock',
    }),
  } as unknown as MockTransport;
}

function runtimeConfigProvider() {
  return {
    getModelConfig: vi.fn().mockResolvedValue({ reasoningEffort: 'medium' as const }),
  };
}

function writeInputWorkbook(root: string, rows: unknown[][]): string {
  const inputPath = join(root, `input-${Math.random().toString(16).slice(2)}.xlsx`);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  XLSX.writeFile(workbook, inputPath);
  return inputPath;
}

function mountReferenceData(db: CATDatabase, projectId: number): void {
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

function createPromptArtifact(
  unitId: string,
  projectType: PromptArtifact['projectType'],
  segment: Segment,
  userPrompt: string,
  overrides: {
    providerId?: string;
    providerName?: string;
    model?: string;
    reasoningEffort?: PromptArtifact['reasoningEffort'];
    tmPromptBlock?: string;
    concordancePromptBlock?: string;
    tbPromptBlock?: string;
    referencePromptBlock?: string;
  } = {},
): PromptArtifact {
  return {
    unitId,
    provider: {
      id: overrides.providerId ?? 'openai',
      name: overrides.providerName ?? 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
    },
    model: overrides.model ?? 'gpt-test',
    reasoningEffort: overrides.reasoningEffort ?? 'medium',
    projectPrompt: '',
    projectType,
    sourcePayload: serializeTokensToDisplayText(segment.sourceTokens),
    tmPromptBlock: overrides.tmPromptBlock ?? userPrompt,
    concordancePromptBlock: overrides.concordancePromptBlock ?? '',
    tbPromptBlock: overrides.tbPromptBlock ?? userPrompt,
    referencePromptBlock: overrides.referencePromptBlock ?? userPrompt,
    systemPrompt: userPrompt,
    userPrompt,
    promptChars: {
      system: userPrompt.length,
      user: userPrompt.length,
      total: userPrompt.length * 2,
    },
  };
}
