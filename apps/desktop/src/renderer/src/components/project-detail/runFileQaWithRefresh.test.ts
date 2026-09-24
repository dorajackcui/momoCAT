import { describe, expect, it, vi } from 'vitest';
import { runFileQaWithRefresh } from './runFileQaWithRefresh';

describe('runFileQaWithRefresh', () => {
  it('runs QA inside mutation and refreshes file list on success', async () => {
    const order: string[] = [];
    const runMutation = vi.fn(async <T>(fn: () => Promise<T>) => {
      order.push('mutation:start');
      const result = await fn();
      order.push('mutation:end');
      return result;
    });
    const runFileQA = vi.fn(async (fileId: number) => {
      order.push(`qa:${fileId}`);
      return {
        fileId,
        checkedSegments: 10,
        issueCount: 0,
        affectedSegments: 0,
        issues: [],
      };
    });
    const loadData = vi.fn(async () => {
      order.push('loadData');
    });

    const report = await runFileQaWithRefresh({
      fileId: 8,
      runMutation,
      runFileQA,
      loadData,
    });

    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runFileQA).toHaveBeenCalledWith(8);
    expect(loadData).toHaveBeenCalledTimes(1);
    expect(report.fileId).toBe(8);
    expect(order).toEqual(['mutation:start', 'qa:8', 'loadData', 'mutation:end']);
  });

  it('does not refresh when QA call fails', async () => {
    const runMutation = vi.fn(async <T>(fn: () => Promise<T>) => fn());
    const runFileQA = vi.fn(async () => {
      throw new Error('qa failed');
    });
    const loadData = vi.fn(async () => {});

    await expect(
      runFileQaWithRefresh({
        fileId: 9,
        runMutation,
        runFileQA,
        loadData,
      }),
    ).rejects.toThrow('qa failed');
    expect(loadData).not.toHaveBeenCalled();
  });
});
