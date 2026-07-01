import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryTranslationAuditSink } from '../audit/TranslationAudit';
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
import type { JobAwareTaskPlanner, TaskPlanner } from './TaskPlanner';

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

  it('passes full job units and completed results to job-aware planners', async () => {
    const harness = await makeHarness();
    await harness.checkpointStore.append(
      makeCheckpoint({
        unit: 'unit-1',
        hash: 'hash-1',
        target: 'reused target',
      }),
    );
    const seenPlanJobArgs: Array<{
      jobUnitIds: string[];
      completedUnitIds: string[];
      hasTargetScope: boolean;
    }> = [];
    const planner: JobAwareTaskPlanner = {
      supportsJobAwarePlanning: true,
      planJob: (input) => {
        seenPlanJobArgs.push({
          jobUnitIds: input.job.units.map((unit) => unit.unitId),
          completedUnitIds: Array.from(input.completedResults.values()).map((result) => result.unitId),
          hasTargetScope: 'targetScope' in input,
        });

        return [
          {
            taskId: 'job-aware-task-1',
            units: [input.job.units[1]],
          },
        ];
      },
    };
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
      { taskPlanner: planner },
    );

    await runner.run(
      makeJob({
        units: [
          makeUnit({ unitId: 'unit-1', sourceHash: 'hash-1' }),
          makeUnit({ unitId: 'unit-2', sourceHash: 'hash-2' }),
        ],
        options: { resume: true, maxConcurrency: 1 },
        translationOptions: { targetBaseline: 'ignore-current-targets' },
      }),
    );

    expect(seenPlanJobArgs).toEqual([
      {
        jobUnitIds: ['unit-1', 'unit-2'],
        completedUnitIds: ['unit-1'],
        hasTargetScope: false,
      },
    ]);
  });

  it('continues passing only pending units to non-job-aware planners', async () => {
    const harness = await makeHarness();
    await harness.checkpointStore.append(
      makeCheckpoint({
        unit: 'unit-1',
        hash: 'hash-1',
        target: 'reused target',
      }),
    );
    const seenPlanUnitIds: string[][] = [];
    const planner: TaskPlanner = {
      plan: (units) => {
        seenPlanUnitIds.push(units.map((unit) => unit.unitId));
        return units.map((unit) => ({ taskId: `task-${unit.unitId}`, units: [unit] }));
      },
    };
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
      { taskPlanner: planner },
    );

    await runner.run(
      makeJob({
        units: [
          makeUnit({ unitId: 'unit-1', sourceHash: 'hash-1' }),
          makeUnit({ unitId: 'unit-2', sourceHash: 'hash-2' }),
        ],
        options: { resume: true, maxConcurrency: 1 },
      }),
    );

    expect(seenPlanUnitIds).toEqual([['unit-2']]);
  });

  it('ignores incidental planJob methods without the job-aware capability flag', async () => {
    const harness = await makeHarness();
    await harness.checkpointStore.append(
      makeCheckpoint({
        unit: 'unit-1',
        hash: 'hash-1',
        target: 'reused target',
      }),
    );
    const seenPlanUnitIds: string[][] = [];
    const incidentalPlanJob = vi.fn(() => {
      throw new Error('incidental planJob should not be called');
    });
    const planner = {
      plan: (units: TranslationJob['units']) => {
        seenPlanUnitIds.push(units.map((unit) => unit.unitId));
        return units.map((unit) => ({ taskId: `task-${unit.unitId}`, units: [unit] }));
      },
      planJob: incidentalPlanJob,
    };
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
      { taskPlanner: planner },
    );

    await runner.run(
      makeJob({
        units: [
          makeUnit({ unitId: 'unit-1', sourceHash: 'hash-1' }),
          makeUnit({ unitId: 'unit-2', sourceHash: 'hash-2' }),
        ],
        options: { resume: true, maxConcurrency: 1 },
      }),
    );

    expect(incidentalPlanJob).not.toHaveBeenCalled();
    expect(seenPlanUnitIds).toEqual([['unit-2']]);
  });

  it('runtime TM seeds translated and skipped checkpoint results on resume', async () => {
    const harness = await makeHarness();
    await harness.checkpointStore.append(
      makeCheckpoint({
        unit: 'unit-1',
        hash: 'hash-1',
        status: 'translated',
        target: 'translated checkpoint',
      }),
    );
    await harness.checkpointStore.append(
      makeCheckpoint({
        unit: 'unit-2',
        hash: 'hash-2',
        status: 'skipped',
        target: 'existing target',
      }),
    );
    await harness.checkpointStore.append(
      makeCheckpoint({
        unit: 'unit-3',
        hash: 'old-hash',
        status: 'translated',
        target: 'stale checkpoint',
      }),
    );
    await harness.checkpointStore.append(
      makeCheckpoint({
        unit: 'unit-4',
        hash: 'hash-4',
        status: 'translated',
        target: '',
      }),
    );
    const seed = vi.fn();
    const executor = vi.fn<TranslationTaskExecutor>(async (task) => ({
        results: [
          makeResult({
            unitId: task.units[0].unitId,
            sourceHash: task.units[0].sourceHash,
            source: task.units[0].source,
            target: `fresh ${task.units[0].unitId}`,
          }),
        ],
      }));
    const runner = harness.makeRunner(
      executor,
      {
        runtimeTm: { seed, commit: vi.fn() },
      },
    );

    await runner.run(
      makeJob({
        units: [
          makeUnit({ unitId: 'unit-1', sourceHash: 'hash-1', source: 'Hello 1' }),
          makeUnit({ unitId: 'unit-2', sourceHash: 'hash-2', source: 'Hello 2' }),
          makeUnit({ unitId: 'unit-3', sourceHash: 'hash-3', source: 'Hello 3' }),
          makeUnit({ unitId: 'unit-4', sourceHash: 'hash-4', source: 'Hello 4' }),
        ],
        options: { resume: true, maxConcurrency: 1 },
      }),
    );

    expect(seed).toHaveBeenCalledTimes(1);
    expect(seed).toHaveBeenCalledWith([
      expect.objectContaining({
        unitId: 'unit-1',
        status: 'translated',
        source: 'Hello 1',
        target: 'translated checkpoint',
      }),
      expect.objectContaining({
        unitId: 'unit-2',
        status: 'skipped',
        source: 'Hello 2',
        target: 'existing target',
      }),
    ]);
    expect(executor.mock.calls.map(([task]) => task.units[0].unitId)).toEqual([
      'unit-2',
      'unit-3',
    ]);
  });

  it('runtime TM commits normalized task results after checkpoint persistence', async () => {
    const harness = await makeHarness();
    const calls: string[] = [];
    const checkpointStore = {
      load: harness.checkpointStore.load.bind(harness.checkpointStore),
      append: async (record: CheckpointRecord) => {
        calls.push(`checkpoint:${record.unit}:${record.target}`);
        await harness.checkpointStore.append(record);
      },
    };
    const commit = vi.fn((results: UnitResult[]) => {
      calls.push(`commit:${results[0].unitId}:${results[0].target}`);
    });
    const runner = harness.makeRunner(
      async () => ({
        results: [
          makeResult({
            jobId: 'wrong-job',
            unitId: 'unit-1',
            sourceHash: 'wrong-hash',
            source: 'wrong source',
            target: 'normalized target',
            attempts: 99,
          }),
        ],
      }),
      {
        checkpointStore,
        runtimeTm: {
          seed: vi.fn(),
          commit,
        },
      },
    );

    await runner.run(makeJob());

    expect(calls).toEqual([
      'checkpoint:unit-1:normalized target',
      'commit:unit-1:normalized target',
    ]);
    expect(commit).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          jobId: 'job-1',
          documentId: 'doc-1',
          unitId: 'unit-1',
          sourceHash: 'hash-1',
          source: 'Hello',
          target: 'normalized target',
          attempts: 99,
        }),
      ],
      expect.objectContaining({ taskId: 'task-1' }),
      expect.objectContaining({ id: 'job-1' }),
    );
    expect(await readJsonlRecords<CheckpointRecord>(harness.checkpointPath)).toMatchObject({
      records: [
        expect.objectContaining({
          job: 'job-1',
          unit: 'unit-1',
          hash: 'hash-1',
          target: 'normalized target',
          attempts: 99,
        }),
      ],
    });
  });

  it('passes audit sink to task executors and records persisted units plus runtime TM commits', async () => {
    const harness = await makeHarness();
    const auditSink = createMemoryTranslationAuditSink();
    const commit = vi.fn();
    const runner = harness.makeRunner(
      async (task, context) => {
        expect(context.auditSink).toBe(auditSink);

        return {
          results: [
            makeResult({
              unitId: task.units[0].unitId,
              sourceHash: task.units[0].sourceHash,
              source: task.units[0].source,
              target: 'Bonjour',
              attempts: context.attempt,
            }),
          ],
        };
      },
      {
        auditSink,
        runtimeTm: {
          seed: vi.fn(),
          commit,
        },
      },
    );

    await runner.run(makeJob());

    expect(commit).toHaveBeenCalledTimes(1);
    expect(auditSink.events.map((event) => event.event)).toEqual([
      'unit_persisted',
      'runtime_tm_commit',
    ]);
    expect(auditSink.events[0]).toEqual({
      event: 'unit_persisted',
      job: 'job-1',
      task: 'task-1',
      doc: 'doc-1',
      unit: 'unit-1',
      status: 'translated',
      attempts: 1,
      targetChars: 7,
      targetHash: expect.stringMatching(/^[0-9a-f]{12}$/),
    });
    expect(auditSink.events[1]).toEqual({
      event: 'runtime_tm_commit',
      job: 'job-1',
      task: 'task-1',
      units: ['unit-1'],
    });
  });

  it('applies host results before committing them to runtime TM', async () => {
    const harness = await makeHarness();
    const order: string[] = [];
    const unit = makeUnit({ unitId: 'unit-1', source: 'Hello' });
    const runner = harness.makeRunner(
      async (task, context) => ({
        results: task.units.map((taskUnit) => ({
          jobId: context.job.id,
          documentId: taskUnit.documentId,
          unitId: taskUnit.unitId,
          sourceHash: taskUnit.sourceHash,
          status: 'translated',
          source: taskUnit.source,
          target: 'Bonjour',
        })),
      }),
      {
        applyResult: async (result) => {
          order.push(`apply:${result.unitId}`);
        },
        runtimeTm: {
          seed: vi.fn(),
          commit: vi.fn(async (results) => {
            order.push(`runtime:${results[0]?.unitId}`);
          }),
        },
      },
    );

    await runner.run(makeJob({ units: [unit] }));

    expect(order).toEqual(['apply:unit-1', 'runtime:unit-1']);
  });

  it('does not checkpoint or commit to runtime TM when host result apply fails', async () => {
    const harness = await makeHarness();
    const append = vi.fn(async (_record: CheckpointRecord) => undefined);
    const commit = vi.fn();
    const checkpointStore = {
      load: harness.checkpointStore.load.bind(harness.checkpointStore),
      append,
    };
    const runner = harness.makeRunner(
      async (task, context) => ({
        results: task.units.map((taskUnit) => ({
          jobId: context.job.id,
          documentId: taskUnit.documentId,
          unitId: taskUnit.unitId,
          sourceHash: taskUnit.sourceHash,
          status: 'translated',
          source: taskUnit.source,
          target: 'Bonjour',
        })),
      }),
      {
        checkpointStore,
        persistArtifacts: false,
        applyResult: async () => {
          throw new Error('host apply failed');
        },
        runtimeTm: {
          seed: vi.fn(),
          commit,
        },
      },
    );

    await expect(runner.run(makeJob())).rejects.toThrow('host apply failed');

    expect(append).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('drops in-flight task results and skips later tasks after cancellation is requested', async () => {
    const harness = await makeHarness();
    let cancelRequested = false;
    const append = vi.fn(async (_record: CheckpointRecord) => undefined);
    const applyResult = vi.fn();
    const checkpointStore = {
      load: harness.checkpointStore.load.bind(harness.checkpointStore),
      append,
    };
    const executor = vi.fn<TranslationTaskExecutor>(async (task, context) => {
      cancelRequested = true;
      return {
        results: [
          makeResult({
            unitId: task.units[0].unitId,
            sourceHash: task.units[0].sourceHash,
            source: task.units[0].source,
            target: `target ${task.units[0].unitId}`,
            attempts: context.attempt,
          }),
        ],
      };
    });
    const runner = harness.makeRunner(executor, {
      checkpointStore,
      applyResult,
      persistArtifacts: false,
      cancellationToken: { isCancellationRequested: () => cancelRequested },
    });

    const result = await runner.run(
      makeJob({
        units: [
          makeUnit({ unitId: 'unit-1', sourceHash: 'hash-1' }),
          makeUnit({ unitId: 'unit-2', sourceHash: 'hash-2' }),
        ],
        options: { maxConcurrency: 1 },
      }),
    );

    expect(executor.mock.calls.map(([task]) => task.units[0].unitId)).toEqual(['unit-1']);
    expect(applyResult).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(result.results).toEqual([]);
    expect(await harness.events()).toEqual([
      expect.objectContaining({ event: 'job_start', done: 0, total: 2 }),
      expect.objectContaining({ event: 'job_done', done: 0, total: 2 }),
    ]);
  });

  it('includes Runtime TM summary in run result and job_done event without artifacts', async () => {
    const harness = await makeHarness();
    const summary = {
      enabled: true,
      tagPolicy: 'none' as const,
      seeded: 2,
      appended: 3,
      skipped: 1,
      entryCount: 4,
      inspectCalls: 5,
      hitUnits: 6,
      tmHits: 7,
      concordanceHits: 8,
      capped: false,
    };
    const runner = harness.makeRunner(
      async (task) => ({
        results: [
          makeResult({
            unitId: task.units[0].unitId,
            sourceHash: task.units[0].sourceHash,
            source: task.units[0].source,
            target: 'Bonjour',
          }),
        ],
      }),
      {
        persistArtifacts: false,
        runtimeTm: {
          seed: vi.fn(),
          commit: vi.fn(),
          summary: () => summary,
        },
      },
    );

    const result = await runner.run(makeJob());

    expect(result.runtimeTm).toEqual(summary);
    const events = await harness.events();
    expect(events.find((event) => event.event === 'job_done')).toEqual(
      expect.objectContaining({ runtimeTm: summary }),
    );
    expect((await readJsonlRecords<ArtifactRecord>(harness.artifactsPath)).records).toEqual([]);
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
      | 'writeSnapshot'
      | 'writeFinal'
      | 'taskPlanner'
      | 'runtimeTm'
      | 'checkpointStore'
      | 'applyResult'
      | 'auditSink'
      | 'cancellationToken'
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
        checkpointStore: options.checkpointStore ?? checkpointStore,
        eventSink: new EventSink(eventsPath),
        taskPlanner: options.taskPlanner ?? new OneUnitTaskPlanner(),
        taskExecutor,
        clock: () => new Date('2026-05-19T00:00:00.000Z'),
        writeSnapshot: options.writeSnapshot,
        writeFinal: options.writeFinal,
        applyResult: options.applyResult,
        runtimeTm: options.runtimeTm,
        auditSink: options.auditSink,
        cancellationToken: options.cancellationToken,
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
