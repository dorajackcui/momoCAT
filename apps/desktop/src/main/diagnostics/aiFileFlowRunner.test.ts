import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Segment, TMEntry } from '@cat/core/models';
import { serializeTokensToDisplayText } from '@cat/core/text';
import { CATDatabase } from '../../../../../packages/db/src';
import type { AITransport, SpreadsheetGateway } from '../services/ports';
import { runAIFileFlowTrace } from './aiFileFlowRunner';

interface EnvTraceConfig {
  dbPath: string;
  projectId?: number;
  projectName?: string;
  fileId?: number;
  filePath?: string;
  importOptions?: {
    hasHeader: boolean;
    sourceCol: number;
    targetCol: number;
    contextCol?: number;
  };
  model?: string;
  mode?: 'dialogue';
  targetScope?: 'blank-only' | 'overwrite-non-confirmed';
  previewLimit?: number;
}

function createSegment(params: {
  segmentId: string;
  fileId: number;
  sourceText: string;
  srcHash: string;
}): Segment {
  return {
    segmentId: params.segmentId,
    fileId: params.fileId,
    orderIndex: 0,
    sourceTokens: [{ type: 'text', content: params.sourceText }],
    targetTokens: [],
    status: 'new',
    tagsSignature: '',
    matchKey: params.sourceText.toLowerCase(),
    srcHash: params.srcHash,
    meta: { updatedAt: new Date().toISOString() },
  };
}

function createTMEntry(params: {
  tmId: string;
  projectId: number;
  srcHash: string;
  sourceText: string;
  targetText: string;
}): TMEntry & { tmId: string } {
  const now = new Date().toISOString();
  return {
    id: `tm-${params.srcHash}`,
    tmId: params.tmId,
    projectId: params.projectId,
    srcLang: 'en',
    tgtLang: 'zh',
    srcHash: params.srcHash,
    matchKey: params.sourceText.toLowerCase(),
    tagsSignature: '',
    sourceTokens: [{ type: 'text', content: params.sourceText }],
    targetTokens: [{ type: 'text', content: params.targetText }],
    usageCount: 1,
    createdAt: now,
    updatedAt: now,
  };
}

describe('runAIFileFlowTrace', () => {
  it('ai-file-flow-env-trace', async () => {
    const config = readEnvTraceConfig(process.env);
    if (!config) return;

    const events: unknown[] = [];
    const result = await runAIFileFlowTrace({
      ...config,
      emit: (event) => {
        events.push(event);
        if (process.env.AI_FILE_FLOW_TRACE === '1') {
          console.info(JSON.stringify(event));
        }
      },
    });

    expect(result.translation.total).toBeGreaterThanOrEqual(0);
    expect(
      events.some((event) => (event as { event: string }).event === 'ai_file_flow_start'),
    ).toBe(true);
    expect(
      events.some((event) => (event as { event: string }).event === 'ai_file_flow_complete'),
    ).toBe(true);
  });

  it('runs mounted TM/TB matching and AI translation for a project file', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Desktop AI Flow', 'en', 'zh');
      db.setSetting('openai_api_key', 'test-api-key');
      const fileId = db.createFile(projectId, 'demo.xlsx');
      const segment = createSegment({
        segmentId: 'seg-1',
        fileId,
        sourceText: 'Hello world',
        srcHash: 'hello-world',
      });
      db.bulkInsertSegments([segment]);

      const tmId = db.createTM('Client Main TM', 'en', 'zh', 'main');
      db.mountTMToProject(projectId, tmId, 10, 'read');
      db.upsertTMEntry(
        createTMEntry({
          tmId,
          projectId,
          srcHash: 'hello-world',
          sourceText: 'Hello world',
          targetText: '你好世界',
        }),
      );

      const tbId = db.createTermBase('Client Terms', 'en', 'zh');
      db.mountTermBaseToProject(projectId, tbId, 20);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'term-world',
        tbId,
        srcLang: 'en',
        srcTerm: 'world',
        tgtTerm: '世界',
      });

      const transport = {
        testConnection: vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          endpoint: '/mock',
        }),
        createResponse: vi.fn().mockResolvedValue({
          content: '你好世界',
          status: 200,
          endpoint: '/mock',
        }),
      } as unknown as AITransport;
      const events: unknown[] = [];

      const result = await runAIFileFlowTrace({
        dbPath: ':memory:',
        db,
        projectId,
        fileId,
        projectsDir: '.tmp/desktop-ai-flow-test',
        previewLimit: 1,
        aiTransport: transport,
        emit: (event) => events.push(event),
      });

      expect(result.translation).toEqual({ translated: 1, skipped: 0, failed: 0, total: 1 });
      expect(events.map((event) => (event as { event: string }).event)).toEqual([
        'ai_file_flow_start',
        'ai_file_flow_resources',
        'ai_file_flow_reference_preview',
        'ai_file_flow_progress',
        'ai_file_flow_complete',
      ]);
      expect(events[1]).toMatchObject({
        event: 'ai_file_flow_resources',
        mountedTMs: expect.arrayContaining([
          expect.objectContaining({ name: 'Client Main TM', type: 'main' }),
        ]),
        mountedTBs: [expect.objectContaining({ name: 'Client Terms' })],
      });
      expect(events[2]).toMatchObject({
        event: 'ai_file_flow_reference_preview',
        segmentId: 'seg-1',
        tmMatchCount: 1,
        tbMatchCount: 1,
      });
      expect(transport.createResponse).toHaveBeenCalledTimes(1);
      const updated = db.getSegment('seg-1');
      expect(updated?.status).toBe('translated');
      expect(serializeTokensToDisplayText(updated?.targetTokens ?? [])).toBe('你好世界');
    } finally {
      db.close();
    }
  });

  it('resolves project by name and imports file path using source/target headers', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'cat-desktop-ai-file-'));
    const inputPath = join(rootDir, 'mt.xlsx');
    await writeFile(inputPath, 'placeholder workbook');

    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Nikki(zh-fr)', 'zh-CN', 'fr-FR');
      db.setSetting('openai_api_key', 'test-api-key');
      const importSpy = vi.fn(async (_filePath: string, _projectId: number, fileId: number) => [
        createSegment({
          segmentId: 'seg-imported',
          fileId,
          sourceText: '测试文本',
          srcHash: 'hash-imported',
        }),
      ]);
      const filter = {
        getPreview: vi.fn().mockResolvedValue([
          ['note', 'target', 'source'],
          ['context', '', '测试文本'],
        ]),
        import: importSpy,
        export: vi.fn(),
      } as unknown as SpreadsheetGateway;

      const tmId = db.createTM('Nikki(zh-fr)TM', 'zh', 'fr', 'main');
      db.mountTMToProject(projectId, tmId, 10, 'read');
      db.upsertTMEntry(
        createTMEntry({
          tmId,
          projectId,
          srcHash: 'hash-imported',
          sourceText: '测试文本',
          targetText: 'Texte de test',
        }),
      );

      const tbId = db.createTermBase('Nikki_TB(zh-fr)', 'zh-CN', 'fr');
      db.mountTermBaseToProject(projectId, tbId, 10);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'term-imported',
        tbId,
        srcLang: 'zh-CN',
        srcTerm: '测试',
        tgtTerm: 'test',
      });

      const transport = {
        testConnection: vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          endpoint: '/mock',
        }),
        createResponse: vi.fn().mockResolvedValue({
          content: 'Texte de test',
          status: 200,
          endpoint: '/mock',
        }),
      } as unknown as AITransport;
      const events: unknown[] = [];

      const result = await runAIFileFlowTrace({
        dbPath: ':memory:',
        db,
        projectName: 'Nikki(zh-fr)',
        filePath: inputPath,
        projectsDir: join(rootDir, 'projects'),
        previewLimit: 1,
        aiTransport: transport,
        filter,
        emit: (event) => events.push(event),
      });

      expect(result.translation).toEqual({ translated: 1, skipped: 0, failed: 0, total: 1 });
      expect(filter.getPreview).toHaveBeenCalledWith(inputPath);
      expect(importSpy).toHaveBeenCalledWith(
        expect.any(String),
        projectId,
        expect.any(Number),
        expect.objectContaining({
          hasHeader: true,
          sourceCol: 2,
          targetCol: 1,
        }),
      );
      expect(events.map((event) => (event as { event: string }).event)).toContain(
        'ai_file_flow_imported_file',
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          event: 'ai_file_flow_start',
          projectId,
          projectName: 'Nikki(zh-fr)',
          fileName: 'mt.xlsx',
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          event: 'ai_file_flow_reference_preview',
          tmMatchCount: 1,
          tbMatchCount: 1,
        }),
      );
    } finally {
      db.close();
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

function readEnvTraceConfig(env: NodeJS.ProcessEnv): EnvTraceConfig | null {
  if (env.AI_FILE_FLOW_DYNAMIC !== '1') return null;

  const projectId = env.AI_FILE_FLOW_PROJECT_ID
    ? readPositiveInt(env.AI_FILE_FLOW_PROJECT_ID, 'AI_FILE_FLOW_PROJECT_ID')
    : undefined;
  const projectName = env.AI_FILE_FLOW_PROJECT_NAME || undefined;
  if (projectId === undefined && !projectName) {
    throw new Error('AI_FILE_FLOW_PROJECT_ID or AI_FILE_FLOW_PROJECT_NAME is required.');
  }

  const fileId = env.AI_FILE_FLOW_FILE_ID
    ? readPositiveInt(env.AI_FILE_FLOW_FILE_ID, 'AI_FILE_FLOW_FILE_ID')
    : undefined;
  const filePath = env.AI_FILE_FLOW_FILE_PATH || undefined;
  if (fileId === undefined && !filePath) {
    throw new Error('AI_FILE_FLOW_FILE_ID or AI_FILE_FLOW_FILE_PATH is required.');
  }

  const previewLimit = env.AI_FILE_FLOW_PREVIEW_LIMIT
    ? readNonNegativeInt(env.AI_FILE_FLOW_PREVIEW_LIMIT, 'AI_FILE_FLOW_PREVIEW_LIMIT')
    : undefined;

  const mode = env.AI_FILE_FLOW_MODE;
  if (mode && mode !== 'standard' && mode !== 'dialogue') {
    throw new Error('AI_FILE_FLOW_MODE must be standard or dialogue.');
  }

  const targetScope = env.AI_FILE_FLOW_TARGET_SCOPE;
  if (targetScope && targetScope !== 'blank-only' && targetScope !== 'overwrite-non-confirmed') {
    throw new Error('AI_FILE_FLOW_TARGET_SCOPE must be blank-only or overwrite-non-confirmed.');
  }

  return {
    dbPath: env.AI_FILE_FLOW_DB_PATH || '.cat_data/cat_v1.db',
    projectId,
    projectName,
    fileId,
    filePath,
    importOptions: readEnvImportOptions(env),
    model: env.AI_FILE_FLOW_MODEL || undefined,
    mode: mode === 'standard' ? undefined : mode,
    targetScope,
    previewLimit,
  };
}

function readEnvImportOptions(env: NodeJS.ProcessEnv): EnvTraceConfig['importOptions'] {
  const hasManualImportOptions =
    env.AI_FILE_FLOW_SOURCE_COL !== undefined ||
    env.AI_FILE_FLOW_TARGET_COL !== undefined ||
    env.AI_FILE_FLOW_CONTEXT_COL !== undefined ||
    env.AI_FILE_FLOW_HAS_HEADER !== undefined;
  if (!hasManualImportOptions) return undefined;

  return {
    hasHeader: env.AI_FILE_FLOW_HAS_HEADER !== '0',
    sourceCol: readNonNegativeInt(env.AI_FILE_FLOW_SOURCE_COL ?? '0', 'AI_FILE_FLOW_SOURCE_COL'),
    targetCol: readNonNegativeInt(env.AI_FILE_FLOW_TARGET_COL ?? '1', 'AI_FILE_FLOW_TARGET_COL'),
    contextCol:
      env.AI_FILE_FLOW_CONTEXT_COL === undefined
        ? undefined
        : readNonNegativeInt(env.AI_FILE_FLOW_CONTEXT_COL, 'AI_FILE_FLOW_CONTEXT_COL'),
  };
}

function readPositiveInt(value: string | undefined, name: string): number {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return numberValue;
}

function readNonNegativeInt(value: string | undefined, name: string): number {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return numberValue;
}
