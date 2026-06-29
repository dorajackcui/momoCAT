import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it, vi } from 'vitest';
import { CATDatabase } from '@cat/db';
import { ProjectService } from './ProjectService';
import type { ProjectFileModule } from './modules/ProjectFileModule';

describe('ProjectService.inspectFile', () => {
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
    } finally {
      db.close();
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
