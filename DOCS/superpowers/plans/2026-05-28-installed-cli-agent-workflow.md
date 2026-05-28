# Installed CLI Agent Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an installed `momocat` CLI usable by agents against the installed desktop app's data without requiring repo paths or a mandatory `--db` argument.

**Architecture:** Add a focused CLI data-environment resolver in `apps/cli`, then route `momocat env` and the existing CLI commands through it. Keep desktop unchanged; use the resolved desktop `cat_v1.db` plus sibling `ai-runtime.json` and `proxy.env` when invoking `@cat/localization` command APIs.

**Tech Stack:** TypeScript, Node.js 20 ESM, Vitest, esbuild, npm workspaces, `better-sqlite3`, `xlsx`.

---

## File Structure

- Create `apps/cli/src/env/dataEnvironment.ts`: pure resolver for `cat_v1.db`, user-data candidates, sibling file paths, and missing-DB diagnostics.
- Create `apps/cli/src/env/dataEnvironment.test.ts`: resolver coverage for Windows/macOS/Linux, environment overrides, explicit overrides, and missing candidates.
- Modify `apps/cli/src/parse/args.ts`: extend `CommandIO` with environment and platform fields used by the resolver.
- Modify `apps/cli/src/cli.ts`: add default environment fields, top-level `momocat env` dispatch, updated top-level help, and help routing.
- Create `apps/cli/src/commands/envCommand.ts`: human and JSON self-check output.
- Modify `apps/cli/src/commands/inspectProjectsCommand.ts`: make DB optional and resolve defaults.
- Modify `apps/cli/src/commands/inspectLocalizationCommand.ts`: make DB optional, pass runtime/proxy paths, keep current `window-partial` and `target-baseline` defaults.
- Modify `apps/cli/src/commands/translateFileCommand.ts`: make DB optional, pass runtime/proxy paths, keep context and resume options.
- Modify `apps/cli/src/cli.test.ts`: dispatch tests for `momocat env`, default DB resolution, missing DB guidance, and updated dependency expectations.
- Create `packages/localization/src/cli/runtimeEnvironment.ts`: load optional `proxy.env` and create an AI runtime provider from `ai-runtime.json` without creating new files.
- Create `packages/localization/src/cli/runtimeEnvironment.test.ts`: runtime/proxy helper tests.
- Modify `packages/localization/src/cli/inspectLocalizationCommand.ts`: accept `aiRuntimeConfigPath` and `proxyEnvPath`.
- Modify `packages/localization/src/cli/translateFileCommand.ts`: accept `aiRuntimeConfigPath` and `proxyEnvPath`.
- Modify `apps/cli/package.json`: clean package metadata, runtime dependencies, and packed file list.
- Create `apps/cli/README.md`: installed desktop plus CLI workflow for users and agents.
- Modify `DOCS/40_CLI_OPERATION.md`: source-checkout and installed workflows.

## Task 1: CLI Data Environment Resolver

**Files:**
- Create: `apps/cli/src/env/dataEnvironment.ts`
- Create: `apps/cli/src/env/dataEnvironment.test.ts`
- Modify: `apps/cli/src/parse/args.ts`

- [ ] **Step 1: Extend `CommandIO` with environment metadata**

Modify `apps/cli/src/parse/args.ts` so the interface is:

```ts
export interface CommandIO {
  cwd: string;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  homeDir: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  exists: (filePath: string) => boolean;
  resolvePath: (value: string) => string;
}
```

- [ ] **Step 2: Write failing resolver tests**

Create `apps/cli/src/env/dataEnvironment.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import {
  formatMissingDatabaseMessage,
  getDesktopUserDataDirCandidates,
  resolveDataEnvironment,
} from './dataEnvironment';
import type { CommandIO } from '../parse/args';

function createIO(
  overrides: Partial<CommandIO> & { existing?: string[] } = {},
): CommandIO {
  const existing = new Set((overrides.existing ?? []).map((value) => value.replaceAll('\\', '/')));
  return {
    cwd: overrides.cwd ?? 'D:/repo',
    env: overrides.env ?? {},
    platform: overrides.platform ?? 'win32',
    homeDir: overrides.homeDir ?? 'C:/Users/Ada',
    stdout: overrides.stdout ?? (() => undefined),
    stderr: overrides.stderr ?? (() => undefined),
    exists:
      overrides.exists ??
      ((filePath) => existing.has(filePath.replaceAll('\\', '/'))),
    resolvePath:
      overrides.resolvePath ??
      ((value) => value.replaceAll('\\', '/')),
  };
}

describe('data environment resolver', () => {
  it('uses explicit db path before environment defaults', () => {
    const io = createIO({
      env: {
        MOMOCAT_DB: 'C:/Users/Ada/AppData/Roaming/Simple CAT Tool/cat_v1.db',
      },
      existing: ['D:/custom/cat.db'],
    });

    const result = resolveDataEnvironment(io, { explicitDbPath: 'D:/custom/cat.db' });

    expect(result.dbPath).toBe('D:/custom/cat.db');
    expect(result.source).toBe('explicit');
    expect(result.exists).toBe(true);
    expect(result.userDataDir).toBe('D:/custom');
  });

  it('uses MOMOCAT_DB before MOMOCAT_USER_DATA_DIR', () => {
    const io = createIO({
      env: {
        MOMOCAT_DB: 'D:/env/cat.db',
        MOMOCAT_USER_DATA_DIR: 'D:/userData',
      },
      existing: ['D:/env/cat.db', 'D:/userData/cat_v1.db'],
    });

    const result = resolveDataEnvironment(io);

    expect(result.dbPath).toBe('D:/env/cat.db');
    expect(result.source).toBe('MOMOCAT_DB');
    expect(result.aiRuntimeConfigPath).toBe('D:/env/ai-runtime.json');
    expect(result.proxyEnvPath).toBe('D:/env/proxy.env');
  });

  it('uses MOMOCAT_USER_DATA_DIR when MOMOCAT_DB is not set', () => {
    const io = createIO({
      env: { MOMOCAT_USER_DATA_DIR: 'D:/userData' },
      existing: ['D:/userData/cat_v1.db'],
    });

    const result = resolveDataEnvironment(io);

    expect(result.dbPath).toBe('D:/userData/cat_v1.db');
    expect(result.userDataDir).toBe('D:/userData');
    expect(result.source).toBe('MOMOCAT_USER_DATA_DIR');
  });

  it('builds Windows desktop candidates from APPDATA', () => {
    const io = createIO({
      env: { APPDATA: 'C:/Users/Ada/AppData/Roaming' },
    });

    expect(getDesktopUserDataDirCandidates(io)).toEqual([
      'C:/Users/Ada/AppData/Roaming/Simple CAT Tool',
      'C:/Users/Ada/AppData/Roaming/simple-cat-tool',
    ]);
  });

  it('builds macOS desktop candidates from homeDir', () => {
    const io = createIO({ platform: 'darwin', homeDir: '/Users/ada' });

    expect(getDesktopUserDataDirCandidates(io)).toEqual([
      '/Users/ada/Library/Application Support/Simple CAT Tool',
      '/Users/ada/Library/Application Support/simple-cat-tool',
    ]);
  });

  it('builds Linux desktop candidates from XDG_CONFIG_HOME first', () => {
    const io = createIO({
      platform: 'linux',
      homeDir: '/home/ada',
      env: { XDG_CONFIG_HOME: '/tmp/config' },
    });

    expect(getDesktopUserDataDirCandidates(io)).toEqual([
      '/tmp/config/Simple CAT Tool',
      '/tmp/config/simple-cat-tool',
      '/home/ada/.config/Simple CAT Tool',
      '/home/ada/.config/simple-cat-tool',
    ]);
  });

  it('uses the first existing desktop candidate', () => {
    const io = createIO({
      env: { APPDATA: 'C:/Users/Ada/AppData/Roaming' },
      existing: ['C:/Users/Ada/AppData/Roaming/simple-cat-tool/cat_v1.db'],
    });

    const result = resolveDataEnvironment(io);

    expect(result.dbPath).toBe('C:/Users/Ada/AppData/Roaming/simple-cat-tool/cat_v1.db');
    expect(result.source).toBe('desktop-default');
  });

  it('falls back to source checkout .cat_data when it exists', () => {
    const io = createIO({ existing: ['D:/repo/.cat_data/cat_v1.db'] });

    const result = resolveDataEnvironment(io);

    expect(result.dbPath).toBe('D:/repo/.cat_data/cat_v1.db');
    expect(result.source).toBe('source-checkout-fallback');
  });

  it('returns candidates and guidance without creating a database when none exist', () => {
    const io = createIO({
      env: { APPDATA: 'C:/Users/Ada/AppData/Roaming' },
      existing: [],
    });

    const result = resolveDataEnvironment(io);

    expect(result.dbPath).toBeUndefined();
    expect(result.exists).toBe(false);
    expect(result.candidateDbPaths).toContain('D:/repo/.cat_data/cat_v1.db');
    expect(formatMissingDatabaseMessage(result)).toContain('Could not find Momocat database.');
    expect(formatMissingDatabaseMessage(result)).toContain('Open the desktop app once');
  });
});
```

- [ ] **Step 3: Run resolver tests to verify they fail**

Run:

```bash
npx vitest run apps/cli/src/env/dataEnvironment.test.ts
```

Expected: FAIL because `apps/cli/src/env/dataEnvironment.ts` does not exist.

- [ ] **Step 4: Implement the resolver**

Create `apps/cli/src/env/dataEnvironment.ts`:

```ts
import path from 'node:path';
import type { CommandIO } from '../parse/args';

export type DataEnvironmentSource =
  | 'explicit'
  | 'MOMOCAT_DB'
  | 'MOMOCAT_USER_DATA_DIR'
  | 'desktop-default'
  | 'source-checkout-fallback'
  | 'missing';

export interface DataEnvironmentResolution {
  dbPath?: string;
  userDataDir?: string;
  source: DataEnvironmentSource;
  exists: boolean;
  candidateDbPaths: string[];
  desktopUserDataDirCandidates: string[];
  aiRuntimeConfigPath?: string;
  aiRuntimeConfigExists: boolean;
  proxyEnvPath?: string;
  proxyEnvExists: boolean;
}

export interface ResolveDataEnvironmentOptions {
  explicitDbPath?: string;
}

interface Candidate {
  path: string;
  source: Exclude<DataEnvironmentSource, 'missing'>;
}

const PRODUCT_USER_DATA_DIR = 'Simple CAT Tool';
const PACKAGE_USER_DATA_DIR = 'simple-cat-tool';
const DB_FILE_NAME = 'cat_v1.db';
const AI_RUNTIME_FILE_NAME = 'ai-runtime.json';
const PROXY_ENV_FILE_NAME = 'proxy.env';

export function resolveDataEnvironment(
  io: CommandIO,
  options: ResolveDataEnvironmentOptions = {},
): DataEnvironmentResolution {
  const desktopUserDataDirCandidates = getDesktopUserDataDirCandidates(io);
  const candidates = buildDbCandidates(io, desktopUserDataDirCandidates, options);
  const selected = candidates.find((candidate) => io.exists(candidate.path));

  if (!selected) {
    const sourceCheckoutDbPath = sourceCheckoutDbPathFor(io);
    return {
      source: 'missing',
      exists: false,
      candidateDbPaths: candidates.map((candidate) => candidate.path),
      desktopUserDataDirCandidates,
      aiRuntimeConfigExists: false,
      proxyEnvExists: false,
      aiRuntimeConfigPath: siblingPath(sourceCheckoutDbPath, AI_RUNTIME_FILE_NAME),
      proxyEnvPath: siblingPath(sourceCheckoutDbPath, PROXY_ENV_FILE_NAME),
    };
  }

  const userDataDir = normalizeForDisplay(path.dirname(selected.path));
  const aiRuntimeConfigPath = siblingPath(selected.path, AI_RUNTIME_FILE_NAME);
  const proxyEnvPath = siblingPath(selected.path, PROXY_ENV_FILE_NAME);

  return {
    dbPath: selected.path,
    userDataDir,
    source: selected.source,
    exists: true,
    candidateDbPaths: candidates.map((candidate) => candidate.path),
    desktopUserDataDirCandidates,
    aiRuntimeConfigPath,
    aiRuntimeConfigExists: io.exists(aiRuntimeConfigPath),
    proxyEnvPath,
    proxyEnvExists: io.exists(proxyEnvPath),
  };
}

export function getDesktopUserDataDirCandidates(io: CommandIO): string[] {
  if (io.platform === 'win32') {
    const appData = io.env.APPDATA;
    if (!appData) return [];
    return [
      joinForDisplay(io, appData, PRODUCT_USER_DATA_DIR),
      joinForDisplay(io, appData, PACKAGE_USER_DATA_DIR),
    ];
  }

  if (io.platform === 'darwin') {
    const appSupport = joinForDisplay(io, io.homeDir, 'Library', 'Application Support');
    return [
      joinForDisplay(io, appSupport, PRODUCT_USER_DATA_DIR),
      joinForDisplay(io, appSupport, PACKAGE_USER_DATA_DIR),
    ];
  }

  const dirs: string[] = [];
  if (io.env.XDG_CONFIG_HOME) {
    dirs.push(joinForDisplay(io, io.env.XDG_CONFIG_HOME, PRODUCT_USER_DATA_DIR));
    dirs.push(joinForDisplay(io, io.env.XDG_CONFIG_HOME, PACKAGE_USER_DATA_DIR));
  }
  dirs.push(joinForDisplay(io, io.homeDir, '.config', PRODUCT_USER_DATA_DIR));
  dirs.push(joinForDisplay(io, io.homeDir, '.config', PACKAGE_USER_DATA_DIR));
  return dirs;
}

export function formatMissingDatabaseMessage(resolution: DataEnvironmentResolution): string {
  const candidates = resolution.candidateDbPaths.map((candidate) => `  - ${candidate}`).join('\n');
  return [
    'Could not find Momocat database.',
    'Open the desktop app once so it can create its user data, or pass --db <path>.',
    'Checked:',
    candidates,
  ].join('\n');
}

function buildDbCandidates(
  io: CommandIO,
  desktopUserDataDirCandidates: string[],
  options: ResolveDataEnvironmentOptions,
): Candidate[] {
  const candidates: Candidate[] = [];

  if (options.explicitDbPath) {
    candidates.push({
      path: io.resolvePath(options.explicitDbPath),
      source: 'explicit',
    });
  }

  if (io.env.MOMOCAT_DB) {
    candidates.push({
      path: io.resolvePath(io.env.MOMOCAT_DB),
      source: 'MOMOCAT_DB',
    });
  }

  if (io.env.MOMOCAT_USER_DATA_DIR) {
    candidates.push({
      path: joinForDisplay(io, io.env.MOMOCAT_USER_DATA_DIR, DB_FILE_NAME),
      source: 'MOMOCAT_USER_DATA_DIR',
    });
  }

  for (const userDataDir of desktopUserDataDirCandidates) {
    candidates.push({
      path: joinForDisplay(io, userDataDir, DB_FILE_NAME),
      source: 'desktop-default',
    });
  }

  candidates.push({
    path: sourceCheckoutDbPathFor(io),
    source: 'source-checkout-fallback',
  });

  return dedupeCandidates(candidates);
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.path)) return false;
    seen.add(candidate.path);
    return true;
  });
}

function sourceCheckoutDbPathFor(io: CommandIO): string {
  return joinForDisplay(io, io.cwd, '.cat_data', DB_FILE_NAME);
}

function siblingPath(filePath: string, siblingName: string): string {
  return normalizeForDisplay(path.join(path.dirname(filePath), siblingName));
}

function joinForDisplay(io: CommandIO, ...parts: string[]): string {
  return normalizeForDisplay(io.resolvePath(path.join(...parts)));
}

function normalizeForDisplay(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}
```

- [ ] **Step 5: Run resolver tests to verify they pass**

Run:

```bash
npx vitest run apps/cli/src/env/dataEnvironment.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add apps/cli/src/parse/args.ts apps/cli/src/env/dataEnvironment.ts apps/cli/src/env/dataEnvironment.test.ts
git commit -m "feat(cli): resolve installed desktop data environment"
```

## Task 2: `momocat env` Self-Check Command

**Files:**
- Create: `apps/cli/src/commands/envCommand.ts`
- Modify: `apps/cli/src/cli.ts`
- Modify: `apps/cli/src/cli.test.ts`

- [ ] **Step 1: Add failing dispatch and output tests**

Append these tests inside `describe('momocat CLI dispatch', () => { ... })` in `apps/cli/src/cli.test.ts`:

```ts
  it('prints top-level help with env command', async () => {
    const harness = createHarness();
    const exitCode = await runCli(['--help'], harness.deps, harness.io);

    expect(exitCode).toBe(0);
    expect(harness.stdout.join('')).toContain('env');
  });

  it('prints human-readable env self-check', async () => {
    const harness = createHarness({
      existing: ['D:/repo/.cat_data/cat_v1.db', 'D:/repo/.cat_data/ai-runtime.json'],
    });

    const exitCode = await runCli(['env'], harness.deps, harness.io);

    expect(exitCode).toBe(0);
    expect(harness.stderr.join('')).toBe('');
    expect(harness.stdout.join('')).toContain('Momocat CLI Environment');
    expect(harness.stdout.join('')).toContain('Database: D:/repo/.cat_data/cat_v1.db');
    expect(harness.stdout.join('')).toContain('Source: source-checkout-fallback');
    expect(harness.stdout.join('')).toContain('AI runtime config: D:/repo/.cat_data/ai-runtime.json (found)');
    expect(harness.stdout.join('')).toContain('Proxy env: D:/repo/.cat_data/proxy.env (missing)');
  });

  it('prints machine-readable env JSON', async () => {
    const harness = createHarness({
      env: { MOMOCAT_USER_DATA_DIR: 'D:/userData' },
      existing: ['D:/userData/cat_v1.db'],
    });

    const exitCode = await runCli(['env', '--json'], harness.deps, harness.io);

    expect(exitCode).toBe(0);
    const payload = JSON.parse(harness.stdout.join('')) as {
      database: { path: string; source: string; exists: boolean };
    };
    expect(payload.database).toEqual({
      path: 'D:/userData/cat_v1.db',
      source: 'MOMOCAT_USER_DATA_DIR',
      exists: true,
    });
  });

  it('prints env missing database guidance without failing', async () => {
    const harness = createHarness({ existing: [] });

    const exitCode = await runCli(['env'], harness.deps, harness.io);

    expect(exitCode).toBe(0);
    expect(harness.stdout.join('')).toContain('Database: not found');
    expect(harness.stdout.join('')).toContain('Open the desktop app once');
  });
```

Update `createHarness` in the same file to accept overrides:

```ts
function createHarness(
  overrides: Partial<{
    cwd: string;
    env: Record<string, string | undefined>;
    platform: NodeJS.Platform;
    homeDir: string;
    existing: string[];
  }> = {},
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const calls: Array<{ name: string; config: unknown }> = [];
  const existing = new Set((overrides.existing ?? []).map((value) => value.replaceAll('\\', '/')));
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
    cwd: overrides.cwd ?? 'D:/repo',
    env: overrides.env ?? {},
    platform: overrides.platform ?? 'win32',
    homeDir: overrides.homeDir ?? 'C:/Users/Ada',
    stdout: (text: string) => stdout.push(text),
    stderr: (text: string) => stderr.push(text),
    exists: (filePath: string) => {
      const normalized = filePath.replaceAll('\\', '/');
      if (existing.size > 0) return existing.has(normalized);
      return !normalized.includes('missing');
    },
    resolvePath: (value: string) => value.replaceAll('\\', '/'),
  };

  return { calls, deps, io, stdout, stderr };
}
```

- [ ] **Step 2: Run CLI dispatch tests to verify they fail**

Run:

```bash
npx vitest run apps/cli/src/cli.test.ts -t "env|top-level help"
```

Expected: FAIL because `momocat env` is unknown.

- [ ] **Step 3: Implement `envCommand`**

Create `apps/cli/src/commands/envCommand.ts`:

```ts
import {
  formatMissingDatabaseMessage,
  resolveDataEnvironment,
} from '../env/dataEnvironment';
import type { CommandIO } from '../parse/args';

export interface EnvCommandConfig {
  json: boolean;
}

const CLI_VERSION = '0.1.0';

export function runEnvCliCommand(argv: string[], io: CommandIO): number {
  if (argv[0] === '-h' || argv[0] === '--help') {
    io.stdout(help());
    return 0;
  }

  const config = parseEnvArgs(argv);
  const resolution = resolveDataEnvironment(io);

  if (config.json) {
    io.stdout(
      `${JSON.stringify(
        {
          cliVersion: CLI_VERSION,
          nodeVersion: process.version,
          platform: io.platform,
          database: {
            path: resolution.dbPath ?? null,
            source: resolution.source,
            exists: resolution.exists,
          },
          userDataDir: resolution.userDataDir ?? null,
          desktopUserDataDirCandidates: resolution.desktopUserDataDirCandidates,
          candidateDbPaths: resolution.candidateDbPaths,
          aiRuntimeConfig: {
            path: resolution.aiRuntimeConfigPath ?? null,
            exists: resolution.aiRuntimeConfigExists,
          },
          proxyEnv: {
            path: resolution.proxyEnvPath ?? null,
            exists: resolution.proxyEnvExists,
          },
          guidance: resolution.exists ? null : formatMissingDatabaseMessage(resolution),
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  io.stdout(formatHumanEnv(resolution, io.platform));
  return 0;
}

function parseEnvArgs(argv: string[]): EnvCommandConfig {
  const config: EnvCommandConfig = { json: false };

  for (const arg of argv) {
    if (arg === '--json') {
      config.json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return config;
}

function formatHumanEnv(
  resolution: ReturnType<typeof resolveDataEnvironment>,
  platform: NodeJS.Platform,
): string {
  const dbLine = resolution.dbPath ?? 'not found';
  const aiRuntimeStatus = resolution.aiRuntimeConfigExists ? 'found' : 'missing';
  const proxyStatus = resolution.proxyEnvExists ? 'found' : 'missing';
  const candidateLines = resolution.candidateDbPaths.map((candidate) => `  - ${candidate}`);
  const guidance = resolution.exists ? '' : `\n${formatMissingDatabaseMessage(resolution)}\n`;

  return `Momocat CLI Environment
CLI version: ${CLI_VERSION}
Node version: ${process.version}
Platform: ${platform}
Database: ${dbLine}
Source: ${resolution.source}
User data dir: ${resolution.userDataDir ?? 'not found'}
AI runtime config: ${resolution.aiRuntimeConfigPath ?? 'not found'} (${aiRuntimeStatus})
Proxy env: ${resolution.proxyEnvPath ?? 'not found'} (${proxyStatus})
Candidate databases:
${candidateLines.join('\n')}
${guidance}`;
}

function help(): string {
  return `Usage: momocat env [--json]

Options:
  --json      Print machine-readable JSON.
  -h, --help  Show this help.
`;
}
```

- [ ] **Step 4: Wire `env` into CLI dispatch and default IO**

Modify imports at the top of `apps/cli/src/cli.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
```

Modify `defaultIO`:

```ts
export const defaultIO: CommandIO = {
  cwd: process.cwd(),
  env: process.env,
  platform: process.platform,
  homeDir: os.homedir(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  exists: (filePath) => fs.existsSync(filePath),
  resolvePath: (value) => path.resolve(value),
};
```

Add dispatch before inspect commands:

```ts
    if (domain === 'env') {
      const { runEnvCliCommand } = await import('./commands/envCommand');
      return runEnvCliCommand([action, ...rest].filter((value): value is string => Boolean(value)), io);
    }
```

Update `helpCommandFor`:

```ts
  if (domain === 'env') {
    return 'momocat env --help';
  }
```

Update `topLevelHelp()` command list:

```ts
  env                    Show installed CLI, desktop data, and runtime environment.
  inspect projects       Inspect project readiness, resources, files, and provider status.
  inspect localization   Inspect TM/TB/MT prompt artifacts without provider requests.
  translate file         Translate an external spreadsheet with resumable sidecars.
```

- [ ] **Step 5: Run env tests**

Run:

```bash
npx vitest run apps/cli/src/cli.test.ts -t "env|top-level help"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add apps/cli/src/cli.ts apps/cli/src/cli.test.ts apps/cli/src/commands/envCommand.ts
git commit -m "feat(cli): add environment self-check command"
```

## Task 3: Optional DB Defaults for Existing CLI Commands

**Files:**
- Modify: `apps/cli/src/commands/inspectProjectsCommand.ts`
- Modify: `apps/cli/src/commands/inspectLocalizationCommand.ts`
- Modify: `apps/cli/src/commands/translateFileCommand.ts`
- Modify: `apps/cli/src/cli.test.ts`

- [ ] **Step 1: Add failing command parser tests**

Append tests to `apps/cli/src/cli.test.ts`:

```ts
  it('resolves inspect projects database from MOMOCAT_USER_DATA_DIR when --db is omitted', async () => {
    const harness = createHarness({
      env: { MOMOCAT_USER_DATA_DIR: 'D:/userData' },
      existing: ['D:/userData/cat_v1.db'],
    });

    const exitCode = await runCli(['inspect', 'projects'], harness.deps, harness.io);

    expect(exitCode).toBe(0);
    expect(harness.calls).toEqual([
      {
        name: 'inspectProjects',
        config: {
          dbPath: 'D:/userData/cat_v1.db',
          projectId: undefined,
        },
      },
    ]);
  });

  it('keeps explicit --db ahead of installed defaults for inspect projects', async () => {
    const harness = createHarness({
      env: { MOMOCAT_USER_DATA_DIR: 'D:/userData' },
      existing: ['D:/custom/cat.db', 'D:/userData/cat_v1.db'],
    });

    const exitCode = await runCli(
      ['inspect', 'projects', '--db', 'D:/custom/cat.db'],
      harness.deps,
      harness.io,
    );

    expect(exitCode).toBe(0);
    expect(harness.calls[0]?.config).toEqual({
      dbPath: 'D:/custom/cat.db',
      projectId: undefined,
    });
  });

  it('resolves inspect localization database and runtime sidecars when --db is omitted', async () => {
    const harness = createHarness({
      env: { MOMOCAT_USER_DATA_DIR: 'D:/userData' },
      existing: ['D:/userData/cat_v1.db', 'input.xlsx'],
    });

    const exitCode = await runCli(
      [
        'inspect',
        'localization',
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

    expect(exitCode).toBe(0);
    expect(harness.calls[0]?.config).toEqual({
      dbPath: 'D:/userData/cat_v1.db',
      projectId: 7,
      inputPath: 'input.xlsx',
      outputPath: 'inspect.xlsx',
      requestMode: 'window-partial',
      targetBaseline: 'use-current-targets',
      aiRuntimeConfigPath: 'D:/userData/ai-runtime.json',
      proxyEnvPath: 'D:/userData/proxy.env',
    });
  });

  it('resolves translate file database and runtime sidecars when --db is omitted', async () => {
    const harness = createHarness({
      env: { MOMOCAT_USER_DATA_DIR: 'D:/userData' },
      existing: ['D:/userData/cat_v1.db', 'input.xlsx'],
    });

    const exitCode = await runCli(
      [
        'translate',
        'file',
        '--project-id',
        '7',
        '--input',
        'input.xlsx',
        '--output',
        'translated.xlsx',
      ],
      harness.deps,
      harness.io,
    );

    expect(exitCode).toBe(0);
    expect(harness.calls[0]?.config).toEqual({
      dbPath: 'D:/userData/cat_v1.db',
      projectId: 7,
      inputPath: 'input.xlsx',
      outputPath: 'translated.xlsx',
      requestMode: 'window-partial',
      targetBaseline: 'use-current-targets',
      aiRuntimeConfigPath: 'D:/userData/ai-runtime.json',
      proxyEnvPath: 'D:/userData/proxy.env',
    });
  });

  it('prints installed database guidance when command defaults cannot find a DB', async () => {
    const harness = createHarness({ existing: ['input.xlsx'] });

    const exitCode = await runCli(['inspect', 'projects'], harness.deps, harness.io);

    expect(exitCode).toBe(1);
    expect(harness.calls).toEqual([]);
    expect(harness.stderr.join('')).toContain('Could not find Momocat database.');
    expect(harness.stderr.join('')).toContain('Run: momocat inspect projects --help');
  });
```

- [ ] **Step 2: Run command parser tests to verify they fail**

Run:

```bash
npx vitest run apps/cli/src/cli.test.ts -t "resolves|installed database|explicit --db"
```

Expected: FAIL because existing commands still require or hard-code `.cat_data/cat_v1.db`.

- [ ] **Step 3: Update `inspectProjectsCommand`**

Modify `apps/cli/src/commands/inspectProjectsCommand.ts`:

```ts
import {
  formatMissingDatabaseMessage,
  resolveDataEnvironment,
} from '../env/dataEnvironment';
```

Change the config interface:

```ts
interface InspectProjectsCliConfig {
  dbPath: string;
  projectId?: number;
  json: boolean;
}
```

Change `parseInspectProjectsArgs` to track explicit DB and resolve after parsing:

```ts
function parseInspectProjectsArgs(argv: string[], io: CommandIO): InspectProjectsCliConfig {
  const config: Omit<InspectProjectsCliConfig, 'dbPath'> = {
    json: false,
  };
  let explicitDbPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const equalsIndex = arg.indexOf('=');

    if (arg === '--db' || arg === '--db-path') {
      explicitDbPath = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--db=')) {
      explicitDbPath = requireOptionValue('--db', arg.slice('--db='.length));
      continue;
    }
    if (arg.startsWith('--db-path=')) {
      explicitDbPath = requireOptionValue('--db-path', arg.slice('--db-path='.length));
      continue;
    }
    if (arg === '--project-id') {
      config.projectId = parsePositiveInteger(readValue(argv, index, arg), '--project-id');
      index += 1;
      continue;
    }
    if (arg.startsWith('--project-id=')) {
      config.projectId = parsePositiveInteger(
        requireOptionValue('--project-id', arg.slice('--project-id='.length)),
        '--project-id',
      );
      continue;
    }
    if (arg === '--json') {
      config.json = true;
      continue;
    }
    if (equalsIndex !== -1) {
      throw new Error(`Unknown argument: ${arg.slice(0, equalsIndex)}`);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  const dataEnvironment = resolveDataEnvironment(io, { explicitDbPath });
  if (!dataEnvironment.dbPath) {
    throw new Error(formatMissingDatabaseMessage(dataEnvironment));
  }
  assertExistingPath(io, dataEnvironment.dbPath, 'Database');

  return {
    ...config,
    dbPath: dataEnvironment.dbPath,
  };
}
```

Update `help()` usage and options:

```ts
Usage: momocat inspect projects [--db <path>] [options]

Options:
  --db <path>, --db-path <path>    SQLite DB path. Default: installed desktop data, then .cat_data/cat_v1.db.
```

Update examples to include a no-`--db` example:

```ts
Examples:
  momocat inspect projects
  momocat inspect projects --project-id 3
  momocat inspect projects --db .cat_data/cat_v1.db --json
```

- [ ] **Step 4: Update `inspectLocalizationCommand`**

Modify `apps/cli/src/commands/inspectLocalizationCommand.ts` imports:

```ts
import {
  formatMissingDatabaseMessage,
  resolveDataEnvironment,
} from '../env/dataEnvironment';
```

At the start of `parseInspectLocalizationArgs`, add:

```ts
  let explicitDbPath: string | undefined;
```

In `assignOption`, stop directly assigning `dbPath`. Instead handle `db` and `db-path` in the main loop before `assignOption`:

```ts
    if (equalsIndex !== -1) {
      const name = arg.slice(2, equalsIndex);
      if (name === 'db' || name === 'db-path') {
        explicitDbPath = requireOptionValue(arg.slice(0, equalsIndex), arg.slice(equalsIndex + 1));
        continue;
      }
      if (!isKnownOption(name)) {
        throw new Error(`Unknown argument: ${arg.slice(0, equalsIndex)}`);
      }
      assignOption(config, name, arg.slice(equalsIndex + 1), io, arg.slice(0, equalsIndex));
      continue;
    }

    const name = arg.slice(2);
    if (name === 'db' || name === 'db-path') {
      explicitDbPath = readValue(argv, index, arg);
      index += 1;
      continue;
    }
```

Remove the `db` and `db-path` branch from `assignOption`. Replace the missing DB check:

```ts
  const dataEnvironment = resolveDataEnvironment(io, { explicitDbPath });
  if (!dataEnvironment.dbPath) {
    throw new Error(formatMissingDatabaseMessage(dataEnvironment));
  }
  config.dbPath = dataEnvironment.dbPath;
  config.aiRuntimeConfigPath = dataEnvironment.aiRuntimeConfigPath;
  config.proxyEnvPath = dataEnvironment.proxyEnvPath;
```

Keep existing checks:

```ts
  if (config.projectId === undefined) throw new Error('Missing --project-id.');
  if (!config.inputPath) throw new Error('Missing --input.');
  if (!config.outputPath) throw new Error('Missing --output.');

  assertExistingPath(io, config.dbPath, 'Database');
  assertExistingPath(io, config.inputPath, 'Input file');

  config.requestMode ??= 'window-partial';
  config.targetBaseline ??= 'use-current-targets';
```

Update help usage and DB option:

```ts
Usage: momocat inspect localization [--db <path>] --project-id <id> --input <path> --output <path> [options]

Options:
  --db <path>, --db-path <path>    SQLite DB path. Default: installed desktop data, then .cat_data/cat_v1.db.
```

- [ ] **Step 5: Update `translateFileCommand`**

Apply the same pattern to `apps/cli/src/commands/translateFileCommand.ts`:

- Import `formatMissingDatabaseMessage` and `resolveDataEnvironment`.
- Track `explicitDbPath`.
- Handle `--db`, `--db=`, `--db-path`, and `--db-path=` in the main loop before `assignOption`.
- Remove the `db` branch from `assignOption`.
- After parsing, resolve DB and assign:

```ts
  const dataEnvironment = resolveDataEnvironment(io, { explicitDbPath });
  if (!dataEnvironment.dbPath) {
    throw new Error(formatMissingDatabaseMessage(dataEnvironment));
  }
  config.dbPath = dataEnvironment.dbPath;
  config.aiRuntimeConfigPath = dataEnvironment.aiRuntimeConfigPath;
  config.proxyEnvPath = dataEnvironment.proxyEnvPath;
```

Keep existing defaults:

```ts
  config.requestMode ??= 'window-partial';
  config.targetBaseline ??= 'use-current-targets';
```

Update help usage and DB option:

```ts
Usage: momocat translate file [--db <path>] --project-id <id> --input <path> --output <path> [options]

Options:
  --db <path>, --db-path <path>    SQLite DB path. Default: installed desktop data, then .cat_data/cat_v1.db.
```

- [ ] **Step 6: Run command parser tests**

Run:

```bash
npx vitest run apps/cli/src/cli.test.ts -t "resolves|installed database|explicit --db"
```

Expected: PASS.

- [ ] **Step 7: Run full CLI unit tests**

Run:

```bash
npx vitest run apps/cli/src/cli.test.ts apps/cli/src/env/dataEnvironment.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add apps/cli/src/commands/inspectProjectsCommand.ts apps/cli/src/commands/inspectLocalizationCommand.ts apps/cli/src/commands/translateFileCommand.ts apps/cli/src/cli.test.ts
git commit -m "feat(cli): default commands to desktop database"
```

## Task 4: Headless Runtime Config and Proxy Support

**Files:**
- Create: `packages/localization/src/cli/runtimeEnvironment.ts`
- Create: `packages/localization/src/cli/runtimeEnvironment.test.ts`
- Modify: `packages/localization/src/cli/inspectLocalizationCommand.ts`
- Modify: `packages/localization/src/cli/translateFileCommand.ts`

- [ ] **Step 1: Write failing runtime environment tests**

Create `packages/localization/src/cli/runtimeEnvironment.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCommandAIRuntimeConfigProvider,
  loadProxyEnvFromFile,
} from './runtimeEnvironment';

const tempRoots: string[] = [];

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'momocat-runtime-env-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('CLI runtime environment helpers', () => {
  it('loads model runtime config from an existing ai-runtime.json', async () => {
    const root = createTempRoot();
    const configPath = path.join(root, 'ai-runtime.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        version: 1,
        models: {
          'gpt-test': { reasoningEffort: 'high' },
        },
      }),
    );

    const provider = await createCommandAIRuntimeConfigProvider({ aiRuntimeConfigPath: configPath });

    await expect(provider.getModelConfig('gpt-test')).resolves.toEqual({
      reasoningEffort: 'high',
    });
  });

  it('uses default runtime config when ai-runtime.json is missing without creating a file', async () => {
    const root = createTempRoot();
    const configPath = path.join(root, 'ai-runtime.json');

    const provider = await createCommandAIRuntimeConfigProvider({ aiRuntimeConfigPath: configPath });

    await expect(provider.getModelConfig('gpt-test')).resolves.toEqual({
      reasoningEffort: 'medium',
    });
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('loads proxy env values from KEY=value and export KEY=value lines', () => {
    const root = createTempRoot();
    const proxyPath = path.join(root, 'proxy.env');
    const env: Record<string, string | undefined> = {};
    fs.writeFileSync(
      proxyPath,
      ['# comment', 'HTTPS_PROXY=https://proxy.example', 'export ALL_PROXY=socks://proxy.example'].join('\n'),
    );

    loadProxyEnvFromFile(proxyPath, env);

    expect(env.HTTPS_PROXY).toBe('https://proxy.example');
    expect(env.ALL_PROXY).toBe('socks://proxy.example');
  });

  it('ignores missing proxy env files', () => {
    const env: Record<string, string | undefined> = {};

    loadProxyEnvFromFile(path.join(createTempRoot(), 'missing.env'), env);

    expect(env).toEqual({});
  });
});
```

- [ ] **Step 2: Run runtime helper tests to verify they fail**

Run:

```bash
npx vitest run packages/localization/src/cli/runtimeEnvironment.test.ts
```

Expected: FAIL because `runtimeEnvironment.ts` does not exist.

- [ ] **Step 3: Implement runtime environment helpers**

Create `packages/localization/src/cli/runtimeEnvironment.ts`:

```ts
import fs from 'node:fs';
import { AIRuntimeConfigService, DefaultAIRuntimeConfigProvider } from '../providers/AIRuntimeConfigService';
import type { AIRuntimeConfigProvider } from '../ports';

export interface CommandRuntimeEnvironmentOptions {
  aiRuntimeConfigPath?: string;
  logger?: Pick<Console, 'warn'>;
}

export async function createCommandAIRuntimeConfigProvider(
  options: CommandRuntimeEnvironmentOptions,
): Promise<AIRuntimeConfigProvider> {
  if (!options.aiRuntimeConfigPath || !fs.existsSync(options.aiRuntimeConfigPath)) {
    return new DefaultAIRuntimeConfigProvider();
  }

  const service = new AIRuntimeConfigService(options.aiRuntimeConfigPath, options.logger ?? console);
  await service.initialize();
  return service;
}

export function loadProxyEnvFromFile(
  filePath: string | undefined,
  env: Record<string, string | undefined> = process.env,
): void {
  if (!filePath || !fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const normalized = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
    const separatorIndex = normalized.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = normalized.slice(0, separatorIndex).trim();
    const value = normalized.slice(separatorIndex + 1).trim();
    if (key) {
      env[key] = value;
    }
  }
}
```

- [ ] **Step 4: Run runtime helper tests**

Run:

```bash
npx vitest run packages/localization/src/cli/runtimeEnvironment.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add runtime/proxy paths to command config types**

Modify `packages/localization/src/cli/inspectLocalizationCommand.ts`:

```ts
import {
  createCommandAIRuntimeConfigProvider,
  loadProxyEnvFromFile,
} from './runtimeEnvironment';
```

Extend `InspectLocalizationCommandConfig`:

```ts
  aiRuntimeConfigPath?: string;
  proxyEnvPath?: string;
```

Inside `runInspectLocalizationCommand`, before opening the DB:

```ts
  loadProxyEnvFromFile(config.proxyEnvPath);
  const aiRuntimeConfigProvider = await createCommandAIRuntimeConfigProvider({
    aiRuntimeConfigPath: config.aiRuntimeConfigPath,
  });
```

Construct the inspector with:

```ts
    const inspector = new LocalizationInspector(db, {
      dbPath: config.dbPath,
      aiRuntimeConfigProvider,
    });
```

Modify `packages/localization/src/cli/translateFileCommand.ts` the same way:

```ts
import {
  createCommandAIRuntimeConfigProvider,
  loadProxyEnvFromFile,
} from './runtimeEnvironment';
```

Extend `TranslateFileCommandConfig`:

```ts
  aiRuntimeConfigPath?: string;
  proxyEnvPath?: string;
```

Inside `runTranslateFileCommand`, before opening the DB:

```ts
  loadProxyEnvFromFile(config.proxyEnvPath);
  const aiRuntimeConfigProvider = await createCommandAIRuntimeConfigProvider({
    aiRuntimeConfigPath: config.aiRuntimeConfigPath,
  });
```

Construct the engine with:

```ts
    const engine = new LocalizationEngine(db, {
      dbPath: config.dbPath,
      aiRuntimeConfigProvider,
    });
```

- [ ] **Step 6: Add command-level tests for runtime config forwarding**

Append to existing command tests where command APIs are tested:

In `apps/cli/src/cli.test.ts`, the Task 3 tests already assert `aiRuntimeConfigPath` and `proxyEnvPath` are present in the config. No extra app CLI test is needed.

In `packages/localization/src/cli/runtimeEnvironment.test.ts`, helper behavior is covered. Do not add network/provider tests for proxy; that would be brittle and outside this helper.

- [ ] **Step 7: Run localization CLI helper and app CLI tests**

Run:

```bash
npx vitest run packages/localization/src/cli/runtimeEnvironment.test.ts apps/cli/src/cli.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add packages/localization/src/cli/runtimeEnvironment.ts packages/localization/src/cli/runtimeEnvironment.test.ts packages/localization/src/cli/inspectLocalizationCommand.ts packages/localization/src/cli/translateFileCommand.ts
git commit -m "feat(localization): use desktop runtime settings from cli"
```

## Task 5: CLI Distribution Metadata and User Docs

**Files:**
- Modify: `apps/cli/package.json`
- Create: `apps/cli/README.md`
- Modify: `apps/cli/src/cli.test.ts`
- Modify: `DOCS/40_CLI_OPERATION.md`

- [ ] **Step 1: Add failing package metadata tests**

Replace the current dependency expectation test in `apps/cli/src/cli.test.ts` with:

```ts
  it('declares runtime dependencies and package files for standalone CLI distribution', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      private?: boolean;
      dependencies?: Record<string, string>;
      files?: string[];
    };

    expect(packageJson.private).toBeUndefined();
    expect(packageJson.dependencies).toEqual({
      'better-sqlite3': '^12.6.2',
      xlsx: '^0.18.5',
    });
    expect(packageJson.files).toEqual([
      'dist/index.mjs',
      'dist/src/**/*.d.ts',
      'README.md',
    ]);
  });
```

- [ ] **Step 2: Run package metadata test to verify it fails**

Run:

```bash
npx vitest run apps/cli/src/cli.test.ts -t "standalone CLI distribution"
```

Expected: FAIL because `private` and dependency metadata still describe monorepo-only packaging.

- [ ] **Step 3: Update CLI package metadata**

Modify `apps/cli/package.json` to:

```json
{
  "name": "@cat/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "momocat": "./dist/index.mjs"
  },
  "main": "./dist/index.mjs",
  "types": "./dist/src/index.d.ts",
  "files": [
    "dist/index.mjs",
    "dist/src/**/*.d.ts",
    "README.md"
  ],
  "scripts": {
    "build": "tsc -b && npm run build:bundle",
    "build:bundle": "esbuild src/index.ts --bundle --platform=node --format=esm --target=node20 --banner:js=\"#!/usr/bin/env node\" --outfile=dist/index.mjs --external:better-sqlite3 --external:xlsx",
    "cli": "node dist/index.mjs",
    "test": "vitest run src"
  },
  "dependencies": {
    "better-sqlite3": "^12.6.2",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "@cat/localization": "*",
    "esbuild": "^0.21.5",
    "typescript": "^5.0.0",
    "vitest": "^4.0.18"
  }
}
```

- [ ] **Step 4: Create installed CLI README**

Create `apps/cli/README.md`:

```md
# Momocat CLI

`momocat` is the headless command-line companion for the Momocat desktop app.
Use the desktop app to create projects, configure AI providers, and mount TM/TB
resources. Use this CLI when an agent or script needs to inspect or translate
files against that installed desktop data.

## Install Shape

Version 1 uses two install steps:

1. Install the Momocat desktop app.
2. Install this CLI package so `momocat` is available on `PATH`.

The CLI is not bundled into the desktop installer yet.

## Agent Quick Start

```bash
momocat env
momocat inspect projects
momocat inspect localization --project-id <project-id> --input <input.xlsx> --output <inspect.xlsx>
momocat translate file --project-id <project-id> --input <input.xlsx> --output <translated.xlsx>
```

Run `inspect localization` before `translate file` when debugging prompt shape.
Real translation sends source text and project context to the configured AI
provider.

## Database Resolution

Commands use this order:

1. `--db <path>` or `--db-path <path>`.
2. `MOMOCAT_DB`.
3. `MOMOCAT_USER_DATA_DIR/cat_v1.db`.
4. Installed desktop user-data directories.
5. Source checkout fallback: `.cat_data/cat_v1.db`.

Default installed desktop locations:

- Windows: `%APPDATA%/Simple CAT Tool/cat_v1.db`
- macOS: `~/Library/Application Support/Simple CAT Tool/cat_v1.db`
- Linux: `$XDG_CONFIG_HOME/Simple CAT Tool/cat_v1.db` or `~/.config/Simple CAT Tool/cat_v1.db`

Package-name fallback directories under `simple-cat-tool` are also checked.

## Self-Check

```bash
momocat env
momocat env --json
```

The self-check prints the resolved database path, candidate paths, platform,
Node version, `ai-runtime.json` status, and `proxy.env` status. It never prints
full API keys.

## Commands

```bash
momocat inspect projects [--db <path>] [--project-id <id>] [--json]
momocat inspect localization [--db <path>] --project-id <id> --input <input.xlsx> --output <inspect.xlsx>
momocat translate file [--db <path>] --project-id <id> --input <input.xlsx> --output <translated.xlsx>
momocat translate file [--db <path>] --project-id <id> --input <input.xlsx> --output <translated.xlsx> --resume
```

Use `--help` on any command for command-specific options.

## Sidecars

`translate file` writes the output workbook and sidecars next to the output by
default:

- `<translated>.checkpoint.jsonl`
- `<translated>.events.jsonl`
- `<translated>.snapshot.xlsx`

Use the same output and sidecar paths when resuming.

## Troubleshooting

- Missing database: launch the desktop app once, or pass `--db <path>`.
- Missing provider: run `momocat inspect projects`, then configure an AI
  provider in the desktop app.
- Unsupported schema: the installed CLI and desktop app must target the same
  current schema.
- Native dependency failure: reinstall the CLI package on the target machine so
  `better-sqlite3` is built for that OS and Node version.

## Concurrent Use

Reads are fine while the desktop app is open. Run long translations when the
desktop app is idle or closed because both processes use the same SQLite
database and project settings.
```

- [ ] **Step 5: Update CLI operation docs**

Modify `DOCS/40_CLI_OPERATION.md`:

- In "Before Running Commands", split installed and source checkout usage.
- Add:

```md
## Installed Desktop + CLI Workflow

Use this flow when Momocat is installed as a desktop app and `momocat` is
installed on `PATH`.

```bash
momocat env
momocat inspect projects
momocat inspect localization --project-id <project-id> --input <input.xlsx> --output <inspect.xlsx>
momocat translate file --project-id <project-id> --input <input.xlsx> --output <translated.xlsx>
```

The CLI resolves the desktop database automatically. Override with `--db`,
`MOMOCAT_DB`, or `MOMOCAT_USER_DATA_DIR` when needed.
```

- Update command examples so the first example omits `--db`, and keep `--db`
  examples as explicit overrides.
- Add a troubleshooting section mirroring `apps/cli/README.md`.

- [ ] **Step 6: Run metadata and CLI tests**

Run:

```bash
npx vitest run apps/cli/src/cli.test.ts
```

Expected: PASS.

- [ ] **Step 7: Build CLI and inspect packed file list**

Run:

```bash
npm run build:cli
npm pack --workspace=apps/cli --dry-run --json
```

Expected:

- Build exits 0.
- Pack output includes `dist/index.mjs`, declaration files, `README.md`, and `package.json`.
- Pack output does not include `src/*.test.ts`, source `.ts` files, or `dist/tsconfig.tsbuildinfo`.

- [ ] **Step 8: Commit Task 5**

```bash
git add apps/cli/package.json apps/cli/README.md apps/cli/src/cli.test.ts DOCS/40_CLI_OPERATION.md
git commit -m "docs(cli): document installed agent workflow"
```

## Task 6: End-to-End Verification

**Files:**
- No new files unless verification reveals a failing test that needs a targeted fix.

- [ ] **Step 1: Run focused CLI and localization tests**

Run:

```bash
npx vitest run apps/cli/src/cli.test.ts apps/cli/src/env/dataEnvironment.test.ts packages/localization/src/cli/runtimeEnvironment.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full CLI package test**

Run:

```bash
npm test --workspace=apps/cli
```

Expected: PASS.

- [ ] **Step 3: Build CLI**

Run:

```bash
npm run build:cli
```

Expected: PASS and `apps/cli/dist/index.mjs` exists.

- [ ] **Step 4: Smoke CLI help from built output**

Run:

```bash
node apps/cli/dist/index.mjs --help
node apps/cli/dist/index.mjs env --json
node apps/cli/dist/index.mjs inspect projects --help
node apps/cli/dist/index.mjs inspect localization --help
node apps/cli/dist/index.mjs translate file --help
```

Expected:

- All commands exit 0.
- Top-level help lists `env`.
- Command help says `--db` defaults to installed desktop data and then `.cat_data/cat_v1.db`.
- `env --json` prints valid JSON and does not create a database.

- [ ] **Step 5: Verify pack dry-run**

Run:

```bash
npm pack --workspace=apps/cli --dry-run --json
```

Expected: pack list is clean as described in Task 5.

- [ ] **Step 6: Check git status**

Run:

```bash
git status --short
```

Expected: clean or only intentional changes from fixes made during verification.

- [ ] **Step 7: Commit final verification fixes only when verification changed files**

If Step 6 is clean, do not create an empty commit.

If Step 6 shows intentional verification fixes, first run:

```bash
git status --short
```

Then stage the exact files shown by `git status --short` that belong to the
verification fix, and commit them:

```bash
git commit -m "test(cli): verify installed agent workflow"
```

## Spec Coverage Self-Review

- Installed desktop plus separate CLI deliverables: Task 5 docs and package metadata.
- Default installed desktop DB resolution: Tasks 1 and 3.
- `momocat env` self-check: Task 2.
- Existing commands work without mandatory `--db`: Task 3.
- Runtime config and proxy sibling files: Task 4.
- Missing DB and no implicit DB creation: Tasks 1, 2, and 3.
- Distribution cleanup: Task 5.
- User and agent docs: Task 5.
- Verification commands: Task 6.

No implementation task ships CLI inside the desktop installer, modifies desktop startup behavior, or changes database schema.
