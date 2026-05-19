import { runBounded } from '../RequestScheduler';
import { SnapshotThrottle } from './SnapshotThrottle';
import type { TaskPlanner } from './TaskPlanner';
import type {
  ArtifactRecord,
  CheckpointRecord,
  CheckpointStatus,
  JobUnit,
  ProgressEventRecord,
  TaskExecutionResult,
  TranslationJob,
  TranslationTask,
  TranslationTaskExecutor,
  UnitResult,
  UnitResultStatus,
} from './types';

export interface TranslationJobRunnerCallbackContext {
  job: TranslationJob;
  resultMap: ReadonlyMap<string, UnitResult>;
}

export interface TranslationJobSummary {
  total: number;
  translated: number;
  skipped: number;
  reused: number;
  failed: number;
}

export interface TranslationJobRunResult {
  jobId: string;
  summary: TranslationJobSummary;
  results: UnitResult[];
}

export interface TranslationJobRunnerDependencies {
  checkpointStore: {
    load(jobId: string): Promise<{
      toReusedResult(unit: JobUnit): UnitResult | undefined;
    }>;
    append(record: CheckpointRecord): Promise<void>;
  };
  eventSink: {
    append(record: ProgressEventRecord): Promise<void>;
  };
  artifactStore: {
    append(record: ArtifactRecord): Promise<void>;
  };
  taskPlanner: TaskPlanner;
  taskExecutor: TranslationTaskExecutor;
  clock?: () => Date;
  writeSnapshot?: (
    results: UnitResult[],
    context: TranslationJobRunnerCallbackContext,
  ) => Promise<void>;
  writeFinal?: (results: UnitResult[], context: TranslationJobRunnerCallbackContext) => Promise<void>;
}

export class TranslationJobRunner {
  private readonly checkpointStore: TranslationJobRunnerDependencies['checkpointStore'];
  private readonly eventSink: TranslationJobRunnerDependencies['eventSink'];
  private readonly artifactStore: TranslationJobRunnerDependencies['artifactStore'];
  private readonly taskPlanner: TaskPlanner;
  private readonly taskExecutor: TranslationTaskExecutor;
  private readonly clock: () => Date;
  private readonly writeSnapshot?: TranslationJobRunnerDependencies['writeSnapshot'];
  private readonly writeFinal?: TranslationJobRunnerDependencies['writeFinal'];

  constructor(dependencies: TranslationJobRunnerDependencies) {
    this.checkpointStore = dependencies.checkpointStore;
    this.eventSink = dependencies.eventSink;
    this.artifactStore = dependencies.artifactStore;
    this.taskPlanner = dependencies.taskPlanner;
    this.taskExecutor = dependencies.taskExecutor;
    this.clock = dependencies.clock ?? (() => new Date());
    this.writeSnapshot = dependencies.writeSnapshot;
    this.writeFinal = dependencies.writeFinal;
  }

  async run(job: TranslationJob): Promise<TranslationJobRunResult> {
    const total = job.units.length;
    const resultMap = new Map<string, UnitResult>();

    await this.emit({
      job: job.id,
      event: 'job_start',
      done: 0,
      total,
    });

    const checkpointIndex = await this.checkpointStore.load(job.id);

    if (job.options?.resume === true) {
      for (const unit of job.units) {
        const reusedResult = checkpointIndex.toReusedResult(unit);

        if (!reusedResult) {
          continue;
        }

        resultMap.set(unitKey(unit), reusedResult);
        await this.emitUnitEvent(job, unit, 'unit_done', reusedResult.status, resultMap.size);
      }
    }

    const pendingUnits = job.units.filter((unit) => !resultMap.has(unitKey(unit)));
    const tasks = this.taskPlanner.plan(pendingUnits);
    const throttle = new SnapshotThrottle({
      snapshotEveryUnits: job.options?.snapshotEveryUnits,
      snapshotEverySeconds: job.options?.snapshotEverySeconds,
      now: () => this.clock().getTime(),
    });
    const maxAttempts = normalizeMaxAttempts(job.options?.maxAttempts);
    let persistenceQueue = Promise.resolve();
    const enqueuePersistence = (work: () => Promise<void>): Promise<void> => {
      const queuedWork = persistenceQueue.then(work, work);
      persistenceQueue = queuedWork.then(
        () => undefined,
        () => undefined,
      );
      return queuedWork;
    };

    const scheduledResults = await runBounded(
      tasks,
      async (task) => {
        const taskResult = await this.executeTaskWithAttempts(job, task, maxAttempts);
        await enqueuePersistence(() =>
          this.persistTaskResult(job, task, taskResult, resultMap, throttle),
        );
      },
      { maxConcurrency: job.options?.maxConcurrency },
    );

    const rejected = scheduledResults.find((result) => result.status === 'rejected');

    if (rejected?.status === 'rejected') {
      throw rejected.reason;
    }

    const orderedResults = orderedResultsFor(job.units, resultMap);
    const callbackContext = { job, resultMap };

    if (this.writeFinal) {
      await this.writeFinal(orderedResults, callbackContext);
    }

    const summary = summarizeResults(total, orderedResults);

    await this.emit({
      job: job.id,
      event: 'job_done',
      done: orderedResults.length,
      total,
    });

    return {
      jobId: job.id,
      summary,
      results: orderedResults,
    };
  }

  private async executeTaskWithAttempts(
    job: TranslationJob,
    task: TranslationTask,
    maxAttempts: number,
  ): Promise<TaskExecutionResult> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await this.taskExecutor(task, { job, attempt });

        return {
          results: normalizeTaskResults(job, task, result.results, attempt),
          artifacts: result.artifacts,
        };
      } catch (error) {
        lastError = error;
      }
    }

    return {
      results: task.units.map((unit) =>
        makeFailedResult(job, unit, errorMessage(lastError), maxAttempts),
      ),
      artifacts: task.units.map((unit) =>
        makeFailedArtifact(job, task, unit, errorMessage(lastError), maxAttempts, this.isoNow()),
      ),
    };
  }

  private async persistTaskResult(
    job: TranslationJob,
    task: TranslationTask,
    taskResult: TaskExecutionResult,
    resultMap: Map<string, UnitResult>,
    throttle: SnapshotThrottle,
  ): Promise<void> {
    const artifactsByUnit = new Map<string, ArtifactRecord[]>();

    for (const artifact of taskResult.artifacts ?? []) {
      const key = unitKeyFromParts(artifact.doc, artifact.unit);
      const artifacts = artifactsByUnit.get(key) ?? [];
      artifacts.push(artifact);
      artifactsByUnit.set(key, artifacts);
    }

    for (const result of taskResult.results) {
      for (const artifact of artifactsByUnit.get(unitKeyFromParts(result.documentId, result.unitId)) ?? []) {
        await this.artifactStore.append(artifact);
      }

      const checkpoint = resultToCheckpoint(result, this.isoNow());

      if (checkpoint) {
        await this.checkpointStore.append(checkpoint);
      }
      resultMap.set(unitKeyFromParts(result.documentId, result.unitId), result);

      const eventName = result.status === 'failed' ? 'unit_error' : 'unit_done';
      const unit = task.units.find(
        (candidate) =>
          candidate.documentId === result.documentId && candidate.unitId === result.unitId,
      );

      await this.emitUnitEvent(job, unit ?? result, eventName, result.status, resultMap.size, result.error);
      await this.maybeWriteSnapshot(job, resultMap, throttle);
    }
  }

  private async maybeWriteSnapshot(
    job: TranslationJob,
    resultMap: Map<string, UnitResult>,
    throttle: SnapshotThrottle,
  ): Promise<void> {
    if (!this.writeSnapshot || !throttle.shouldSnapshot(resultMap.size)) {
      return;
    }

    await this.writeSnapshot(orderedResultsFor(job.units, resultMap), { job, resultMap });
    throttle.markSnapshotWritten(resultMap.size);

    await this.emit({
      job: job.id,
      event: 'snapshot',
      done: resultMap.size,
      total: job.units.length,
    });
  }

  private async emitUnitEvent(
    job: TranslationJob,
    unit: Pick<JobUnit | UnitResult, 'documentId' | 'unitId'>,
    event: 'unit_done' | 'unit_error',
    status: UnitResultStatus,
    done: number,
    error?: string,
  ): Promise<void> {
    await this.emit({
      job: job.id,
      event,
      doc: unit.documentId,
      unit: unit.unitId,
      status,
      done,
      total: job.units.length,
      error,
    });
  }

  private async emit(record: Omit<ProgressEventRecord, 'at'>): Promise<void> {
    await this.eventSink.append({
      ...record,
      at: this.isoNow(),
    });
  }

  private isoNow(): string {
    return this.clock().toISOString();
  }
}

function normalizeTaskResults(
  job: TranslationJob,
  task: TranslationTask,
  results: UnitResult[],
  attempt: number,
): UnitResult[] {
  return task.units.map((unit, index) => {
    const result = results[index];

    if (!result) {
      return makeFailedResult(job, unit, 'Task executor did not return a result for this unit', attempt);
    }

    return {
      jobId: job.id,
      documentId: unit.documentId,
      unitId: unit.unitId,
      sourceHash: unit.sourceHash,
      status: result.status,
      source: unit.source,
      target: result.target,
      error: result.error,
      attempts: result.attempts ?? attempt,
      metadata: unit.metadata,
    };
  });
}

function makeFailedResult(
  job: TranslationJob,
  unit: JobUnit,
  message: string,
  attempts: number,
): UnitResult {
  return {
    jobId: job.id,
    documentId: unit.documentId,
    unitId: unit.unitId,
    sourceHash: unit.sourceHash,
    status: 'failed',
    source: unit.source,
    error: message,
    attempts,
    metadata: unit.metadata,
  };
}

function makeFailedArtifact(
  job: TranslationJob,
  task: TranslationTask,
  unit: JobUnit,
  error: string,
  attempts: number,
  at: string,
): ArtifactRecord {
  return {
    job: job.id,
    task: task.taskId,
    doc: unit.documentId,
    unit: unit.unitId,
    error,
    result: makeFailedResult(job, unit, error, attempts),
    at,
  };
}

function resultToCheckpoint(result: UnitResult, at: string): CheckpointRecord | undefined {
  if (!isCheckpointStatus(result.status)) {
    return undefined;
  }

  return {
    job: result.jobId,
    doc: result.documentId,
    unit: result.unitId,
    hash: result.sourceHash,
    status: result.status,
    target: result.target,
    error: result.error,
    attempts: result.attempts ?? 1,
    at,
  };
}

function isCheckpointStatus(status: UnitResultStatus): status is CheckpointStatus {
  return status === 'translated' || status === 'skipped' || status === 'failed';
}

function orderedResultsFor(units: JobUnit[], resultMap: ReadonlyMap<string, UnitResult>): UnitResult[] {
  return units.flatMap((unit) => {
    const result = resultMap.get(unitKey(unit));
    return result ? [result] : [];
  });
}

function summarizeResults(total: number, results: UnitResult[]): TranslationJobSummary {
  return results.reduce<TranslationJobSummary>(
    (summary, result) => ({
      ...summary,
      [result.status]: summary[result.status] + 1,
    }),
    {
      total,
      translated: 0,
      skipped: 0,
      reused: 0,
      failed: 0,
    },
  );
}

function normalizeMaxAttempts(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value < 1) {
    return 3;
  }

  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unitKey(unit: Pick<JobUnit, 'documentId' | 'unitId'>): string {
  return unitKeyFromParts(unit.documentId, unit.unitId);
}

function unitKeyFromParts(documentId: string, unitId: string): string {
  return `${documentId}\u0000${unitId}`;
}
