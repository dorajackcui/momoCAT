import { describe, expect, it } from 'vitest';
import {
  prepareProjectSegmentTranslationJob,
  translateProjectSegmentsJob,
} from './projectSegmentJobAdapter';
import type { ProgressEventRecord, TranslationJob, TranslationTask, UnitResult } from './job/types';

describe('projectSegmentJobAdapter', () => {
  it('prepares project segment units with window-partial as the default request mode', () => {
    const prepared = prepareProjectSegmentTranslationJob({
      projectId: 7,
      documentId: 'file-1:demo.xlsx',
      units: [
        { id: 's1', source: 'One', target: '', metadata: { orderIndex: 0 } },
        { id: 's2', source: 'Two', target: 'Deux', metadata: { orderIndex: 1 } },
        { id: 's3', source: 'Three', target: 'Trois', locked: true, metadata: { orderIndex: 2 } },
      ],
      options: { targetScope: 'overwrite-non-confirmed', batchSize: 3 },
    });

    expect(prepared.job.translationOptions?.requestMode).toBe('window-partial');
    expect(prepared.job.options?.maxConcurrency).toBe(1);
    expect(prepared.job.units).toEqual([
      expect.objectContaining({ unitId: 's1', target: '', locked: undefined }),
      expect.objectContaining({ unitId: 's2', target: 'Deux', locked: undefined }),
      expect.objectContaining({ unitId: 's3', target: 'Trois', locked: true }),
    ]);
  });

  it('uses the window-partial planner and keeps locked rows out of requestUnitKeys under overwrite scope', async () => {
    const plannedTasks: TranslationTask[] = [];

    await translateProjectSegmentsJob(
      {
        projectId: 7,
        documentId: 'file-1:demo.xlsx',
        units: [
          { id: 's1', source: 'One', target: '' },
          { id: 's2', source: 'Two', target: 'Deux' },
          { id: 's3', source: 'Three', target: 'Trois', locked: true },
        ],
        options: { targetScope: 'overwrite-non-confirmed', batchSize: 3 },
      },
      {
        taskExecutor: async () => ({ results: [] }),
        runnerFactory: (dependencies) => ({
          run: async (job: TranslationJob) => {
            const planner = dependencies.taskPlanner as unknown as {
              planJob(input: {
                job: TranslationJob;
                completedResults: ReadonlyMap<string, UnitResult>;
                targetScope: 'overwrite-non-confirmed';
              }): TranslationTask[];
            };

            plannedTasks.push(
              ...planner.planJob({
                job,
                completedResults: new Map(),
                targetScope: 'overwrite-non-confirmed',
              }),
            );

            return {
              jobId: job.id,
              summary: { total: 3, translated: 0, skipped: 0, reused: 0, failed: 0 },
              results: [],
            };
          },
        }),
      },
    );

    expect(plannedTasks[0]).toEqual(
      expect.objectContaining({
        requestMode: 'window-partial',
        requestUnitKeys: ['file-1:demo.xlsx\u0000s1', 'file-1:demo.xlsx\u0000s2'],
      }),
    );
  });

  it('applies translated results through the host callback', async () => {
    const applied: UnitResult[] = [];

    const result = await translateProjectSegmentsJob(
      {
        projectId: 7,
        documentId: 'file-1:demo.xlsx',
        units: [{ id: 's1', source: 'One', target: '' }],
        options: { targetScope: 'blank-only' },
      },
      {
        taskExecutor: async (task, context) => ({
          results: task.units.map((unit) => ({
            jobId: context.job.id,
            documentId: unit.documentId,
            unitId: unit.unitId,
            sourceHash: unit.sourceHash,
            status: 'translated',
            source: unit.source,
            target: 'Un',
            metadata: unit.metadata,
          })),
        }),
        applyResult: async (unitResult) => {
          applied.push(unitResult);
        },
      },
    );

    expect(result.summary).toEqual({ total: 1, translated: 1, skipped: 0, failed: 0 });
    expect(applied).toEqual([expect.objectContaining({ unitId: 's1', target: 'Un' })]);
  });

  it('reports progress only for unit completion events', async () => {
    const progressEvents: Array<{ current: number; total: number; message?: string }> = [];

    await translateProjectSegmentsJob(
      {
        projectId: 7,
        documentId: 'file-1:demo.xlsx',
        units: [
          { id: 's1', source: 'One', target: '' },
          { id: 's2', source: 'Two', target: '' },
        ],
      },
      {
        taskExecutor: async () => ({ results: [] }),
        onProgress: (event) => {
          progressEvents.push(event);
        },
        runnerFactory: (dependencies) => ({
          run: async (job: TranslationJob) => {
            const emit = async (record: Omit<ProgressEventRecord, 'at'>) => {
              await dependencies.eventSink.append({
                ...record,
                at: '2026-01-01T00:00:00.000Z',
              });
            };

            await emit({ jobId: job.id, event: 'job_start', done: 0, total: 2 });
            await emit({
              jobId: job.id,
              event: 'unit_done',
              documentId: 'file-1:demo.xlsx',
              unitId: 's1',
              done: 1,
              total: 2,
            });
            await emit({
              jobId: job.id,
              event: 'unit_error',
              documentId: 'file-1:demo.xlsx',
              unitId: 's2',
              done: 2,
              total: 2,
            });
            await emit({ jobId: job.id, event: 'job_done', done: 2, total: 2 });

            return {
              jobId: job.id,
              summary: { total: 2, translated: 1, skipped: 0, reused: 0, failed: 1 },
              results: [
                {
                  jobId: job.id,
                  documentId: 'file-1:demo.xlsx',
                  unitId: 's1',
                  sourceHash: job.units[0].sourceHash,
                  status: 'translated',
                  source: 'One',
                  target: 'Un',
                },
                {
                  jobId: job.id,
                  documentId: 'file-1:demo.xlsx',
                  unitId: 's2',
                  sourceHash: job.units[1].sourceHash,
                  status: 'failed',
                  source: 'Two',
                  error: 'boom',
                },
              ],
            };
          },
        }),
      },
    );

    expect(progressEvents).toEqual([
      { current: 1, total: 2 },
      { current: 2, total: 2 },
    ]);
  });
});
