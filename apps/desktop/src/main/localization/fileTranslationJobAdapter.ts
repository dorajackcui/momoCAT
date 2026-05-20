import { createHash } from 'crypto';
import { basename, extname, join, parse as parsePath, win32 } from 'path';
import { resolveBatchTargetScope } from '../services/modules/ai/translationTargetScope';
import { CheckpointStore } from './job/CheckpointStore';
import { EventSink } from './job/EventSink';
import { ArtifactStore } from './job/ArtifactStore';
import { computeSourceHash } from './job/sourceHash';
import { OneUnitTaskPlanner } from './job/TaskPlanner';
import {
  TranslationJobRunner,
  type TranslationJobRunResult,
  type TranslationJobRunnerDependencies,
} from './job/TranslationJobRunner';
import type { JobUnit, TranslationJob, TranslationTaskExecutor, UnitResult } from './job/types';
import { parseExternalSpreadsheet, writeTranslatedSpreadsheet } from './modules/FileModule';
import type {
  TranslateFileInput,
  TranslateFileResult,
  TranslateUnitResult,
  TranslateUnitsResult,
} from './types';

export interface FileTranslationJobSidecarPaths {
  checkpointPath: string;
  eventsPath: string;
  artifactsPath: string;
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
}

export async function prepareFileTranslationJob(
  input: TranslateFileInput,
): Promise<PreparedFileTranslationJob> {
  const parsed = await parseExternalSpreadsheet(input);
  const documentId = basename(input.inputPath);
  const resumeFingerprint = computeFileTranslationResumeFingerprint(input);
  const units: JobUnit[] = parsed.artifact.rows
    .filter((row) => row.source.trim())
    .map((row) => ({
      documentId,
      unitId: row.unitId,
      source: row.source,
      target: row.target,
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
      translationOptions: input.options,
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
    maxConcurrency: input.options?.maxConcurrency ?? options.defaultMaxConcurrency,
  };
  const runner = (options.runnerFactory ?? defaultRunnerFactory)({
    checkpointStore: new CheckpointStore(prepared.sidecarPaths.checkpointPath),
    eventSink: new EventSink(prepared.sidecarPaths.eventsPath, {
      stdout: input.job?.progressStdout,
    }),
    artifactStore: new ArtifactStore(prepared.sidecarPaths.artifactsPath),
    taskPlanner: new OneUnitTaskPlanner(),
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
  });
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
    artifactsPath: input.job?.artifactsPath ?? inferred.artifactsPath,
    snapshotPath: input.job?.snapshotPath ?? inferred.snapshotPath,
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
    artifactsPath: `${basePath}.artifacts.jsonl`,
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
  return hashCanonicalPayload([
    ['projectId', String(input.projectId)],
    ['targetScope', resolveBatchTargetScope(input.options?.targetScope)],
    ['mode', input.options?.mode ?? 'standard'],
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

  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
}

function normalizeNumberOption(value: number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

function jobRunResultToTranslateUnitsResult(
  runResult: TranslationJobRunResult,
): TranslateUnitsResult {
  return unitResultsToTranslateUnitsResult(runResult.results);
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
