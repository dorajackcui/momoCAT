import { describe, expect, it, vi } from 'vitest';
import type { FileReferenceExportResult, ProjectFileRecord } from '../../../../shared/ipc';
import {
  buildReferenceExportDefaultPath,
  INSPECT_OUTPUT_FILTERS,
  runFileReferenceExportAction,
} from './fileInspectAction';

function createFile(overrides?: Partial<ProjectFileRecord>): ProjectFileRecord {
  return {
    id: 7,
    uuid: 'file-7',
    projectId: 100,
    name: 'demo.xlsx',
    totalSegments: 10,
    confirmedSegments: 0,
    importOptionsJson: null,
    segmentStatusStats: {
      totalSegments: 10,
      qaProblemSegments: 0,
      confirmedSegmentsForBar: 0,
      inProgressSegments: 0,
      newSegments: 10,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('buildReferenceExportDefaultPath', () => {
  it.each([
    ['demo.xlsx', 'demo_tm_tb_refs.xlsx'],
    ['demo.csv', 'demo_tm_tb_refs.xlsx'],
    ['demo', 'demo_tm_tb_refs.xlsx'],
  ])('builds reference export workbook path for %s', (fileName, expected) => {
    expect(buildReferenceExportDefaultPath(fileName)).toBe(expected);
  });
});

describe('runFileReferenceExportAction', () => {
  it('exports TM/TB references inside mutation and reports partial issues as info', async () => {
    const order: string[] = [];
    const result: FileReferenceExportResult = {
      outputPath: 'D:/out/demo_tm_tb_refs.xlsx',
      summary: { total: 3, ready: 2, error: 1 },
    };
    const saveFileDialog = vi.fn(async () => 'D:/out/demo_tm_tb_refs.xlsx');
    const exportReferencesForMt = vi.fn(async (fileId: number, outputPath: string) => {
      order.push(`references:${fileId}:${outputPath}`);
      return result;
    });
    const runMutation = vi.fn(async <T>(fn: () => Promise<T>) => {
      order.push('mutation:start');
      const mutationResult = await fn();
      order.push('mutation:end');
      return mutationResult;
    });
    const success = vi.fn();
    const info = vi.fn();
    const error = vi.fn();

    const actual = await runFileReferenceExportAction(createFile(), {
      saveFileDialog,
      exportReferencesForMt,
      runMutation,
      success,
      info,
      error,
    });

    expect(saveFileDialog).toHaveBeenCalledWith('demo_tm_tb_refs.xlsx', INSPECT_OUTPUT_FILTERS);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(exportReferencesForMt).toHaveBeenCalledWith(7, 'D:/out/demo_tm_tb_refs.xlsx');
    expect(order).toEqual([
      'mutation:start',
      'references:7:D:/out/demo_tm_tb_refs.xlsx',
      'mutation:end',
    ]);
    expect(info).toHaveBeenCalledWith(
      'TM/TB refs exported with issues: 2/3 source rows ready, 1 failed.',
    );
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(actual).toBe(result);
  });

  it('reports pure reference exports as success', async () => {
    const result: FileReferenceExportResult = {
      outputPath: 'D:/out/demo_tm_tb_refs.xlsx',
      summary: { total: 3, ready: 3, error: 0 },
    };
    const saveFileDialog = vi.fn(async () => 'D:/out/demo_tm_tb_refs.xlsx');
    const exportReferencesForMt = vi.fn(async () => result);
    const runMutation = vi.fn(async <T>(fn: () => Promise<T>) => fn());
    const success = vi.fn();
    const info = vi.fn();
    const error = vi.fn();

    const actual = await runFileReferenceExportAction(createFile(), {
      saveFileDialog,
      exportReferencesForMt,
      runMutation,
      success,
      info,
      error,
    });

    expect(success).toHaveBeenCalledWith('TM/TB refs exported: 3/3 source rows ready.');
    expect(info).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(actual).toBe(result);
  });

  it('returns null without exporting when save dialog is canceled', async () => {
    const saveFileDialog = vi.fn(async () => null);
    const exportReferencesForMt = vi.fn();
    const runMutation = vi.fn(async <T>(fn: () => Promise<T>) => fn());

    const actual = await runFileReferenceExportAction(createFile(), {
      saveFileDialog,
      exportReferencesForMt,
      runMutation,
      success: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    });

    expect(saveFileDialog).toHaveBeenCalledWith('demo_tm_tb_refs.xlsx', INSPECT_OUTPUT_FILTERS);
    expect(exportReferencesForMt).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
    expect(actual).toBeNull();
  });

  it('reports save dialog failures with the thrown error message', async () => {
    const saveFileDialog = vi.fn(async () => {
      throw new Error('dialog blew up');
    });
    const exportReferencesForMt = vi.fn();
    const runMutation = vi.fn(async <T>(fn: () => Promise<T>) => fn());
    const success = vi.fn();
    const info = vi.fn();
    const error = vi.fn();

    const actual = await runFileReferenceExportAction(createFile(), {
      saveFileDialog,
      exportReferencesForMt,
      runMutation,
      success,
      info,
      error,
    });

    expect(exportReferencesForMt).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('TM/TB refs export failed: dialog blew up');
    expect(actual).toBeNull();
  });

  it('reports reference export failures with the thrown error message', async () => {
    const saveFileDialog = vi.fn(async () => 'D:/out/demo_tm_tb_refs.xlsx');
    const exportReferencesForMt = vi.fn(async () => {
      throw new Error('export blew up');
    });
    const runMutation = vi.fn(async <T>(fn: () => Promise<T>) => fn());
    const success = vi.fn();
    const info = vi.fn();
    const error = vi.fn();

    const actual = await runFileReferenceExportAction(createFile(), {
      saveFileDialog,
      exportReferencesForMt,
      runMutation,
      success,
      info,
      error,
    });

    expect(exportReferencesForMt).toHaveBeenCalledWith(7, 'D:/out/demo_tm_tb_refs.xlsx');
    expect(success).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('TM/TB refs export failed: export blew up');
    expect(actual).toBeNull();
  });
});
