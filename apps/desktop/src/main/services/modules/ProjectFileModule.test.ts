import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Segment } from '@cat/core/models';
import { ProjectFileModule } from './ProjectFileModule';
import { ProjectRepository, SegmentRepository, SpreadsheetGateway } from '../ports';

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
