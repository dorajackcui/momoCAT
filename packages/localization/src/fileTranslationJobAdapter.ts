import { createHash } from 'crypto';
import { basename, extname, join, parse as parsePath, win32 } from 'path';
import { tagPolicyFingerprintValue } from './tagPolicy';
import { normalizeTargetForBaseline, resolveTargetBaseline } from './targetBaseline';
import { CheckpointStore } from './job/CheckpointStore';
import { EventSink } from './job/EventSink';
import { ArtifactStore } from './job/ArtifactStore';
import { computeSourceHash } from './job/sourceHash';
import { WindowModeTaskPlanner, WindowPartialTaskPlanner } from './job/TaskPlanner';
import {
  TranslationJobRunner,
  type TranslationJobRunResult,
  type TranslationJobRunnerDependencies,
} from './job/TranslationJobRunner';
import type { JobUnit, TranslationJob, TranslationTaskExecutor, UnitResult } from './job/types';
import { parseExternalSpreadsheet, writeTranslatedSpreadsheet } from './modules/FileModule';
import type {
  LocalizationRequestMode,
  TranslateFileInput,
  TranslateFileResult,
  TranslateUnitResult,
  TranslateUnitsOptions,
  TranslateUnitsResult,
} from './types';

export interface FileTranslationJobSidecarPaths {
  checkpointPath: string;
  eventsPath: string;
  artifactsPath?: string;
  snapshotPath: string;
}

export interface PreparedFileTranslationJob {
  job: TranslationJob;
  parsed: Awaited<ReturnType<typeof parseExternalSpreadsheet>>;
  sidecarPaths: FileTranslationJobSidecarPaths;
}

export type FileTranslationJobRunnerFactory = (
  dependencies: TranslationJobRunnerDependencies,
) => Pick<TranslationJobRunner, 'run'>;

export interface TranslateSpreadsheetFileJobOptions {
  taskExecutor: TranslationTaskExecutor;
  defaultMaxConcurrency?: number;
  runnerFactory?: FileTranslationJobRunnerFactory;
  runtimeTm?: TranslationJobRunnerDependencies['runtimeTm'];
  auditSink?: TranslationJobRunnerDependencies['auditSink'];
}

export async function prepareFileTranslationJob(
  input: TranslateFileInput,
): Promise<PreparedFileTranslationJob> {
  const parsed = await parseExternalSpreadsheet(input);
  const documentId = basename(input.inputPath);
  const resumeFingerprint = computeFileTranslationResumeFingerprint(input);
  const translationOptions = buildFileTranslationOptions(input.options);
  const units: JobUnit[] = parsed.artifact.rows
    .filter((row) => row.source.trim())
    .map((row) => ({
      documentId,
      unitId: row.unitId,
      source: row.source,
      target: normalizeTargetForBaseline({
        target: row.target,
        targetBaseline: translationOptions.targetBaseline ?? 'use-current-targets',
      }),
      context: row.context,
      rowNumber: row.rowNumber,
      sourceHash: computeSourceHash({
        source: row.source,
        context: row.context,
        resumeFingerprint,
      }),
      metadata: {
        rowIndex: row.rowIndex,
        rowNumber: row.rowNumber,
      },
    }));
  const sidecarPaths = resolveFileTranslationJobSidecarPaths(input);

  return {
    parsed,
    sidecarPaths,
    job: {
      id: input.job?.jobId ?? defaultFileTranslationJobId(input),
      projectId: input.projectId,
      units,
      translationOptions,
      options: {
        resume: input.job?.resume,
        maxAttempts: input.job?.maxAttempts,
        maxConcurrency: input.options?.maxConcurrency,
        snapshotEveryUnits: input.job?.snapshotEveryUnits,
        snapshotEverySeconds: input.job?.snapshotEverySeconds,
      },
    },
  };
}

export async function translateSpreadsheetFileJob(
  input: TranslateFileInput,
  options: TranslateSpreadsheetFileJobOptions,
): Promise<TranslateFileResult> {
  const prepared = await prepareFileTranslationJob(input);
  prepared.job.options = {
    ...prepared.job.options,
    maxConcurrency: 1,
  };
  const runnerDependencies: TranslationJobRunnerDependencies = {
    checkpointStore: new CheckpointStore(prepared.sidecarPaths.checkpointPath),
    eventSink: new EventSink(prepared.sidecarPaths.eventsPath, {
      stdout: input.job?.progressStdout,
    }),
    taskPlanner:
      prepared.job.translationOptions?.requestMode === 'window-partial'
        ? new WindowPartialTaskPlanner({ batchSize: prepared.job.translationOptions.batchSize })
        : new WindowModeTaskPlanner({ batchSize: prepared.job.translationOptions?.batchSize }),
    taskExecutor: options.taskExecutor,
    writeSnapshot: async (results) => {
      await writeTranslatedSpreadsheet(
        prepared.parsed,
        unitResultsToTranslateUnitsResult(results),
        prepared.sidecarPaths.snapshotPath,
        'xlsx',
      );
    },
    writeFinal: async (results) => {
      await writeTranslatedSpreadsheet(
        prepared.parsed,
        unitResultsToTranslateUnitsResult(results),
        input.outputPath,
        input.format,
      );
    },
    runtimeTm: options.runtimeTm,
    auditSink: options.auditSink,
  };

  if (prepared.sidecarPaths.artifactsPath) {
    runnerDependencies.artifactStore = new ArtifactStore(prepared.sidecarPaths.artifactsPath);
  }

  const runner = (options.runnerFactory ?? defaultRunnerFactory)(runnerDependencies);
  const runResult = await runner.run(prepared.job);
  const translation = jobRunResultToTranslateUnitsResult(runResult);

  return {
    ...translation,
    inputPath: input.inputPath,
    outputPath: input.outputPath,
  };
}

export function resolveFileTranslationJobSidecarPaths(
  input: TranslateFileInput,
): FileTranslationJobSidecarPaths {
  const inferred = inferFileTranslationJobSidecarPaths(input.outputPath);

  return {
    checkpointPath: input.job?.checkpointPath ?? inferred.checkpointPath,
    eventsPath: input.job?.eventsPath ?? inferred.eventsPath,
    snapshotPath: input.job?.snapshotPath ?? inferred.snapshotPath,
    ...(input.job?.artifactsPath ? { artifactsPath: input.job.artifactsPath } : {}),
  };
}

export function inferFileTranslationJobSidecarPaths(
  outputPath: string,
): FileTranslationJobSidecarPaths {
  const pathModule = isWindowsPath(outputPath) ? win32 : { parse: parsePath, join };
  const parsed = pathModule.parse(outputPath);
  const basePath = pathModule.join(parsed.dir, parsed.name);

  return {
    checkpointPath: `${basePath}.checkpoint.jsonl`,
    eventsPath: `${basePath}.events.jsonl`,
    snapshotPath: `${basePath}.snapshot.xlsx`,
  };
}

function defaultRunnerFactory(
  dependencies: TranslationJobRunnerDependencies,
): Pick<TranslationJobRunner, 'run'> {
  return new TranslationJobRunner(dependencies);
}

function defaultFileTranslationJobId(input: TranslateFileInput): string {
  const outputName = basename(input.outputPath, extname(input.outputPath));
  return `file:${basename(input.inputPath)}:${outputName}:${computeFileTranslationResumeFingerprint(
    input,
  )}`;
}

function computeFileTranslationResumeFingerprint(input: TranslateFileInput): string {
  const targetBaseline = resolveTargetBaseline(input.options);

  return hashCanonicalPayload([
    ['projectId', String(input.projectId)],
    ['targetBaseline', targetBaseline],
    ['mode', input.options?.mode ?? 'standard'],
    ['requestMode', resolveFileTranslationRequestMode(input.options?.requestMode)],
    ['tagPolicy', tagPolicyFingerprintValue(input.options?.tagPolicy)],
    ['providerOverride', input.options?.providerOverride],
    ['mt.providerId', input.options?.mt?.providerId],
    ['mt.model', input.options?.mt?.model],
    ['mt.reasoningEffort', input.options?.mt?.reasoningEffort],
    ['mt.systemPrompt', input.options?.mt?.systemPrompt],
    ['mt.temperature', normalizeNumberOption(input.options?.mt?.temperature)],
    ['resolved', input.job?.resumeFingerprint],
  ]);
}

function hashCanonicalPayload(entries: Array<[string, string | undefined]>): string {
  const payload = entries.filter((entry): entry is [string, string] => entry[1] !== undefined);

  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
}

function normalizeNumberOption(value: number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

function resolveFileTranslationRequestMode(
  requestMode: LocalizationRequestMode | undefined,
): LocalizationRequestMode {
  return requestMode ?? 'window-partial';
}

function buildFileTranslationOptions(
  options: TranslateUnitsOptions | undefined,
): TranslateUnitsOptions {
  const { targetScope: _legacyTargetScope, ...restOptions } = options ?? {};

  return {
    ...restOptions,
    targetBaseline: resolveTargetBaseline(options),
    requestMode: resolveFileTranslationRequestMode(options?.requestMode),
  };
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

function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.includes('\\');
}
