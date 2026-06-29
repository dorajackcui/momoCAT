import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const localizationMocks = vi.hoisted(() => {
  const inspectFile = vi.fn();
  return {
    inspectFile,
    LocalizationEngine: vi.fn(function () {}),
    LocalizationInspector: vi.fn(function (_db: unknown, _options: unknown) {
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
import type { ProjectFileModule } from './modules/ProjectFileModule';

describe('ProjectService.inspectFile', () => {
  beforeEach(() => {
    localizationMocks.inspectFile.mockClear();
    localizationMocks.LocalizationEngine.mockClear();
    localizationMocks.LocalizationInspector.mockClear();
  });

  it('delegates to ProjectFileModule.inspectFile', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'project-service-inspect-'));
    const dbPath = join(rootDir, 'cat.db');
    const db = new CATDatabase(dbPath);
    const inspectFile = vi.fn().mockResolvedValue({
      outputPath: 'inspect.xlsx',
      jsonOutputPath: 'inspect.json',
      summary: { total: 1, ready: 1, error: 0 },
    });

    try {
      const service = new ProjectService(db, join(rootDir, 'projects'), dbPath, {
        projectModule: { inspectFile } as unknown as ProjectFileModule,
        tmModule: {} as never,
        tbModule: {} as never,
        aiModule: { applySavedProxySettings: vi.fn() } as never,
      });

      const result = await service.inspectFile(44, 'inspect.xlsx');

      expect(inspectFile).toHaveBeenCalledWith(44, 'inspect.xlsx');
      expect(result.summary.ready).toBe(1);
      expect(localizationMocks.LocalizationInspector).not.toHaveBeenCalled();
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
