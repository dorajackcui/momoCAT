import { describe, expect, it } from 'vitest';
import { CATDatabase } from '../../../../../packages/db/src';
import { LocalizationEngine } from './LocalizationEngine';
import type { LocalizationTargetScope, TranslateFileJobOptions } from './types';

const runDynamic = process.env.LOCALIZATION_ENGINE_FILE_DYNAMIC === '1';
const maybeIt = runDynamic ? it : it.skip;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

function optionalPositiveIntegerEnv(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const value = env[name];
  return value ? Number(value) : undefined;
}

function buildTranslateFileJobFromEnv(env: NodeJS.ProcessEnv): TranslateFileJobOptions | undefined {
  if (env.LOCALIZATION_ENGINE_JOB_ENABLED !== '1') {
    return undefined;
  }

  const job: TranslateFileJobOptions = {};
  if (env.LOCALIZATION_ENGINE_CHECKPOINT_PATH) {
    job.checkpointPath = env.LOCALIZATION_ENGINE_CHECKPOINT_PATH;
  }
  if (env.LOCALIZATION_ENGINE_EVENTS_PATH) {
    job.eventsPath = env.LOCALIZATION_ENGINE_EVENTS_PATH;
  }
  if (env.LOCALIZATION_ENGINE_ARTIFACTS_PATH) {
    job.artifactsPath = env.LOCALIZATION_ENGINE_ARTIFACTS_PATH;
  }
  if (env.LOCALIZATION_ENGINE_SNAPSHOT_PATH) {
    job.snapshotPath = env.LOCALIZATION_ENGINE_SNAPSHOT_PATH;
  }
  if (env.LOCALIZATION_ENGINE_RESUME === '1') {
    job.resume = true;
  }
  const maxAttempts = optionalPositiveIntegerEnv(env, 'LOCALIZATION_ENGINE_MAX_ATTEMPTS');
  if (maxAttempts !== undefined) {
    job.maxAttempts = maxAttempts;
  }
  const snapshotEveryUnits = optionalPositiveIntegerEnv(
    env,
    'LOCALIZATION_ENGINE_SNAPSHOT_EVERY_UNITS',
  );
  if (snapshotEveryUnits !== undefined) {
    job.snapshotEveryUnits = snapshotEveryUnits;
  }
  const snapshotEverySeconds = optionalPositiveIntegerEnv(
    env,
    'LOCALIZATION_ENGINE_SNAPSHOT_EVERY_SECONDS',
  );
  if (snapshotEverySeconds !== undefined) {
    job.snapshotEverySeconds = snapshotEverySeconds;
  }
  if (env.LOCALIZATION_ENGINE_PROGRESS_STDOUT === '1') {
    job.progressStdout = true;
  }

  return job;
}

describe('LocalizationEngine CLI file runner', () => {
  it('builds TranslateFileInput job options from dynamic runner env', () => {
    expect(
      buildTranslateFileJobFromEnv({
        LOCALIZATION_ENGINE_JOB_ENABLED: '1',
        LOCALIZATION_ENGINE_CHECKPOINT_PATH: 'checkpoint.jsonl',
        LOCALIZATION_ENGINE_EVENTS_PATH: 'events.jsonl',
        LOCALIZATION_ENGINE_ARTIFACTS_PATH: 'artifacts.jsonl',
        LOCALIZATION_ENGINE_SNAPSHOT_PATH: 'snapshot.xlsx',
        LOCALIZATION_ENGINE_RESUME: '1',
        LOCALIZATION_ENGINE_MAX_ATTEMPTS: '3',
        LOCALIZATION_ENGINE_SNAPSHOT_EVERY_UNITS: '5',
        LOCALIZATION_ENGINE_SNAPSHOT_EVERY_SECONDS: '7',
        LOCALIZATION_ENGINE_PROGRESS_STDOUT: '1',
      }),
    ).toEqual({
      checkpointPath: 'checkpoint.jsonl',
      eventsPath: 'events.jsonl',
      artifactsPath: 'artifacts.jsonl',
      snapshotPath: 'snapshot.xlsx',
      resume: true,
      maxAttempts: 3,
      snapshotEveryUnits: 5,
      snapshotEverySeconds: 7,
      progressStdout: true,
    });
  });

  it('omits TranslateFileInput job options when dynamic runner env does not enable jobs', () => {
    expect(
      buildTranslateFileJobFromEnv({
        LOCALIZATION_ENGINE_CHECKPOINT_PATH: 'stale.checkpoint.jsonl',
        LOCALIZATION_ENGINE_RESUME: '1',
        LOCALIZATION_ENGINE_PROGRESS_STDOUT: '1',
      }),
    ).toBeUndefined();
  });

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
        options: targetScope ? { targetScope: targetScope as LocalizationTargetScope } : undefined,
        job: buildTranslateFileJobFromEnv(process.env),
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
      expect(result.summary.failed).toBe(0);
    } finally {
      db.close();
    }
  });
});
