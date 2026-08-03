import type {
  ObservableCancellationToken,
  SourceTerminologyPrecheckFileInput,
  SourceTerminologyPrecheckFileResult,
} from '@cat/localization';

export type SourceTerminologyPrecheckOperationInput = Omit<
  SourceTerminologyPrecheckFileInput,
  'cancellationToken'
> & {
  cancellationToken?: ObservableCancellationToken;
};
export type SourceTerminologyPrecheckJobInput = Omit<
  SourceTerminologyPrecheckOperationInput,
  'onProgress' | 'cancellationToken'
>;
export type SourceTerminologyPrecheckJobResult = Pick<
  SourceTerminologyPrecheckFileResult,
  'outputPath' | 'summary'
>;
export type SourceTerminologyPrecheckRunner = (
  input: SourceTerminologyPrecheckOperationInput,
) => Promise<SourceTerminologyPrecheckJobResult>;

export interface SourceTerminologyPrecheckWorkerInput {
  dbPath: string;
  precheckInput: SourceTerminologyPrecheckJobInput;
}

export type SourceTerminologyPrecheckWorkerMessage =
  | { type: 'progress'; current: number; total: number }
  | { type: 'done'; result: SourceTerminologyPrecheckJobResult }
  | { type: 'error'; error: string };
