import { CATDatabase } from '@cat/db';
import type { TagPolicy } from '@cat/core/tag';
import { LocalizationInspector, type InspectFileInput } from '../LocalizationInspector';
import type { LocalizationTargetBaseline } from '../types';

export interface InspectLocalizationCommandConfig {
  dbPath: string;
  projectId: number;
  inputPath: string;
  outputPath: string;
  jsonOutputPath?: string;
  unitLimit?: number;
  maxCellChars?: number;
  requestMode?: 'window' | 'window-partial';
  targetBaseline?: LocalizationTargetBaseline;
  tagPolicy?: TagPolicy;
}

export async function runInspectLocalizationCommand(config: InspectLocalizationCommandConfig) {
  const db = new CATDatabase(config.dbPath);
  try {
    const inspector = new LocalizationInspector(db, { dbPath: config.dbPath });
    const input: InspectFileInput = {
      projectId: config.projectId,
      inputPath: config.inputPath,
      outputPath: config.outputPath,
      jsonOutputPath: config.jsonOutputPath,
      unitLimit: config.unitLimit,
      maxCellChars: config.maxCellChars,
      options: {
        requestMode: config.requestMode ?? 'window-partial',
        targetBaseline: config.targetBaseline ?? 'use-current-targets',
        tagPolicy: config.tagPolicy,
      },
    };

    return await inspector.inspectFile(input);
  } finally {
    db.close();
  }
}
