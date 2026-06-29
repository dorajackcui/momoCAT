import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Segment } from '@cat/core/models';
import type { InspectFileInput, InspectFileResult } from '@cat/localization';
import type { FileInspectResult } from '../../../shared/ipc';
import { ProjectFileModule } from './ProjectFileModule';
import { ProjectRepository, SegmentRepository, SpreadsheetGateway } from '../ports';

function createInspectResult(outputPath: string): InspectFileResult {
  return {
    outputPath,
    jsonOutputPath: join(outputPath, '..', 'inspect.json'),
    summary: { total: 3, ready: 2, error: 1 },
    artifact: {
      version: 1,
      generatedAt: '2026-06-29T00:00:00.000Z',
      project: {
        id: 9,
        name: 'Demo project',
        srcLang: 'en',
        tgtLang: 'fr',
        projectType: 'translation',
        promptChars: 0,
      },
      inputFile: {
        inputPath: 'demo.xlsx',
        sheetName: 'Sheet1',
        columns: {
          hasHeader: true,
          sourceCol: 2,
          targetCol: 4,
          contextCol: 5,
        },
        rows: [],
      },
      systemPrompt: {
        value: '',
        promptChars: 0,
        xlsxValue: '',
        truncated: false,
      },
      units: [],
    },
  };
}

describe('ProjectFileModule.addFileToProject cleanup', () => {
  it('removes db file record and copied file when import fails', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'project-file-module-'));
    const inputPath = join(rootDir, 'input.xlsx');
    writeFileSync(inputPath, 'fake spreadsheet');

    const createdFileId = 42;
    const projectRepo = {
      getProject: vi.fn().mockReturnValue({ id: 1 }),
      createFile: vi.fn().mockReturnValue(createdFileId),
      deleteFile: vi.fn(),
      getFile: vi.fn(),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      bulkInsertSegments: vi.fn(),
    } as unknown as SegmentRepository;

    const filter = {
      import: vi.fn().mockRejectedValue(new Error('Import failed')),
      export: vi.fn(),
      getPreview: vi.fn(),
    } as unknown as SpreadsheetGateway;

    const module = new ProjectFileModule(projectRepo, segmentRepo, filter, rootDir);
    const options = {
      hasHeader: true,
      sourceCol: 0,
      targetCol: 1,
    };

    try {
      await expect(module.addFileToProject(1, inputPath, options)).rejects.toThrow('Import failed');
      expect(projectRepo.deleteFile).toHaveBeenCalledTimes(1);
      expect(projectRepo.deleteFile).toHaveBeenCalledWith(createdFileId);
      expect(segmentRepo.bulkInsertSegments).not.toHaveBeenCalled();

      const copiedPath = join(rootDir, '1', `${createdFileId}_input.xlsx`);
      expect(existsSync(copiedPath)).toBe(false);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('removes db file record and copied file when segment persistence fails', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'project-file-module-'));
    const inputPath = join(rootDir, 'input.xlsx');
    writeFileSync(inputPath, 'fake spreadsheet');

    const createdFileId = 43;
    const projectRepo = {
      getProject: vi.fn().mockReturnValue({ id: 1 }),
      createFile: vi.fn().mockReturnValue(createdFileId),
      deleteFile: vi.fn(),
      getFile: vi.fn(),
    } as unknown as ProjectRepository;

    const importedSegments: Segment[] = [
      {
        segmentId: 'seg-1',
        fileId: createdFileId,
        orderIndex: 0,
        sourceTokens: [{ type: 'text', content: 'Hello' }],
        targetTokens: [],
        status: 'new',
        tagsSignature: '',
        matchKey: 'hello',
        srcHash: 'hash-1',
        meta: { updatedAt: new Date().toISOString() },
      },
    ];

    const segmentRepo = {
      bulkInsertSegments: vi.fn().mockImplementation(() => {
        throw new Error('Insert failed');
      }),
    } as unknown as SegmentRepository;

    const filter = {
      import: vi.fn().mockResolvedValue(importedSegments),
      export: vi.fn(),
      getPreview: vi.fn(),
    } as unknown as SpreadsheetGateway;

    const module = new ProjectFileModule(projectRepo, segmentRepo, filter, rootDir);
    const options = {
      hasHeader: true,
      sourceCol: 0,
      targetCol: 1,
    };

    try {
      await expect(module.addFileToProject(1, inputPath, options)).rejects.toThrow('Insert failed');
      expect(projectRepo.deleteFile).toHaveBeenCalledTimes(1);
      expect(projectRepo.deleteFile).toHaveBeenCalledWith(createdFileId);
      expect(segmentRepo.bulkInsertSegments).toHaveBeenCalledTimes(1);

      const copiedPath = join(rootDir, '1', `${createdFileId}_input.xlsx`);
      expect(existsSync(copiedPath)).toBe(false);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('throws aggregate error when import fails and cleanup also fails', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'project-file-module-'));
    const inputPath = join(rootDir, 'input.xlsx');
    writeFileSync(inputPath, 'fake spreadsheet');

    const createdFileId = 44;
    const projectRepo = {
      getProject: vi.fn().mockReturnValue({ id: 1 }),
      createFile: vi.fn().mockReturnValue(createdFileId),
      deleteFile: vi.fn().mockImplementation(() => {
        throw new Error('cleanup delete failed');
      }),
      getFile: vi.fn(),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      bulkInsertSegments: vi.fn(),
    } as unknown as SegmentRepository;

    const filter = {
      import: vi.fn().mockRejectedValue(new Error('Import failed')),
      export: vi.fn(),
      getPreview: vi.fn(),
    } as unknown as SpreadsheetGateway;

    const module = new ProjectFileModule(projectRepo, segmentRepo, filter, rootDir);
    const options = {
      hasHeader: true,
      sourceCol: 0,
      targetCol: 1,
    };

    try {
      let thrown: unknown;
      try {
        await module.addFileToProject(1, inputPath, options);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(AggregateError);
      const aggregate = thrown as AggregateError;
      expect(aggregate.message).toContain('Import failed and cleanup encountered');
      expect(aggregate.errors).toHaveLength(2);
      expect((aggregate.errors[0] as Error).message).toContain('Import failed');
      expect((aggregate.errors[1] as Error).message).toContain('cleanup delete failed');

      const copiedPath = join(rootDir, '1', `${createdFileId}_input.xlsx`);
      expect(existsSync(copiedPath)).toBe(false);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

describe('ProjectFileModule.createPastedSourceFile', () => {
  it('writes an internal CSV and imports it through the spreadsheet gateway', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'project-file-module-paste-'));
    const createdFileId = 77;
    const optionsJson: string[] = [];
    let importedPath = '';

    const projectRepo = {
      getProject: vi.fn().mockReturnValue({ id: 1 }),
      listFiles: vi.fn().mockReturnValue([]),
      createFile: vi.fn().mockImplementation((_projectId, _name, importOptionsJson) => {
        optionsJson.push(importOptionsJson);
        return createdFileId;
      }),
      deleteFile: vi.fn(),
      getFile: vi.fn().mockReturnValue({
        id: createdFileId,
        projectId: 1,
        name: 'A-2026-06-23-08-30.csv',
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      bulkInsertSegments: vi.fn(),
    } as unknown as SegmentRepository;

    const filter = {
      import: vi.fn().mockImplementation(async (filePath: string) => {
        importedPath = filePath;
        return [
          {
            segmentId: 'seg-1',
            fileId: createdFileId,
            orderIndex: 1,
            sourceTokens: [{ type: 'text', content: 'A' }],
            targetTokens: [],
            status: 'new',
            tagsSignature: '',
            matchKey: 'a',
            srcHash: 'hash-a',
            meta: { rowRef: 2, updatedAt: new Date().toISOString() },
          },
        ] satisfies Segment[];
      }),
      export: vi.fn(),
      getPreview: vi.fn(),
    } as unknown as SpreadsheetGateway;

    const module = new ProjectFileModule(projectRepo, segmentRepo, filter, rootDir);
    const file = await module.createPastedSourceFile(
      1,
      { sources: ['A', 'B, C'], tagPolicy: 'none' },
      new Date(2026, 5, 23, 8, 30),
    );

    expect(file.id).toBe(createdFileId);
    expect(projectRepo.createFile).toHaveBeenCalledWith(
      1,
      'A-2026-06-23-08-30.csv',
      JSON.stringify({
        hasHeader: true,
        sourceCol: 0,
        targetCol: 1,
        tagPolicy: 'none',
      }),
    );
    expect(readFileSync(importedPath, 'utf8')).toBe('Source,Target\r\nA,\r\n"B, C",');
    expect(filter.import).toHaveBeenCalledWith(
      importedPath,
      1,
      createdFileId,
      JSON.parse(optionsJson[0]),
    );
    expect(segmentRepo.bulkInsertSegments).toHaveBeenCalledTimes(1);

    rmSync(rootDir, { recursive: true, force: true });
  });

  it('rejects empty pasted sources before creating a file record', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'project-file-module-paste-'));
    const projectRepo = {
      getProject: vi.fn().mockReturnValue({ id: 1 }),
      listFiles: vi.fn().mockReturnValue([]),
      createFile: vi.fn(),
    } as unknown as ProjectRepository;
    const segmentRepo = {
      bulkInsertSegments: vi.fn(),
    } as unknown as SegmentRepository;
    const filter = {
      import: vi.fn(),
      export: vi.fn(),
      getPreview: vi.fn(),
    } as unknown as SpreadsheetGateway;

    const module = new ProjectFileModule(projectRepo, segmentRepo, filter, rootDir);

    await expect(module.createPastedSourceFile(1, { sources: [' ', ''] })).rejects.toThrow(
      'No valid pasted source rows found.',
    );
    expect(projectRepo.createFile).not.toHaveBeenCalled();

    rmSync(rootDir, { recursive: true, force: true });
  });

  it('cleans up the file record and generated CSV when segment persistence fails', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'project-file-module-paste-'));
    const createdFileId = 78;
    let generatedPath = '';

    const projectRepo = {
      getProject: vi.fn().mockReturnValue({ id: 1 }),
      listFiles: vi.fn().mockReturnValue([]),
      createFile: vi.fn().mockReturnValue(createdFileId),
      deleteFile: vi.fn(),
      getFile: vi.fn(),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      bulkInsertSegments: vi.fn().mockImplementation(() => {
        throw new Error('Insert failed');
      }),
    } as unknown as SegmentRepository;

    const filter = {
      import: vi.fn().mockImplementation(async (filePath: string) => {
        generatedPath = filePath;
        return [
          {
            segmentId: 'seg-1',
            fileId: createdFileId,
            orderIndex: 1,
            sourceTokens: [{ type: 'text', content: 'A' }],
            targetTokens: [],
            status: 'new',
            tagsSignature: '',
            matchKey: 'a',
            srcHash: 'hash-a',
            meta: { rowRef: 2, updatedAt: new Date().toISOString() },
          },
        ] satisfies Segment[];
      }),
      export: vi.fn(),
      getPreview: vi.fn(),
    } as unknown as SpreadsheetGateway;

    const module = new ProjectFileModule(projectRepo, segmentRepo, filter, rootDir);

    await expect(module.createPastedSourceFile(1, { sources: ['A'] })).rejects.toThrow(
      'Insert failed',
    );
    expect(projectRepo.deleteFile).toHaveBeenCalledWith(createdFileId);
    expect(existsSync(generatedPath)).toBe(false);

    rmSync(rootDir, { recursive: true, force: true });
  });
});

describe('ProjectFileModule.inspectFile', () => {
  it('maps stored import options to the shared inspector input and strips artifacts', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'project-file-module-inspect-'));
    const outputPath = join(rootDir, 'inspect.xlsx');
    const inspectResult: InspectFileResult = {
      ...createInspectResult(outputPath),
      summary: { total: 3, ready: 2, error: 1, internal: 99 } as InspectFileResult['summary'],
    };
    const inspectFileRunner = vi.fn<[InspectFileInput], Promise<InspectFileResult>>(
      async () => inspectResult,
    );
    const projectRepo = {
      getFile: vi.fn().mockReturnValue({
        id: 12,
        projectId: 9,
        name: 'demo.xlsx',
        importOptionsJson: JSON.stringify({
          hasHeader: true,
          sourceCol: 2,
          targetCol: 4,
          contextCol: 5,
          tagPolicy: 'none',
        }),
      }),
      getProject: vi.fn().mockReturnValue({ id: 9 }),
    } as unknown as ProjectRepository;
    const segmentRepo = {} as unknown as SegmentRepository;
    const filter = {} as unknown as SpreadsheetGateway;

    const module = new ProjectFileModule(
      projectRepo,
      segmentRepo,
      filter,
      rootDir,
      inspectFileRunner,
    );

    try {
      const result = await module.inspectFile(12, outputPath);

      expect(inspectFileRunner).toHaveBeenCalledTimes(1);
      expect(inspectFileRunner).toHaveBeenCalledWith({
        projectId: 9,
        inputPath: join(rootDir, '9', '12_demo.xlsx'),
        outputPath,
        columns: { hasHeader: true, sourceCol: 2, targetCol: 4, contextCol: 5 },
        options: {
          requestMode: 'window-partial',
          targetBaseline: 'ignore-current-targets',
          tagPolicy: 'none',
        },
      });

      expect(result).toEqual({
        outputPath,
        jsonOutputPath: inspectResult.jsonOutputPath,
        summary: { total: 3, ready: 2, error: 1 },
      } satisfies FileInspectResult);
      expect(Object.keys(result.summary)).toEqual(['total', 'ready', 'error']);
      expect(result).not.toHaveProperty('artifact');
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects missing inspect import options before calling the runner', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'project-file-module-inspect-'));
    const outputPath = join(rootDir, 'inspect.xlsx');
    const inspectFileRunner = vi.fn<[InspectFileInput], Promise<InspectFileResult>>();
    const projectRepo = {
      getFile: vi.fn().mockReturnValue({
        id: 12,
        projectId: 9,
        name: 'demo.xlsx',
        importOptionsJson: '{"hasHeader":true}',
      }),
      getProject: vi.fn().mockReturnValue({ id: 9 }),
    } as unknown as ProjectRepository;
    const segmentRepo = {} as unknown as SegmentRepository;
    const filter = {} as unknown as SpreadsheetGateway;

    const module = new ProjectFileModule(
      projectRepo,
      segmentRepo,
      filter,
      rootDir,
      inspectFileRunner,
    );

    try {
      await expect(module.inspectFile(12, outputPath)).rejects.toThrow(
        'Inspect options not found for this file. Please re-import the file.',
      );
      expect(inspectFileRunner).not.toHaveBeenCalled();
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

describe('ProjectFileModule.runFileQA', () => {
  it('writes per-segment qa issues back to repository while building report', async () => {
    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 99 }),
      getProject: vi.fn().mockReturnValue({
        id: 99,
        qaSettings: {
          enabledRuleIds: ['tag-integrity'],
          instantQaOnConfirm: true,
        },
      }),
    } as unknown as ProjectRepository;

    const segments: Segment[] = [
      {
        segmentId: 'seg-has-error',
        fileId: 1,
        orderIndex: 0,
        sourceTokens: [{ type: 'tag', content: '<1>' }],
        targetTokens: [],
        status: 'draft',
        tagsSignature: '<1>',
        matchKey: 'k1',
        srcHash: 'h1',
        meta: { rowRef: 3, updatedAt: new Date().toISOString() },
      },
      {
        segmentId: 'seg-clean',
        fileId: 1,
        orderIndex: 1,
        sourceTokens: [{ type: 'text', content: 'hello' }],
        targetTokens: [{ type: 'text', content: '你好' }],
        status: 'draft',
        tagsSignature: '',
        matchKey: 'k2',
        srcHash: 'h2',
        meta: { rowRef: 4, updatedAt: new Date().toISOString() },
      },
    ];

    const segmentRepo = {
      getSegmentsPage: vi
        .fn()
        .mockImplementation((_fileId: number, offset: number) => (offset === 0 ? segments : [])),
      updateSegmentQaIssues: vi.fn(),
    } as unknown as SegmentRepository;

    const filter = {
      import: vi.fn(),
      export: vi.fn(),
      getPreview: vi.fn(),
    } as unknown as SpreadsheetGateway;

    const module = new ProjectFileModule(projectRepo, segmentRepo, filter, '/tmp');
    const report = await module.runFileQA(1, vi.fn().mockResolvedValue([]));

    expect(report.checkedSegments).toBe(2);
    expect(report.errorCount).toBe(1);
    expect(report.warningCount).toBe(0);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0].segmentId).toBe('seg-has-error');

    expect(segmentRepo.updateSegmentQaIssues).toHaveBeenCalledTimes(2);
    expect(segmentRepo.updateSegmentQaIssues).toHaveBeenNthCalledWith(
      1,
      'seg-has-error',
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'tag-missing',
          severity: 'error',
        }),
      ]),
    );
    expect(segmentRepo.updateSegmentQaIssues).toHaveBeenNthCalledWith(2, 'seg-clean', []);
  });

  it('passes project target locale into terminology QA during file QA runs', async () => {
    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 99 }),
      getProject: vi.fn().mockReturnValue({
        id: 99,
        tgtLang: 'tr-TR',
        qaSettings: {
          enabledRuleIds: ['terminology-consistency'],
          instantQaOnConfirm: true,
        },
      }),
    } as unknown as ProjectRepository;

    const segment: Segment = {
      segmentId: 'seg-tr-locale',
      fileId: 1,
      orderIndex: 0,
      sourceTokens: [{ type: 'text', content: 'Please preserve the heat insulation.' }],
      targetTokens: [{ type: 'text', content: 'Lütfen ısı yalıtımı koruyun.' }],
      status: 'draft',
      tagsSignature: '',
      matchKey: 'k-tr',
      srcHash: 'h-tr',
      meta: { rowRef: 8, updatedAt: new Date().toISOString() },
    };

    const resolveTermMatches = vi.fn().mockResolvedValue([
      {
        id: 'tb-tr-1',
        tbId: 'tb-tr',
        srcTerm: 'heat insulation',
        tgtTerm: 'ISI YALITIMI',
        srcNorm: 'heat insulation',
        note: null,
        createdAt: '',
        updatedAt: '',
        usageCount: 1,
        tbName: 'TR TB',
        priority: 1,
        positions: [{ start: 21, end: 36 }],
      },
    ]);

    const segmentRepo = {
      getSegmentsPage: vi
        .fn()
        .mockImplementation((_fileId: number, offset: number) => (offset === 0 ? [segment] : [])),
      updateSegmentQaIssues: vi.fn(),
    } as unknown as SegmentRepository;

    const filter = {
      import: vi.fn(),
      export: vi.fn(),
      getPreview: vi.fn(),
    } as unknown as SpreadsheetGateway;

    const module = new ProjectFileModule(projectRepo, segmentRepo, filter, '/tmp');
    const report = await module.runFileQA(1, resolveTermMatches);

    expect(resolveTermMatches).toHaveBeenCalledWith(99, segment);
    expect(report.checkedSegments).toBe(1);
    expect(report.warningCount).toBe(0);
    expect(report.issues).toEqual([]);
    expect(segmentRepo.updateSegmentQaIssues).toHaveBeenCalledWith('seg-tr-locale', []);
  });
});
