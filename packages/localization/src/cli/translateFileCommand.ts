import { CATDatabase } from '@cat/db';
import type { TagPolicy } from '@cat/core/tag';
import { LocalizationEngine } from '../LocalizationEngine';
import type { TranslateFileInput } from '../types';

export interface TranslateFileCommandConfig {
  dbPath: string;
  projectId: number;
  inputPath: string;
  outputPath: string;
  targetScope?: 'blank-only' | 'overwrite-non-confirmed';
  requestMode?: 'window' | 'window-partial';
  tagPolicy?: TagPolicy;
  checkpointPath?: string;
  eventsPath?: string;
  artifactsPath?: string;
  resume?: boolean;
  maxAttempts?: number;
  batchSize?: number;
  snapshotPath?: string;
  snapshotEveryUnits?: number;
  snapshotEverySeconds?: number;
  progressStdout?: boolean;
}

export async function runTranslateFileCommand(config: TranslateFileCommandConfig) {
  const db = new CATDatabase(config.dbPath);
  try {
    const engine = new LocalizationEngine(db, { dbPath: config.dbPath });
    const input: TranslateFileInput = {
      projectId: config.projectId,
      inputPath: config.inputPath,
      outputPath: config.outputPath,
      options: {
        targetScope: config.targetScope,
        requestMode: config.requestMode,
        tagPolicy: config.tagPolicy,
        batchSize: config.batchSize,
      },
      job: {
        checkpointPath: config.checkpointPath,
        eventsPath: config.eventsPath,
        artifactsPath: config.artifactsPath,
        resume: config.resume,
        maxAttempts: config.maxAttempts,
        snapshotPath: config.snapshotPath,
        snapshotEveryUnits: config.snapshotEveryUnits,
        snapshotEverySeconds: config.snapshotEverySeconds,
        progressStdout: config.progressStdout,
      },
    };

    return await engine.translateFile(input);
  } finally {
    db.close();
  }
}
