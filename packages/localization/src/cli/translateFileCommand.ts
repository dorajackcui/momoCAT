import { CATDatabase } from '@cat/db';
import type { TagPolicy } from '@cat/core/tag';
import { LocalizationEngine } from '../LocalizationEngine';
import type { LocalizationTargetBaseline, TranslateFileInput } from '../types';
import {
  createCommandAIRuntimeConfigProvider,
  loadProxyEnvFromFile,
} from './runtimeEnvironment';

export interface TranslateFileCommandConfig {
  dbPath: string;
  projectId: number;
  inputPath: string;
  outputPath: string;
  contextHeader?: string;
  contextCol?: number;
  targetBaseline?: LocalizationTargetBaseline;
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
  aiRuntimeConfigPath?: string;
  proxyEnvPath?: string;
}

export async function runTranslateFileCommand(config: TranslateFileCommandConfig) {
  loadProxyEnvFromFile(config.proxyEnvPath);
  const aiRuntimeConfigProvider = await createCommandAIRuntimeConfigProvider({
    aiRuntimeConfigPath: config.aiRuntimeConfigPath,
  });

  const db = new CATDatabase(config.dbPath, { fileMustExist: true });
  try {
    const engine = new LocalizationEngine(db, {
      dbPath: config.dbPath,
      aiRuntimeConfigProvider,
    });
    const input: TranslateFileInput = {
      projectId: config.projectId,
      inputPath: config.inputPath,
      outputPath: config.outputPath,
      columns:
        config.contextHeader !== undefined || config.contextCol !== undefined
          ? {
              contextHeader: config.contextHeader,
              contextCol: config.contextCol,
            }
          : undefined,
      options: {
        targetBaseline: config.targetBaseline ?? 'use-current-targets',
        requestMode: config.requestMode ?? 'window-partial',
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
