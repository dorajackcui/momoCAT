import { describe, expect, it, vi } from 'vitest';
import type { FileInspectResult, ProjectFileRecord } from '../../../../shared/ipc';
import {
  buildInspectDefaultPath,
  INSPECT_OUTPUT_FILTERS,
  runFileInspectAction,
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

describe('buildInspectDefaultPath', () => {
  it.each([
    ['demo.xlsx', 'demo_inspect.xlsx'],
    ['demo.csv', 'demo_inspect.xlsx'],
    ['demo', 'demo_inspect.xlsx'],
  ])('builds inspect workbook path for %s', (fileName, expected) => {
    expect(buildInspectDefaultPath(fileName)).toBe(expected);
  });
});

describe('runFileInspectAction', () => {
  it('exports file inspect output inside mutation and reports partial issues as info', async () => {
    const order: string[] = [];
    const result: FileInspectResult = {
      outputPath: 'D:/out/demo_inspect.xlsx',
      jsonOutputPath: 'D:/out/demo_inspect.json',
      summary: { total: 3, ready: 2, error: 1 },
    };
    const saveFileDialog = vi.fn(async () => 'D:/out/demo_inspect.xlsx');
    const inspectFile = vi.fn(async (fileId: number, outputPath: string) => {
      order.push(`inspect:${fileId}:${outputPath}`);
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

    const actual = await runFileInspectAction(createFile(), {
      saveFileDialog,
      inspectFile,
      runMutation,
      success,
      info,
      error,
    });

    expect(saveFileDialog).toHaveBeenCalledWith('demo_inspect.xlsx', INSPECT_OUTPUT_FILTERS);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(inspectFile).toHaveBeenCalledWith(7, 'D:/out/demo_inspect.xlsx');
    expect(order).toEqual(['mutation:start', 'inspect:7:D:/out/demo_inspect.xlsx', 'mutation:end']);
    expect(info).toHaveBeenCalledWith(
      'Inspect exported with issues: 2/3 source rows ready, 1 failed.',
    );
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(actual).toBe(result);
  });

  it('reports pure inspect exports as success', async () => {
    const result: FileInspectResult = {
      outputPath: 'D:/out/demo_inspect.xlsx',
      jsonOutputPath: 'D:/out/demo_inspect.json',
      summary: { total: 3, ready: 3, error: 0 },
    };
    const saveFileDialog = vi.fn(async () => 'D:/out/demo_inspect.xlsx');
    const inspectFile = vi.fn(async () => result);
    const runMutation = vi.fn(async <T>(fn: () => Promise<T>) => fn());
    const success = vi.fn();
    const info = vi.fn();
    const error = vi.fn();

    const actual = await runFileInspectAction(createFile(), {
      saveFileDialog,
      inspectFile,
      runMutation,
      success,
      info,
      error,
    });

    expect(success).toHaveBeenCalledWith('Inspect exported: 3/3 source rows ready.');
    expect(info).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(actual).toBe(result);
  });

  it('returns null without inspecting when save dialog is canceled', async () => {
    const saveFileDialog = vi.fn(async () => null);
    const inspectFile = vi.fn();
    const runMutation = vi.fn(async <T>(fn: () => Promise<T>) => fn());

    const actual = await runFileInspectAction(createFile(), {
      saveFileDialog,
      inspectFile,
      runMutation,
      success: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    });

    expect(saveFileDialog).toHaveBeenCalledWith('demo_inspect.xlsx', INSPECT_OUTPUT_FILTERS);
    expect(inspectFile).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
    expect(actual).toBeNull();
  });

  it('reports save dialog failures with the thrown error message', async () => {
    const saveFileDialog = vi.fn(async () => {
      throw new Error('dialog blew up');
    });
    const inspectFile = vi.fn();
    const runMutation = vi.fn(async <T>(fn: () => Promise<T>) => fn());
    const success = vi.fn();
    const info = vi.fn();
    const error = vi.fn();

    const actual = await runFileInspectAction(createFile(), {
      saveFileDialog,
      inspectFile,
      runMutation,
      success,
      info,
      error,
    });

    expect(inspectFile).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('Inspect failed: dialog blew up');
    expect(actual).toBeNull();
  });

  it('reports inspect failures with the thrown error message', async () => {
    const saveFileDialog = vi.fn(async () => 'D:/out/demo_inspect.xlsx');
    const inspectFile = vi.fn(async () => {
      throw new Error('inspect blew up');
    });
    const runMutation = vi.fn(async <T>(fn: () => Promise<T>) => fn());
    const success = vi.fn();
    const info = vi.fn();
    const error = vi.fn();

    const actual = await runFileInspectAction(createFile(), {
      saveFileDialog,
      inspectFile,
      runMutation,
      success,
      info,
      error,
    });

    expect(inspectFile).toHaveBeenCalledWith(7, 'D:/out/demo_inspect.xlsx');
    expect(success).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('Inspect failed: inspect blew up');
    expect(actual).toBeNull();
  });
});
