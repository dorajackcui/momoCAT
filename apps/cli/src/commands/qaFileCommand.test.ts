import { describe, expect, it, vi } from 'vitest';
import { runCli, type CliDependencies } from '../cli';

type FileQaReport = Awaited<ReturnType<NonNullable<CliDependencies['runQAFileCommand']>>>;

function harness() {
  const report: FileQaReport = {
    fileId: 2,
    checkedSegments: 1,
    issueCount: 1,
    affectedSegments: 1,
    issues: [
      { segmentId: 's', row: 2, ruleId: 'empty-target', severity: 'info', message: 'Empty target' },
    ],
  };
  const runQAFileCommand = vi.fn().mockResolvedValue(report);
  const io = {
    stdout: vi.fn(),
    stderr: vi.fn(),
    cwd: 'D:/repo',
    homeDir: 'C:/Users/test',
    platform: 'win32' as const,
    env: {},
    exists: () => true,
    resolvePath: (value: string) => value,
  };
  return { report, runQAFileCommand, deps: { runQAFileCommand } as unknown as CliDependencies, io };
}

describe('qa file command', () => {
  it('prints the shared report counts in normal output', async () => {
    const h = harness();
    expect(await runCli(['qa', 'file', '--project-id', '1', '--file-id', '2'], h.deps, h.io)).toBe(
      0,
    );
    expect(h.io.stdout).toHaveBeenCalledWith('QA: 1 rows checked; 1 findings in 1 rows.\n');
  });
  it('passes repeated groups and reports findings with a successful exit code', async () => {
    const h = harness();
    const argv = [
      'qa',
      'file',
      '--project-id',
      '1',
      '--file-id',
      '2',
      '--db',
      'cat.db',
      '--check',
      'number',
      '--check=empty-target',
      '--json',
    ];
    expect(await runCli(argv, h.deps, h.io)).toBe(0);
    expect(h.runQAFileCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 1,
        fileId: 2,
        dbPath: 'cat.db',
        enabledRuleIds: ['number', 'empty-target'],
      }),
    );
    expect(JSON.parse(h.io.stdout.mock.calls[0][0])).toEqual(h.report);
  });

  it.each([
    ['--input', 'input.xlsx', '--file-id', '2'],
    ['--file-id', '0'],
    ['--file-id', '2', '--fail-on-issues'],
    ['--file-id', '2', '--check', 'unknown'],
    ['--file-id', '2', '--tag-policy', 'none'],
  ])('rejects invalid inputs before running QA: %s', async (...args) => {
    const h = harness();
    expect(await runCli(['qa', 'file', '--project-id', '1', ...args], h.deps, h.io)).not.toBe(0);
    expect(h.runQAFileCommand).not.toHaveBeenCalled();
  });
});
