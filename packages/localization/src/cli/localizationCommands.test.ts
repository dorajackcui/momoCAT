import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runExportReferencesForMtCommand } from './exportReferencesForMtCommand';
import { runInspectLocalizationCommand } from './inspectLocalizationCommand';
import { runTranslateFileCommand } from './translateFileCommand';

function createMissingDbFixture(prefix: string) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(tempRoot, 'missing.db');
  const inputPath = path.join(tempRoot, 'input.xlsx');
  const outputPath = path.join(tempRoot, 'output.xlsx');
  fs.writeFileSync(inputPath, '');

  return { dbPath, inputPath, outputPath, tempRoot };
}

describe('localization command database guards', () => {
  it('runInspectLocalizationCommand rejects a missing db path without creating it', async () => {
    const { dbPath, inputPath, outputPath, tempRoot } = createMissingDbFixture(
      'momocat-inspect-localization-missing-',
    );
    try {
      await expect(
        runInspectLocalizationCommand({
          dbPath,
          projectId: 1,
          inputPath,
          outputPath,
        }),
      ).rejects.toThrow();
      expect(fs.existsSync(dbPath)).toBe(false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('runTranslateFileCommand rejects a missing db path without creating it', async () => {
    const { dbPath, inputPath, outputPath, tempRoot } = createMissingDbFixture(
      'momocat-translate-file-missing-',
    );
    try {
      await expect(
        runTranslateFileCommand({
          dbPath,
          projectId: 1,
          inputPath,
          outputPath,
        }),
      ).rejects.toThrow();
      expect(fs.existsSync(dbPath)).toBe(false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('runExportReferencesForMtCommand rejects a missing db path without creating it', async () => {
    const { dbPath, inputPath, outputPath, tempRoot } = createMissingDbFixture(
      'momocat-export-references-missing-',
    );
    try {
      await expect(
        runExportReferencesForMtCommand({
          dbPath,
          projectId: 1,
          inputPath,
          outputPath,
        }),
      ).rejects.toThrow();
      expect(fs.existsSync(dbPath)).toBe(false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
