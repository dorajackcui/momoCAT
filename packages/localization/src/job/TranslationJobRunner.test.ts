import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactStore } from './ArtifactStore';
import { CheckpointStore } from './CheckpointStore';
import { EventSink } from './EventSink';
import { readJsonlRecords } from './JsonlStore';
import { OneUnitTaskPlanner } from './TaskPlanner';
import { TranslationJobRunner } from './TranslationJobRunner';
import type {
  ArtifactRecord,
  CheckpointRecord,
  ProgressEventRecord,
  TranslationJob,
  TranslationTaskExecutor,
  UnitResult,
} from './types';

describe('TranslationJobRunner', () => {
  it('writes artifact, checkpoint, and event records for a successful unit', async () => {
    const harness = await makeHarness();
    const job = makeJob();
    const executor = vi.fn<TranslationTaskExecutor>(async (task, context) => ({
      results: [
        makeResult({
          unitId: task.units[0].unitId,
          target: 'Bonjour',
          attempts: context.attempt,
        }),
      ],
      artifacts: [
        makeArtifact({
          task: task.taskId,
          unit: task.units[0].unitId,
          result: makeResult({
            unitId: task.units[0].unitId,
            target: 'Bonjour',
          }),
        }),
      ],
    }));
    const runner = harness.makeRunner(executor);

    const result = await runner.run(job);

    expect(result.results).toEqual([
      expect.objectContaining({
        unitId: 'unit-1',
        status: 'translated',
        target: 'Bonjour',
        attempts: 1,
      }),
    ]);
    expect(result.summary).toEqual({
      total: 1,
      translated: 1,
      skipped: 0,
      reused: 0,
      failed: 0,
    });
    expect(await readJsonlRecords<ArtifactRecord>(harness.artifactsPath)).toMatchObject({
      records: [
        expect.objectContaining({
          unit: 'unit-1',
          task: 'task-1',
          result: expect.objectContaining({
            attempts: 1,
          }),
        }),
      ],
      diagnostics: [],
    });
    expect(await readJsonlRecords<CheckpointRecord>(harness.checkpointPath)).toMatchObject({
      records: [
        expect.objectContaining({
          unit: 'unit-1',
          status: 'translated',
          target: 'Bonjour',
          attempts: 1,
        }),
      ],
      diagnostics: [],
    });
    expect(eventNames(await harness.events())).toEqual([
      'job_start',
      'unit_done',
      'job_done',
    ]);
    expect(executor.mock.calls[0]?.[1].captureArtifacts).toBe(true);
  });

  it('does not request or write artifacts without an artifact store', async () => {
    const harness = await makeHarness();
    const executor = vi.fn<TranslationTaskExecutor>(async (task, context) => ({
      results: [
        makeResult({
          unitId: task.units[0].unitId,
          target: 'Bonjour',
          attempts: context.attempt,
        }),
      ],
      artifacts: [
        makeArtifact({
          task: task.taskId,
          unit: task.units[0].unitId,
        }),
      ],
    }));
    const runner = harness.makeRunner(executor, { persistArtifacts: false });

    await runner.run(makeJob());

    expect(executor.mock.calls[0]?.[1].captureArtifacts).toBe(false);
    expect((await readJsonlRecords<ArtifactRecord>(harness.artifactsPath)).records).toEqual([]);
  });

  it('retries thrown tasks and writes failed checkpoints and events after max attempts', async () => {
    const harness = await makeHarness();
    const executor = vi.fn<TranslationTaskExecutor>(async () => {
      throw new Error('provider unavailable');
    });
    const runner = harness.makeRunner(executor);

    const result = await runner.run(makeJob({ options: { maxAttempts: 2, maxConcurrency: 1 } }));

    expect(executor).toHaveBeenCalledTimes(2);
    expect(result.results).toEqual([
      expect.objectContaining({
        status: 'failed',
        error: 'provider unavailable',
        attempts: 2,
      }),
    ]);
    expect(await readJsonlRecords<CheckpointRecord>(harness.checkpointPath)).toMatchObject({
      records: [expect.objectContaining({ status: 'failed', attempts: 2 })],
    });
    expect(await readJsonlRecords<ArtifactRecord>(harness.artifactsPath)).toMatchObject({
      records: [
        expect.objectContaining({
          unit: 'unit-1',
          error: 'provider unavailable',
          result: expect.objectContaining({ status: 'failed', attempts: 2 }),
        }),
      ],
    });
    expect(await harness.events()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'unit_error',
          unit: 'unit-1',
          status: 'failed',
          error: 'provider unavailable',
        }),
      ]),
    );
  });

  it('reuses matching translated checkpoints and does not call the executor for them', async () => {
    const harness = await makeHarness();
    await harness.checkpointStore.append(
      makeCheckpoint({
        unit: 'unit-1',
        hash: 'hash-1',
        target: 'Bonjour from checkpoint',
      }),
    );
    const executor = vi.fn<TranslationTaskExecutor>(async () => {
      throw new Error('should not execute');
    });
    const runner = harness.makeRunner(executor);

    const result = await runner.run(makeJob({ options: { resume: true } }));

    expect(executor).not.toHaveBeenCalled();
    expect(result.results).toEqual([
      expect.objectContaining({
        status: 'reused',
        target: 'Bonjour from checkpoint',
      }),
    ]);
    expect(await readJsonlRecords<CheckpointRecord>(harness.checkpointPath)).toMatchObject({
      records: [expect.objectContaining({ status: 'translated' })],
    });
    expect(await harness.events()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'unit_done',
          unit: 'unit-1',
          status: 'reused',
        }),
      ]),
    );
  });

  it('re-executes a unit when the checkpoint hash does not match', async () => {
    const harness = await makeHarness();
    await harness.checkpointStore.append(makeCheckpoint({ hash: 'old-hash', target: 'old target' }));
    const executor = vi.fn<TranslationTaskExecutor>(async () => ({
      results: [makeResult({ target: 'fresh target' })],
    }));
    const runner = harness.makeRunner(executor);

    const result = await runner.run(makeJob({ options: { resume: true } }));

    expect(executor).toHaveBeenCalledTimes(1);
    expect(result.results).toEqual([
      expect.objectContaining({
        status: 'translated',
        target: 'fresh target',
      }),
    ]);
    expect((await readJsonlRecords<CheckpointRecord>(harness.checkpointPath)).records).toEqual([
      expect.objectContaining({ hash: 'old-hash' }),
      expect.objectContaining({ hash: 'hash-1', target: 'fresh target' }),
    ]);
  });

  it('throttles snapshot callbacks and emits snapshot events only after successful writes', async () => {
    const harness = await makeHarness();
    const snapshots: UnitResult[][] = [];
    const runner = harness.makeRunner(
      async (task) => ({
        results: [
          makeResult({
            unitId: task.units[0].unitId,
            sourceHash: task.units[0].sourceHash,
            source: task.units[0].source,
            target: `target ${task.units[0].unitId}`,
          }),
        ],
      }),
      {
        writeSnapshot: async (results) => {
          snapshots.push(results);
        },
      },
    );

    await runner.run(
      makeJob({
        units: [
          makeUnit({ unitId: 'unit-1', sourceHash: 'hash-1' }),
          makeUnit({ unitId: 'unit-2', sourceHash: 'hash-2' }),
          makeUnit({ unitId: 'unit-3', sourceHash: 'hash-3' }),
        ],
        options: { maxConcurrency: 1, snapshotEveryUnits: 2, snapshotEverySeconds: 60 },
      }),
    );

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].map((result) => result.unitId)).toEqual(['unit-1', 'unit-2']);
    expect((await harness.events()).filter((event) => event.event === 'snapshot')).toEqual([
      expect.objectContaining({ done: 2, total: 3 }),
    ]);
  });

  it('passes reused and newly completed results to the final callback', async () => {
    const harness = await makeHarness();
    await harness.checkpointStore.append(
      makeCheckpoint({
        unit: 'unit-1',
        hash: 'hash-1',
        target: 'reused target',
      }),
    );
    const finalCalls: Array<{
      results: UnitResult[];
      resultMapUnits: string[];
    }> = [];
    const runner = harness.makeRunner(
      async (task) => ({
        results: [
          makeResult({
            unitId: task.units[0].unitId,
            sourceHash: task.units[0].sourceHash,
            source: task.units[0].source,
            target: 'new target',
          }),
        ],
      }),
      {
        writeFinal: async (results, context) => {
          finalCalls.push({
            results,
            resultMapUnits: Array.from(context.resultMap.values()).map((result) => result.unitId),
          });
        },
      },
    );

    await runner.run(
      makeJob({
        units: [
          makeUnit({ unitId: 'unit-1', sourceHash: 'hash-1' }),
          makeUnit({ unitId: 'unit-2', sourceHash: 'hash-2', source: 'second source' }),
        ],
        options: { resume: true, maxConcurrency: 1 },
      }),
    );

    expect(finalCalls).toHaveLength(1);
    expect(finalCalls[0].results).toEqual([
      expect.objectContaining({ unitId: 'unit-1', status: 'reused', target: 'reused target' }),
      expect.objectContaining({ unitId: 'unit-2', status: 'translated', target: 'new target' }),
    ]);
    expect(finalCalls[0].resultMapUnits).toEqual(['unit-1', 'unit-2']);
  });

  it('serializes concurrent persistence so snapshots and final counts stay stable', async () => {
    const harness = await makeHarness();
    const snapshots: UnitResult[][] = [];
    const runner = harness.makeRunner(
      async (task) => ({
        results: [
          makeResult({
            unitId: task.units[0].unitId,
            sourceHash: task.units[0].sourceHash,
            source: task.units[0].source,
            target: `target ${task.units[0].unitId}`,
          }),
        ],
      }),
      {
        writeSnapshot: async (results) => {
          snapshots.push(results);
          await new Promise((resolve) => setTimeout(resolve, 5));
        },
      },
    );

    const result = await runner.run(
      makeJob({
        units: [
          makeUnit({ unitId: 'unit-1', sourceHash: 'hash-1' }),
          makeUnit({ unitId: 'unit-2', sourceHash: 'hash-2' }),
          makeUnit({ unitId: 'unit-3', sourceHash: 'hash-3' }),
        ],
        options: { maxConcurrency: 3, snapshotEveryUnits: 2, snapshotEverySeconds: 60 },
      }),
    );

    expect(result.summary).toEqual({
      total: 3,
      translated: 3,
      skipped: 0,
      reused: 0,
      failed: 0,
    });
    expect(snapshots).toHaveLength(1);
    expect((await harness.events()).filter((event) => event.event === 'snapshot')).toEqual([
      expect.objectContaining({ done: 2, total: 3 }),
    ]);
    expect((await readJsonlRecords<CheckpointRecord>(harness.checkpointPath)).records).toHaveLength(3);
  });

  it('canonicalizes executor result identity from the planned unit', async () => {
    const harness = await makeHarness();
    const runner = harness.makeRunner(async () => ({
      results: [
        makeResult({
          jobId: 'wrong-job',
          documentId: 'doc-canonical',
          unitId: 'unit-canonical',
          sourceHash: 'wrong-hash',
          source: 'wrong source',
          target: 'canonical target',
          metadata: { wrong: true },
        }),
      ],
    }));

    const result = await runner.run(
      makeJob({
        units: [
          makeUnit({
            documentId: 'doc-canonical',
            unitId: 'unit-canonical',
            source: 'canonical source',
            sourceHash: 'hash-canonical',
            metadata: { expected: true },
          }),
        ],
      }),
    );

    expect(result.results).toEqual([
      expect.objectContaining({
        jobId: 'job-1',
        documentId: 'doc-canonical',
        unitId: 'unit-canonical',
        sourceHash: 'hash-canonical',
        source: 'canonical source',
        target: 'canonical target',
        metadata: { expected: true },
      }),
    ]);
    expect((await readJsonlRecords<CheckpointRecord>(harness.checkpointPath)).records).toEqual([
      expect.objectContaining({
        job: 'job-1',
        doc: 'doc-canonical',
        unit: 'unit-canonical',
        hash: 'hash-canonical',
        target: 'canonical target',
      }),
    ]);
  });

  it('matches out-of-order multi-unit task results by unit identity', async () => {
    const harness = await makeHarness();
    const runner = harness.makeRunner(
      async (task) => ({
        results: [
          makeResult({
            documentId: task.units[1].documentId,
            unitId: task.units[1].unitId,
            sourceHash: task.units[1].sourceHash,
            source: task.units[1].source,
            target: 'target for second',
          }),
          makeResult({
            documentId: 'extra-doc',
            unitId: 'extra-unit',
            sourceHash: 'extra-hash',
            target: 'ignored extra target',
          }),
          makeResult({
            documentId: task.units[0].documentId,
            unitId: task.units[0].unitId,
            sourceHash: task.units[0].sourceHash,
            source: task.units[0].source,
            target: 'target for first',
          }),
        ],
        artifacts: [
          makeArtifact({
            task: task.taskId,
            doc: task.units[1].documentId,
            unit: task.units[1].unitId,
            result: makeResult({
              documentId: task.units[1].documentId,
              unitId: task.units[1].unitId,
              sourceHash: task.units[1].sourceHash,
              target: 'target for second',
            }),
          }),
          makeArtifact({
            task: task.taskId,
            doc: 'extra-doc',
            unit: 'extra-unit',
          }),
        ],
      }),
      {
        taskPlanner: {
          plan: (units) => [{ taskId: 'batch-1', units }],
        },
      },
    );

    const result = await runner.run(
      makeJob({
        units: [
          makeUnit({ unitId: 'unit-1', sourceHash: 'hash-1', source: 'first source' }),
          makeUnit({ unitId: 'unit-2', sourceHash: 'hash-2', source: 'second source' }),
        ],
      }),
    );

    expect(result.results).toEqual([
      expect.objectContaining({ unitId: 'unit-1', target: 'target for first' }),
      expect.objectContaining({ unitId: 'unit-2', target: 'target for second' }),
    ]);
    expect((await readJsonlRecords<CheckpointRecord>(harness.checkpointPath)).records).toEqual([
      expect.objectContaining({ unit: 'unit-1', target: 'target for first' }),
      expect.objectContaining({ unit: 'unit-2', target: 'target for second' }),
    ]);
    expect((await readJsonlRecords<ArtifactRecord>(harness.artifactsPath)).records).toEqual([
      expect.objectContaining({
        task: 'batch-1',
        unit: 'unit-2',
        result: expect.objectContaining({
          unitId: 'unit-2',
          sourceHash: 'hash-2',
        }),
      }),
    ]);
  });

  it('passes completed results snapshot into each ordered task attempt', async () => {
    const harness = await makeHarness();
    const seenCompletedUnits: string[][] = [];
    const runner = harness.makeRunner(async (task, context) => {
      seenCompletedUnits.push(
        Array.from(context.completedResults?.values() ?? []).map((result) => result.unitId),
      );

      return {
        results: [
          makeResult({
            unitId: task.units[0].unitId,
            sourceHash: task.units[0].sourceHash,
            source: task.units[0].source,
            target: `target ${task.units[0].unitId}`,
          }),
        ],
      };
    });

    await runner.run(
      makeJob({
        units: [
          makeUnit({ unitId: 'unit-1', sourceHash: 'hash-1' }),
          makeUnit({ unitId: 'unit-2', sourceHash: 'hash-2' }),
        ],
        options: { maxConcurrency: 1 },
      }),
    );

    expect(seenCompletedUnits).toEqual([[], ['unit-1']]);
  });
});

async function makeHarness(): Promise<{
  checkpointPath: string;
  eventsPath: string;
  artifactsPath: string;
  checkpointStore: CheckpointStore;
  makeRunner: (
    executor: TranslationTaskExecutor,
    options?: Pick<
      ConstructorParameters<typeof TranslationJobRunner>[0],
      'writeSnapshot' | 'writeFinal' | 'taskPlanner'
    > & { persistArtifacts?: boolean },
  ) => TranslationJobRunner;
  events: () => Promise<ProgressEventRecord[]>;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'momocat-job-runner-'));
  const checkpointPath = join(dir, 'checkpoint.jsonl');
  const eventsPath = join(dir, 'events.jsonl');
  const artifactsPath = join(dir, 'artifacts.jsonl');
  const checkpointStore = new CheckpointStore(checkpointPath);

  return {
    checkpointPath,
    eventsPath,
    artifactsPath,
    checkpointStore,
    makeRunner: (taskExecutor, options = {}) => {
      const dependencies: ConstructorParameters<typeof TranslationJobRunner>[0] = {
        checkpointStore,
        eventSink: new EventSink(eventsPath),
        taskPlanner: options.taskPlanner ?? new OneUnitTaskPlanner(),
        taskExecutor,
        clock: () => new Date('2026-05-19T00:00:00.000Z'),
        writeSnapshot: options.writeSnapshot,
        writeFinal: options.writeFinal,
      };

      if (options.persistArtifacts !== false) {
        dependencies.artifactStore = new ArtifactStore(artifactsPath);
      }

      return new TranslationJobRunner(dependencies);
    },
    events: async () => (await readJsonlRecords<ProgressEventRecord>(eventsPath)).records,
  };
}

function makeJob(overrides: Partial<TranslationJob> = {}): TranslationJob {
  return {
    id: 'job-1',
    projectId: 1,
    units: [makeUnit()],
    options: { maxConcurrency: 1 },
    ...overrides,
  };
}

function makeUnit(overrides: Partial<TranslationJob['units'][number]> = {}) {
  return {
    documentId: 'doc-1',
    unitId: 'unit-1',
    source: 'Hello',
    sourceHash: 'hash-1',
    ...overrides,
  };
}

function makeResult(overrides: Partial<UnitResult> = {}): UnitResult {
  return {
    jobId: 'job-1',
    documentId: 'doc-1',
    unitId: 'unit-1',
    sourceHash: 'hash-1',
    status: 'translated',
    source: 'Hello',
    target: 'Bonjour',
    ...overrides,
  };
}

function makeCheckpoint(overrides: Partial<CheckpointRecord> = {}): CheckpointRecord {
  return {
    job: 'job-1',
    doc: 'doc-1',
    unit: 'unit-1',
    hash: 'hash-1',
    status: 'translated',
    target: 'checkpoint target',
    attempts: 1,
    at: '2026-05-19T00:00:00.000Z',
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    job: 'job-1',
    task: 'task-1',
    doc: 'doc-1',
    unit: 'unit-1',
    metadata: { executor: 'mock' },
    at: '2026-05-19T00:00:00.000Z',
    ...overrides,
  };
}

function eventNames(events: ProgressEventRecord[]): string[] {
  return events.map((event) => event.event);
}
