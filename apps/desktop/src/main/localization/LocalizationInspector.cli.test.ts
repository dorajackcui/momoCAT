import { describe, expect, it } from 'vitest';
import { CATDatabase } from '../../../../../packages/db/src';
import { LocalizationInspector } from './LocalizationInspector';

const runDynamic = process.env.LOCALIZATION_INSPECT_DYNAMIC === '1';
const maybeIt = runDynamic ? it : it.skip;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

function optionalPositiveInteger(name: string): number | undefined {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }
  return Number(value);
}

describe('LocalizationInspector CLI file runner', () => {
  maybeIt('localization-inspect-env-run', async () => {
    const dbPath = requireEnv('LOCALIZATION_INSPECT_DB_PATH');
    const projectId = Number(requireEnv('LOCALIZATION_INSPECT_PROJECT_ID'));
    const inputPath = requireEnv('LOCALIZATION_INSPECT_INPUT_PATH');
    const outputPath = requireEnv('LOCALIZATION_INSPECT_OUTPUT_PATH');
    const jsonOutputPath = process.env.LOCALIZATION_INSPECT_JSON_OUTPUT_PATH || undefined;
    const unitLimit = optionalPositiveInteger('LOCALIZATION_INSPECT_UNIT_LIMIT');
    const maxCellChars = optionalPositiveInteger('LOCALIZATION_INSPECT_MAX_CELL_CHARS');
    const db = new CATDatabase(dbPath);

    try {
      const inspector = new LocalizationInspector(db, { dbPath });
      const result = await inspector.inspectFile({
        projectId,
        inputPath,
        outputPath,
        jsonOutputPath,
        unitLimit,
        maxCellChars,
      });

      console.log(
        JSON.stringify({
          event: 'localization_inspect_complete',
          inputPath,
          outputPath,
          jsonOutputPath: result.jsonOutputPath,
          summary: result.summary,
        }),
      );

      expect(result.summary.total).toBeGreaterThan(0);
      expect(result.summary.error).toBe(0);
    } finally {
      db.close();
    }
  });
});
