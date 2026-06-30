import { CATDatabase } from '@cat/db';
import type { TagPolicy } from '@cat/core/tag';
import {
  LocalizationReferenceExporter,
  type ExportReferencesForMtInput,
} from '../LocalizationReferenceExporter';

export interface ExportReferencesForMtCommandConfig {
  dbPath: string;
  projectId: number;
  inputPath: string;
  outputPath: string;
  columns?: ExportReferencesForMtInput['columns'];
  unitLimit?: number;
  maxCellChars?: number;
  maxConcurrency?: number;
  tagPolicy?: TagPolicy;
}

export async function runExportReferencesForMtCommand(
  config: ExportReferencesForMtCommandConfig,
) {
  const db = new CATDatabase(config.dbPath, { fileMustExist: true });
  try {
    const exporter = new LocalizationReferenceExporter(db, {
      maxConcurrency: config.maxConcurrency,
    });
    return await exporter.exportReferencesForMtFile({
      projectId: config.projectId,
      inputPath: config.inputPath,
      outputPath: config.outputPath,
      columns: config.columns,
      unitLimit: config.unitLimit,
      maxCellChars: config.maxCellChars,
      maxConcurrency: config.maxConcurrency,
      options: {
        tagPolicy: config.tagPolicy,
      },
    });
  } finally {
    db.close();
  }
}
