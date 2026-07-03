import type { ExportReferencesForMtInput, ExportReferencesForMtResult } from '@cat/localization';

export type ReferenceExportJobInput = Omit<ExportReferencesForMtInput, 'onProgress'>;

export type ReferenceExportJobResult = Pick<ExportReferencesForMtResult, 'outputPath' | 'summary'>;

export interface ReferenceExportWorkerInput {
  dbPath: string;
  exportInput: ReferenceExportJobInput;
}

export type ReferenceExportWorkerMessage =
  | { type: 'progress'; current: number; total: number }
  | { type: 'done'; result: ReferenceExportJobResult }
  | { type: 'error'; error: string };
