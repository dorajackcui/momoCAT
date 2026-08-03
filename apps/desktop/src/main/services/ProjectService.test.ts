import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const localizationMocks = vi.hoisted(() => {
  const inspectFile = vi.fn();
  return {
    inspectFile,
    LocalizationEngine: vi.fn(function () {}),
    LocalizationInspector: vi.fn(function () {
      return { inspectFile };
    }),
  };
});

vi.mock('@cat/localization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cat/localization')>();
  return {
    ...actual,
    LocalizationEngine: localizationMocks.LocalizationEngine,
    LocalizationInspector: localizationMocks.LocalizationInspector,
  };
});

import { CATDatabase } from '@cat/db';
import { ProjectService } from './ProjectService';
import type { AITransport } from './ports';

function createStoredFile(db: CATDatabase, projectsDir: string): number {
  const projectId = db.createProject('Progress project', 'en', 'fr');
  const fileId = db.createFile(
    projectId,
    'demo.xlsx',
    JSON.stringify({ hasHeader: true, sourceCol: 0, targetCol: 1, tagPolicy: 'none' }),
  );
  const projectDir = join(projectsDir, String(projectId));
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, `${fileId}_demo.xlsx`), 'test workbook');
  return fileId;
}

describe('ProjectService.inspectFile', () => {
  beforeEach(() => {
    localizationMocks.inspectFile.mockClear();
    localizationMocks.LocalizationEngine.mockClear();
    localizationMocks.LocalizationInspector.mockClear();
  });

  it('routes inspect progress through the file-scoped emitter', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'project-service-inspect-'));
    const dbPath = join(rootDir, 'cat.db');
    const db = new CATDatabase(dbPath);
    const projectsDir = join(rootDir, 'projects');
    const fileId = createStoredFile(db, projectsDir);
    const inspectFileRunner = vi.fn(async (input) => {
      input.onProgress?.(5, 10);
      return {
        outputPath: 'inspect.xlsx',
        jsonOutputPath: 'inspect.json',
        summary: { total: 1, ready: 1, error: 0 },
        artifact: {} as never,
      };
    });

    try {
      const service = new ProjectService(db, projectsDir, dbPath, {
        inspectFileRunner,
        tmModule: {} as never,
        tbModule: {} as never,
        aiModule: { applySavedProxySettings: vi.fn() } as never,
      });

      const progressEvents: { type: string; current: number; total: number; scope?: string }[] = [];
      service.onProgress((data) => progressEvents.push(data));

      const result = await service.inspectFile(fileId, 'inspect.xlsx');

      expect(inspectFileRunner).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: expect.any(Number),
          outputPath: 'inspect.xlsx',
          onProgress: expect.any(Function),
        }),
      );
      expect(result.summary.ready).toBe(1);
      expect(localizationMocks.LocalizationInspector).not.toHaveBeenCalled();
      expect(progressEvents).toContainEqual({
        type: 'inspect',
        current: 5,
        total: 10,
        message: undefined,
        scope: `file:${fileId}`,
      });
    } finally {
      db.close();
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('forwards injected AI transport to the default localization inspector runner', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'project-service-inspect-'));
    const dbPath = join(rootDir, 'cat.db');
    const db = new CATDatabase(dbPath);
    const aiTransport = {
      listModels: vi.fn(),
      testConnection: vi.fn(),
      createResponse: vi.fn(),
    } as unknown as AITransport;

    try {
      new ProjectService(db, join(rootDir, 'projects'), dbPath, {
        aiTransport,
        tmModule: {} as never,
        tbModule: {} as never,
        aiModule: { applySavedProxySettings: vi.fn() } as never,
      });

      expect(localizationMocks.LocalizationInspector).toHaveBeenCalledTimes(1);
      const [, options] = localizationMocks.LocalizationInspector.mock.calls[0];
      expect(options).toMatchObject({ dbPath });
      expect((options as { aiTransport?: AITransport }).aiTransport).toBe(aiTransport);
    } finally {
      db.close();
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

describe('ProjectService.exportReferencesForMt', () => {
  it('routes reference-export progress through the file-scoped emitter', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'project-service-reference-export-'));
    const dbPath = join(rootDir, 'cat.db');
    const db = new CATDatabase(dbPath);
    const projectsDir = join(rootDir, 'projects');
    const fileId = createStoredFile(db, projectsDir);
    const referenceExportRunner = vi.fn(async (input) => {
      input.onProgress?.(5, 10);
      return {
        outputPath: 'references.xlsx',
        summary: { total: 1, ready: 1, error: 0 },
        units: [],
      };
    });

    try {
      const service = new ProjectService(db, projectsDir, dbPath, {
        referenceExportRunner,
        tmModule: {} as never,
        tbModule: {} as never,
        aiModule: { applySavedProxySettings: vi.fn() } as never,
      });

      const progressEvents: { type: string; current: number; total: number; scope?: string }[] = [];
      service.onProgress((data) => progressEvents.push(data));

      const result = await service.exportReferencesForMt(fileId, 'references.xlsx');

      expect(referenceExportRunner).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: expect.any(Number),
          outputPath: 'references.xlsx',
          onProgress: expect.any(Function),
        }),
      );
      expect(result.summary.ready).toBe(1);
      expect(progressEvents).toContainEqual({
        type: 'reference-export',
        current: 5,
        total: 10,
        message: undefined,
        scope: `file:${fileId}`,
      });
    } finally {
      db.close();
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
