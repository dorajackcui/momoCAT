import { basename, extname, join, parse as parsePath } from 'path';
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
  runnerFactory?: FileTranslationJobRunnerFactory;
}

export async function prepareFileTranslationJob(
  input: TranslateFileInput,
): Promise<PreparedFileTranslationJob> {
  const parsed = await parseExternalSpreadsheet(input);
  const documentId = basename(input.inputPath);
  const units: JobUnit[] = parsed.artifact.rows
    .filter((row) => row.source.trim())
    .map((row) => ({
      documentId,
      unitId: row.unitId,
      source: row.source,
      target: row.target,
      context: row.context,
      rowNumber: row.rowNumber,
      sourceHash: computeSourceHash({ source: row.source, context: row.context }),
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
  const parsed = parsePath(outputPath);
  const basePath = join(parsed.dir, parsed.name);

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
  return `file:${basename(input.inputPath)}:${outputName}`;
}

function jobRunResultToTranslateUnitsResult(
  runResult: TranslationJobRunResult,
): TranslateUnitsResult {
  return unitResultsToTranslateUnitsResult(runResult.results);
}

function unitResultsToTranslateUnitsResult(results: UnitResult[]): TranslateUnitsResult {
  const translatedResults = results.map(unitResultToTranslateUnitResult);

  return {
    summary: {
      total: translatedResults.length,
      translated: translatedResults.filter((result) => result.status === 'translated').length,
      skipped: translatedResults.filter((result) => result.status === 'skipped').length,
      failed: translatedResults.filter((result) => result.status === 'failed').length,
    },
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
      metadata: result.metadata,
    };
  }

  return {
    id: result.unitId,
    source: result.source,
    target: result.target ?? '',
    status: result.status === 'translated' ? 'translated' : 'skipped',
    metadata: result.metadata,
  };
}
