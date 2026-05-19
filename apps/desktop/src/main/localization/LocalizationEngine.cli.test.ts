import { describe, expect, it } from 'vitest';
import { CATDatabase } from '../../../../../packages/db/src';
import { LocalizationEngine } from './LocalizationEngine';
import type { LocalizationTargetScope } from './types';

const runDynamic = process.env.LOCALIZATION_ENGINE_FILE_DYNAMIC === '1';
const maybeIt = runDynamic ? it : it.skip;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

describe('LocalizationEngine CLI file runner', () => {
  maybeIt('localization-engine-file-env-run', async () => {
    const dbPath = requireEnv('LOCALIZATION_ENGINE_DB_PATH');
    const projectId = Number(requireEnv('LOCALIZATION_ENGINE_PROJECT_ID'));
    const inputPath = requireEnv('LOCALIZATION_ENGINE_INPUT_PATH');
    const outputPath = requireEnv('LOCALIZATION_ENGINE_OUTPUT_PATH');
    const targetScope = process.env.LOCALIZATION_ENGINE_TARGET_SCOPE;
    const db = new CATDatabase(dbPath);

    try {
      const engine = new LocalizationEngine(db, { dbPath });
      const result = await engine.translateFile({
        projectId,
        inputPath,
        outputPath,
        options: targetScope
          ? { targetScope: targetScope as LocalizationTargetScope }
          : undefined,
      });

      console.log(
        JSON.stringify({
          event: 'localization_file_complete',
          inputPath,
          outputPath,
          summary: result.summary,
        }),
      );

      expect(result.summary.total).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });
});
