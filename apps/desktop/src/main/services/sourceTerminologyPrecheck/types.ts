import type {
  SourceTerminologyPrecheckFileInput,
  SourceTerminologyPrecheckFileResult,
} from '@cat/localization';

export type SourceTerminologyPrecheckJobInput = Omit<
  SourceTerminologyPrecheckFileInput,
  'onProgress'
>;
export type SourceTerminologyPrecheckJobResult = Pick<
  SourceTerminologyPrecheckFileResult,
  'outputPath' | 'summary'
>;

export interface SourceTerminologyPrecheckWorkerInput {
  dbPath: string;
  precheckInput: SourceTerminologyPrecheckJobInput;
}

export type SourceTerminologyPrecheckWorkerMessage =
  | { type: 'progress'; current: number; total: number }
  | { type: 'done'; result: SourceTerminologyPrecheckJobResult }
  | { type: 'error'; error: string };
