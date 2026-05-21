# CLI App Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `apps/cli` as the first-class `momocat` CLI app and move the three existing root CLI commands behind the clean dependency chain `apps/cli -> @cat/localization -> @cat/db -> @cat/core`.

**Architecture:** `apps/cli` owns command grammar, argv parsing, help text, stdout/stderr formatting, and exit codes. `@cat/localization` owns headless command behavior and typed results, including the project inspection behavior currently living in `scripts/inspect-projects.mjs`. Architecture guardrails enforce that `apps/cli` never imports desktop, `@cat/db`, or `@cat/core` directly.

**Tech Stack:** TypeScript, Node 20 ESM, esbuild for CLI bundling, Vitest for package and CLI tests, existing `@cat/localization`, `@cat/db`, and `@cat/core`.

---

## File Structure

Create and modify these files.

`packages/localization/src/cli/inspectProjectsCommand.ts`

- New command API for project inspection.
- Opens `CATDatabase`, uses public DB methods, returns typed summary data.
- Contains provider-status helpers and file status summarization formerly in `scripts/inspect-projects.mjs`.

`packages/localization/src/cli/inspectProjectsCommand.test.ts`

- New Vitest coverage for the typed project inspection result.
- Verifies project filtering, mounted TM/TB/file status output, and no full API-key leakage.

`packages/localization/src/index.ts`

- Export `runInspectProjectsCommand` and its public types.

`packages/db/src/index.ts`

- Remove the debug `console.log("[DB] Listing projects")` from `CATDatabase.listProjects()` so JSON CLI output is not polluted by DB logging.

`apps/cli/package.json`

- New workspace app package.
- Exposes `momocat` bin.
- Provides `build`, `test`, and `cli` scripts.

`apps/cli/tsconfig.json`

- New TS project with path mapping for `@cat/localization`.

`apps/cli/src/index.ts`

- Node bin entrypoint.
- Calls `runCli(process.argv.slice(2))`.

`apps/cli/src/cli.ts`

- Command dispatch, dependency injection for tests, top-level help, and shared IO contract.

`apps/cli/src/parse/args.ts`

- Small argv helper functions: option reading, positive integer parsing, path resolution, and file-existence checks.

`apps/cli/src/output/formatProjects.ts`

- Human-readable formatter for `inspect projects`.

`apps/cli/src/commands/inspectProjectsCommand.ts`

- Parses `momocat inspect projects` options and calls `runInspectProjectsCommand`.

`apps/cli/src/commands/inspectLocalizationCommand.ts`

- Parses `momocat inspect localization` options and calls `runInspectLocalizationCommand`.

`apps/cli/src/commands/translateFileCommand.ts`

- Parses `momocat translate file` options and calls `runTranslateFileCommand`.

`apps/cli/src/cli.test.ts`

- Vitest tests for help, unknown commands, option mapping, JSON output, and error behavior.

`package.json`

- Remove the old CLI product scripts: `inspect:projects`, `inspect:localization`, and `translate:file`.
- Add one repository-local development helper: `cli`.

`DOCS/architecture/GATE05_GUARDRAILS.json`

- Add forbidden import rules for the CLI boundary.

`DOCS/00_START_HERE.md`

- Replace old root CLI script examples with `momocat ...` and `npm run cli -- ...`.

`DOCS/10_ARCHITECTURE.md`

- Add `apps/cli` as a peer app to `apps/desktop`.
- Document the enforced dependency graph.

`DOCS/agent-first/CLI.md`

- Rewrite command examples around `momocat`.

`DOCS/40_STATUS_AND_ROADMAP.md`

- Update current direction if the root script removal changes the active CLI status.

Delete after migration:

```text
scripts/inspect-projects.mjs
scripts/inspect-projects.test.mjs
scripts/inspect-localization.mjs
scripts/inspect-localization-runner.mjs
scripts/inspect-localization.test.mjs
scripts/translate-file.mjs
scripts/translate-file-runner.mjs
scripts/translate-file.test.mjs
```

---

### Task 1: Add `inspect projects` Command API To `@cat/localization`

**Files:**

- Create: `packages/localization/src/cli/inspectProjectsCommand.test.ts`
- Create: `packages/localization/src/cli/inspectProjectsCommand.ts`
- Modify: `packages/localization/src/index.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing localization command test**

Create `packages/localization/src/cli/inspectProjectsCommand.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATDatabase } from '@cat/db';
import type { Segment } from '@cat/core/models';
import { runInspectProjectsCommand } from './inspectProjectsCommand';

function createSegment(fileId: number, index: number, targetText: string, status: Segment['status']): Segment {
  return {
    segmentId: `seg-${index}`,
    fileId,
    orderIndex: index,
    sourceTokens: [{ type: 'text', content: `Source ${index}` }],
    targetTokens: targetText ? [{ type: 'text', content: targetText }] : [],
    status,
    tagsSignature: '',
    matchKey: `source-${index}`,
    srcHash: `hash-${index}`,
    meta: {
      rowRef: index,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

function createFixtureDb() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'momocat-inspect-projects-'));
  const dbPath = path.join(tempRoot, 'cat_v1.db');
  const db = new CATDatabase(dbPath);

  const projectId = db.createProject('Fixture Project', 'en-US', 'zh-CN', 'translation');
  db.updateProjectAISettings(projectId, 'Use concise style.', 'custom:test-provider');
  db.setSetting(
    'ai_provider_catalog_v1',
    JSON.stringify([
      {
        id: 'custom:test-provider',
        name: 'Test Provider',
        baseUrl: 'https://example.invalid/v1/',
        model: 'test-model',
        protocol: 'chat-completions',
        kind: 'custom',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]),
  );
  db.setSetting('ai_provider_key::custom:test-provider', 'sk-test-1234567890');

  const tmId = db.createTM('Client Main TM', 'en-US', 'zh-CN', 'main');
  db.mountTMToProject(projectId, tmId, 10, 'read');
  const tbId = db.createTermBase('Client Terms', 'en-US', 'zh-CN');
  db.mountTermBaseToProject(projectId, tbId, 20);

  const fileId = db.createFile(projectId, 'fixture.xlsx');
  db.bulkInsertSegments([
    createSegment(fileId, 1, '', 'new'),
    createSegment(fileId, 2, '你好', 'translated'),
  ]);
  db.close();

  return { dbPath, projectId, tempRoot };
}

describe('runInspectProjectsCommand', () => {
  it('returns project, provider, mounted resource, file, and status summaries', () => {
    const { dbPath, projectId, tempRoot } = createFixtureDb();
    try {
      const result = runInspectProjectsCommand({
        dbPath,
        generatedAt: () => '2026-05-21T00:00:00.000Z',
      });

      expect(result.dbPath).toBe(dbPath);
      expect(result.generatedAt).toBe('2026-05-21T00:00:00.000Z');
      expect(result.providers).toEqual([
        {
          id: 'custom:test-provider',
          name: 'Test Provider',
          baseUrl: 'https://example.invalid/v1',
          model: 'test-model',
          kind: 'custom',
          apiKeySet: true,
          apiKeyLast4: '7890',
        },
      ]);
      expect(result.projects).toHaveLength(1);
      expect(result.projects[0]).toMatchObject({
        id: projectId,
        name: 'Fixture Project',
        srcLang: 'en-US',
        tgtLang: 'zh-CN',
        projectType: 'translation',
        promptChars: 'Use concise style.'.length,
      });
      expect(result.projects[0].model.id).toBe('custom:test-provider');
      expect(result.projects[0].mountedTMs[0].name).toBe('Client Main TM');
      expect(result.projects[0].mountedTBs[0].name).toBe('Client Terms');
      expect(result.projects[0].files[0]).toMatchObject({
        name: 'fixture.xlsx',
        totalSegments: 2,
        targetRows: 1,
        confirmedSegments: 0,
        statusCounts: {
          new: 1,
          translated: 1,
        },
      });
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('filters by project id and never returns full API keys', () => {
    const { dbPath, projectId, tempRoot } = createFixtureDb();
    try {
      const result = runInspectProjectsCommand({
        dbPath,
        projectId,
        generatedAt: () => '2026-05-21T00:00:00.000Z',
      });

      expect(result.projects.map((project) => project.id)).toEqual([projectId]);
      expect(JSON.stringify(result)).not.toContain('sk-test-1234567890');
      expect(JSON.stringify(result)).toContain('"apiKeyLast4":"7890"');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
npx vitest run packages/localization/src/cli/inspectProjectsCommand.test.ts
```

Expected: FAIL with a module resolution error for `./inspectProjectsCommand`.

- [ ] **Step 3: Remove DB list-project debug output**

Modify `packages/db/src/index.ts` inside `CATDatabase.listProjects()`:

```ts
  public listProjects(): (ProjectListRecord & {
    progress: number;
    fileCount: number;
  })[] {
    const projects = this.projectRepo.listProjects();
```

Remove only this line:

```ts
    console.log("[DB] Listing projects");
```

This keeps `momocat inspect projects --json` from receiving non-JSON stdout when
the CLI calls the localization command API.

- [ ] **Step 4: Implement the command API**

Create `packages/localization/src/cli/inspectProjectsCommand.ts`:

```ts
import { CATDatabase } from '@cat/db';
import {
  BUILTIN_OPENAI_PROVIDER_MODELS,
  DEFAULT_PROJECT_AI_MODEL,
  normalizeProjectAIModel,
} from '@cat/core/project';
import type { Segment } from '@cat/core/models';

const PROVIDER_CATALOG_KEY = 'ai_provider_catalog_v1';
const PROVIDER_KEY_PREFIX = 'ai_provider_key::';
const OPENAI_API_KEY = 'openai_api_key';
const BUILTIN_OPENAI_BASE_URL = 'https://api.openai.com/v1';

export interface InspectProjectsCommandConfig {
  dbPath: string;
  projectId?: number;
  generatedAt?: () => string;
}

export interface InspectProviderSummary {
  id: string;
  name: string;
  baseUrl: string | null;
  model: string | null;
  kind: 'builtin' | 'custom';
  apiKeySet: boolean;
  apiKeyLast4: string | null;
  configuredId?: string | null;
  fallbackFrom?: string | null;
  resolvedId?: string;
}

export interface InspectMountedTMSummary {
  id: string;
  name: string;
  srcLang: string;
  tgtLang: string;
  type: string;
  priority: number;
  permission: string;
  isEnabled: boolean;
}

export interface InspectMountedTBSummary {
  id: string;
  name: string;
  srcLang: string;
  tgtLang: string;
  priority: number;
  isEnabled: boolean;
}

export interface InspectProjectFileSummary {
  id: number;
  name: string;
  totalSegments: number;
  targetRows: number;
  confirmedSegments: number;
  statusCounts: Record<string, number>;
}

export interface InspectProjectSummary {
  id: number;
  name: string;
  srcLang: string;
  tgtLang: string;
  projectType: string | undefined;
  promptChars: number;
  model: InspectProviderSummary;
  mountedTMs: InspectMountedTMSummary[];
  mountedTBs: InspectMountedTBSummary[];
  files: InspectProjectFileSummary[];
}

export interface InspectProjectsResult {
  dbPath: string;
  generatedAt: string;
  providers: InspectProviderSummary[];
  projects: InspectProjectSummary[];
}

interface StoredCustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  protocol: 'chat-completions';
  kind: 'custom';
}

export function runInspectProjectsCommand(
  config: InspectProjectsCommandConfig,
): InspectProjectsResult {
  const db = new CATDatabase(config.dbPath);
  try {
    const settings = readSettings(db);
    const customProviders = readCustomProviders(settings);
    const customProviderById = new Map(customProviders.map((provider) => [provider.id, provider]));
    const projects = readProjects(db, config.projectId).map((project) =>
      inspectProject(db, project, settings, customProviderById),
    );

    return {
      dbPath: config.dbPath,
      generatedAt: config.generatedAt ? config.generatedAt() : new Date().toISOString(),
      providers: customProviders,
      projects,
    };
  } finally {
    db.close();
  }
}

function readSettings(db: CATDatabase): Map<string, string> {
  const settings = new Map<string, string>();
  for (const key of [PROVIDER_CATALOG_KEY, OPENAI_API_KEY]) {
    const value = db.getSetting(key);
    if (value !== undefined) {
      settings.set(key, value);
    }
  }

  const rawCatalog = settings.get(PROVIDER_CATALOG_KEY);
  if (!rawCatalog) {
    return settings;
  }

  try {
    const parsed = JSON.parse(rawCatalog) as unknown;
    if (!Array.isArray(parsed)) {
      return settings;
    }
    for (const provider of parsed) {
      if (isStoredCustomProvider(provider)) {
        const key = buildProviderKey(provider.id);
        const value = db.getSetting(key);
        if (value !== undefined) {
          settings.set(key, value);
        }
      }
    }
  } catch {
    return settings;
  }

  return settings;
}

function readProjects(db: CATDatabase, projectId: number | undefined) {
  if (projectId !== undefined) {
    const project = db.getProject(projectId);
    return project ? [project] : [];
  }
  return db.listProjects();
}

function inspectProject(
  db: CATDatabase,
  project: ReturnType<CATDatabase['getProject']> extends infer T ? NonNullable<T> : never,
  settings: Map<string, string>,
  customProviderById: Map<string, InspectProviderSummary>,
): InspectProjectSummary {
  return {
    id: project.id,
    name: project.name,
    srcLang: project.srcLang,
    tgtLang: project.tgtLang,
    projectType: project.projectType,
    promptChars: project.aiPrompt ? project.aiPrompt.length : 0,
    model: resolveProjectModel(project.aiModel, settings, customProviderById),
    mountedTMs: db.getProjectMountedTMs(project.id).map((tm) => ({
      id: tm.id,
      name: tm.name,
      srcLang: tm.srcLang,
      tgtLang: tm.tgtLang,
      type: tm.type,
      priority: tm.priority,
      permission: tm.permission,
      isEnabled: Boolean(tm.isEnabled),
    })),
    mountedTBs: db.getProjectMountedTermBases(project.id).map((tb) => ({
      id: tb.id,
      name: tb.name,
      srcLang: tb.srcLang,
      tgtLang: tb.tgtLang,
      priority: tb.priority,
      isEnabled: Boolean(tb.isEnabled),
    })),
    files: db.listFiles(project.id).map((file) => inspectFile(db, file)),
  };
}

function inspectFile(
  db: CATDatabase,
  file: ReturnType<CATDatabase['listFiles']>[number],
): InspectProjectFileSummary {
  const segments = file.totalSegments > 0 ? db.getSegmentsPage(file.id, 0, file.totalSegments) : [];
  return {
    id: file.id,
    name: file.name,
    totalSegments: file.totalSegments,
    confirmedSegments: file.confirmedSegments,
    targetRows: countTargetRows(segments),
    statusCounts: countStatuses(segments),
  };
}

function countTargetRows(segments: Segment[]): number {
  return segments.filter((segment) => segment.targetTokens.length > 0).length;
}

function countStatuses(segments: Segment[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const segment of segments) {
    counts[segment.status] = (counts[segment.status] ?? 0) + 1;
  }
  return counts;
}

function readCustomProviders(settings: Map<string, string>): InspectProviderSummary[] {
  const raw = settings.get(PROVIDER_CATALOG_KEY);
  if (!raw) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(isStoredCustomProvider).map((provider) => {
    const apiKey = settings.get(buildProviderKey(provider.id)) ?? '';
    return {
      id: provider.id,
      name: provider.name,
      baseUrl: normalizeBaseUrl(provider.baseUrl),
      model: provider.model,
      kind: 'custom',
      apiKeySet: Boolean(apiKey),
      apiKeyLast4: apiKey ? apiKey.slice(-4) : null,
    };
  });
}

function isStoredCustomProvider(value: unknown): value is StoredCustomProvider {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<StoredCustomProvider>;
  return (
    candidate.kind === 'custom' &&
    candidate.protocol === 'chat-completions' &&
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.baseUrl === 'string' &&
    typeof candidate.model === 'string'
  );
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function buildProviderKey(providerId: string): string {
  return `${PROVIDER_KEY_PREFIX}${providerId}`;
}

function resolveProjectModel(
  rawModel: string | null | undefined,
  settings: Map<string, string>,
  customProviderById: Map<string, InspectProviderSummary>,
): InspectProviderSummary {
  const configuredId = typeof rawModel === 'string' && rawModel.trim() ? rawModel.trim() : null;
  const normalizedId = normalizeProjectAIModel(configuredId);
  const customProvider = customProviderById.get(normalizedId);
  if (customProvider) {
    return {
      ...customProvider,
      configuredId,
      fallbackFrom: null,
    };
  }

  if (normalizedId.startsWith('custom:')) {
    const apiKey = settings.get(buildProviderKey(normalizedId)) ?? '';
    return {
      id: normalizedId,
      configuredId,
      name: 'Unknown custom provider',
      baseUrl: null,
      model: null,
      kind: 'custom',
      apiKeySet: Boolean(apiKey),
      apiKeyLast4: apiKey ? apiKey.slice(-4) : null,
      fallbackFrom: normalizedId,
      resolvedId: DEFAULT_PROJECT_AI_MODEL,
    };
  }

  const providerId = Object.hasOwn(BUILTIN_OPENAI_PROVIDER_MODELS, normalizedId)
    ? normalizedId
    : DEFAULT_PROJECT_AI_MODEL;
  const defaultProviderId =
    DEFAULT_PROJECT_AI_MODEL as keyof typeof BUILTIN_OPENAI_PROVIDER_MODELS;
  const model =
    BUILTIN_OPENAI_PROVIDER_MODELS[
      providerId as keyof typeof BUILTIN_OPENAI_PROVIDER_MODELS
    ] ?? BUILTIN_OPENAI_PROVIDER_MODELS[defaultProviderId];
  const apiKey = settings.get(OPENAI_API_KEY) ?? '';

  return {
    id: providerId,
    configuredId,
    name: `OpenAI / ${model}`,
    baseUrl: BUILTIN_OPENAI_BASE_URL,
    model,
    kind: 'builtin',
    apiKeySet: Boolean(apiKey),
    apiKeyLast4: apiKey ? apiKey.slice(-4) : null,
    fallbackFrom: providerId === normalizedId ? null : normalizedId,
  };
}
```

- [ ] **Step 5: Export the command API**

Modify `packages/localization/src/index.ts` near the other CLI exports:

```ts
export { runInspectProjectsCommand } from './cli/inspectProjectsCommand';
export type {
  InspectMountedTBSummary,
  InspectMountedTMSummary,
  InspectProjectFileSummary,
  InspectProjectSummary,
  InspectProjectsCommandConfig,
  InspectProjectsResult,
  InspectProviderSummary,
} from './cli/inspectProjectsCommand';
```

- [ ] **Step 6: Run the focused test**

Run:

```bash
npx vitest run packages/localization/src/cli/inspectProjectsCommand.test.ts
```

Expected: PASS.

- [ ] **Step 7: Build localization**

Run:

```bash
npm run build --workspace=packages/localization
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add packages/db/src/index.ts packages/localization/src/cli/inspectProjectsCommand.ts packages/localization/src/cli/inspectProjectsCommand.test.ts packages/localization/src/index.ts
git commit -m "feat: add localization project inspection command"
```

---

### Task 2: Scaffold `apps/cli` And Top-Level Dispatch

**Files:**

- Create: `apps/cli/package.json`
- Create: `apps/cli/tsconfig.json`
- Create: `apps/cli/src/index.ts`
- Create: `apps/cli/src/cli.ts`
- Create: `apps/cli/src/parse/args.ts`
- Create: `apps/cli/src/cli.test.ts`

- [ ] **Step 1: Write failing top-level CLI tests**

Create `apps/cli/src/cli.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { runCli } from './cli';

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
});
```

- [ ] **Step 2: Run the failing CLI test**

Run:

```bash
npx vitest run apps/cli/src/cli.test.ts
```

Expected: FAIL because `apps/cli/src/cli.ts` does not exist.

- [ ] **Step 3: Create the app package**

Create `apps/cli/package.json`:

```json
{
  "name": "@cat/cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "momocat": "./dist/index.mjs"
  },
  "main": "./dist/index.mjs",
  "types": "./dist/src/index.d.ts",
  "scripts": {
    "build": "tsc -b && npm run build:bundle",
    "build:bundle": "esbuild src/index.ts --bundle --platform=node --format=esm --target=node20 --banner:js=\"#!/usr/bin/env node\" --outfile=dist/index.mjs --external:better-sqlite3 --external:xlsx",
    "cli": "node dist/index.mjs",
    "test": "vitest run src"
  },
  "dependencies": {
    "@cat/localization": "*"
  },
  "devDependencies": {
    "esbuild": "^0.21.5",
    "typescript": "^5.0.0",
    "vitest": "^4.0.18"
  }
}
```

Create `apps/cli/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Node",
    "declaration": true,
    "outDir": "./dist",
    "strict": true,
    "esModuleInterop": true,
    "composite": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": {
      "@cat/localization": ["../../packages/localization/src"],
      "@cat/localization/*": ["../../packages/localization/src/*"]
    }
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts", "src/**/*.test.tsx"],
  "references": [{ "path": "../../packages/localization" }]
}
```

- [ ] **Step 4: Implement CLI IO and dispatch skeleton**

Create `apps/cli/src/parse/args.ts`:

```ts
export interface CommandIO {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  exists: (filePath: string) => boolean;
  resolvePath: (value: string) => string;
}

export function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

export function requireOptionValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

export function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

export function assertExistingPath(io: CommandIO, filePath: string, label: string): void {
  if (!io.exists(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}
```

Create `apps/cli/src/cli.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import {
  runInspectLocalizationCommand,
  runInspectProjectsCommand,
  runTranslateFileCommand,
} from '@cat/localization';
import type {
  InspectLocalizationCommandConfig,
  InspectProjectsCommandConfig,
  TranslateFileCommandConfig,
} from '@cat/localization';
import type { CommandIO } from './parse/args';

export interface CliDependencies {
  runInspectProjectsCommand: (config: InspectProjectsCommandConfig) => unknown;
  runInspectLocalizationCommand: (config: InspectLocalizationCommandConfig) => Promise<unknown>;
  runTranslateFileCommand: (config: TranslateFileCommandConfig) => Promise<unknown>;
}

export const defaultDependencies: CliDependencies = {
  runInspectProjectsCommand,
  runInspectLocalizationCommand,
  runTranslateFileCommand,
};

export const defaultIO: CommandIO = {
  cwd: process.cwd(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  exists: (filePath) => fs.existsSync(filePath),
  resolvePath: (value) => path.resolve(value),
};

export async function runCli(
  argv: string[],
  deps: CliDependencies = defaultDependencies,
  io: CommandIO = defaultIO,
): Promise<number> {
  try {
    const [domain, action, ...rest] = argv;
    if (!domain || domain === '-h' || domain === '--help') {
      io.stdout(topLevelHelp());
      return 0;
    }

    if (domain === 'inspect' && action === 'projects') {
      const { runInspectProjectsCliCommand } = await import('./commands/inspectProjectsCommand');
      return runInspectProjectsCliCommand(rest, deps, io);
    }
    if (domain === 'inspect' && action === 'localization') {
      const { runInspectLocalizationCliCommand } = await import('./commands/inspectLocalizationCommand');
      return runInspectLocalizationCliCommand(rest, deps, io);
    }
    if (domain === 'translate' && action === 'file') {
      const { runTranslateFileCliCommand } = await import('./commands/translateFileCommand');
      return runTranslateFileCliCommand(rest, deps, io);
    }

    const command = [domain, action].filter(Boolean).join(' ');
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`${message}\nRun: momocat --help\n`);
    return 1;
  }
}

function topLevelHelp(): string {
  return `Usage: momocat <command> [options]

Commands:
  inspect projects       Inspect project readiness, resources, files, and provider status.
  inspect localization   Inspect TM/TB/MT prompt artifacts without provider requests.
  translate file         Translate an external spreadsheet with resumable sidecars.

Run a command with --help for command-specific options.
`;
}
```

Create `apps/cli/src/index.ts`:

```ts
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { runCli } from './cli';

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}

export { runCli };
```

- [ ] **Step 5: Add temporary command module stubs that only show help**

Create `apps/cli/src/commands/inspectProjectsCommand.ts`:

```ts
import type { CliDependencies } from '../cli';
import type { CommandIO } from '../parse/args';

export async function runInspectProjectsCliCommand(
  argv: string[],
  _deps: CliDependencies,
  io: CommandIO,
): Promise<number> {
  if (argv[0] === '-h' || argv[0] === '--help') {
    io.stdout(`Usage: momocat inspect projects --db <path> [options]\n`);
    return 0;
  }
  throw new Error('momocat inspect projects is not implemented yet.');
}
```

Create `apps/cli/src/commands/inspectLocalizationCommand.ts`:

```ts
import type { CliDependencies } from '../cli';
import type { CommandIO } from '../parse/args';

export async function runInspectLocalizationCliCommand(
  argv: string[],
  _deps: CliDependencies,
  io: CommandIO,
): Promise<number> {
  if (argv[0] === '-h' || argv[0] === '--help') {
    io.stdout(`Usage: momocat inspect localization --db <path> --project-id <id> --input <path> --output <path> [options]\n`);
    return 0;
  }
  throw new Error('momocat inspect localization is not implemented yet.');
}
```

Create `apps/cli/src/commands/translateFileCommand.ts`:

```ts
import type { CliDependencies } from '../cli';
import type { CommandIO } from '../parse/args';

export async function runTranslateFileCliCommand(
  argv: string[],
  _deps: CliDependencies,
  io: CommandIO,
): Promise<number> {
  if (argv[0] === '-h' || argv[0] === '--help') {
    io.stdout(`Usage: momocat translate file --db <path> --project-id <id> --input <path> --output <path> [options]\n`);
    return 0;
  }
  throw new Error('momocat translate file is not implemented yet.');
}
```

- [ ] **Step 6: Run the top-level CLI tests**

Run:

```bash
npx vitest run apps/cli/src/cli.test.ts
```

Expected: PASS.

- [ ] **Step 7: Build the CLI app**

Run:

```bash
npm run build --workspace=apps/cli
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add apps/cli
git commit -m "feat: scaffold momocat cli app"
```

---

### Task 3: Implement `momocat inspect projects`

**Files:**

- Modify: `apps/cli/src/cli.test.ts`
- Modify: `apps/cli/src/commands/inspectProjectsCommand.ts`
- Create: `apps/cli/src/output/formatProjects.ts`

- [ ] **Step 1: Add failing CLI tests for `inspect projects`**

Append to `apps/cli/src/cli.test.ts`:

```ts
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
  expect(harness.stderr.join('')).toContain('Database not found: missing.db');
});
```

- [ ] **Step 2: Run the failing CLI tests**

Run:

```bash
npx vitest run apps/cli/src/cli.test.ts
```

Expected: FAIL because `inspect projects` still throws "not implemented yet".

- [ ] **Step 3: Add the project formatter**

Create `apps/cli/src/output/formatProjects.ts`:

```ts
import type { InspectProjectsResult, InspectProviderSummary } from '@cat/localization';

export function formatProjectsInspection(summary: InspectProjectsResult): string {
  const lines: string[] = [];
  lines.push(`Database: ${summary.dbPath}`);
  lines.push(`Projects: ${summary.projects.length}`);
  lines.push('');
  lines.push('API providers:');
  if (summary.providers.length === 0) {
    lines.push('  - no custom providers configured');
  } else {
    for (const provider of summary.providers) {
      lines.push(
        `  - ${provider.id} (${provider.name} / ${provider.model}) apiKey: ${formatKeyStatus(provider)} baseUrl: ${provider.baseUrl}`,
      );
    }
  }

  if (summary.projects.length === 0) {
    lines.push('');
    lines.push('No projects found.');
    return `${lines.join('\n')}\n`;
  }

  for (const project of summary.projects) {
    lines.push('');
    lines.push(`Project ${project.id}: ${project.name} [${project.srcLang} -> ${project.tgtLang}]`);
    lines.push(`  type: ${project.projectType}`);
    lines.push(`  model: ${formatProjectModel(project.model)}`);
    lines.push(`  prompt: ${project.promptChars} chars`);
    lines.push(`  mounted TM: ${project.mountedTMs.length}`);
    for (const tm of project.mountedTMs) {
      lines.push(
        `    - ${tm.name} [${tm.srcLang} -> ${tm.tgtLang}] type=${tm.type} priority=${tm.priority} permission=${tm.permission} enabled=${tm.isEnabled}`,
      );
    }
    lines.push(`  mounted TB: ${project.mountedTBs.length}`);
    for (const tb of project.mountedTBs) {
      lines.push(
        `    - ${tb.name} [${tb.srcLang} -> ${tb.tgtLang}] priority=${tb.priority} enabled=${tb.isEnabled}`,
      );
    }
    lines.push('  files:');
    if (project.files.length === 0) {
      lines.push('    - none');
    } else {
      for (const file of project.files) {
        lines.push(
          `    - file ${file.id}: ${file.name}, total=${file.totalSegments}, targetRows=${file.targetRows}, confirmed=${file.confirmedSegments}, status=${formatStatusCounts(file.statusCounts)}`,
        );
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

function formatKeyStatus(provider: Pick<InspectProviderSummary, 'apiKeySet' | 'apiKeyLast4'>): string {
  return provider.apiKeySet
    ? `set${provider.apiKeyLast4 ? ` last4=${provider.apiKeyLast4}` : ''}`
    : 'missing';
}

function formatProjectModel(model: InspectProviderSummary): string {
  const providerLabel = model.model
    ? `${model.id} (${model.name} / ${model.model})`
    : `${model.id} (${model.name})`;
  const fallbackLabel = model.fallbackFrom ? ` fallbackFrom=${model.fallbackFrom}` : '';
  return `${providerLabel}, apiKey: ${formatKeyStatus(model)}${fallbackLabel}`;
}

function formatStatusCounts(statusCounts: Record<string, number>): string {
  const entries = Object.entries(statusCounts);
  if (entries.length === 0) {
    return 'none';
  }
  return entries.map(([status, count]) => `${status}:${count}`).join(', ');
}
```

- [ ] **Step 4: Implement `inspect projects` parsing and output**

Replace `apps/cli/src/commands/inspectProjectsCommand.ts` with:

```ts
import type { InspectProjectsResult } from '@cat/localization';
import type { CliDependencies } from '../cli';
import { assertExistingPath, parsePositiveInteger, readValue, requireOptionValue } from '../parse/args';
import type { CommandIO } from '../parse/args';
import { formatProjectsInspection } from '../output/formatProjects';

interface InspectProjectsCliConfig {
  dbPath: string;
  projectId?: number;
  json: boolean;
}

export async function runInspectProjectsCliCommand(
  argv: string[],
  deps: CliDependencies,
  io: CommandIO,
): Promise<number> {
  if (argv[0] === '-h' || argv[0] === '--help') {
    io.stdout(help());
    return 0;
  }

  const config = parseInspectProjectsArgs(argv, io);
  const result = deps.runInspectProjectsCommand({
    dbPath: config.dbPath,
    projectId: config.projectId,
  }) as InspectProjectsResult;

  if (config.json) {
    io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    io.stdout(formatProjectsInspection(result));
  }

  return 0;
}

function parseInspectProjectsArgs(argv: string[], io: CommandIO): InspectProjectsCliConfig {
  const config: InspectProjectsCliConfig = {
    dbPath: io.resolvePath('.cat_data/cat_v1.db'),
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const equalsIndex = arg.indexOf('=');

    if (arg === '--db' || arg === '--db-path') {
      config.dbPath = io.resolvePath(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith('--db=')) {
      config.dbPath = io.resolvePath(requireOptionValue('--db', arg.slice('--db='.length)));
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

  assertExistingPath(io, config.dbPath, 'Database');
  return config;
}

function help(): string {
  return `Usage: momocat inspect projects --db <path> [options]

Options:
  --db <path>, --db-path <path>    SQLite DB path. Default: .cat_data/cat_v1.db
  --project-id <id>                Optional project id filter.
  --json                           Print machine-readable JSON.
  -h, --help                       Show this help.

Examples:
  momocat inspect projects --db .cat_data/cat_v1.db
  momocat inspect projects --db .cat_data/cat_v1.db --project-id 3
  momocat inspect projects --db .cat_data/cat_v1.db --json
`;
}
```

- [ ] **Step 5: Run CLI tests**

Run:

```bash
npx vitest run apps/cli/src/cli.test.ts
```

Expected: PASS.

- [ ] **Step 6: Build CLI**

Run:

```bash
npm run build --workspace=apps/cli
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/cli/src/cli.test.ts apps/cli/src/commands/inspectProjectsCommand.ts apps/cli/src/output/formatProjects.ts
git commit -m "feat: add momocat inspect projects"
```

---

### Task 4: Implement `momocat inspect localization`

**Files:**

- Modify: `apps/cli/src/cli.test.ts`
- Modify: `apps/cli/src/commands/inspectLocalizationCommand.ts`

- [ ] **Step 1: Add failing CLI tests for `inspect localization`**

Append to `apps/cli/src/cli.test.ts`:

```ts
it('maps inspect localization options to the localization command API', async () => {
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
      '--json-output',
      'inspect.json',
      '--unit-limit',
      '5',
      '--max-cell-chars=120',
    ],
    harness.deps,
    harness.io,
  );

  expect(exitCode).toBe(0);
  expect(harness.calls).toEqual([
    {
      name: 'inspectLocalization',
      config: {
        dbPath: 'cat.db',
        projectId: 7,
        inputPath: 'input.xlsx',
        outputPath: 'inspect.xlsx',
        jsonOutputPath: 'inspect.json',
        unitLimit: 5,
        maxCellChars: 120,
      },
    },
  ]);
});

it('reports inspect localization invalid numeric options', async () => {
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
```

- [ ] **Step 2: Run the failing CLI tests**

Run:

```bash
npx vitest run apps/cli/src/cli.test.ts
```

Expected: FAIL because `inspect localization` still throws "not implemented yet".

- [ ] **Step 3: Implement `inspect localization` parsing**

Replace `apps/cli/src/commands/inspectLocalizationCommand.ts` with:

```ts
import type { CliDependencies } from '../cli';
import { assertExistingPath, parsePositiveInteger, readValue, requireOptionValue } from '../parse/args';
import type { CommandIO } from '../parse/args';

interface InspectLocalizationCliConfig {
  dbPath: string;
  projectId: number | undefined;
  inputPath: string;
  outputPath: string;
  jsonOutputPath?: string;
  unitLimit?: number;
  maxCellChars?: number;
}

export async function runInspectLocalizationCliCommand(
  argv: string[],
  deps: CliDependencies,
  io: CommandIO,
): Promise<number> {
  if (argv[0] === '-h' || argv[0] === '--help') {
    io.stdout(help());
    return 0;
  }

  const config = parseInspectLocalizationArgs(argv, io);
  await deps.runInspectLocalizationCommand({
    dbPath: config.dbPath,
    projectId: config.projectId,
    inputPath: config.inputPath,
    outputPath: config.outputPath,
    jsonOutputPath: config.jsonOutputPath,
    unitLimit: config.unitLimit,
    maxCellChars: config.maxCellChars,
  });
  return 0;
}

function parseInspectLocalizationArgs(argv: string[], io: CommandIO): Required<Pick<InspectLocalizationCliConfig, 'dbPath' | 'projectId' | 'inputPath' | 'outputPath'>> &
  Omit<InspectLocalizationCliConfig, 'dbPath' | 'projectId' | 'inputPath' | 'outputPath'> {
  const config: InspectLocalizationCliConfig = {
    dbPath: '',
    projectId: undefined,
    inputPath: '',
    outputPath: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--db' || arg === '--db-path') {
      config.dbPath = io.resolvePath(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith('--db=')) {
      config.dbPath = io.resolvePath(requireOptionValue('--db', arg.slice('--db='.length)));
      continue;
    }
    if (arg === '--project-id') {
      config.projectId = parsePositiveInteger(readValue(argv, index, arg), '--project-id');
      index += 1;
      continue;
    }
    if (arg.startsWith('--project-id=')) {
      config.projectId = parsePositiveInteger(requireOptionValue('--project-id', arg.slice('--project-id='.length)), '--project-id');
      continue;
    }
    if (arg === '--input') {
      config.inputPath = io.resolvePath(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith('--input=')) {
      config.inputPath = io.resolvePath(requireOptionValue('--input', arg.slice('--input='.length)));
      continue;
    }
    if (arg === '--output') {
      config.outputPath = io.resolvePath(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      config.outputPath = io.resolvePath(requireOptionValue('--output', arg.slice('--output='.length)));
      continue;
    }
    if (arg === '--json-output') {
      config.jsonOutputPath = io.resolvePath(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith('--json-output=')) {
      config.jsonOutputPath = io.resolvePath(requireOptionValue('--json-output', arg.slice('--json-output='.length)));
      continue;
    }
    if (arg === '--unit-limit') {
      config.unitLimit = parsePositiveInteger(readValue(argv, index, arg), '--unit-limit');
      index += 1;
      continue;
    }
    if (arg.startsWith('--unit-limit=')) {
      config.unitLimit = parsePositiveInteger(requireOptionValue('--unit-limit', arg.slice('--unit-limit='.length)), '--unit-limit');
      continue;
    }
    if (arg === '--max-cell-chars') {
      config.maxCellChars = parsePositiveInteger(readValue(argv, index, arg), '--max-cell-chars');
      index += 1;
      continue;
    }
    if (arg.startsWith('--max-cell-chars=')) {
      config.maxCellChars = parsePositiveInteger(requireOptionValue('--max-cell-chars', arg.slice('--max-cell-chars='.length)), '--max-cell-chars');
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!config.dbPath) throw new Error('Missing --db.');
  if (config.projectId === undefined) throw new Error('Missing --project-id.');
  if (!config.inputPath) throw new Error('Missing --input.');
  if (!config.outputPath) throw new Error('Missing --output.');

  assertExistingPath(io, config.dbPath, 'Database');
  assertExistingPath(io, config.inputPath, 'Input file');

  return config as Required<Pick<InspectLocalizationCliConfig, 'dbPath' | 'projectId' | 'inputPath' | 'outputPath'>> &
    Omit<InspectLocalizationCliConfig, 'dbPath' | 'projectId' | 'inputPath' | 'outputPath'>;
}

function help(): string {
  return `Usage: momocat inspect localization --db <path> --project-id <id> --input <path> --output <path> [options]

Options:
  --db <path>, --db-path <path>    SQLite DB path.
  --project-id <id>                Project id that owns mounted TM/TB resources.
  --input <path>                   Spreadsheet path to inspect.
  --output <path>                  Output inspection spreadsheet path.
  --json-output <path>             Optional JSON artifact output path.
  --unit-limit <n>                 Optional maximum number of source units to inspect.
  --max-cell-chars <n>             Optional max characters per generated spreadsheet cell.
  -h, --help                       Show this help.

Examples:
  momocat inspect localization --db .cat_data/cat_v1.db --project-id 1 --input mt.xlsx --output inspect.xlsx
`;
}
```

- [ ] **Step 4: Run CLI tests**

Run:

```bash
npx vitest run apps/cli/src/cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Build CLI**

Run:

```bash
npm run build --workspace=apps/cli
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/cli/src/cli.test.ts apps/cli/src/commands/inspectLocalizationCommand.ts
git commit -m "feat: add momocat inspect localization"
```

---

### Task 5: Implement `momocat translate file`

**Files:**

- Modify: `apps/cli/src/cli.test.ts`
- Modify: `apps/cli/src/commands/translateFileCommand.ts`

- [ ] **Step 1: Add failing CLI tests for `translate file`**

Append to `apps/cli/src/cli.test.ts`:

```ts
it('maps translate file options to the localization command API', async () => {
  const harness = createHarness();
  const exitCode = await runCli(
    [
      'translate',
      'file',
      '--db',
      'cat.db',
      '--project-id=7',
      '--input',
      'input.xlsx',
      '--output',
      'translated.xlsx',
      '--target-scope=blank-only',
      '--checkpoint',
      'custom.checkpoint.jsonl',
      '--events=custom.events.jsonl',
      '--artifacts',
      'custom.artifacts.jsonl',
      '--resume',
      '--max-attempts',
      '3',
      '--batch-size=5',
      '--snapshot',
      'custom.snapshot.xlsx',
      '--snapshot-every-units=10',
      '--snapshot-every-seconds',
      '30',
      '--progress-stdout',
    ],
    harness.deps,
    harness.io,
  );

  expect(exitCode).toBe(0);
  expect(harness.calls).toEqual([
    {
      name: 'translateFile',
      config: {
        dbPath: 'cat.db',
        projectId: 7,
        inputPath: 'input.xlsx',
        outputPath: 'translated.xlsx',
        targetScope: 'blank-only',
        checkpointPath: 'custom.checkpoint.jsonl',
        eventsPath: 'custom.events.jsonl',
        artifactsPath: 'custom.artifacts.jsonl',
        resume: true,
        maxAttempts: 3,
        batchSize: 5,
        snapshotPath: 'custom.snapshot.xlsx',
        snapshotEveryUnits: 10,
        snapshotEverySeconds: 30,
        progressStdout: true,
      },
    },
  ]);
});

it('rejects translate file invalid target scope', async () => {
  const harness = createHarness();
  const exitCode = await runCli(
    [
      'translate',
      'file',
      '--db',
      'cat.db',
      '--project-id',
      '7',
      '--input',
      'input.xlsx',
      '--output',
      'translated.xlsx',
      '--target-scope',
      'all',
    ],
    harness.deps,
    harness.io,
  );

  expect(exitCode).toBe(1);
  expect(harness.calls).toEqual([]);
  expect(harness.stderr.join('')).toContain('--target-scope must be blank-only or overwrite-non-confirmed.');
});
```

- [ ] **Step 2: Run the failing CLI tests**

Run:

```bash
npx vitest run apps/cli/src/cli.test.ts
```

Expected: FAIL because `translate file` still throws "not implemented yet".

- [ ] **Step 3: Implement `translate file` parsing**

Replace `apps/cli/src/commands/translateFileCommand.ts` with:

```ts
import type { TranslateFileCommandConfig } from '@cat/localization';
import type { CliDependencies } from '../cli';
import { assertExistingPath, parsePositiveInteger, readValue, requireOptionValue } from '../parse/args';
import type { CommandIO } from '../parse/args';

const BOOLEAN_OPTIONS = new Set(['resume', 'progress-stdout']);

export async function runTranslateFileCliCommand(
  argv: string[],
  deps: CliDependencies,
  io: CommandIO,
): Promise<number> {
  if (argv[0] === '-h' || argv[0] === '--help') {
    io.stdout(help());
    return 0;
  }

  const config = parseTranslateFileArgs(argv, io);
  await deps.runTranslateFileCommand(config);
  return 0;
}

function parseTranslateFileArgs(argv: string[], io: CommandIO): TranslateFileCommandConfig {
  const config: Partial<TranslateFileCommandConfig> = {
    resume: false,
    progressStdout: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const equalsIndex = arg.indexOf('=');
    if (!arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    if (equalsIndex !== -1) {
      assignOption(config, arg.slice(2, equalsIndex), arg.slice(equalsIndex + 1), io, arg.slice(0, equalsIndex));
      continue;
    }

    const name = arg.slice(2);
    if (BOOLEAN_OPTIONS.has(name)) {
      assignOption(config, name, undefined, io, arg);
      continue;
    }
    assignOption(config, name, readValue(argv, index, arg), io, arg);
    index += 1;
  }

  if (!config.dbPath) throw new Error('Missing --db.');
  if (config.projectId === undefined) throw new Error('Missing --project-id.');
  if (!config.inputPath) throw new Error('Missing --input.');
  if (!config.outputPath) throw new Error('Missing --output.');

  assertExistingPath(io, config.dbPath, 'Database');
  assertExistingPath(io, config.inputPath, 'Input file');

  return config as TranslateFileCommandConfig;
}

function assignOption(
  config: Partial<TranslateFileCommandConfig>,
  name: string,
  value: string | undefined,
  io: CommandIO,
  flag = `--${name}`,
): void {
  if (name === 'resume') {
    if (value !== undefined) throw new Error(`${flag} does not take a value.`);
    config.resume = true;
    return;
  }
  if (name === 'progress-stdout') {
    if (value !== undefined) throw new Error(`${flag} does not take a value.`);
    config.progressStdout = true;
    return;
  }

  const optionValue = requireOptionValue(flag, value);
  if (name === 'db' || name === 'db-path') {
    config.dbPath = io.resolvePath(optionValue);
    return;
  }
  if (name === 'project-id') {
    config.projectId = parsePositiveInteger(optionValue, '--project-id');
    return;
  }
  if (name === 'input') {
    config.inputPath = io.resolvePath(optionValue);
    return;
  }
  if (name === 'output') {
    config.outputPath = io.resolvePath(optionValue);
    return;
  }
  if (name === 'target-scope') {
    if (optionValue !== 'blank-only' && optionValue !== 'overwrite-non-confirmed') {
      throw new Error('--target-scope must be blank-only or overwrite-non-confirmed.');
    }
    config.targetScope = optionValue;
    return;
  }
  if (name === 'checkpoint') {
    config.checkpointPath = io.resolvePath(optionValue);
    return;
  }
  if (name === 'events') {
    config.eventsPath = io.resolvePath(optionValue);
    return;
  }
  if (name === 'artifacts') {
    config.artifactsPath = io.resolvePath(optionValue);
    return;
  }
  if (name === 'max-attempts') {
    config.maxAttempts = parsePositiveInteger(optionValue, '--max-attempts');
    return;
  }
  if (name === 'batch-size') {
    config.batchSize = parsePositiveInteger(optionValue, '--batch-size');
    return;
  }
  if (name === 'snapshot') {
    config.snapshotPath = io.resolvePath(optionValue);
    return;
  }
  if (name === 'snapshot-every-units') {
    config.snapshotEveryUnits = parsePositiveInteger(optionValue, '--snapshot-every-units');
    return;
  }
  if (name === 'snapshot-every-seconds') {
    config.snapshotEverySeconds = parsePositiveInteger(optionValue, '--snapshot-every-seconds');
    return;
  }

  throw new Error(`Unknown argument: --${name}`);
}

function help(): string {
  return `Usage: momocat translate file --db <path> --project-id <id> --input <path> --output <path> [options]

Options:
  --db <path>, --db-path <path>    SQLite DB path.
  --project-id <id>                Project id that owns mounted TM/TB resources.
  --input <path>                   Spreadsheet path to translate.
  --output <path>                  Output spreadsheet path.
  --target-scope <scope>           blank-only or overwrite-non-confirmed.
  --checkpoint <path>              Checkpoint JSONL path.
  --events <path>                  Event JSONL path.
  --artifacts <path>               Enable diagnostic prompt artifact JSONL at this path.
  --resume                         Resume from an existing checkpoint.
  --max-attempts <n>               Positive integer retry attempt limit.
  --batch-size <n>                 Window Mode batch size, integer from 1 to 5.
  --snapshot <path>                Snapshot spreadsheet path.
  --snapshot-every-units <n>       Positive integer snapshot cadence by completed units.
  --snapshot-every-seconds <n>     Positive integer snapshot cadence by elapsed seconds.
  --progress-stdout                Emit live NDJSON job events to stdout.
  -h, --help                       Show this help.

Examples:
  momocat translate file --db .cat_data/cat_v1.db --project-id 1 --input mt.xlsx --output mt.fr.xlsx
  momocat translate file --db .cat_data/cat_v1.db --project-id 1 --input mt.xlsx --output mt.fr.xlsx --resume
`;
}
```

- [ ] **Step 4: Run CLI tests**

Run:

```bash
npx vitest run apps/cli/src/cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Build CLI**

Run:

```bash
npm run build --workspace=apps/cli
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/cli/src/cli.test.ts apps/cli/src/commands/translateFileCommand.ts
git commit -m "feat: add momocat translate file"
```

---

### Task 6: Move Root CLI Surface Into `apps/cli`

**Files:**

- Modify: `package.json`
- Delete: `scripts/inspect-projects.mjs`
- Delete: `scripts/inspect-projects.test.mjs`
- Delete: `scripts/inspect-localization.mjs`
- Delete: `scripts/inspect-localization-runner.mjs`
- Delete: `scripts/inspect-localization.test.mjs`
- Delete: `scripts/translate-file.mjs`
- Delete: `scripts/translate-file-runner.mjs`
- Delete: `scripts/translate-file.test.mjs`

- [ ] **Step 1: Update root package script tests expectation**

No separate root script test remains because `scripts/translate-file.test.mjs`
is deleted. The CLI package tests now verify command mapping. Before editing
`package.json`, run:

```bash
npm test --workspace=apps/cli
```

Expected: PASS, proving the new CLI tests are the active command-surface tests.

- [ ] **Step 2: Update root scripts**

Modify `package.json`:

Remove:

```json
"translate:file": "npm run rebuild:test && npm run build --workspace=packages/localization && node scripts/translate-file.mjs",
"inspect:localization": "npm run rebuild:test && npm run build --workspace=packages/localization && node scripts/inspect-localization.mjs",
"inspect:projects": "node scripts/inspect-projects.mjs",
```

Add one development helper near the other repo-level scripts:

```json
"cli": "npm run build --workspace=packages/localization && npm run build --workspace=apps/cli && node apps/cli/dist/index.mjs",
```

Keep root build/test/gate scripts unchanged.

- [ ] **Step 3: Delete the old root CLI implementation files**

Delete:

```text
scripts/inspect-projects.mjs
scripts/inspect-projects.test.mjs
scripts/inspect-localization.mjs
scripts/inspect-localization-runner.mjs
scripts/inspect-localization.test.mjs
scripts/translate-file.mjs
scripts/translate-file-runner.mjs
scripts/translate-file.test.mjs
```

- [ ] **Step 4: Run CLI and root tests**

Run:

```bash
npm test --workspace=apps/cli
npm run build --workspace=apps/cli
npm run build --workspace=packages/localization
```

Expected: PASS.

- [ ] **Step 5: Smoke the development helper help command**

Run:

```bash
npm run cli -- --help
```

Expected: stdout contains:

```text
Usage: momocat <command> [options]
```

- [ ] **Step 6: Commit**

Run:

```bash
git add package.json apps/cli scripts
git commit -m "refactor: move cli scripts into apps cli"
```

---

### Task 7: Enforce CLI Dependency Guardrails

**Files:**

- Modify: `DOCS/architecture/GATE05_GUARDRAILS.json`
- Modify: `apps/cli/src/cli.test.ts`

- [ ] **Step 1: Add a failing guardrail test through the real gate**

Run the current architecture gate before editing:

```bash
npm run gate:arch
```

Expected: PASS, but it does not yet enforce the new CLI boundary.

- [ ] **Step 2: Add forbidden import rules**

Modify `DOCS/architecture/GATE05_GUARDRAILS.json` and append these objects to
`forbiddenImports`:

```json
{
  "sourceRoot": "apps/cli/src",
  "forbiddenTargetRoot": "apps/desktop/src",
  "forbiddenSpecifierPatterns": [
    "^apps/desktop/src(?:/|$)",
    "^@desktop(?:/|$)"
  ],
  "message": "apps/cli must not import desktop code"
},
{
  "sourceRoot": "apps/cli/src",
  "forbiddenTargetRoot": "packages/db/src",
  "forbiddenSpecifierPatterns": [
    "^@cat/db(?:/|$)"
  ],
  "message": "apps/cli must depend on @cat/localization, not @cat/db"
},
{
  "sourceRoot": "apps/cli/src",
  "forbiddenTargetRoot": "packages/core/src",
  "forbiddenSpecifierPatterns": [
    "^@cat/core(?:/|$)"
  ],
  "message": "apps/cli must depend on @cat/localization, not @cat/core"
},
{
  "sourceRoot": "apps/desktop/src",
  "forbiddenTargetRoot": "apps/cli/src",
  "forbiddenSpecifierPatterns": [
    "^apps/cli/src(?:/|$)",
    "^@cat/cli(?:/|$)"
  ],
  "message": "apps/desktop must not import CLI app code"
},
{
  "sourceRoot": "packages/localization/src",
  "forbiddenTargetRoot": "apps/cli/src",
  "forbiddenSpecifierPatterns": [
    "^apps/cli/src(?:/|$)",
    "^@cat/cli(?:/|$)"
  ],
  "message": "@cat/localization must not import CLI app code"
}
```

Keep the existing localization-to-desktop rules.

- [ ] **Step 3: Add CLI package dependency assertion**

Append to `apps/cli/src/cli.test.ts`:

```ts
it('declares only @cat/localization as an internal workspace dependency', async () => {
  const packageJson = JSON.parse(
    await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ),
  ) as { dependencies?: Record<string, string> };

  expect(packageJson.dependencies).toEqual({
    '@cat/localization': '*',
  });
});
```

- [ ] **Step 4: Run guardrail and CLI tests**

Run:

```bash
npm run gate:arch
npm test --workspace=apps/cli
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add DOCS/architecture/GATE05_GUARDRAILS.json apps/cli/src/cli.test.ts
git commit -m "test: enforce cli dependency boundary"
```

---

### Task 8: Update Agent-First Documentation

**Files:**

- Modify: `DOCS/00_START_HERE.md`
- Modify: `DOCS/10_ARCHITECTURE.md`
- Modify: `DOCS/agent-first/CLI.md`
- Modify: `DOCS/40_STATUS_AND_ROADMAP.md`

- [ ] **Step 1: Update `DOCS/00_START_HERE.md` command examples**

Replace the Agent-first CLI examples in `DOCS/00_START_HERE.md` with:

```md
Agent-first CLI:

- Project check: `momocat inspect projects --db <path> --project-id <id>`
- No-request prompt inspection: `momocat inspect localization --db <path> --project-id <id> --input <path> --output <inspect.xlsx>`
- Resumable file translation: `momocat translate file --db <path> --project-id <id> --input <path> --output <translated.xlsx>`
- Repository-local development helper: `npm run cli -- inspect projects --db <path> --project-id <id>`
```

- [ ] **Step 2: Update `DOCS/10_ARCHITECTURE.md` app boundaries**

Add `apps/cli` to the layered boundary section:

```md
2. CLI (`apps/cli`)

- Exposes the `momocat` command.
- Owns command grammar, argument parsing, help text, stdout/stderr formatting, and exit codes.
- Calls `@cat/localization` for all headless behavior.
- Must not import `apps/desktop`, `@cat/db`, or `@cat/core` directly.
```

Update the dependency map to include:

```text
apps/cli
  -> @cat/localization
  -> @cat/db
  -> @cat/core
```

- [ ] **Step 3: Rewrite `DOCS/agent-first/CLI.md` around `momocat`**

Change the command examples to:

```bash
momocat inspect projects --db <path>
momocat inspect localization --db <path> --project-id <id> --input <path> --output <inspect.xlsx>
momocat translate file --db <path> --project-id <id> --input <path> --output <translated.xlsx>
```

Add a short note:

```md
When running from a source checkout before installing the bin, use `npm run cli -- <momocat arguments>`.
For example: `npm run cli -- inspect projects --db <path>`.
```

- [ ] **Step 4: Update roadmap status if needed**

If `DOCS/40_STATUS_AND_ROADMAP.md` still describes root scripts as the active CLI surface, update the current phase or roadmap bullets so they say the CLI surface is now `apps/cli` / `momocat`.

Use this wording if no better local wording exists:

```md
- Agent-first CLI commands now live under `apps/cli` and are exposed as `momocat ...`; root scripts are reserved for repo orchestration and the repository-local `npm run cli -- ...` helper.
```

- [ ] **Step 5: Run docs grep**

Run:

```bash
rg "inspect:projects|inspect:localization|translate:file|scripts/inspect-projects|scripts/translate-file|scripts/inspect-localization" DOCS package.json scripts apps packages
```

Expected: No active command references remain. Historical references under completed specs or plans may remain if they clearly describe past decisions; do not edit historical records just to erase history.

- [ ] **Step 6: Commit**

Run:

```bash
git add DOCS/00_START_HERE.md DOCS/10_ARCHITECTURE.md DOCS/agent-first/CLI.md DOCS/40_STATUS_AND_ROADMAP.md
git commit -m "docs: document momocat cli app"
```

---

### Task 9: Final Verification

**Files:**

- No planned source edits.
- Fix only failures caused by this plan.

- [ ] **Step 1: Run focused localization tests**

Run:

```bash
npx vitest run packages/localization/src/cli/inspectProjectsCommand.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run CLI tests**

Run:

```bash
npm test --workspace=apps/cli
```

Expected: PASS.

- [ ] **Step 3: Build packages**

Run:

```bash
npm run build --workspace=packages/localization
npm run build --workspace=apps/cli
```

Expected: both PASS.

- [ ] **Step 4: Run architecture gate**

Run:

```bash
npm run gate:arch
```

Expected: PASS and includes the existing success line:

```text
[gate:arch] Architecture guard passed.
```

- [ ] **Step 5: Smoke the development helper**

Run:

```bash
npm run cli -- --help
npm run cli -- inspect projects --help
npm run cli -- inspect localization --help
npm run cli -- translate file --help
```

Expected: each command exits successfully and prints `momocat` usage.

- [ ] **Step 6: Inspect final dependency graph manually**

Run:

```bash
rg "@cat/db|@cat/core|apps/desktop|@cat/cli|apps/cli" apps/cli packages/localization/src apps/desktop/src
```

Expected:

- `apps/cli` imports `@cat/localization`.
- `apps/cli` does not import `@cat/db`, `@cat/core`, or desktop paths.
- `packages/localization/src` does not import `apps/cli`.
- `apps/desktop/src` does not import `apps/cli`.

- [ ] **Step 7: Commit any verification fixes**

If final verification required fixes, commit them:

```bash
git add <changed-files>
git commit -m "fix: stabilize momocat cli extraction"
```

If no fixes were required, do not create an empty commit.
