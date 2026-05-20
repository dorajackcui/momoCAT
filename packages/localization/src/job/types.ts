import type { PromptArtifact, TBArtifact, TMArtifact } from '../artifacts';
import type { TranslateUnitReferences, TranslateUnitsOptions } from '../types';

export type UnitResultStatus = 'translated' | 'skipped' | 'reused' | 'failed';

export type CheckpointStatus = Exclude<UnitResultStatus, 'reused'>;

export type ProgressEventName =
  | 'job_start'
  | 'unit_start'
  | 'unit_done'
  | 'unit_error'
  | 'snapshot'
  | 'job_done';

export interface JobUnit {
  documentId: string;
  unitId: string;
  source: string;
  target?: string;
  context?: string;
  rowNumber?: number;
  sourceHash: string;
  metadata?: Record<string, unknown>;
}

export interface TranslationTask {
  taskId: string;
  units: JobUnit[];
}

export interface JobOptions {
  resume?: boolean;
  maxAttempts?: number;
  maxConcurrency?: number;
  snapshotEveryUnits?: number;
  snapshotEverySeconds?: number;
}

export interface TranslationJob {
  id: string;
  projectId: number;
  units: JobUnit[];
  translationOptions?: TranslateUnitsOptions;
  options?: JobOptions;
}

export interface UnitResult {
  jobId: string;
  documentId: string;
  unitId: string;
  sourceHash: string;
  status: UnitResultStatus;
  source: string;
  target?: string;
  error?: string;
  references?: TranslateUnitReferences;
  attempts?: number;
  metadata?: Record<string, unknown>;
}

export interface CheckpointRecord {
  job: string;
  doc: string;
  unit: string;
  hash: string;
  status: CheckpointStatus;
  target?: string;
  error?: string;
  attempts: number;
  at: string;
}

export interface ProgressEventRecord {
  job: string;
  event: ProgressEventName;
  doc?: string;
  unit?: string;
  task?: string;
  status?: UnitResultStatus;
  done?: number;
  total?: number;
  error?: string;
  at: string;
}

export interface ArtifactRecord {
  job: string;
  task: string;
  doc: string;
  unit: string;
  tm?: TMArtifact;
  tb?: TBArtifact;
  prompt?: PromptArtifact;
  result?: UnitResult;
  error?: string;
  metadata?: Record<string, unknown>;
  at: string;
}

export interface TaskExecutionContext {
  job: TranslationJob;
  attempt: number;
  captureArtifacts?: boolean;
}

export interface TaskExecutionResult {
  results: UnitResult[];
  artifacts?: ArtifactRecord[];
}

export type TranslationTaskExecutor = (
  task: TranslationTask,
  context: TaskExecutionContext,
) => Promise<TaskExecutionResult>;
