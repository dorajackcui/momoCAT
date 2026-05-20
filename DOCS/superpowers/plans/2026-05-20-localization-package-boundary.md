# Localization Package Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the agent-first CLI/headless localization workflow from `apps/desktop/src/main/localization` into a new `@cat/localization` workspace package without changing translation behavior.

**Architecture:** `@cat/localization` becomes the headless orchestration package used by CLI scripts and future desktop host wiring. It may depend on `@cat/core`, `@cat/db`, `xlsx`, and Node runtime APIs, but it must not import `apps/desktop/src/main/*`. Existing desktop GUI AI workflows remain in `apps/desktop`.

**Tech Stack:** TypeScript, npm workspaces, Vitest, Electron desktop app, `@cat/core`, `@cat/db`, `xlsx`, Node filesystem/path APIs.

---

## File Structure

Create:

- `packages/localization/package.json` - workspace package metadata, build/lint scripts, dependencies.
- `packages/localization/tsconfig.json` - composite TypeScript build config and package path aliases.
- `packages/localization/src/index.ts` - public headless package exports.
- `packages/localization/src/ports.ts` - headless repository, provider, and runtime config ports.
- `packages/localization/src/providers/AIProviderCatalogService.ts` - provider catalog for headless MT.
- `packages/localization/src/providers/AIRuntimeConfigService.ts` - runtime model config for headless MT.
- `packages/localization/src/providers/AIProviderTransport.ts` - chat-completions transport for headless MT.
- `packages/localization/src/adapters/sqlite/SqliteProjectRepository.ts` - headless project repository adapter over `CATDatabase`.
- `packages/localization/src/adapters/sqlite/SqliteSettingsRepository.ts` - headless settings repository adapter over `CATDatabase`.
- `packages/localization/src/adapters/sqlite/SqliteTBRepository.ts` - headless TB repository adapter over `CATDatabase`.
- `packages/localization/src/adapters/sqlite/SqliteTMRepository.ts` - headless TM repository adapter over `CATDatabase`.
- `packages/localization/src/services/TMService.ts` - TM matching service needed by headless `TMModule`.
- `packages/localization/src/services/TBService.ts` - TB matching service needed by headless `TBModule`.

Move from `apps/desktop/src/main/localization` to `packages/localization/src`:

- `RequestScheduler.ts`
- `RequestScheduler.test.ts`
- `artifacts.ts`
- `types.ts`
- `transientSegment.ts`
- `transientSegment.test.ts`
- `spreadsheetFileAdapter.ts`
- `spreadsheetFileAdapter.test.ts`
- `fileTranslationJobAdapter.ts`
- `fileTranslationJobAdapter.test.ts`
- `LocalizationEngine.ts`
- `LocalizationEngine.test.ts`
- `LocalizationEngine.cli.test.ts`
- `LocalizationInspector.ts`
- `LocalizationInspector.test.ts`
- `LocalizationInspector.cli.test.ts`
- `index.ts`
- `job/*`
- `modules/FileModule.ts`
- `modules/FileModule.test.ts`
- `modules/TMModule.ts`
- `modules/TMModule.test.ts`
- `modules/TBModule.ts`
- `modules/TBModule.test.ts`
- `modules/MTModule.ts`
- `modules/MTModule.test.ts`

Modify:

- `package.json` - no root script change is required unless execution discovers a workspace command gap.
- `vitest.config.ts` - add `@cat/localization` alias.
- `apps/desktop/tsconfig.json` - add `@cat/localization` path and project reference if desktop imports the package.
- `apps/desktop/src/main/localization/index.ts` - temporary compatibility re-export, if needed during migration.
- `scripts/gate-architecture-check.mjs` - enforce no package import from desktop main.
- `DOCS/architecture/GATE05_GUARDRAILS.json` - configure forbidden import guard.
- `DOCS/10_ARCHITECTURE.md` - document new package boundary.
- `DOCS/agent-first/ARCHITECTURE.md` - point headless code paths to `@cat/localization`.
- `DOCS/agent-first/CLI.md` - remove Vitest-runtime wording once CLI scripts call the package directly.
- `scripts/translate-file.mjs` - call the package runtime instead of spawning Vitest.
- `scripts/inspect-localization.mjs` - call the package runtime instead of spawning Vitest.

---

### Task 1: Scaffold `@cat/localization`

**Files:**

- Create: `packages/localization/package.json`
- Create: `packages/localization/tsconfig.json`
- Create: `packages/localization/src/index.ts`
- Modify: `vitest.config.ts`
- Modify: `apps/desktop/tsconfig.json`

- [ ] **Step 1: Create the package manifest**

Create `packages/localization/package.json`:

```json
{
  "name": "@cat/localization",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./package.json": "./package.json"
  },
  "scripts": {
    "build": "tsc",
    "lint": "eslint \"src/**/*.{ts,tsx}\""
  },
  "dependencies": {
    "@cat/core": "*",
    "@cat/db": "*",
    "fastest-levenshtein": "^1.0.16",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 2: Create the TypeScript config**

Create `packages/localization/tsconfig.json`:

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
      "@cat/core": ["../core/src"],
      "@cat/core/*": ["../core/src/*"],
      "@cat/db": ["../db/src"]
    }
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts", "src/**/*.test.tsx"],
  "references": [{ "path": "../core" }, { "path": "../db" }]
}
```

- [ ] **Step 3: Create the initial public entrypoint**

Create `packages/localization/src/index.ts`:

```ts
export {};
```

- [ ] **Step 4: Add the Vitest alias**

Modify `vitest.config.ts` so the alias list includes `@cat/localization` before the `@cat/core` aliases:

```ts
      {
        find: '@cat/localization',
        replacement: resolve(__dirname, 'packages/localization/src'),
      },
      {
        find: /^@cat\/localization\/(.+)$/,
        replacement: resolve(__dirname, 'packages/localization/src/$1'),
      },
```

- [ ] **Step 5: Add the desktop TypeScript path**

Modify `apps/desktop/tsconfig.json` paths and references:

```json
      "@cat/localization": ["../../packages/localization/src"],
      "@cat/localization/*": ["../../packages/localization/src/*"]
```

Add the project reference:

```json
{ "path": "../../packages/localization" }
```

- [ ] **Step 6: Build the empty package**

Run:

```bash
npm run build --workspace=packages/localization
```

Expected: PASS with TypeScript creating `packages/localization/dist`.

- [ ] **Step 7: Commit**

Run:

```bash
git add packages/localization/package.json packages/localization/tsconfig.json packages/localization/src/index.ts vitest.config.ts apps/desktop/tsconfig.json
git commit -m "chore: scaffold localization package"
```

---

### Task 2: Add A Guardrail Against Localization-To-Desktop Imports

**Files:**

- Modify: `DOCS/architecture/GATE05_GUARDRAILS.json`
- Modify: `scripts/gate-architecture-check.mjs`
- Create: `packages/localization/src/__guardrail_desktop_import_fixture.test.ts`

- [ ] **Step 1: Add forbidden import config**

Modify `DOCS/architecture/GATE05_GUARDRAILS.json` and add this top-level object after `catCore`:

```json
  "forbiddenImports": [
    {
      "sourceRoot": "packages/localization/src",
      "forbiddenTargetRoot": "apps/desktop/src/main",
      "message": "@cat/localization must not import desktop main code"
    }
  ]
```

Keep the surrounding JSON valid by adding a comma after the previous top-level object.

- [ ] **Step 2: Add the failing fixture**

Create `packages/localization/src/__guardrail_desktop_import_fixture.test.ts`:

```ts
import '../src-does-not-exist';
import '../../../apps/desktop/src/main/services/ports';

describe('guardrail desktop import fixture', () => {
  it('is never executed; gate:arch parses import specifiers only', () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 3: Add the guard implementation**

Modify `scripts/gate-architecture-check.mjs` by adding this function after `validateCatCoreImports()`:

```js
function validateForbiddenImports() {
  const rules = guardrails.forbiddenImports ?? [];

  for (const rule of rules) {
    const sourceRoot = path.join(ROOT, rule.sourceRoot);
    const forbiddenTargetRoot = path.join(ROOT, rule.forbiddenTargetRoot);

    if (!fs.existsSync(sourceRoot)) {
      continue;
    }

    const files = listSourceFiles(sourceRoot);
    for (const filePath of files) {
      const relativeFilePath = toPosixPath(path.relative(ROOT, filePath));
      const sourceFile = readSourceFile(filePath);
      const importSpecifiers = getImportSpecifiers(sourceFile);

      for (const specifier of importSpecifiers) {
        const resolvedTarget = specifier.startsWith('.')
          ? resolveImportTarget(filePath, specifier)
          : null;

        if (!resolvedTarget) {
          continue;
        }

        if (path.normalize(resolvedTarget).startsWith(path.normalize(forbiddenTargetRoot))) {
          errors.push(`${relativeFilePath} imports forbidden target "${specifier}"; ${rule.message}`);
        }
      }
    }
  }
}
```

Then modify the `try` block:

```js
  validateProjectService();
  validateCatDatabase();
  validateCatCoreImports();
  validateForbiddenImports();
```

- [ ] **Step 4: Verify the guard fails**

Run:

```bash
npm run gate:arch
```

Expected: FAIL with a message containing:

```text
@cat/localization must not import desktop main code
```

- [ ] **Step 5: Remove the fixture**

Delete `packages/localization/src/__guardrail_desktop_import_fixture.test.ts`.

- [ ] **Step 6: Verify the guard passes**

Run:

```bash
npm run gate:arch
```

Expected: PASS with:

```text
[gate:arch] Architecture guard passed.
```

- [ ] **Step 7: Commit**

Run:

```bash
git add DOCS/architecture/GATE05_GUARDRAILS.json scripts/gate-architecture-check.mjs
git commit -m "chore: guard localization package boundary"
```

---

### Task 3: Move Low-Coupling Job And Artifact Infrastructure

**Files:**

- Move: `apps/desktop/src/main/localization/RequestScheduler.ts` -> `packages/localization/src/RequestScheduler.ts`
- Move: `apps/desktop/src/main/localization/RequestScheduler.test.ts` -> `packages/localization/src/RequestScheduler.test.ts`
- Move: `apps/desktop/src/main/localization/types.ts` -> `packages/localization/src/types.ts`
- Move: `apps/desktop/src/main/localization/artifacts.ts` -> `packages/localization/src/artifacts.ts`
- Move: `apps/desktop/src/main/localization/job/*` -> `packages/localization/src/job/*`
- Modify: `packages/localization/src/artifacts.ts`
- Modify: `packages/localization/src/types.ts`
- Modify: `packages/localization/src/job/types.ts`
- Modify: `packages/localization/src/index.ts`

- [ ] **Step 1: Move the files with git**

Run:

```bash
git mv apps/desktop/src/main/localization/RequestScheduler.ts packages/localization/src/RequestScheduler.ts
git mv apps/desktop/src/main/localization/RequestScheduler.test.ts packages/localization/src/RequestScheduler.test.ts
git mv apps/desktop/src/main/localization/types.ts packages/localization/src/types.ts
git mv apps/desktop/src/main/localization/artifacts.ts packages/localization/src/artifacts.ts
git mv apps/desktop/src/main/localization/job packages/localization/src/job
```

- [ ] **Step 2: Replace desktop port imports with local ports**

In `packages/localization/src/types.ts`, change:

```ts
import type { ReasoningEffort } from '../services/ports';
```

to:

```ts
import type { ReasoningEffort } from './ports';
```

In `packages/localization/src/artifacts.ts`, change:

```ts
import type { ReasoningEffort } from '../services/ports';
import type { TMMatch } from '../services/TMService';
```

to:

```ts
import type { ReasoningEffort } from './ports';
```

Then add this temporary structural type near the top of `artifacts.ts`, after imports:

```ts
type TMMatch = TMEntry & {
  kind: 'tm' | 'concordance';
  rank: number;
  tmName: string;
  tmType: 'working' | 'main';
  similarity?: number;
  matchedSourceText?: string;
  sourceCoverage?: number;
  entryCoverage?: number;
};
```

Also add `TMEntry` to the existing core model import:

```ts
import type { TBMatch, TMEntry } from '@cat/core/models';
```

This keeps Task 3 buildable before `TMService` moves in Task 5. Task 5 may replace this structural type with the real service export if that improves consistency.

- [ ] **Step 3: Create minimal ports needed by moved types**

Create `packages/localization/src/ports.ts`:

```ts
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
```

- [ ] **Step 4: Export moved infrastructure**

Replace `packages/localization/src/index.ts` with:

```ts
export { runBounded } from './RequestScheduler';
export type { RunBoundedOptions, ScheduledResult } from './RequestScheduler';
export type * from './artifacts';
export type * from './types';
export type * from './job/types';
export { TranslationJobRunner } from './job/TranslationJobRunner';
export type {
  TranslationJobRunResult,
  TranslationJobRunnerDependencies,
  TranslationJobSummary,
} from './job/TranslationJobRunner';
export { OneUnitTaskPlanner } from './job/TaskPlanner';
export type { TaskPlanner } from './job/TaskPlanner';
```

- [ ] **Step 5: Run the moved infrastructure tests**

Run:

```bash
npx vitest run packages/localization/src/RequestScheduler.test.ts packages/localization/src/job
```

Expected: PASS. If TypeScript reports unresolved `./ports`, verify Step 3 created the file.

- [ ] **Step 6: Build the package**

Run:

```bash
npm run build --workspace=packages/localization
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add packages/localization apps/desktop/src/main/localization
git commit -m "refactor: move localization job infrastructure"
```

---

### Task 4: Move File Parsing And Transient Segment Infrastructure

**Files:**

- Move: `apps/desktop/src/main/localization/transientSegment.ts` -> `packages/localization/src/transientSegment.ts`
- Move: `apps/desktop/src/main/localization/transientSegment.test.ts` -> `packages/localization/src/transientSegment.test.ts`
- Move: `apps/desktop/src/main/localization/modules/FileModule.ts` -> `packages/localization/src/modules/FileModule.ts`
- Move: `apps/desktop/src/main/localization/modules/FileModule.test.ts` -> `packages/localization/src/modules/FileModule.test.ts`
- Move: `apps/desktop/src/main/localization/spreadsheetFileAdapter.ts` -> `packages/localization/src/spreadsheetFileAdapter.ts`
- Move: `apps/desktop/src/main/localization/spreadsheetFileAdapter.test.ts` -> `packages/localization/src/spreadsheetFileAdapter.test.ts`
- Move: `apps/desktop/src/main/localization/fileTranslationJobAdapter.ts` -> `packages/localization/src/fileTranslationJobAdapter.ts`
- Move: `apps/desktop/src/main/localization/fileTranslationJobAdapter.test.ts` -> `packages/localization/src/fileTranslationJobAdapter.test.ts`
- Modify: `packages/localization/src/fileTranslationJobAdapter.ts`
- Modify: `packages/localization/src/index.ts`

- [ ] **Step 1: Move the files with git**

Run:

```bash
git mv apps/desktop/src/main/localization/transientSegment.ts packages/localization/src/transientSegment.ts
git mv apps/desktop/src/main/localization/transientSegment.test.ts packages/localization/src/transientSegment.test.ts
git mv apps/desktop/src/main/localization/modules/FileModule.ts packages/localization/src/modules/FileModule.ts
git mv apps/desktop/src/main/localization/modules/FileModule.test.ts packages/localization/src/modules/FileModule.test.ts
git mv apps/desktop/src/main/localization/spreadsheetFileAdapter.ts packages/localization/src/spreadsheetFileAdapter.ts
git mv apps/desktop/src/main/localization/spreadsheetFileAdapter.test.ts packages/localization/src/spreadsheetFileAdapter.test.ts
git mv apps/desktop/src/main/localization/fileTranslationJobAdapter.ts packages/localization/src/fileTranslationJobAdapter.ts
git mv apps/desktop/src/main/localization/fileTranslationJobAdapter.test.ts packages/localization/src/fileTranslationJobAdapter.test.ts
```

- [ ] **Step 2: Replace the target-scope import**

In `packages/localization/src/fileTranslationJobAdapter.ts`, replace:

```ts
import { resolveBatchTargetScope } from '../services/modules/ai/translationTargetScope';
```

with:

```ts
import { resolveBatchTargetScope } from './translationTargetScope';
```

- [ ] **Step 3: Create the headless target-scope helper**

Create `packages/localization/src/translationTargetScope.ts`:

```ts
import type { LocalizationTargetScope } from './types';

export function resolveBatchTargetScope(scope?: LocalizationTargetScope): LocalizationTargetScope {
  if (scope === 'overwrite-non-confirmed') {
    return 'overwrite-non-confirmed';
  }

  return 'blank-only';
}
```

- [ ] **Step 4: Export file infrastructure**

Append these exports to `packages/localization/src/index.ts`:

```ts
export { createTransientSegment } from './transientSegment';
export {
  fileRowsToLocalizationUnits,
  parseExternalSpreadsheet,
  writeInspectSpreadsheet,
  writeTranslatedSpreadsheet,
} from './modules/FileModule';
export type { ParsedSpreadsheetFile, SheetCell } from './modules/FileModule';
export { translateSpreadsheetFile } from './spreadsheetFileAdapter';
export {
  inferFileTranslationJobSidecarPaths,
  prepareFileTranslationJob,
  resolveFileTranslationJobSidecarPaths,
  translateSpreadsheetFileJob,
} from './fileTranslationJobAdapter';
export type {
  FileTranslationJobRunnerFactory,
  FileTranslationJobSidecarPaths,
  PreparedFileTranslationJob,
  TranslateSpreadsheetFileJobOptions,
} from './fileTranslationJobAdapter';
export { resolveBatchTargetScope } from './translationTargetScope';
```

- [ ] **Step 5: Run moved file tests**

Run:

```bash
npx vitest run packages/localization/src/transientSegment.test.ts packages/localization/src/modules/FileModule.test.ts packages/localization/src/spreadsheetFileAdapter.test.ts packages/localization/src/fileTranslationJobAdapter.test.ts
```

Expected: PASS.

- [ ] **Step 6: Build the package**

Run:

```bash
npm run build --workspace=packages/localization
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add packages/localization apps/desktop/src/main/localization
git commit -m "refactor: move headless file infrastructure"
```

---

### Task 5: Move Headless Ports, SQLite Adapters, And TM/TB Services

**Files:**

- Modify: `packages/localization/src/ports.ts`
- Create: `packages/localization/src/adapters/sqlite/SqliteProjectRepository.ts`
- Create: `packages/localization/src/adapters/sqlite/SqliteSettingsRepository.ts`
- Create: `packages/localization/src/adapters/sqlite/SqliteTBRepository.ts`
- Create: `packages/localization/src/adapters/sqlite/SqliteTMRepository.ts`
- Create: `packages/localization/src/services/TMService.ts`
- Create: `packages/localization/src/services/TBService.ts`
- Modify: `packages/localization/src/index.ts`

- [ ] **Step 1: Expand headless ports**

Replace `packages/localization/src/ports.ts` with:

```ts
import type { QaIssue, Segment, SegmentStatus, TBEntry, TMEntry, Token } from '@cat/core/models';
import type { Project, ProjectAIModel, ProjectQASettings, ProjectType } from '@cat/core/project';
import type {
  MountedTBRecord,
  MountedTMRecord,
  ProjectFileRecord,
  ProjectListRecord,
  ProjectTermEntryRecord,
  TBRecord,
  TMConcordanceRecallOptions,
  TMEntryRow,
  TMRecallOptions,
  TMRecord,
  TMType,
} from '@cat/db';

export type {
  MountedTBRecord,
  MountedTMRecord,
  ProjectFileRecord,
  ProjectListRecord,
  ProjectTermEntryRecord,
  TBRecord,
  TMConcordanceRecallOptions,
  TMEntryRow,
  TMRecallOptions,
  TMRecord,
  TMType,
};

export type ProjectRecord = Project;
export type TMEntryWithTmId = TMEntry & { tmId: string };

export interface ProjectRepository {
  createProject(name: string, srcLang: string, tgtLang: string, projectType?: ProjectType): number;
  listProjects(): ProjectListRecord[];
  getProject(id: number): ProjectRecord | undefined;
  updateProjectPrompt(projectId: number, aiPrompt: string | null): void;
  updateProjectAISettings(
    projectId: number,
    aiPrompt: string | null,
    aiModel: ProjectAIModel | null,
  ): void;
  updateProjectQASettings(projectId: number, qaSettings: ProjectQASettings): void;
  deleteProject(id: number): void;
  createFile(projectId: number, name: string, importOptionsJson?: string): number;
  listFiles(projectId: number): ProjectFileRecord[];
  getFile(id: number): ProjectFileRecord | undefined;
  deleteFile(id: number): void;
}

export interface SegmentRepository {
  bulkInsertSegments(segments: Segment[]): void;
  getSegmentsPage(fileId: number, offset: number, limit: number): Segment[];
  getSegment(segmentId: string): Segment | undefined;
  getProjectIdByFileId(fileId: number): number | undefined;
  getProjectTypeByFileId(fileId: number): ProjectType | undefined;
  getProjectSegmentsByHash(projectId: number, srcHash: string): Segment[];
  updateSegmentTarget(segmentId: string, targetTokens: Token[], status: SegmentStatus): void;
  updateSegmentQaIssues(segmentId: string, qaIssues: QaIssue[]): void;
}

export interface TMRepository {
  upsertTMEntryBySrcHash(entry: TMEntry & { tmId: string }): string;
  insertTMEntryIfAbsentBySrcHash(entry: TMEntry & { tmId: string }): string | undefined;
  insertTMFts(tmId: string, srcText: string, tgtText: string, tmEntryId: string): void;
  replaceTMFts(tmId: string, srcText: string, tgtText: string, tmEntryId: string): void;
  findTMEntryByHash(tmId: string, srcHash: string): TMEntry | undefined;
  searchConcordance(projectId: number, query: string, tmIds?: string[]): TMEntryWithTmId[];
  searchTMRecallCandidates(
    projectId: number,
    sourceText: string,
    tmIds?: string[],
    options?: TMRecallOptions,
  ): TMEntryWithTmId[];
  searchTMFuzzyRecallCandidates(
    projectId: number,
    sourceText: string,
    tmIds?: string[],
    options?: TMRecallOptions,
  ): TMEntryWithTmId[];
  searchTMConcordanceRecallCandidates(
    projectId: number,
    queryText: string,
    tmIds?: string[],
    options?: TMConcordanceRecallOptions,
  ): TMEntryWithTmId[];
  listTMs(type?: TMType): TMRecord[];
  createTM(name: string, srcLang: string, tgtLang: string, type: TMType): string;
  deleteTM(id: string): void;
  getTM(tmId: string): TMRecord | undefined;
  getTMStats(tmId: string): { entryCount: number; maxEntryUpdatedAt?: string | null };
  getProjectMountedTMs(projectId: number): MountedTMRecord[];
  mountTMToProject(projectId: number, tmId: string, priority?: number, permission?: string): void;
  unmountTMFromProject(projectId: number, tmId: string): void;
}

export interface TBRepository {
  listTermBases(): TBRecord[];
  createTermBase(name: string, srcLang: string, tgtLang: string): string;
  deleteTermBase(id: string): void;
  getTermBase(tbId: string): TBRecord | undefined;
  getTermBaseStats(tbId: string): { entryCount: number; maxEntryUpdatedAt?: string | null };
  getProjectMountedTermBases(projectId: number): MountedTBRecord[];
  mountTermBaseToProject(projectId: number, tbId: string, priority?: number): void;
  unmountTermBaseFromProject(projectId: number, tbId: string): void;
  listProjectTermEntries(projectId: number): ProjectTermEntryRecord[];
  searchProjectTermEntries(
    projectId: number,
    sourceText: string,
    options?: { srcLang?: string; limit?: number },
  ): ProjectTermEntryRecord[];
  upsertTBEntryBySrcTerm(params: {
    id: string;
    tbId: string;
    srcLang: string;
    srcTerm: string;
    tgtTerm: string;
    note?: string | null;
    usageCount?: number;
  }): string;
  insertTBEntryIfAbsentBySrcTerm(params: {
    id: string;
    tbId: string;
    srcLang: string;
    srcTerm: string;
    tgtTerm: string;
    note?: string | null;
    usageCount?: number;
  }): string | undefined;
}

export interface SettingsRepository {
  getSetting(key: string): string | undefined;
  setSetting(key: string, value: string | null): void;
}

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface AiModelRuntimeConfig {
  reasoningEffort: ReasoningEffort;
}

export interface AIRuntimeConfigProvider {
  getModelConfig(model: string): Promise<AiModelRuntimeConfig>;
}

export interface AITransport {
  testConnection(params: {
    apiKey: string;
    baseUrl: string;
    model: string;
  }): Promise<{
    ok: true;
    status: number;
    endpoint: string;
    rawResponseText?: string;
  }>;
  createResponse(params: {
    apiKey: string;
    baseUrl: string;
    model: string;
    reasoningEffort: ReasoningEffort;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<{
    content: string;
    requestId?: string;
    status: number;
    endpoint: string;
    rawResponseText?: string;
  }>;
}
```

- [ ] **Step 2: Copy SQLite adapters into localization**

Create `packages/localization/src/adapters/sqlite/SqliteProjectRepository.ts` by copying `apps/desktop/src/main/services/adapters/SqliteProjectRepository.ts`, then change its imports to:

```ts
import type { ProjectAIModel, ProjectQASettings, ProjectType } from '@cat/core/project';
import { CATDatabase } from '@cat/db';
import type { ProjectFileRecord, ProjectListRecord, ProjectRecord, ProjectRepository } from '../../ports';
```

Create `packages/localization/src/adapters/sqlite/SqliteSettingsRepository.ts`:

```ts
import { CATDatabase } from '@cat/db';
import type { SettingsRepository } from '../../ports';

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly db: CATDatabase) {}

  getSetting(key: string): string | undefined {
    return this.db.getSetting(key);
  }

  setSetting(key: string, value: string | null): void {
    this.db.setSetting(key, value);
  }
}
```

Create `packages/localization/src/adapters/sqlite/SqliteTBRepository.ts` by copying `apps/desktop/src/main/services/adapters/SqliteTBRepository.ts`, then change imports to use:

```ts
import { CATDatabase } from '@cat/db';
import type { TBRepository } from '../../ports';
```

Create `packages/localization/src/adapters/sqlite/SqliteTMRepository.ts` by copying `apps/desktop/src/main/services/adapters/SqliteTMRepository.ts`, then change imports to use:

```ts
import { CATDatabase } from '@cat/db';
import type { MountedTMRecord, TMConcordanceRecallOptions, TMRecallOptions, TMRecord, TMRepository } from '../../ports';
```

- [ ] **Step 3: Copy TM/TB services into localization**

Copy `apps/desktop/src/main/services/TMService.ts` to `packages/localization/src/services/TMService.ts`.

Keep its imports in this shape:

```ts
import { type Segment, type TMEntry } from '@cat/core/models';
import { serializeTokensToDisplayText, serializeTokensToTextOnly } from '@cat/core/text';
import { randomUUID } from 'crypto';
import { distance } from 'fastest-levenshtein';
import type { ProjectRepository, TMRepository } from '../ports';
```

Copy `apps/desktop/src/main/services/TBService.ts` to `packages/localization/src/services/TBService.ts`.

Keep its imports in this shape:

```ts
import type { Segment, TBEntry, TBMatch } from '@cat/core/models';
import {
  findTermPositionsInText,
  serializeTokensToSearchText,
  suppressNestedTermMatches,
} from '@cat/core/text';
import type { ProjectRepository, TBRepository } from '../ports';
```

- [ ] **Step 4: Export adapters and services**

Append these exports to `packages/localization/src/index.ts`:

```ts
export type * from './ports';
export { SqliteProjectRepository } from './adapters/sqlite/SqliteProjectRepository';
export { SqliteSettingsRepository } from './adapters/sqlite/SqliteSettingsRepository';
export { SqliteTBRepository } from './adapters/sqlite/SqliteTBRepository';
export { SqliteTMRepository } from './adapters/sqlite/SqliteTMRepository';
export { TMService } from './services/TMService';
export type { TMMatch, TMMatchKind, StandardTMMatch, ConcordanceTMMatch } from './services/TMService';
export { TBService } from './services/TBService';
```

- [ ] **Step 5: Build the package**

Run:

```bash
npm run build --workspace=packages/localization
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add packages/localization/src/ports.ts packages/localization/src/adapters packages/localization/src/services packages/localization/src/index.ts
git commit -m "refactor: add localization ports and adapters"
```

---

### Task 6: Move Provider Runtime Services

**Files:**

- Create: `packages/localization/src/providers/AIProviderCatalogService.ts`
- Create: `packages/localization/src/providers/AIRuntimeConfigService.ts`
- Create: `packages/localization/src/providers/AIProviderTransport.ts`
- Modify: `packages/localization/src/index.ts`

- [ ] **Step 1: Copy provider catalog**

Copy `apps/desktop/src/main/services/modules/ai/AIProviderCatalogService.ts` to `packages/localization/src/providers/AIProviderCatalogService.ts`.

Replace shared IPC imports with local provider types. Add these interfaces near the top of the new file:

```ts
export interface AddAIProviderInput {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface TestAIProviderInput extends AddAIProviderInput {}

export interface AITestProviderResult {
  ok: boolean;
  status?: number;
  endpoint?: string;
  model?: string;
  rawResponseText?: string;
  error?: string;
}

export interface AIProviderSummary {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  protocol: 'chat-completions';
  kind: 'builtin' | 'custom';
  apiKeyLast4?: string;
  createdAt: string;
  updatedAt: string;
}
```

Replace:

```ts
import type {
  AddAIProviderInput,
  AIProviderSummary,
  AITestProviderResult,
  TestAIProviderInput,
} from '../../../../shared/ipc';
import type { AITransport, SettingsRepository } from '../../ports';
import { AISettingsService } from './AISettingsService';
```

with:

```ts
import type { AITransport, SettingsRepository } from '../ports';
```

Replace `AISettingsService.AI_API_KEY` with:

```ts
const OPENAI_API_KEY = 'openai_api_key';
```

and use `OPENAI_API_KEY` in `listProviders()` and `resolveProviderConfig()`.

- [ ] **Step 2: Copy runtime config service**

Copy `apps/desktop/src/main/services/modules/ai/AIRuntimeConfigService.ts` to `packages/localization/src/providers/AIRuntimeConfigService.ts`.

Change its import to:

```ts
import type { AIRuntimeConfigProvider, AiModelRuntimeConfig, ReasoningEffort } from '../ports';
```

- [ ] **Step 3: Copy provider transport**

Copy `apps/desktop/src/main/services/providers/AIProviderTransport.ts` to `packages/localization/src/providers/AIProviderTransport.ts`.

Change its import to:

```ts
import type { AITransport } from '../ports';
```

- [ ] **Step 4: Export provider services**

Append these exports to `packages/localization/src/index.ts`:

```ts
export {
  AIProviderCatalogService,
  type AddAIProviderInput,
  type AIProviderSummary,
  type AITestProviderResult,
  type ResolvedAIProviderConfig,
  type TestAIProviderInput,
} from './providers/AIProviderCatalogService';
export {
  AIRuntimeConfigService,
  DefaultAIRuntimeConfigProvider,
  createDefaultAIRuntimeConfig,
  sanitizeAIRuntimeConfig,
  type AiRuntimeConfig,
} from './providers/AIRuntimeConfigService';
export { AIProviderTransport } from './providers/AIProviderTransport';
```

- [ ] **Step 5: Run provider tests through existing callers**

Run:

```bash
npx vitest run packages/localization/src/providers
```

Expected: PASS if no provider tests exist, Vitest reports no matching tests. Then run:

```bash
npm run build --workspace=packages/localization
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add packages/localization/src/providers packages/localization/src/index.ts
git commit -m "refactor: move localization provider runtime"
```

---

### Task 7: Move Headless TM/TB/MT Modules

**Files:**

- Move: `apps/desktop/src/main/localization/modules/TMModule.ts` -> `packages/localization/src/modules/TMModule.ts`
- Move: `apps/desktop/src/main/localization/modules/TMModule.test.ts` -> `packages/localization/src/modules/TMModule.test.ts`
- Move: `apps/desktop/src/main/localization/modules/TBModule.ts` -> `packages/localization/src/modules/TBModule.ts`
- Move: `apps/desktop/src/main/localization/modules/TBModule.test.ts` -> `packages/localization/src/modules/TBModule.test.ts`
- Move: `apps/desktop/src/main/localization/modules/MTModule.ts` -> `packages/localization/src/modules/MTModule.ts`
- Move: `apps/desktop/src/main/localization/modules/MTModule.test.ts` -> `packages/localization/src/modules/MTModule.test.ts`
- Modify: moved module files and tests
- Modify: `packages/localization/src/index.ts`

- [ ] **Step 1: Move module files**

Run:

```bash
git mv apps/desktop/src/main/localization/modules/TMModule.ts packages/localization/src/modules/TMModule.ts
git mv apps/desktop/src/main/localization/modules/TMModule.test.ts packages/localization/src/modules/TMModule.test.ts
git mv apps/desktop/src/main/localization/modules/TBModule.ts packages/localization/src/modules/TBModule.ts
git mv apps/desktop/src/main/localization/modules/TBModule.test.ts packages/localization/src/modules/TBModule.test.ts
git mv apps/desktop/src/main/localization/modules/MTModule.ts packages/localization/src/modules/MTModule.ts
git mv apps/desktop/src/main/localization/modules/MTModule.test.ts packages/localization/src/modules/MTModule.test.ts
```

- [ ] **Step 2: Update TM/TB module imports**

In `packages/localization/src/modules/TMModule.ts`, replace desktop service imports with:

```ts
import type { TMRepository } from '../ports';
import { type TMMatch, type TMService } from '../services/TMService';
```

In `packages/localization/src/modules/TBModule.ts`, replace desktop service imports with:

```ts
import type { TBRepository } from '../ports';
import type { TBService } from '../services/TBService';
```

- [ ] **Step 3: Update MT module imports**

In `packages/localization/src/modules/MTModule.ts`, replace:

```ts
import {
  AIProviderCatalogService,
  type ResolvedAIProviderConfig,
} from '../../services/modules/ai/AIProviderCatalogService';
import type { AIRuntimeConfigProvider, AITransport, ReasoningEffort } from '../../services/ports';
```

with:

```ts
import {
  AIProviderCatalogService,
  type ResolvedAIProviderConfig,
} from '../providers/AIProviderCatalogService';
import type { AIRuntimeConfigProvider, AITransport, ReasoningEffort } from '../ports';
```

- [ ] **Step 4: Update module tests**

In module tests, replace imports from `../../services/adapters`, `../../services/modules/ai`, `../../services/ports`, and `../../services/TMService` with localization paths:

```ts
import { SqliteSettingsRepository } from '../adapters/sqlite/SqliteSettingsRepository';
import { AIProviderCatalogService } from '../providers/AIProviderCatalogService';
import type { AIRuntimeConfigProvider, AITransport } from '../ports';
import type { TMMatch } from '../services/TMService';
```

For `TMModule.test.ts`, use:

```ts
import { SqliteProjectRepository } from '../adapters/sqlite/SqliteProjectRepository';
import { SqliteTMRepository } from '../adapters/sqlite/SqliteTMRepository';
import type { TMRepository } from '../ports';
import { TMService, type TMMatch } from '../services/TMService';
```

For `TBModule.test.ts`, use:

```ts
import { SqliteProjectRepository } from '../adapters/sqlite/SqliteProjectRepository';
import { SqliteTBRepository } from '../adapters/sqlite/SqliteTBRepository';
import type { TBRepository } from '../ports';
import { TBService } from '../services/TBService';
```

- [ ] **Step 5: Export modules**

Append these exports to `packages/localization/src/index.ts`:

```ts
export { TMModule, mapTMEngineReferences } from './modules/TMModule';
export { TBModule, mapTBEngineReferences } from './modules/TBModule';
export { MTModule } from './modules/MTModule';
export type {
  ComposePromptInput,
  MTModuleOptions,
  MTTranslateResult,
  PreparedPromptInput,
  PromptMTConfig,
  ResolvedMTConfig,
  TranslatePreparedPromptInput,
} from './modules/MTModule';
```

- [ ] **Step 6: Run module tests**

Run:

```bash
npx vitest run packages/localization/src/modules/TMModule.test.ts packages/localization/src/modules/TBModule.test.ts packages/localization/src/modules/MTModule.test.ts
```

Expected: PASS.

- [ ] **Step 7: Build the package**

Run:

```bash
npm run build --workspace=packages/localization
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add packages/localization apps/desktop/src/main/localization
git commit -m "refactor: move localization resource modules"
```

---

### Task 8: Move `LocalizationEngine` And `LocalizationInspector`

**Files:**

- Move: `apps/desktop/src/main/localization/LocalizationEngine.ts` -> `packages/localization/src/LocalizationEngine.ts`
- Move: `apps/desktop/src/main/localization/LocalizationEngine.test.ts` -> `packages/localization/src/LocalizationEngine.test.ts`
- Move: `apps/desktop/src/main/localization/LocalizationEngine.cli.test.ts` -> `packages/localization/src/LocalizationEngine.cli.test.ts`
- Move: `apps/desktop/src/main/localization/LocalizationInspector.ts` -> `packages/localization/src/LocalizationInspector.ts`
- Move: `apps/desktop/src/main/localization/LocalizationInspector.test.ts` -> `packages/localization/src/LocalizationInspector.test.ts`
- Move: `apps/desktop/src/main/localization/LocalizationInspector.cli.test.ts` -> `packages/localization/src/LocalizationInspector.cli.test.ts`
- Modify: moved engine and inspector files
- Modify: `packages/localization/src/index.ts`
- Create or modify: `apps/desktop/src/main/localization/index.ts`

- [ ] **Step 1: Move engine and inspector files**

Run:

```bash
git mv apps/desktop/src/main/localization/LocalizationEngine.ts packages/localization/src/LocalizationEngine.ts
git mv apps/desktop/src/main/localization/LocalizationEngine.test.ts packages/localization/src/LocalizationEngine.test.ts
git mv apps/desktop/src/main/localization/LocalizationEngine.cli.test.ts packages/localization/src/LocalizationEngine.cli.test.ts
git mv apps/desktop/src/main/localization/LocalizationInspector.ts packages/localization/src/LocalizationInspector.ts
git mv apps/desktop/src/main/localization/LocalizationInspector.test.ts packages/localization/src/LocalizationInspector.test.ts
git mv apps/desktop/src/main/localization/LocalizationInspector.cli.test.ts packages/localization/src/LocalizationInspector.cli.test.ts
```

- [ ] **Step 2: Update `LocalizationEngine.ts` imports**

Replace desktop service imports with localization package imports:

```ts
import { TBService } from './services/TBService';
import { TMService } from './services/TMService';
import { SqliteProjectRepository } from './adapters/sqlite/SqliteProjectRepository';
import { SqliteSettingsRepository } from './adapters/sqlite/SqliteSettingsRepository';
import { SqliteTBRepository } from './adapters/sqlite/SqliteTBRepository';
import { SqliteTMRepository } from './adapters/sqlite/SqliteTMRepository';
import { DefaultAIRuntimeConfigProvider } from './providers/AIRuntimeConfigService';
import { AIProviderCatalogService } from './providers/AIProviderCatalogService';
import { resolveBatchTargetScope } from './translationTargetScope';
import { AIProviderTransport } from './providers/AIProviderTransport';
import type { AIRuntimeConfigProvider, AITransport } from './ports';
```

- [ ] **Step 3: Update `LocalizationInspector.ts` imports**

Replace desktop service imports with localization package imports:

```ts
import { TBService } from './services/TBService';
import { TMService } from './services/TMService';
import { SqliteProjectRepository } from './adapters/sqlite/SqliteProjectRepository';
import { SqliteSettingsRepository } from './adapters/sqlite/SqliteSettingsRepository';
import { SqliteTBRepository } from './adapters/sqlite/SqliteTBRepository';
import { SqliteTMRepository } from './adapters/sqlite/SqliteTMRepository';
import { DefaultAIRuntimeConfigProvider } from './providers/AIRuntimeConfigService';
import { AIProviderCatalogService } from './providers/AIProviderCatalogService';
import { AIProviderTransport } from './providers/AIProviderTransport';
import type { AIRuntimeConfigProvider, AITransport } from './ports';
```

- [ ] **Step 4: Update tests to local ports**

In moved engine and inspector tests, replace:

```ts
import type { AITransport } from '../services/ports';
```

with:

```ts
import type { AITransport } from './ports';
```

- [ ] **Step 5: Export engine and inspector**

Append these exports to `packages/localization/src/index.ts`:

```ts
export { LocalizationEngine } from './LocalizationEngine';
export type { LocalizationEngineConstructorOptions } from './LocalizationEngine';
export { LocalizationInspector } from './LocalizationInspector';
export type { InspectFileInput, InspectFileResult, LocalizationInspectorOptions } from './LocalizationInspector';
```

- [ ] **Step 6: Add a temporary desktop compatibility re-export**

Create or replace `apps/desktop/src/main/localization/index.ts`:

```ts
export * from '@cat/localization';
```

This keeps any current desktop imports from `apps/desktop/src/main/localization` working while the package boundary lands.

- [ ] **Step 7: Run engine and inspector tests**

Run:

```bash
npx vitest run packages/localization/src/LocalizationEngine.test.ts packages/localization/src/LocalizationInspector.test.ts
```

Expected: PASS.

- [ ] **Step 8: Build the package**

Run:

```bash
npm run build --workspace=packages/localization
```

Expected: PASS.

- [ ] **Step 9: Verify no desktop imports remain**

Run:

```bash
rg -n "apps/desktop/src/main|\\.\\./services|\\.\\.\\/services|services/modules|services/providers" packages/localization/src
```

Expected: no matches.

- [ ] **Step 10: Commit**

Run:

```bash
git add packages/localization apps/desktop/src/main/localization
git commit -m "refactor: move localization engine package"
```

---

### Task 9: Update CLI Scripts To Use Package Tests Temporarily

**Files:**

- Modify: `scripts/translate-file.mjs`
- Modify: `scripts/inspect-localization.mjs`

- [ ] **Step 1: Point dynamic test paths to the new package**

In `scripts/translate-file.mjs`, replace:

```js
const TEST_PATH =
  "apps/desktop/src/main/localization/LocalizationEngine.cli.test.ts";
```

with:

```js
const TEST_PATH =
  "packages/localization/src/LocalizationEngine.cli.test.ts";
```

In `scripts/inspect-localization.mjs`, replace:

```js
const TEST_PATH =
  "apps/desktop/src/main/localization/LocalizationInspector.cli.test.ts";
```

with:

```js
const TEST_PATH =
  "packages/localization/src/LocalizationInspector.cli.test.ts";
```

- [ ] **Step 2: Verify help still works**

Run:

```bash
npm run inspect:localization -- --help
npm run translate:file -- --help
```

Expected: both commands print usage text and exit 0.

- [ ] **Step 3: Run package CLI tests directly**

Run:

```bash
npx vitest run packages/localization/src/LocalizationEngine.cli.test.ts packages/localization/src/LocalizationInspector.cli.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add scripts/translate-file.mjs scripts/inspect-localization.mjs
git commit -m "chore: point localization cli scripts to package"
```

---

### Task 10: Replace Vitest Runtime With Direct CLI Runners

**Files:**

- Create: `packages/localization/src/cli/translateFileCommand.ts`
- Create: `packages/localization/src/cli/inspectLocalizationCommand.ts`
- Create: `scripts/translate-file-runner.mjs`
- Create: `scripts/inspect-localization-runner.mjs`
- Modify: `scripts/translate-file.mjs`
- Modify: `scripts/inspect-localization.mjs`
- Modify: `packages/localization/src/index.ts`
- Modify: `DOCS/agent-first/CLI.md`

- [ ] **Step 1: Add package CLI command functions**

Create `packages/localization/src/cli/translateFileCommand.ts`:

```ts
import { CATDatabase } from '@cat/db';
import { LocalizationEngine } from '../LocalizationEngine';
import type { TranslateFileInput } from '../types';

export interface TranslateFileCommandConfig {
  dbPath: string;
  projectId: number;
  inputPath: string;
  outputPath: string;
  targetScope?: 'blank-only' | 'overwrite-non-confirmed';
  checkpointPath?: string;
  eventsPath?: string;
  artifactsPath?: string;
  resume?: boolean;
  maxAttempts?: number;
  snapshotPath?: string;
  snapshotEveryUnits?: number;
  snapshotEverySeconds?: number;
  progressStdout?: boolean;
}

export async function runTranslateFileCommand(config: TranslateFileCommandConfig) {
  const db = new CATDatabase(config.dbPath);
  try {
    const engine = new LocalizationEngine(db, { dbPath: config.dbPath });
    const input: TranslateFileInput = {
      projectId: config.projectId,
      inputPath: config.inputPath,
      outputPath: config.outputPath,
      options: {
        targetScope: config.targetScope,
      },
      job: {
        checkpointPath: config.checkpointPath,
        eventsPath: config.eventsPath,
        artifactsPath: config.artifactsPath,
        resume: config.resume,
        maxAttempts: config.maxAttempts,
        snapshotPath: config.snapshotPath,
        snapshotEveryUnits: config.snapshotEveryUnits,
        snapshotEverySeconds: config.snapshotEverySeconds,
        progressStdout: config.progressStdout,
      },
    };

    return await engine.translateFile(input);
  } finally {
    db.close();
  }
}
```

Create `packages/localization/src/cli/inspectLocalizationCommand.ts`:

```ts
import { CATDatabase } from '@cat/db';
import { LocalizationInspector, type InspectFileInput } from '../LocalizationInspector';

export interface InspectLocalizationCommandConfig {
  dbPath: string;
  projectId: number;
  inputPath: string;
  outputPath: string;
  jsonOutputPath?: string;
  unitLimit?: number;
  maxCellChars?: number;
}

export async function runInspectLocalizationCommand(config: InspectLocalizationCommandConfig) {
  const db = new CATDatabase(config.dbPath);
  try {
    const inspector = new LocalizationInspector(db, { dbPath: config.dbPath });
    const input: InspectFileInput = {
      projectId: config.projectId,
      inputPath: config.inputPath,
      outputPath: config.outputPath,
      jsonOutputPath: config.jsonOutputPath,
      unitLimit: config.unitLimit,
      maxCellChars: config.maxCellChars,
    };

    return await inspector.inspectFile(input);
  } finally {
    db.close();
  }
}
```

- [ ] **Step 2: Export CLI command functions**

Append to `packages/localization/src/index.ts`:

```ts
export { runTranslateFileCommand } from './cli/translateFileCommand';
export type { TranslateFileCommandConfig } from './cli/translateFileCommand';
export { runInspectLocalizationCommand } from './cli/inspectLocalizationCommand';
export type { InspectLocalizationCommandConfig } from './cli/inspectLocalizationCommand';
```

- [ ] **Step 3: Add lightweight JS runners**

Create `scripts/translate-file-runner.mjs`:

```js
import { pathToFileURL } from "node:url";
import path from "node:path";
import process from "node:process";

const packageEntry = path.resolve(
  process.cwd(),
  "packages/localization/dist/index.js",
);
const { runTranslateFileCommand } = await import(pathToFileURL(packageEntry).href);

export async function run(config) {
  return runTranslateFileCommand(config);
}
```

Create `scripts/inspect-localization-runner.mjs`:

```js
import { pathToFileURL } from "node:url";
import path from "node:path";
import process from "node:process";

const packageEntry = path.resolve(
  process.cwd(),
  "packages/localization/dist/index.js",
);
const { runInspectLocalizationCommand } = await import(pathToFileURL(packageEntry).href);

export async function run(config) {
  return runInspectLocalizationCommand(config);
}
```

- [ ] **Step 4: Replace `translate-file.mjs` runtime**

In `scripts/translate-file.mjs`, remove `TEST_NAME`, `TEST_PATH`, `spawnCommandSync()`, `buildRunnerEnv()`, and `runTranslation()`.

Import the runner:

```js
import { run as runTranslateFile } from "./translate-file-runner.mjs";
```

At the bottom, replace:

```js
try {
  runTranslation(parseArgs(process.argv.slice(2)));
} catch (error) {
```

with:

```js
try {
  const config = parseArgs(process.argv.slice(2));
  await runTranslateFile({
    dbPath: config.dbPath,
    projectId: Number(config.projectId),
    inputPath: config.inputPath,
    outputPath: config.outputPath,
    targetScope: config.targetScope || undefined,
    checkpointPath: config.checkpointPath || undefined,
    eventsPath: config.eventsPath || undefined,
    artifactsPath: config.artifactsPath || undefined,
    resume: config.resume,
    maxAttempts: config.maxAttempts ? Number(config.maxAttempts) : undefined,
    snapshotPath: config.snapshotPath || undefined,
    snapshotEveryUnits: config.snapshotEveryUnits ? Number(config.snapshotEveryUnits) : undefined,
    snapshotEverySeconds: config.snapshotEverySeconds ? Number(config.snapshotEverySeconds) : undefined,
    progressStdout: config.progressStdout,
  });
} catch (error) {
```

- [ ] **Step 5: Replace `inspect-localization.mjs` runtime**

In `scripts/inspect-localization.mjs`, remove `TEST_NAME`, `TEST_PATH`, `spawnCommandSync()`, and `runInspection()`.

Import the runner:

```js
import { run as runInspectLocalization } from "./inspect-localization-runner.mjs";
```

At the bottom, replace:

```js
try {
  runInspection(parseArgs(process.argv.slice(2)));
} catch (error) {
```

with:

```js
try {
  const config = parseArgs(process.argv.slice(2));
  await runInspectLocalization({
    dbPath: config.dbPath,
    projectId: Number(config.projectId),
    inputPath: config.inputPath,
    outputPath: config.outputPath,
    jsonOutputPath: config.jsonOutputPath || undefined,
    unitLimit: config.unitLimit ? Number(config.unitLimit) : undefined,
    maxCellChars: config.maxCellChars ? Number(config.maxCellChars) : undefined,
  });
} catch (error) {
```

- [ ] **Step 6: Build before running CLI help**

Run:

```bash
npm run build --workspace=packages/localization
```

Expected: PASS.

- [ ] **Step 7: Verify help commands**

Run:

```bash
npm run inspect:localization -- --help
npm run translate:file -- --help
```

Expected: both commands print usage text and exit 0.

- [ ] **Step 8: Update CLI docs**

In `DOCS/agent-first/CLI.md`, keep command syntax unchanged and remove any wording that implies `translate:file` or `inspect:localization` run through Vitest tests. Add this sentence under `Commands`:

```markdown
The CLI scripts are thin Node entrypoints that call `@cat/localization`; tests verify the same package APIs without serving as the command runtime.
```

- [ ] **Step 9: Commit**

Run:

```bash
git add packages/localization/src/cli packages/localization/src/index.ts scripts/translate-file-runner.mjs scripts/inspect-localization-runner.mjs scripts/translate-file.mjs scripts/inspect-localization.mjs DOCS/agent-first/CLI.md
git commit -m "refactor: run localization cli through package"
```

---

### Task 11: Update Architecture Documentation

**Files:**

- Modify: `DOCS/10_ARCHITECTURE.md`
- Modify: `DOCS/agent-first/ARCHITECTURE.md`
- Modify: `DOCS/agent-first/MT_MODULE.md`
- Modify: `DOCS/00_START_HERE.md`

- [ ] **Step 1: Update main architecture package section**

In `DOCS/10_ARCHITECTURE.md`, add `@cat/localization` under `Packages`:

```markdown
- `@cat/localization`: agent-first/headless localization orchestration, including file adapters, job runner, checkpoint/events/artifacts, LocalizationEngine, LocalizationInspector, and headless TM/TB/MT adapter modules.
```

Add this dependency rule:

```markdown
`@cat/localization` may depend on `@cat/core` and `@cat/db`, but must not import `apps/desktop/src/main/*`. Desktop and CLI code call localization APIs instead of owning headless engine code.
```

- [ ] **Step 2: Update agent-first architecture code paths**

In `DOCS/agent-first/ARCHITECTURE.md`, replace the Resource Modules code paths with:

```markdown
- `packages/localization/src/modules/TMModule.ts`
- `packages/localization/src/modules/TBModule.ts`
- `packages/localization/src/modules/MTModule.ts`
```

Replace File Layer and Job Layer code paths with these package paths:

```markdown
- `packages/localization/src/modules/FileModule.ts`
- `packages/localization/src/fileTranslationJobAdapter.ts`
- `packages/localization/src/spreadsheetFileAdapter.ts`
- `packages/localization/src/job/TranslationJobRunner.ts`
- `packages/localization/src/job/CheckpointStore.ts`
- `packages/localization/src/job/EventSink.ts`
- `packages/localization/src/job/ArtifactStore.ts`
- `packages/localization/src/job/TaskPlanner.ts`
```

- [ ] **Step 3: Update MT module documentation paths**

In `DOCS/agent-first/MT_MODULE.md`, replace:

```markdown
- `apps/desktop/src/main/localization/modules/MTModule.ts`
- `apps/desktop/src/main/localization/modules/MTModule.test.ts`
```

with:

```markdown
- `packages/localization/src/modules/MTModule.ts`
- `packages/localization/src/modules/MTModule.test.ts`
```

- [ ] **Step 4: Update onboarding fast index**

In `DOCS/00_START_HERE.md`, change:

```markdown
- Agent-first localization: `apps/desktop/src/main/localization`
```

to:

```markdown
- Agent-first localization: `packages/localization/src`
```

- [ ] **Step 5: Run docs search**

Run:

```bash
rg -n "apps/desktop/src/main/localization" DOCS
```

Expected: no matches except historical notes in `DOCS/90_HISTORY_CONSOLIDATED.md` if present.

- [ ] **Step 6: Commit**

Run:

```bash
git add DOCS/10_ARCHITECTURE.md DOCS/agent-first/ARCHITECTURE.md DOCS/agent-first/MT_MODULE.md DOCS/00_START_HERE.md
git commit -m "docs: document localization package boundary"
```

---

### Task 12: Final Validation And Cleanup

**Files:**

- Modify only files needed to fix validation failures from prior tasks.

- [ ] **Step 1: Run targeted localization tests**

Run:

```bash
npx vitest run packages/localization/src
```

Expected: PASS.

- [ ] **Step 2: Build all touched packages**

Run:

```bash
npm run build --workspace=packages/localization
npm run build --workspace=packages/core
npm run build --workspace=packages/db
```

Expected: all PASS.

- [ ] **Step 3: Run architecture guard**

Run:

```bash
npm run gate:arch
```

Expected: PASS.

- [ ] **Step 4: Verify no localization imports from desktop main**

Run:

```bash
rg -n "apps/desktop/src/main|\\.\\./services|\\.\\.\\/services|services/modules|services/providers" packages/localization/src
```

Expected: no matches.

- [ ] **Step 5: Run CLI help smoke**

Run:

```bash
npm run inspect:localization -- --help
npm run translate:file -- --help
```

Expected: both commands print usage text and exit 0.

- [ ] **Step 6: Run repo gate**

Run:

```bash
npm run gate:check
```

Expected: PASS.

- [ ] **Step 7: Inspect final status**

Run:

```bash
git status --short
```

Expected: only intentional files are modified. Do not revert unrelated user changes.

- [ ] **Step 8: Final commit if validation fixes were needed**

If Step 1 through Step 6 required fixes after the last task commit, run:

```bash
git add packages/localization apps/desktop scripts DOCS package.json vitest.config.ts
git commit -m "chore: validate localization package extraction"
```

Expected: commit succeeds. If no validation fixes were needed, do not create an empty commit.
