import { createHash } from 'crypto';
import { tagPolicyFingerprintValue } from './tagPolicy';
import { normalizeTargetForBaseline, resolveTargetBaseline } from './targetBaseline';
import { computeSourceHash } from './job/sourceHash';
import { WindowModeTaskPlanner, WindowPartialTaskPlanner } from './job/TaskPlanner';
import {
  TranslationJobRunner,
  type TranslationJobRunResult,
  type TranslationJobRunnerDependencies,
} from './job/TranslationJobRunner';
import type {
  CheckpointRecord,
  JobUnit,
  ProgressEventRecord,
  TranslationJob,
  TranslationTaskExecutor,
  UnitResult,
} from './job/types';
import type {
  LocalizationRequestMode,
  TranslateUnitResult,
  TranslateUnitsOptions,
  TranslateUnitsResult,
} from './types';

export interface ProjectSegmentTranslationUnit {
  id: string;
  source: string;
  target?: string;
  context?: string;
  rowNumber?: number;
  locked?: boolean;
  metadata?: Record<string, unknown>;
}

export interface TranslateProjectSegmentsJobInput {
  projectId: number;
  documentId: string;
  units: ProjectSegmentTranslationUnit[];
  options?: TranslateUnitsOptions;
  job?: {
    jobId?: string;
    maxAttempts?: number;
  };
}

export interface PreparedProjectSegmentTranslationJob {
  job: TranslationJob;
}

export type ProjectSegmentTranslationJobRunnerFactory = (
  dependencies: TranslationJobRunnerDependencies,
) => Pick<TranslationJobRunner, 'run'>;

export interface TranslateProjectSegmentsJobOptions {
  taskExecutor: TranslationTaskExecutor;
  runnerFactory?: ProjectSegmentTranslationJobRunnerFactory;
  runtimeTm?: TranslationJobRunnerDependencies['runtimeTm'];
  applyResult?: TranslationJobRunnerDependencies['applyResult'];
  onProgress?: (data: { current: number; total: number; message?: string }) => void;
}

export function prepareProjectSegmentTranslationJob(
  input: TranslateProjectSegmentsJobInput,
): PreparedProjectSegmentTranslationJob {
  const requestMode: LocalizationRequestMode = input.options?.requestMode ?? 'window-partial';
  const targetBaseline = resolveTargetBaseline(input.options);
  const { targetScope: _legacyTargetScope, ...restOptions } = input.options ?? {};
  const translationOptions: TranslateUnitsOptions = {
    ...restOptions,
    targetBaseline,
    requestMode,
  };
  const resumeFingerprint = computeProjectSegmentResumeFingerprint(input, requestMode);
  const units: JobUnit[] = input.units.map((unit) => ({
    documentId: input.documentId,
    unitId: unit.id,
    source: unit.source,
    target: normalizeTargetForBaseline({
      target: unit.target,
      locked: unit.locked,
      targetBaseline,
    }),
    context: unit.context,
    rowNumber: unit.rowNumber,
    locked: unit.locked,
    sourceHash: computeSourceHash({
      source: unit.source,
      context: unit.context,
      resumeFingerprint,
    }),
    metadata: unit.metadata,
  }));

  return {
    job: {
      id: input.job?.jobId ?? defaultProjectSegmentJobId(input, resumeFingerprint),
      projectId: input.projectId,
      units,
      translationOptions,
      options: {
        maxAttempts: input.job?.maxAttempts,
        maxConcurrency: 1,
      },
    },
  };
}

export async function translateProjectSegmentsJob(
  input: TranslateProjectSegmentsJobInput,
  options: TranslateProjectSegmentsJobOptions,
): Promise<TranslateUnitsResult> {
  const prepared = prepareProjectSegmentTranslationJob(input);
  const runner = (options.runnerFactory ?? defaultRunnerFactory)({
    checkpointStore: createMemoryCheckpointStore(),
    eventSink: createMemoryEventSink(options.onProgress),
    taskPlanner:
      prepared.job.translationOptions?.requestMode === 'window'
        ? new WindowModeTaskPlanner({ batchSize: prepared.job.translationOptions.batchSize })
        : new WindowPartialTaskPlanner({ batchSize: prepared.job.translationOptions?.batchSize }),
    taskExecutor: options.taskExecutor,
    runtimeTm: options.runtimeTm,
    applyResult: options.applyResult,
  });

  return jobRunResultToTranslateUnitsResult(await runner.run(prepared.job));
}

function defaultRunnerFactory(
  dependencies: TranslationJobRunnerDependencies,
): Pick<TranslationJobRunner, 'run'> {
  return new TranslationJobRunner(dependencies);
}

function createMemoryCheckpointStore(): TranslationJobRunnerDependencies['checkpointStore'] {
  return {
    async load() {
      return {
        toReusedResult: () => undefined,
        toRuntimeSeedResults: () => [],
      };
    },
    async append(_record: CheckpointRecord) {
      return undefined;
    },
  };
}

function createMemoryEventSink(
  onProgress: TranslateProjectSegmentsJobOptions['onProgress'],
): TranslationJobRunnerDependencies['eventSink'] {
  return {
    async append(record: ProgressEventRecord) {
      if (
        (record.event === 'unit_done' || record.event === 'unit_error') &&
        typeof record.done === 'number' &&
        typeof record.total === 'number'
      ) {
        onProgress?.({
          current: record.done,
          total: record.total,
        });
      }
    },
  };
}

function defaultProjectSegmentJobId(
  input: TranslateProjectSegmentsJobInput,
  resumeFingerprint: string,
): string {
  return `project-segments:${input.projectId}:${input.documentId}:${resumeFingerprint}`;
}

function computeProjectSegmentResumeFingerprint(
  input: TranslateProjectSegmentsJobInput,
  requestMode: LocalizationRequestMode,
): string {
  return hashCanonicalPayload([
    ['projectId', String(input.projectId)],
    ['documentId', input.documentId],
    ['targetBaseline', resolveTargetBaseline(input.options)],
    ['mode', input.options?.mode ?? 'standard'],
    ['requestMode', requestMode],
    ['tagPolicy', tagPolicyFingerprintValue(input.options?.tagPolicy)],
    ['providerOverride', input.options?.providerOverride],
    ['mt.providerId', input.options?.mt?.providerId],
    ['mt.model', input.options?.mt?.model],
    ['mt.reasoningEffort', input.options?.mt?.reasoningEffort],
    ['mt.systemPrompt', input.options?.mt?.systemPrompt],
    ['mt.temperature', normalizeNumberOption(input.options?.mt?.temperature)],
  ]);
}

function hashCanonicalPayload(entries: Array<[string, string | undefined]>): string {
  const payload = entries.filter((entry): entry is [string, string] => entry[1] !== undefined);

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function normalizeNumberOption(value: number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

function jobRunResultToTranslateUnitsResult(
  runResult: TranslationJobRunResult,
): TranslateUnitsResult {
  return {
    ...unitResultsToTranslateUnitsResult(runResult.results),
    ...(runResult.runtimeTm ? { runtimeTm: runResult.runtimeTm } : {}),
  };
}

function unitResultsToTranslateUnitsResult(results: UnitResult[]): TranslateUnitsResult {
  const translatedResults = results.map(unitResultToTranslateUnitResult);
  const reused = translatedResults.filter((result) => result.status === 'reused').length;
  const summary: TranslateUnitsResult['summary'] = {
    total: translatedResults.length,
    translated: translatedResults.filter((result) => result.status === 'translated').length,
    skipped: translatedResults.filter((result) => result.status === 'skipped').length,
    failed: translatedResults.filter((result) => result.status === 'failed').length,
  };

  if (reused > 0) {
    summary.reused = reused;
  }

  return {
    summary,
    results: translatedResults,
  };
}

function unitResultToTranslateUnitResult(result: UnitResult): TranslateUnitResult {
  if (result.status === 'failed') {
    return {
      id: result.unitId,
      source: result.source,
      target: result.target,
      status: 'failed',
      error: result.error ?? 'Translation failed',
      references: result.references,
      metadata: result.metadata,
    };
  }

  return {
    id: result.unitId,
    source: result.source,
    target: result.target ?? '',
    status:
      result.status === 'translated' || result.status === 'reused'
        ? result.status
        : 'skipped',
    references: result.references,
    metadata: result.metadata,
  };
}
