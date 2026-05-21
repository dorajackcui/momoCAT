import { describe, expect, it } from 'vitest';
import { runCli } from './cli';
import { isDirectRun } from './index';

function createHarness() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const calls: Array<{ name: string; config: unknown }> = [];
  const deps = {
    runInspectProjectsCommand: (config: unknown) => {
      calls.push({ name: 'inspectProjects', config });
      return {
        dbPath: 'fixture.db',
        generatedAt: '2026-05-21T00:00:00.000Z',
        providers: [],
        projects: [],
      };
    },
    runInspectLocalizationCommand: async (config: unknown) => {
      calls.push({ name: 'inspectLocalization', config });
    },
    runTranslateFileCommand: async (config: unknown) => {
      calls.push({ name: 'translateFile', config });
    },
  };
  const io = {
    cwd: 'D:/repo',
    stdout: (text: string) => stdout.push(text),
    stderr: (text: string) => stderr.push(text),
    exists: (filePath: string) => !filePath.includes('missing'),
    resolvePath: (value: string) => value.replaceAll('\\', '/'),
  };

  return { calls, deps, io, stdout, stderr };
}

describe('momocat CLI dispatch', () => {
  it('prints top-level help', async () => {
    const harness = createHarness();
    const exitCode = await runCli(['--help'], harness.deps, harness.io);

    expect(exitCode).toBe(0);
    expect(harness.stdout.join('')).toContain('Usage: momocat <command>');
    expect(harness.stdout.join('')).toContain('inspect projects');
    expect(harness.stdout.join('')).toContain('translate file');
  });

  it('reports unknown commands with a help pointer', async () => {
    const harness = createHarness();
    const exitCode = await runCli(['nope'], harness.deps, harness.io);

    expect(exitCode).toBe(1);
    expect(harness.stderr.join('')).toContain('Unknown command: nope');
    expect(harness.stderr.join('')).toContain('Run: momocat --help');
  });

  it('prints inspect projects help', async () => {
    const harness = createHarness();
    const exitCode = await runCli(['inspect', 'projects', '--help'], harness.deps, harness.io);

    expect(exitCode).toBe(0);
    expect(harness.stdout.join('')).toContain('Usage: momocat inspect projects');
    expect(harness.stdout.join('')).toContain('--project-id <id>');
    expect(harness.stdout.join('')).toContain('--json');
  });

  it('maps inspect projects options to the localization command API', async () => {
    const harness = createHarness();
    const exitCode = await runCli(
      ['inspect', 'projects', '--db', 'cat.db', '--project-id', '7'],
      harness.deps,
      harness.io,
    );

    expect(exitCode).toBe(0);
    expect(harness.calls).toEqual([
      {
        name: 'inspectProjects',
        config: {
          dbPath: 'cat.db',
          projectId: 7,
        },
      },
    ]);
    expect(harness.stdout.join('')).toContain('Database: fixture.db');
  });

  it('maps inspect projects --db-path equals option to the localization command API', async () => {
    const harness = createHarness();
    const exitCode = await runCli(
      ['inspect', 'projects', '--db-path=cat.db', '--project-id=7'],
      harness.deps,
      harness.io,
    );

    expect(exitCode).toBe(0);
    expect(harness.calls).toEqual([
      {
        name: 'inspectProjects',
        config: {
          dbPath: 'cat.db',
          projectId: 7,
        },
      },
    ]);
  });

  it('prints inspect projects JSON without extra text', async () => {
    const harness = createHarness();
    const exitCode = await runCli(
      ['inspect', 'projects', '--db=cat.db', '--json'],
      harness.deps,
      harness.io,
    );

    expect(exitCode).toBe(0);
    expect(harness.stderr.join('')).toBe('');
    expect(JSON.parse(harness.stdout.join(''))).toEqual({
      dbPath: 'fixture.db',
      generatedAt: '2026-05-21T00:00:00.000Z',
      providers: [],
      projects: [],
    });
  });

  it('reports inspect projects missing database paths before calling localization', async () => {
    const harness = createHarness();
    const exitCode = await runCli(
      ['inspect', 'projects', '--db', 'missing.db'],
      harness.deps,
      harness.io,
    );

    expect(exitCode).toBe(1);
    expect(harness.calls).toEqual([]);
    expect(harness.stderr.join('')).toContain('Database does not exist: missing.db');
  });

  it('prints inspect localization help', async () => {
    const harness = createHarness();
    const exitCode = await runCli(['inspect', 'localization', '--help'], harness.deps, harness.io);

    expect(exitCode).toBe(0);
    expect(harness.stdout.join('')).toContain('Usage: momocat inspect localization');
    expect(harness.stdout.join('')).toContain('--db <path>, --db-path <path>');
    expect(harness.stdout.join('')).toContain('--project-id <id>');
    expect(harness.stdout.join('')).toContain('--json-output <path>');
    expect(harness.stdout.join('')).toContain('--unit-limit <n>');
    expect(harness.stdout.join('')).toContain('--max-cell-chars <n>');
  });

  it('maps inspect localization options to the localization command API', async () => {
    const harness = createHarness();
    const exitCode = await runCli(
      [
        'inspect',
        'localization',
        '--db-path=cat.db',
        '--project-id=7',
        '--input=input.xlsx',
        '--output=inspect.xlsx',
        '--json-output=inspect.json',
        '--unit-limit',
        '12',
        '--max-cell-chars',
        '5000',
      ],
      harness.deps,
      harness.io,
    );

    expect(exitCode).toBe(0);
    expect(harness.stdout.join('')).toBe('');
    expect(harness.calls).toEqual([
      {
        name: 'inspectLocalization',
        config: {
          dbPath: 'cat.db',
          projectId: 7,
          inputPath: 'input.xlsx',
          outputPath: 'inspect.xlsx',
          jsonOutputPath: 'inspect.json',
          unitLimit: 12,
          maxCellChars: 5000,
        },
      },
    ]);
  });

  it('reports inspect localization invalid project id before calling localization', async () => {
    const harness = createHarness();
    const exitCode = await runCli(
      [
        'inspect',
        'localization',
        '--db',
        'cat.db',
        '--project-id',
        '0',
        '--input',
        'input.xlsx',
        '--output',
        'inspect.xlsx',
      ],
      harness.deps,
      harness.io,
    );

    expect(exitCode).toBe(1);
    expect(harness.calls).toEqual([]);
    expect(harness.stderr.join('')).toContain('--project-id must be a positive integer.');
  });

  it('reports inspect localization missing database paths before calling localization', async () => {
    const harness = createHarness();
    const exitCode = await runCli(
      [
        'inspect',
        'localization',
        '--db',
        'missing.db',
        '--project-id',
        '7',
        '--input',
        'input.xlsx',
        '--output',
        'inspect.xlsx',
      ],
      harness.deps,
      harness.io,
    );

    expect(exitCode).toBe(1);
    expect(harness.calls).toEqual([]);
    expect(harness.stderr.join('')).toContain('Database does not exist: missing.db');
  });

  it('reports inspect localization missing input files before calling localization', async () => {
    const harness = createHarness();
    const exitCode = await runCli(
      [
        'inspect',
        'localization',
        '--db',
        'cat.db',
        '--project-id',
        '7',
        '--input',
        'missing.xlsx',
        '--output',
        'inspect.xlsx',
      ],
      harness.deps,
      harness.io,
    );

    expect(exitCode).toBe(1);
    expect(harness.calls).toEqual([]);
    expect(harness.stderr.join('')).toContain('Input file does not exist: missing.xlsx');
  });

  it('reports inspect localization unknown arguments before calling localization', async () => {
    const harness = createHarness();
    const exitCode = await runCli(
      [
        'inspect',
        'localization',
        '--db',
        'cat.db',
        '--project-id',
        '7',
        '--input',
        'input.xlsx',
        '--output',
        'inspect.xlsx',
        '--surprise',
      ],
      harness.deps,
      harness.io,
    );

    expect(exitCode).toBe(1);
    expect(harness.calls).toEqual([]);
    expect(harness.stderr.join('')).toContain('Unknown argument: --surprise');
  });

  it('reports inspect localization unknown equals arguments before missing values', async () => {
    const harness = createHarness();
    const exitCode = await runCli(
      [
        'inspect',
        'localization',
        '--db',
        'cat.db',
        '--project-id',
        '7',
        '--input',
        'input.xlsx',
        '--output',
        'inspect.xlsx',
        '--surprise=',
      ],
      harness.deps,
      harness.io,
    );

    expect(exitCode).toBe(1);
    expect(harness.calls).toEqual([]);
    expect(harness.stderr.join('')).toContain('Unknown argument: --surprise');
  });

  it('reports inspect localization known empty equals options as missing values', async () => {
    const harness = createHarness();
    const exitCode = await runCli(
      [
        'inspect',
        'localization',
        '--db-path=',
        '--project-id',
        '7',
        '--input',
        'input.xlsx',
        '--output',
        'inspect.xlsx',
      ],
      harness.deps,
      harness.io,
    );

    expect(exitCode).toBe(1);
    expect(harness.calls).toEqual([]);
    expect(harness.stderr.join('')).toContain('Missing value for --db-path.');
  });

  it('prints translate file help from the temporary stub', async () => {
    const harness = createHarness();
    const exitCode = await runCli(['translate', 'file', '--help'], harness.deps, harness.io);

    expect(exitCode).toBe(0);
    expect(harness.stdout.join('')).toContain('Usage: momocat translate file');
  });

  it('detects direct execution through resolved real paths', () => {
    const realpath = (filePath: string) => {
      const normalized = filePath.replaceAll('\\', '/');
      if (normalized === 'D:/repo/node_modules/.bin/momocat') {
        return 'D:/repo/apps/cli/dist/index.mjs';
      }
      return normalized;
    };

    expect(
      isDirectRun(
        'D:/repo/node_modules/.bin/momocat',
        'file:///D:/repo/apps/cli/dist/index.mjs',
        realpath,
      ),
    ).toBe(true);
  });

  it('does not detect direct execution without an argv entry', () => {
    expect(isDirectRun(undefined, 'file:///D:/repo/apps/cli/dist/index.mjs')).toBe(false);
  });

  it('does not detect direct execution for mismatched paths', () => {
    const realpath = (filePath: string) => filePath.replaceAll('\\', '/');

    expect(
      isDirectRun(
        'D:/repo/node_modules/.bin/other',
        'file:///D:/repo/apps/cli/dist/index.mjs',
        realpath,
      ),
    ).toBe(false);
  });
});
