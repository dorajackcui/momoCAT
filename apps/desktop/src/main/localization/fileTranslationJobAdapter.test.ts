import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, win32 } from 'path';
import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import {
  inferFileTranslationJobSidecarPaths,
  prepareFileTranslationJob,
  translateSpreadsheetFileJob,
} from './fileTranslationJobAdapter';
import { computeSourceHash } from './job/sourceHash';
import type { TranslationTaskExecutor, UnitResult } from './job/types';

describe('fileTranslationJobAdapter', () => {
  it('converts xlsx rows into job units with source hashes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-file-job-'));
    try {
      const inputPath = join(root, 'mt.xlsx');
      const outputPath = join(root, 'mt.translated.xlsx');
      writeWorkbook(inputPath, [
        ['source', 'target', 'context'],
        ['Hello', '', 'Greeting'],
        ['World', 'Monde', 'Noun'],
        ['', '', 'empty row'],
      ]);

      const prepared = await prepareFileTranslationJob({
        projectId: 7,
        inputPath,
        outputPath,
        columns: { contextHeader: 'context' },
        job: { jobId: 'job-file-1' },
      });

      expect(prepared.job).toMatchObject({
        id: 'job-file-1',
        projectId: 7,
      });
      expect(prepared.job.units).toEqual([
        {
          documentId: 'mt.xlsx',
          unitId: 'row-2',
          source: 'Hello',
          target: '',
          context: 'Greeting',
          rowNumber: 2,
          sourceHash: computeSourceHash({ source: 'Hello', context: 'Greeting' }),
          metadata: { rowIndex: 1, rowNumber: 2 },
        },
        {
          documentId: 'mt.xlsx',
          unitId: 'row-3',
          source: 'World',
          target: 'Monde',
          context: 'Noun',
          rowNumber: 3,
          sourceHash: computeSourceHash({ source: 'World', context: 'Noun' }),
          metadata: { rowIndex: 2, rowNumber: 3 },
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('infers deterministic sidecar paths and honors explicit overrides', async () => {
    const outputPath = win32.join('C:\\tmp', 'mt.translated.xlsx');
    expect(inferFileTranslationJobSidecarPaths(outputPath)).toEqual({
      checkpointPath: win32.join('C:\\tmp', 'mt.translated.checkpoint.jsonl'),
      eventsPath: win32.join('C:\\tmp', 'mt.translated.events.jsonl'),
      artifactsPath: win32.join('C:\\tmp', 'mt.translated.artifacts.jsonl'),
      snapshotPath: win32.join('C:\\tmp', 'mt.translated.snapshot.xlsx'),
    });

    const root = await mkdtemp(join(tmpdir(), 'cat-file-job-'));
    try {
      const inputPath = join(root, 'mt.xlsx');
      const outputPath = join(root, 'mt.translated.xlsx');
      const checkpointPath = join(root, 'explicit.checkpoint.jsonl');
      const eventsPath = join(root, 'explicit.events.jsonl');
      const artifactsPath = join(root, 'explicit.artifacts.jsonl');
      const snapshotPath = join(root, 'explicit.snapshot.xlsx');
      writeWorkbook(inputPath, [
        ['source', 'target'],
        ['Hello', ''],
      ]);

      const prepared = await prepareFileTranslationJob({
        projectId: 7,
        inputPath,
        outputPath,
        job: { checkpointPath, eventsPath, artifactsPath, snapshotPath },
      });

      expect(prepared.sidecarPaths).toEqual({
        checkpointPath,
        eventsPath,
        artifactsPath,
        snapshotPath,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes the final xlsx from runner results without overwriting failed units', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-file-job-'));
    try {
      const inputPath = join(root, 'mt.xlsx');
      const outputPath = join(root, 'mt.translated.xlsx');
      writeWorkbook(inputPath, [
        ['source', 'target'],
        ['Hello', ''],
        ['Keep me', 'Existing target'],
      ]);
      const executor = vi.fn<TranslationTaskExecutor>(async (task, context) => {
        const unit = task.units[0];
        const base = {
          jobId: context.job.id,
          documentId: unit.documentId,
          unitId: unit.unitId,
          sourceHash: unit.sourceHash,
          source: unit.source,
          metadata: unit.metadata,
        };

        if (unit.unitId === 'row-3') {
          return {
            results: [
              {
                ...base,
                status: 'failed',
                target: 'Should not be written',
                error: 'provider failed',
              },
            ],
          };
        }

        return {
          results: [{ ...base, status: 'translated', target: 'Bonjour' }],
        };
      });

      const result = await translateSpreadsheetFileJob(
        {
          projectId: 7,
          inputPath,
          outputPath,
          job: { maxAttempts: 1 },
        },
        { taskExecutor: executor },
      );

      expect(result.summary).toEqual({ total: 2, translated: 1, skipped: 0, failed: 1 });
      expect(executor).toHaveBeenCalledTimes(2);
      const rows = readRows(outputPath);
      expect(rows[1][1]).toBe('Bonjour');
      expect(rows[2][1]).toBe('Existing target');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('can write a snapshot xlsx before the final output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-file-job-'));
    try {
      const inputPath = join(root, 'mt.xlsx');
      const outputPath = join(root, 'mt.translated.xlsx');
      const snapshotPath = join(root, 'mt.snapshot.xlsx');
      writeWorkbook(inputPath, [
        ['source', 'target'],
        ['Hello', ''],
        ['World', ''],
      ]);
      const first = makeResult('row-2', 'Hello', 'Bonjour', { rowIndex: 1, rowNumber: 2 });
      const second = makeResult('row-3', 'World', 'Monde', { rowIndex: 2, rowNumber: 3 });

      await translateSpreadsheetFileJob(
        {
          projectId: 7,
          inputPath,
          outputPath,
          job: { snapshotPath },
        },
        {
          taskExecutor: async () => ({ results: [] }),
          runnerFactory: (dependencies) => ({
            run: async (job) => {
              await dependencies.writeSnapshot?.([first], { job, resultMap: new Map() });
              expect(readRows(snapshotPath)[1][1]).toBe('Bonjour');
              expect(readRows(snapshotPath)[2]?.[1] ?? '').toBe('');
              await dependencies.writeFinal?.([first, second], { job, resultMap: new Map() });
              return {
                jobId: job.id,
                summary: { total: 2, translated: 2, skipped: 0, reused: 0, failed: 0 },
                results: [first, second],
              };
            },
          }),
        },
      );

      expect(readRows(outputPath)[2][1]).toBe('Monde');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps the compact worksheet range fix for job-mode output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-file-job-'));
    try {
      const inputPath = join(root, 'source-only.xlsx');
      const outputPath = join(root, 'source-only.translated.xlsx');
      writeWorkbook(inputPath, [['Hello'], ['World']]);

      await translateSpreadsheetFileJob(
        {
          projectId: 7,
          inputPath,
          outputPath,
          columns: { hasHeader: false, sourceCol: 0, targetCol: 2 },
          job: { maxAttempts: 1 },
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
              target: `${unit.source} translated`,
              metadata: unit.metadata,
            })),
          }),
        },
      );

      const written = XLSX.read(await readFile(outputPath), { type: 'buffer' });
      expect(written.Sheets.Sheet1['!ref']).toBe('A1:C2');
      const rows = XLSX.utils.sheet_to_json(written.Sheets.Sheet1, {
        header: 1,
        defval: '',
      }) as string[][];
      expect(rows[0][2]).toBe('Hello translated');
      expect(rows[1][2]).toBe('World translated');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('passes input maxConcurrency first and then adapter default to the runner job', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-file-job-'));
    try {
      const inputPath = join(root, 'mt.xlsx');
      const outputPath = join(root, 'mt.translated.xlsx');
      writeWorkbook(inputPath, [
        ['source', 'target'],
        ['Hello', ''],
      ]);
      const seenMaxConcurrency: Array<number | undefined> = [];

      await translateSpreadsheetFileJob(
        {
          projectId: 7,
          inputPath,
          outputPath,
          job: {},
        },
        {
          defaultMaxConcurrency: 3,
          taskExecutor: async () => ({ results: [] }),
          runnerFactory: () => ({
            run: async (job) => {
              seenMaxConcurrency.push(job.options?.maxConcurrency);
              return {
                jobId: job.id,
                summary: { total: 1, translated: 0, skipped: 0, reused: 0, failed: 0 },
                results: [],
              };
            },
          }),
        },
      );

      await translateSpreadsheetFileJob(
        {
          projectId: 7,
          inputPath,
          outputPath,
          options: { maxConcurrency: 5 },
          job: {},
        },
        {
          defaultMaxConcurrency: 3,
          taskExecutor: async () => ({ results: [] }),
          runnerFactory: () => ({
            run: async (job) => {
              seenMaxConcurrency.push(job.options?.maxConcurrency);
              return {
                jobId: job.id,
                summary: { total: 1, translated: 0, skipped: 0, reused: 0, failed: 0 },
                results: [],
              };
            },
          }),
        },
      );

      expect(seenMaxConcurrency).toEqual([3, 5]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function writeWorkbook(path: string, rows: unknown[][]): void {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  XLSX.writeFile(workbook, path);
}

function readRows(path: string): string[][] {
  const workbook = XLSX.readFile(path);
  return XLSX.utils.sheet_to_json(workbook.Sheets.Sheet1, {
    header: 1,
    defval: '',
  }) as string[][];
}

function makeResult(
  unitId: string,
  source: string,
  target: string,
  metadata: Record<string, unknown>,
): UnitResult {
  return {
    jobId: 'job-1',
    documentId: 'mt.xlsx',
    unitId,
    sourceHash: computeSourceHash({ source }),
    status: 'translated',
    source,
    target,
    metadata,
  };
}
