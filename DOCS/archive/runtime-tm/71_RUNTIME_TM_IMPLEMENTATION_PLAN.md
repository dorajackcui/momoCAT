# Runtime TM Implementation Plan

> Archived implementation plan. This is not active policy. Runtime TM's
> durable behavior is now documented in `DOCS/50_MT_REQUEST_MODEL.md`,
> `DOCS/60_TM_TB_REFERENCE.md`, and `DOCS/90_STATUS_AND_ROADMAP.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a job-local Runtime TM for headless file translation so later Window Mode requests can reuse source-target pairs produced or observed earlier in the same file job.

**Architecture:** Runtime TM lives in `@cat/localization` as a file-job-scoped memory layer backed by an isolated in-memory SQLite CAT database. It reuses the normal `TMRepo -> TMService -> TMModule` recall path, selects runtime TM and runtime concordance references with independent slots, then merges them into the existing prompt reference blocks.

**Tech Stack:** TypeScript, Vitest, `better-sqlite3` through `@cat/db`, `@cat/core` token/text helpers, `@cat/localization` job runner and request-mode strategies.

---

## Spec And Scope

Read first:

- `DOCS/archive/runtime-tm/70_RUNTIME_TM_SPEC.md`
- `DOCS/50_MT_REQUEST_MODEL.md`
- `DOCS/60_TM_TB_REFERENCE.md`
- `packages/localization/src/job/TranslationJobRunner.ts`
- `packages/localization/src/LocalizationEngine.ts`
- `packages/localization/src/modules/TMModule.ts`

Runtime TM is enabled only for `LocalizationEngine.translateFile()` jobs that use the headless file job path with `requestMode=window` or `requestMode=window-partial`. It is not enabled for inspect, legacy concurrent `translateUnits()`, or desktop legacy flows.

Status note: Runtime TM reference selection caps are implemented as 3 runtime
TM plus 3 runtime concordance references, independent of persistent reference
caps. Append/global entry caps remain optional `RuntimeTMContext` behavior for
tests or future callers; `LocalizationEngine.translateFile()` does not pass
`maxEntries`, so file jobs currently use the context default of no append cap.

## File Structure

Create:

- `packages/localization/src/runtimeTm/RuntimeTMDatabase.ts`: create an isolated in-memory CAT database, runtime project, and runtime TM.
- `packages/localization/src/runtimeTm/RuntimeTMContext.ts`: own job-scoped runtime lifecycle, seed, commit, inspect, optional append cap, and dispose.
- `packages/localization/src/runtimeTm/RuntimeTMSelection.ts`: select independent runtime/persistent TM and concordance slots, merge by rank, and build merged TM artifacts.
- `packages/localization/src/runtimeTm/RuntimeTMReferenceResolver.ts`: combine persistent reference resolution with runtime TM references.
- `packages/localization/src/runtimeTm/index.ts`: internal runtime TM exports.
- `packages/localization/src/runtimeTm/RuntimeTMContext.test.ts`
- `packages/localization/src/runtimeTm/RuntimeTMSelection.test.ts`
- `packages/localization/src/runtimeTm/RuntimeTMReferenceResolver.test.ts`

Modify:

- `packages/localization/src/modules/TMModule.ts`: allow `buildTMPromptReferences()` to accept custom caps and export the reusable policy type.
- `packages/localization/src/modules/TMModule.test.ts`: cover custom caps.
- `packages/localization/src/requestModes/shared/references.ts`: export a request reference resolver interface.
- `packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.ts`: accept an optional resolver.
- `packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.test.ts`: prove custom resolver is used.
- `packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.ts`: accept an optional resolver.
- `packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.test.ts`: prove custom resolver is used.
- `packages/localization/src/job/CheckpointStore.ts`: expose runtime seed results from translated and skipped checkpoints without changing resume reuse semantics.
- `packages/localization/src/job/TranslationJobRunner.ts`: seed Runtime TM on resume and commit task results after checkpoint/event persistence.
- `packages/localization/src/job/TranslationJobRunner.test.ts`: cover seed, commit order, and dispose-free runner behavior.
- `packages/localization/src/fileTranslationJobAdapter.ts`: pass optional runtime hooks into the runner.
- `packages/localization/src/fileTranslationJobAdapter.test.ts`: cover adapter propagation without touching CLI.
- `packages/localization/src/LocalizationEngine.ts`: create Runtime TM for file jobs, pass resolver into task executor, pass commit hooks into the runner, and dispose in `finally`.
- `packages/localization/src/LocalizationEngine.test.ts`: cover end-to-end runtime references for window and window-partial file translation.

Do not modify:

- `apps/cli` business logic.
- `apps/desktop`.
- Persistent TM schema or migration files unless a test proves `CATDatabase(':memory:')` lacks a required schema path.

---

### Task 1: Make TM Prompt Reference Caps Configurable

**Files:**
- Modify: `packages/localization/src/modules/TMModule.ts`
- Modify: `packages/localization/src/modules/TMModule.test.ts`

- [ ] **Step 1: Add the failing cap test**

Append this test to `packages/localization/src/modules/TMModule.test.ts` near existing prompt reference tests:

```ts
import { buildTMPromptReferences } from './TMModule';

it('builds TM prompt references with caller-provided caps', () => {
  const matches = [
    tmMatch({ id: 'tm-100', rank: 100, similarity: 100, source: 'A', target: 'AA' }),
    tmMatch({ id: 'tm-99', rank: 99, similarity: 99, source: 'B', target: 'BB' }),
    tmMatch({ id: 'tm-98', rank: 98, similarity: 98, source: 'C', target: 'CC' }),
    tmMatch({ id: 'tm-97', rank: 97, similarity: 97, source: 'D', target: 'DD' }),
    concordanceMatch({ id: 'cc-90', rank: 90, source: 'Alpha beta', target: 'Alpha cible' }),
    concordanceMatch({ id: 'cc-89', rank: 89, source: 'Beta gamma', target: 'Beta cible' }),
    concordanceMatch({ id: 'cc-88', rank: 88, source: 'Gamma delta', target: 'Gamma cible' }),
    concordanceMatch({ id: 'cc-87', rank: 87, source: 'Delta eta', target: 'Delta cible' }),
  ];

  const refs = buildTMPromptReferences(matches, {
    maxTmReferences: 4,
    maxConcordanceReferences: 4,
  });

  expect(refs.tmReferences.map((ref) => ref.sourceText)).toEqual(['A', 'B', 'C', 'D']);
  expect(refs.concordanceReferences.map((ref) => ref.sourceText)).toEqual([
    'Alpha beta',
    'Beta gamma',
    'Gamma delta',
    'Delta eta',
  ]);
});
```

If the helper functions do not exist in this test file, add these local helpers at the bottom:

```ts
import { parseDisplayTextToTokens } from '@cat/core/tag';
import type { TMArtifact } from '../artifacts';

type RawTMMatch = TMArtifact['rawMatches'][number];

function tmMatch(input: {
  id: string;
  rank: number;
  similarity: number;
  source: string;
  target: string;
}): RawTMMatch {
  return {
    id: input.id,
    projectId: 1,
    srcLang: 'en',
    tgtLang: 'fr',
    srcHash: input.id,
    matchKey: input.id,
    tagsSignature: '',
    sourceTokens: parseDisplayTextToTokens(input.source),
    targetTokens: parseDisplayTextToTokens(input.target),
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
    usageCount: 1,
    kind: 'tm',
    rank: input.rank,
    similarity: input.similarity,
    tmName: 'Persistent TM',
    tmType: 'main',
  };
}

function concordanceMatch(input: {
  id: string;
  rank: number;
  source: string;
  target: string;
}): RawTMMatch {
  return {
    ...tmMatch({
      id: input.id,
      rank: input.rank,
      similarity: input.rank,
      source: input.source,
      target: input.target,
    }),
    kind: 'concordance',
    matchedSourceText: input.source.split(' ')[0] ?? input.source,
    sourceCoverage: 50,
    entryCoverage: 100,
  };
}
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
npx vitest run packages/localization/src/modules/TMModule.test.ts -t "caller-provided caps"
```

Expected: FAIL because `buildTMPromptReferences` does not accept a second argument.

- [ ] **Step 3: Implement configurable caps**

Change `packages/localization/src/modules/TMModule.ts`:

```ts
export interface TMPromptReferenceLimits {
  maxTmReferences: number;
  maxConcordanceReferences: number;
}

export const DEFAULT_TM_PROMPT_REFERENCE_LIMITS: TMPromptReferenceLimits = {
  maxTmReferences: MAX_TM_PROMPT_REFERENCES,
  maxConcordanceReferences: MAX_CONCORDANCE_PROMPT_REFERENCES,
};

export function buildTMPromptReferences(
  matches: TMMatch[],
  limits: TMPromptReferenceLimits = DEFAULT_TM_PROMPT_REFERENCE_LIMITS,
): TMArtifact['selectedReferences'] {
  return {
    tmReferences: matches
      .filter((match): match is Extract<TMMatch, { kind: 'tm' }> => match.kind === 'tm')
      .slice(0, limits.maxTmReferences)
      .map(mapTMPromptReference),
    concordanceReferences: matches
      .filter(
        (match): match is Extract<TMMatch, { kind: 'concordance' }> =>
          match.kind === 'concordance',
      )
      .slice(0, limits.maxConcordanceReferences)
      .map(mapConcordancePromptReference),
  };
}
```

Keep `TMModule.inspect()` using the default limits:

```ts
selectedReferences: buildTMPromptReferences(rawMatches),
```

- [ ] **Step 4: Run the test**

Run:

```powershell
npx vitest run packages/localization/src/modules/TMModule.test.ts -t "caller-provided caps"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/localization/src/modules/TMModule.ts packages/localization/src/modules/TMModule.test.ts
git commit -m "feat: allow configurable tm prompt caps"
```

---

### Task 2: Add Runtime TM Selection

**Files:**
- Create: `packages/localization/src/runtimeTm/RuntimeTMSelection.ts`
- Create: `packages/localization/src/runtimeTm/RuntimeTMSelection.test.ts`

- [ ] **Step 1: Write the failing selection tests**

Create `packages/localization/src/runtimeTm/RuntimeTMSelection.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseDisplayTextToTokens } from '@cat/core/tag';
import type { TMArtifact } from '../artifacts';
import { mergeRuntimeTMArtifact } from './RuntimeTMSelection';

type RawTMMatch = TMArtifact['rawMatches'][number];

describe('mergeRuntimeTMArtifact', () => {
  it('keeps independent runtime and persistent TM slots then sorts by rank', () => {
    const persistent = artifact('unit-1', [
      tm('p-100', 100, 'Persistent 100', 'P100'),
      tm('p-99', 99, 'Persistent 99', 'P99'),
      tm('p-98', 98, 'Persistent 98', 'P98'),
      tm('p-97', 97, 'Persistent 97', 'P97'),
    ]);
    const runtime = artifact('unit-1', [
      tm('r-101', 101, 'Runtime 101', 'R101', 'Runtime TM'),
      tm('r-96', 96, 'Runtime 96', 'R96', 'Runtime TM'),
      tm('r-95', 95, 'Runtime 95', 'R95', 'Runtime TM'),
      tm('r-94', 94, 'Runtime 94', 'R94', 'Runtime TM'),
    ]);

    const merged = mergeRuntimeTMArtifact({ persistent, runtime });

    expect(merged.selectedReferences.tmReferences.map((ref) => ref.sourceText)).toEqual([
      'Runtime 101',
      'Persistent 100',
      'Persistent 99',
      'Persistent 98',
      'Runtime 96',
      'Runtime 95',
    ]);
    expect(merged.selectionPolicy).toEqual({
      maxTmReferences: 6,
      maxConcordanceReferences: 6,
    });
  });

  it('keeps independent runtime and persistent concordance slots', () => {
    const persistent = artifact('unit-1', [
      cc('pc-90', 90, 'Persistent concordance 90', 'PC90'),
      cc('pc-89', 89, 'Persistent concordance 89', 'PC89'),
      cc('pc-88', 88, 'Persistent concordance 88', 'PC88'),
      cc('pc-87', 87, 'Persistent concordance 87', 'PC87'),
    ]);
    const runtime = artifact('unit-1', [
      cc('rc-91', 91, 'Runtime concordance 91', 'RC91', 'Runtime TM'),
      cc('rc-86', 86, 'Runtime concordance 86', 'RC86', 'Runtime TM'),
      cc('rc-85', 85, 'Runtime concordance 85', 'RC85', 'Runtime TM'),
      cc('rc-84', 84, 'Runtime concordance 84', 'RC84', 'Runtime TM'),
    ]);

    const merged = mergeRuntimeTMArtifact({ persistent, runtime });

    expect(merged.selectedReferences.concordanceReferences.map((ref) => ref.sourceText)).toEqual([
      'Runtime concordance 91',
      'Persistent concordance 90',
      'Persistent concordance 89',
      'Persistent concordance 88',
      'Runtime concordance 86',
      'Runtime concordance 85',
    ]);
  });
});

function artifact(unitId: string, rawMatches: RawTMMatch[]): TMArtifact {
  return {
    unitId,
    segmentId: `segment-${unitId}`,
    mountedTMs: [],
    rawMatches,
    selectedReferences: { tmReferences: [], concordanceReferences: [] },
    selectionPolicy: { maxTmReferences: 3, maxConcordanceReferences: 3 },
    diagnostics: [],
  };
}

function tm(
  id: string,
  rank: number,
  source: string,
  target: string,
  tmName = 'Persistent TM',
): RawTMMatch {
  return {
    id,
    projectId: 1,
    srcLang: 'en',
    tgtLang: 'fr',
    srcHash: id,
    matchKey: id,
    tagsSignature: '',
    sourceTokens: parseDisplayTextToTokens(source),
    targetTokens: parseDisplayTextToTokens(target),
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
    usageCount: 1,
    kind: 'tm',
    rank,
    similarity: rank,
    tmName,
    tmType: 'main',
  };
}

function cc(
  id: string,
  rank: number,
  source: string,
  target: string,
  tmName = 'Persistent TM',
): RawTMMatch {
  return {
    ...tm(id, rank, source, target, tmName),
    kind: 'concordance',
    matchedSourceText: source.split(' ')[0] ?? source,
    sourceCoverage: 50,
    entryCoverage: 100,
  };
}
```

- [ ] **Step 2: Run the failing tests**

Run:

```powershell
npx vitest run packages/localization/src/runtimeTm/RuntimeTMSelection.test.ts
```

Expected: FAIL because `RuntimeTMSelection.ts` does not exist.

- [ ] **Step 3: Implement selection**

Create `packages/localization/src/runtimeTm/RuntimeTMSelection.ts`:

```ts
import type { TMArtifact } from '../artifacts';
import { buildTMPromptReferences } from '../modules/TMModule';

type RawTMMatch = TMArtifact['rawMatches'][number];

const RUNTIME_TM_LIMIT = 3;
const RUNTIME_CONCORDANCE_LIMIT = 3;
const PERSISTENT_TM_LIMIT = 3;
const PERSISTENT_CONCORDANCE_LIMIT = 3;

export function mergeRuntimeTMArtifact(input: {
  persistent: TMArtifact;
  runtime: TMArtifact;
}): TMArtifact {
  const persistentTm = selectKind(input.persistent.rawMatches, 'tm', PERSISTENT_TM_LIMIT);
  const runtimeTm = selectKind(input.runtime.rawMatches, 'tm', RUNTIME_TM_LIMIT);
  const persistentConcordance = selectKind(
    input.persistent.rawMatches,
    'concordance',
    PERSISTENT_CONCORDANCE_LIMIT,
  );
  const runtimeConcordance = selectKind(
    input.runtime.rawMatches,
    'concordance',
    RUNTIME_CONCORDANCE_LIMIT,
  );
  const selectedMatches = [
    ...persistentTm,
    ...runtimeTm,
    ...persistentConcordance,
    ...runtimeConcordance,
  ].sort(compareRawMatches);

  return {
    ...input.persistent,
    mountedTMs: [...input.persistent.mountedTMs, ...input.runtime.mountedTMs],
    rawMatches: selectedMatches,
    selectedReferences: buildTMPromptReferences(selectedMatches, {
      maxTmReferences: PERSISTENT_TM_LIMIT + RUNTIME_TM_LIMIT,
      maxConcordanceReferences: PERSISTENT_CONCORDANCE_LIMIT + RUNTIME_CONCORDANCE_LIMIT,
    }),
    selectionPolicy: {
      maxTmReferences: PERSISTENT_TM_LIMIT + RUNTIME_TM_LIMIT,
      maxConcordanceReferences: PERSISTENT_CONCORDANCE_LIMIT + RUNTIME_CONCORDANCE_LIMIT,
    },
    diagnostics: [
      ...input.persistent.diagnostics,
      ...input.runtime.diagnostics,
      `Runtime TM selected ${runtimeTm.length} TM and ${runtimeConcordance.length} concordance references.`,
    ],
  };
}

function selectKind<K extends RawTMMatch['kind']>(
  matches: RawTMMatch[],
  kind: K,
  limit: number,
): Array<Extract<RawTMMatch, { kind: K }>> {
  return matches
    .filter((match): match is Extract<RawTMMatch, { kind: K }> => match.kind === kind)
    .sort(compareRawMatches)
    .slice(0, limit);
}

function compareRawMatches(left: RawTMMatch, right: RawTMMatch): number {
  if (right.rank !== left.rank) return right.rank - left.rank;
  if (right.usageCount !== left.usageCount) return right.usageCount - left.usageCount;
  return left.id.localeCompare(right.id);
}
```

- [ ] **Step 4: Run the tests**

Run:

```powershell
npx vitest run packages/localization/src/runtimeTm/RuntimeTMSelection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/localization/src/runtimeTm/RuntimeTMSelection.ts packages/localization/src/runtimeTm/RuntimeTMSelection.test.ts
git commit -m "feat: add runtime tm selection"
```

---

### Task 3: Add Runtime TM Database And Context

**Files:**
- Create: `packages/localization/src/runtimeTm/RuntimeTMDatabase.ts`
- Create: `packages/localization/src/runtimeTm/RuntimeTMContext.ts`
- Create: `packages/localization/src/runtimeTm/RuntimeTMContext.test.ts`
- Create: `packages/localization/src/runtimeTm/index.ts`

- [ ] **Step 1: Write failing context tests**

Create `packages/localization/src/runtimeTm/RuntimeTMContext.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTransientSegment } from '../transientSegment';
import type { UnitResult } from '../job/types';
import { RuntimeTMContext } from './RuntimeTMContext';

describe('RuntimeTMContext', () => {
  it('commits translated and skipped non-empty results into an isolated runtime TM', async () => {
    const runtime = RuntimeTMContext.create({ srcLang: 'en', tgtLang: 'fr' });
    try {
      const summary = runtime.commitResults([
        result({ unitId: 'u1', source: 'Save file', target: 'Enregistrer le fichier' }),
        result({ unitId: 'u2', status: 'skipped', source: 'Open file', target: 'Ouvrir le fichier' }),
        result({ unitId: 'u3', status: 'failed', source: 'Close file', target: '' }),
        result({ unitId: 'u4', source: 'Empty target', target: '' }),
      ]);

      expect(summary).toEqual({ appended: 2, skipped: 2, disabled: false });
      expect(runtime.hasEntries()).toBe(true);

      const artifact = await runtime.inspect(
        createTransientSegment({ id: 'query', source: 'Save file' }, 0),
      );
      expect(artifact.rawMatches[0]).toMatchObject({
        kind: 'tm',
        tmName: 'Runtime TM',
        similarity: 100,
      });
    } finally {
      runtime.dispose();
    }
  });

  it('stops appending after the configured cap without failing translation', () => {
    const runtime = RuntimeTMContext.create({ srcLang: 'en', tgtLang: 'fr', maxEntries: 1 });
    try {
      const first = runtime.commitResults([
        result({ unitId: 'u1', source: 'One', target: 'Un' }),
      ]);
      const second = runtime.commitResults([
        result({ unitId: 'u2', source: 'Two', target: 'Deux' }),
      ]);

      expect(first).toEqual({ appended: 1, skipped: 0, disabled: false });
      expect(second).toEqual({ appended: 0, skipped: 1, disabled: true });
    } finally {
      runtime.dispose();
    }
  });
});

function result(overrides: Partial<UnitResult>): UnitResult {
  return {
    jobId: 'job-1',
    documentId: 'sheet.xlsx',
    unitId: 'u1',
    sourceHash: overrides.sourceHash ?? `hash-${overrides.unitId ?? 'u1'}`,
    status: 'translated',
    source: 'Save file',
    target: 'Enregistrer le fichier',
    ...overrides,
  };
}
```

- [ ] **Step 2: Run the failing tests**

Run:

```powershell
npx vitest run packages/localization/src/runtimeTm/RuntimeTMContext.test.ts
```

Expected: FAIL because `RuntimeTMContext.ts` does not exist.

- [ ] **Step 3: Implement the runtime database helper**

Create `packages/localization/src/runtimeTm/RuntimeTMDatabase.ts`:

```ts
import { CATDatabase } from '@cat/db';

export interface RuntimeTMDatabase {
  db: CATDatabase;
  projectId: number;
  tmId: string;
}

export function createRuntimeTMDatabase(input: {
  srcLang: string;
  tgtLang: string;
}): RuntimeTMDatabase {
  const db = new CATDatabase(':memory:');
  const projectId = db.createProject('Runtime TM Project', input.srcLang, input.tgtLang, 'custom');
  const tmId = db.createTM('Runtime TM', input.srcLang, input.tgtLang, 'working');
  db.mountTMToProject(projectId, tmId, 0, 'readwrite');

  return { db, projectId, tmId };
}
```

- [ ] **Step 4: Implement the runtime context**

Create `packages/localization/src/runtimeTm/RuntimeTMContext.ts`:

```ts
import type { Segment } from '@cat/core/models';
import { SqliteProjectRepository } from '../adapters/sqlite/SqliteProjectRepository';
import { SqliteTMRepository } from '../adapters/sqlite/SqliteTMRepository';
import type { TMArtifact } from '../artifacts';
import type { UnitResult } from '../job/types';
import { TMModule } from '../modules/TMModule';
import { TMService } from '../services/TMService';
import { createTransientSegment } from '../transientSegment';
import { createRuntimeTMDatabase } from './RuntimeTMDatabase';
import type { RuntimeTMDatabase } from './RuntimeTMDatabase';

export interface RuntimeTMCommitSummary {
  appended: number;
  skipped: number;
  disabled: boolean;
}

export interface RuntimeTMContextOptions {
  srcLang: string;
  tgtLang: string;
  maxEntries?: number;
}

export class RuntimeTMContext {
  private readonly runtime: RuntimeTMDatabase;
  private readonly tmRepo: SqliteTMRepository;
  private readonly tmService: TMService;
  private readonly tmModule: TMModule;
  private readonly maxEntries: number;
  private disposed = false;
  private appendDisabled = false;
  private orderIndex = 0;

  private constructor(options: RuntimeTMContextOptions, runtime: RuntimeTMDatabase) {
    const projectRepo = new SqliteProjectRepository(runtime.db);
    this.runtime = runtime;
    this.tmRepo = new SqliteTMRepository(runtime.db);
    this.tmService = new TMService(projectRepo, this.tmRepo);
    this.tmModule = new TMModule({ tmRepo: this.tmRepo, tmService: this.tmService });
    this.maxEntries = options.maxEntries ?? Number.POSITIVE_INFINITY;
  }

  static create(options: RuntimeTMContextOptions): RuntimeTMContext {
    return new RuntimeTMContext(options, createRuntimeTMDatabase(options));
  }

  hasEntries(): boolean {
    return this.tmRepo.getTMStats(this.runtime.tmId).entryCount > 0;
  }

  commitResults(results: readonly UnitResult[]): RuntimeTMCommitSummary {
    this.assertOpen();
    let appended = 0;
    let skipped = 0;

    for (const result of results) {
      if (!isEligibleRuntimeResult(result)) {
        skipped += 1;
        continue;
      }
      if (this.appendDisabled || this.tmRepo.getTMStats(this.runtime.tmId).entryCount >= this.maxEntries) {
        this.appendDisabled = true;
        skipped += 1;
        continue;
      }

      const segment = createTransientSegment(
        {
          id: `${result.documentId}#${result.unitId}`,
          source: result.source,
          target: result.target,
        },
        this.orderIndex,
        {
          projectId: this.runtime.projectId,
          sourceLanguage: result.metadata?.sourceLanguage as string | undefined,
          targetLanguage: result.metadata?.targetLanguage as string | undefined,
        },
      );
      this.orderIndex += 1;
      this.tmService.upsertFromConfirmedSegment(this.runtime.projectId, segment);
      appended += 1;
    }

    return { appended, skipped, disabled: this.appendDisabled };
  }

  seedResults(results: readonly UnitResult[]): RuntimeTMCommitSummary {
    return this.commitResults(results);
  }

  async inspect(segment: Segment): Promise<TMArtifact> {
    this.assertOpen();
    return this.tmModule.inspect(this.runtime.projectId, segment);
  }

  dispose(): void {
    if (this.disposed) return;
    this.runtime.db.close();
    this.disposed = true;
  }

  private assertOpen(): void {
    if (this.disposed) {
      throw new Error('Runtime TM context has been disposed.');
    }
  }
}

function isEligibleRuntimeResult(result: UnitResult): result is UnitResult & { target: string } {
  return (
    (result.status === 'translated' || result.status === 'skipped') &&
    result.source.trim().length > 0 &&
    typeof result.target === 'string' &&
    result.target.trim().length > 0
  );
}
```

- [ ] **Step 5: Add the runtime module barrel**

Create `packages/localization/src/runtimeTm/index.ts`:

```ts
export { RuntimeTMContext } from './RuntimeTMContext';
export type { RuntimeTMCommitSummary, RuntimeTMContextOptions } from './RuntimeTMContext';
```

- [ ] **Step 6: Run the tests**

Run:

```powershell
npx vitest run packages/localization/src/runtimeTm/RuntimeTMContext.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add packages/localization/src/runtimeTm
git commit -m "feat: add runtime tm context"
```

---

### Task 4: Add Runtime TM Reference Resolver

**Files:**
- Create: `packages/localization/src/runtimeTm/RuntimeTMReferenceResolver.ts`
- Create: `packages/localization/src/runtimeTm/RuntimeTMReferenceResolver.test.ts`
- Modify: `packages/localization/src/runtimeTm/index.ts`
- Modify: `packages/localization/src/requestModes/shared/references.ts`

- [ ] **Step 1: Export a resolver type from shared references**

Modify `packages/localization/src/requestModes/shared/references.ts` so the existing function has a named input type and callable type:

```ts
export interface ResolveRequestModeReferencesInput {
  projectId: number;
  segment: Segment;
  tmModule: RequestModeReferenceModules['tmModule'];
  tbModule: RequestModeReferenceModules['tbModule'];
}

export type RequestModeReferenceResolver = (
  params: ResolveRequestModeReferencesInput,
) => Promise<ResolvedReferences>;

export const resolveRequestModeReferences: RequestModeReferenceResolver = async (params) => {
  const [tmMatches, tbMatches] = await Promise.all([
    params.tmModule.inspect(params.projectId, params.segment),
    params.tbModule.inspect(params.projectId, params.segment),
  ]);

  return {
    engineReferences: {
      tm: mapTMEngineReferences(tmMatches.rawMatches),
      tb: mapTBEngineReferences(tbMatches.rawMatches),
    },
    tm: tmMatches,
    tb: tbMatches,
  };
};
```

- [ ] **Step 2: Write the failing resolver test**

Create `packages/localization/src/runtimeTm/RuntimeTMReferenceResolver.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createTransientSegment } from '../transientSegment';
import type { ResolvedReferences } from '../requestModes/types';
import { RuntimeTMContext } from './RuntimeTMContext';
import { RuntimeTMReferenceResolver } from './RuntimeTMReferenceResolver';

describe('RuntimeTMReferenceResolver', () => {
  it('returns persistent references unchanged when runtime TM is empty', async () => {
    const runtime = RuntimeTMContext.create({ srcLang: 'en', tgtLang: 'fr' });
    try {
      const persistent = references('Persistent TM', 'Persistent source', 'Persistent target');
      const persistentResolver = vi.fn(async () => persistent);
      const resolver = new RuntimeTMReferenceResolver(runtime, persistentResolver);

      const result = await resolver.resolve(resolveInput());

      expect(result).toBe(persistent);
      expect(persistentResolver).toHaveBeenCalledTimes(1);
    } finally {
      runtime.dispose();
    }
  });

  it('merges runtime and persistent TM references when runtime has entries', async () => {
    const runtime = RuntimeTMContext.create({ srcLang: 'en', tgtLang: 'fr' });
    try {
      runtime.commitResults([
        {
          jobId: 'job-1',
          documentId: 'sheet.xlsx',
          unitId: 'row-2',
          sourceHash: 'hash-row-2',
          status: 'translated',
          source: 'Install package',
          target: 'Installer le paquet',
        },
      ]);
      const persistentResolver = vi.fn(async () =>
        references('Persistent TM', 'Install software', 'Installer le logiciel'),
      );
      const resolver = new RuntimeTMReferenceResolver(runtime, persistentResolver);

      const result = await resolver.resolve(
        resolveInput({ segment: createTransientSegment({ id: 'query', source: 'Install package' }, 0) }),
      );

      expect(result.tm.selectedReferences.tmReferences.map((ref) => ref.tmName)).toContain('Runtime TM');
      expect(result.tm.selectedReferences.tmReferences.map((ref) => ref.tmName)).toContain('Persistent TM');
      expect(result.engineReferences.tm.map((ref) => ref.tmName)).toContain('Runtime TM');
      expect(result.tb).toBeDefined();
    } finally {
      runtime.dispose();
    }
  });
});

function resolveInput(overrides: Partial<Parameters<RuntimeTMReferenceResolver['resolve']>[0]> = {}) {
  return {
    projectId: 1,
    segment: createTransientSegment({ id: 'query', source: 'Install package' }, 0),
    tmModule: { inspect: vi.fn() },
    tbModule: { inspect: vi.fn() },
    ...overrides,
  };
}

function references(tmName: string, sourceText: string, targetText: string): ResolvedReferences {
  return {
    engineReferences: {
      tm: [{ kind: 'tm', rank: 100, tmName, sourceText, targetText, similarity: 100 }],
      tb: [],
    },
    tm: {
      unitId: 'query',
      segmentId: 'segment-query',
      mountedTMs: [],
      rawMatches: [],
      selectedReferences: {
        tmReferences: [{ tmName, similarity: 100, sourceText, targetText }],
        concordanceReferences: [],
      },
      selectionPolicy: { maxTmReferences: 3, maxConcordanceReferences: 3 },
      diagnostics: [],
    },
    tb: {
      unitId: 'query',
      segmentId: 'segment-query',
      mountedTBs: [],
      rawMatches: [],
      selectedReferences: [],
      selectionPolicy: { maxTbReferences: 0 },
      diagnostics: [],
    },
  };
}
```

- [ ] **Step 3: Run the failing resolver test**

Run:

```powershell
npx vitest run packages/localization/src/runtimeTm/RuntimeTMReferenceResolver.test.ts
```

Expected: FAIL because `RuntimeTMReferenceResolver.ts` does not exist.

- [ ] **Step 4: Implement the resolver**

Create `packages/localization/src/runtimeTm/RuntimeTMReferenceResolver.ts`:

```ts
import { mapTMEngineReferences } from '../modules/TMModule';
import type {
  RequestModeReferenceResolver,
  ResolveRequestModeReferencesInput,
} from '../requestModes/shared/references';
import { resolveRequestModeReferences } from '../requestModes/shared/references';
import type { ResolvedReferences } from '../requestModes/types';
import type { RuntimeTMContext } from './RuntimeTMContext';
import { mergeRuntimeTMArtifact } from './RuntimeTMSelection';

export class RuntimeTMReferenceResolver {
  constructor(
    private readonly runtimeTm: RuntimeTMContext,
    private readonly persistentResolver: RequestModeReferenceResolver = resolveRequestModeReferences,
  ) {}

  resolve: RequestModeReferenceResolver = async (
    params: ResolveRequestModeReferencesInput,
  ): Promise<ResolvedReferences> => {
    const persistent = await this.persistentResolver(params);
    if (!this.runtimeTm.hasEntries()) {
      return persistent;
    }

    const runtimeTmArtifact = await this.runtimeTm.inspect(params.segment);
    const mergedTm = mergeRuntimeTMArtifact({
      persistent: persistent.tm,
      runtime: runtimeTmArtifact,
    });

    return {
      ...persistent,
      tm: mergedTm,
      engineReferences: {
        ...persistent.engineReferences,
        tm: mapTMEngineReferences(mergedTm.rawMatches),
      },
    };
  };
}
```

Update `packages/localization/src/runtimeTm/index.ts`:

```ts
export { RuntimeTMReferenceResolver } from './RuntimeTMReferenceResolver';
export { mergeRuntimeTMArtifact } from './RuntimeTMSelection';
```

- [ ] **Step 5: Run resolver tests**

Run:

```powershell
npx vitest run packages/localization/src/runtimeTm/RuntimeTMReferenceResolver.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/localization/src/requestModes/shared/references.ts packages/localization/src/runtimeTm
git commit -m "feat: resolve runtime tm references"
```

---

### Task 5: Wire Reference Resolver Into Window Strategies

**Files:**
- Modify: `packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.ts`
- Modify: `packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.test.ts`
- Modify: `packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.ts`
- Modify: `packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.test.ts`

- [ ] **Step 1: Add failing Window Mode resolver test**

Append this test to `WindowModeSequentialBatchStrategy.test.ts`:

```ts
it('uses an injected reference resolver for request rows', async () => {
  const unit = jobUnit('row-1', 'Install package', 'hash-1');
  const segment = createTransientSegment({ id: 'row-1', source: 'Install package' }, 0);
  const referenceResolver = vi.fn(async () => referencesWithTmName('Runtime TM'));
  const translateBatch = vi.fn().mockResolvedValue({
    results: [{
      documentId: unit.documentId,
      unitId: unit.unitId,
      responseId: 'window.xlsx#row-1',
      targetTokens: parseEditorTextToTokens('Installer le paquet', segment.sourceTokens),
    }],
    prompt: promptArtifact(['window.xlsx#row-1']),
  });
  const strategy = new WindowModeSequentialBatchStrategy({
    tmModule: { inspect: vi.fn() },
    tbModule: { inspect: vi.fn() },
    mtModule: { translateBatch },
  });

  await strategy.translate({
    task: { taskId: 'window-task-1', units: [unit], requestMode: 'window' },
    context: executionContext({ job: { units: [unit] } }),
    project: project(),
    mtConfig: resolvedMTConfig(),
    mtOptions: mtOptions(),
    includeReferences: true,
    captureArtifacts: true,
    translatableUnits: [{ jobUnit: unit, segment }],
    skippedResults: [],
    referenceResolver,
  });

  expect(referenceResolver).toHaveBeenCalledTimes(1);
  expect(translateBatch).toHaveBeenCalledWith(
    expect.objectContaining({
      current: [expect.objectContaining({
        tm: expect.objectContaining({
          selectedReferences: expect.objectContaining({
            tmReferences: [expect.objectContaining({ tmName: 'Runtime TM' })],
          }),
        }),
      })],
    }),
  );
});
```

Add a local helper if the test file does not already have one:

```ts
function referencesWithTmName(tmName: string) {
  return {
    engineReferences: {
      tm: [{ kind: 'tm', rank: 100, tmName, sourceText: 'Install package', targetText: 'Installer le paquet', similarity: 100 }],
      tb: [],
    },
    tm: tmArtifact(tmName),
    tb: emptyTb('segment-row-1', 'row-1'),
  };
}
```

- [ ] **Step 2: Add failing Window Partial resolver test**

Append this test to `WindowPartialSequentialBatchStrategy.test.ts`:

```ts
it('uses an injected reference resolver only for requested rows', async () => {
  const units = [
    jobUnit('row-1', 'One', 'hash-1'),
    jobUnit('row-2', 'Two', 'hash-2', { target: 'Deux' }),
  ];
  const segment = createTransientSegment({ id: 'row-1', source: 'One' }, 0);
  const referenceResolver = vi.fn(async () => referencesWithTmName('Runtime TM'));
  const translateBatch = vi.fn().mockResolvedValue({
    results: [{
      documentId: units[0].documentId,
      unitId: units[0].unitId,
      responseId: 'sheet.xlsx#row-1',
      targetTokens: parseEditorTextToTokens('Un', segment.sourceTokens),
    }],
    prompt: promptArtifact(['sheet.xlsx#row-1']),
  });
  const strategy = new WindowPartialSequentialBatchStrategy({
    tmModule: { inspect: vi.fn() },
    tbModule: { inspect: vi.fn() },
    mtModule: { translateBatch },
  });

  await strategy.translate({
    task: {
      taskId: 'partial-task-1',
      requestMode: 'window-partial',
      units,
      scanWindowUnits: units,
      requestUnitKeys: [key(units[0])],
    },
    context: executionContext({ job: { units } }),
    project: project(),
    mtConfig: resolvedMTConfig(),
    mtOptions: mtOptions(),
    includeReferences: true,
    captureArtifacts: true,
    translatableUnits: [{ jobUnit: units[0], segment }],
    skippedResults: [unitResult(units[1], 'Deux', 'skipped')],
    referenceResolver,
  });

  expect(referenceResolver).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 3: Run the failing strategy tests**

Run:

```powershell
npx vitest run packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.test.ts packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.test.ts -t "injected reference resolver"
```

Expected: FAIL because strategy inputs do not accept `referenceResolver`.

- [ ] **Step 4: Implement resolver injection**

In both strategy input interfaces add:

```ts
import type { RequestModeReferenceResolver } from '../shared/references';

export interface WindowModeSequentialBatchStrategyInput {
  // existing fields
  referenceResolver?: RequestModeReferenceResolver;
}
```

In both strategy `translate()` methods replace direct calls to `resolveRequestModeReferences` with:

```ts
const resolveReferences = input.referenceResolver ?? resolveRequestModeReferences;

const references =
  projectType === 'translation'
    ? await resolveReferences({
        projectId: input.project.id,
        segment,
        tmModule: this.dependencies.tmModule,
        tbModule: this.dependencies.tbModule,
      })
    : emptyReferencesForUnit(jobUnit, segment);
```

- [ ] **Step 5: Run strategy tests**

Run:

```powershell
npx vitest run packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.test.ts packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/localization/src/requestModes/windowSequentialBatch packages/localization/src/requestModes/windowPartialSequentialBatch
git commit -m "feat: inject request reference resolver"
```

---

### Task 6: Add Runtime Hooks To Translation Job Runner

**Files:**
- Modify: `packages/localization/src/job/CheckpointStore.ts`
- Modify: `packages/localization/src/job/TranslationJobRunner.ts`
- Modify: `packages/localization/src/job/TranslationJobRunner.test.ts`

- [ ] **Step 1: Write failing checkpoint seed test**

Append to `TranslationJobRunner.test.ts`:

```ts
it('seeds runtime TM from translated and skipped checkpoints on resume', async () => {
  const harness = await makeHarness();
  await harness.checkpointStore.append(makeCheckpoint({
    unit: 'unit-1',
    hash: 'hash-1',
    status: 'translated',
    target: 'Translated target',
  }));
  await harness.checkpointStore.append(makeCheckpoint({
    unit: 'unit-2',
    hash: 'hash-2',
    status: 'skipped',
    target: 'Existing target',
  }));
  const seed = vi.fn();
  const commit = vi.fn();
  const runner = harness.makeRunner(
    async (task) => ({
      results: [
        makeResult({
          unitId: task.units[0].unitId,
          sourceHash: task.units[0].sourceHash,
          source: task.units[0].source,
          target: 'New target',
        }),
      ],
    }),
    {
      runtimeTm: { seed, commit },
      taskPlanner: {
        supportsJobAwarePlanning: true,
        planJob: ({ job }) => [{ taskId: 'remaining', units: [job.units[2]] }],
      },
    },
  );

  await runner.run(makeJob({
    units: [
      makeUnit({ unitId: 'unit-1', source: 'One', sourceHash: 'hash-1' }),
      makeUnit({ unitId: 'unit-2', source: 'Two', sourceHash: 'hash-2' }),
      makeUnit({ unitId: 'unit-3', source: 'Three', sourceHash: 'hash-3' }),
    ],
    options: { resume: true, maxConcurrency: 1 },
  }));

  expect(seed).toHaveBeenCalledWith([
    expect.objectContaining({ unitId: 'unit-1', status: 'translated', target: 'Translated target' }),
    expect.objectContaining({ unitId: 'unit-2', status: 'skipped', target: 'Existing target' }),
  ]);
});
```

Update the `makeHarness()` option type to accept runtime hooks:

```ts
options?: Pick<
  ConstructorParameters<typeof TranslationJobRunner>[0],
  'writeSnapshot' | 'writeFinal' | 'taskPlanner' | 'runtimeTm'
> & { persistArtifacts?: boolean },
```

and pass it through:

```ts
runtimeTm: options.runtimeTm,
```

- [ ] **Step 2: Write failing commit-order test**

Append:

```ts
it('commits normalized task results to runtime TM after persistence', async () => {
  const harness = await makeHarness();
  const calls: string[] = [];
  const runner = harness.makeRunner(
    async (task) => ({
      results: [
        makeResult({
          unitId: task.units[0].unitId,
          sourceHash: task.units[0].sourceHash,
          source: task.units[0].source,
          target: `target ${task.units[0].unitId}`,
        }),
      ],
    }),
    {
      runtimeTm: {
        seed: vi.fn(),
        commit: vi.fn(async (results) => {
          calls.push(`commit:${results.map((result) => result.unitId).join(',')}`);
          const checkpointRecords = await readJsonlRecords<CheckpointRecord>(harness.checkpointPath);
          calls.push(`checkpoint-count:${checkpointRecords.records.length}`);
        }),
      },
    },
  );

  await runner.run(makeJob({ options: { maxConcurrency: 1 } }));

  expect(calls).toEqual(['commit:unit-1', 'checkpoint-count:1']);
});
```

- [ ] **Step 3: Run the failing runner tests**

Run:

```powershell
npx vitest run packages/localization/src/job/TranslationJobRunner.test.ts -t "runtime TM"
```

Expected: FAIL because runner dependencies do not expose runtime hooks.

- [ ] **Step 4: Implement checkpoint runtime seed results**

In `packages/localization/src/job/CheckpointStore.ts`, add:

```ts
  toRuntimeSeedResults(units: readonly JobUnit[]): UnitResult[] {
    return units.flatMap((unit) => {
      const record = this.getRecord(unit);
      if (!record || record.hash !== unit.sourceHash) return [];
      if (record.status !== 'translated' && record.status !== 'skipped') return [];
      if (!unit.source.trim() || !record.target?.trim()) return [];

      return [{
        jobId: record.job,
        documentId: record.doc,
        unitId: record.unit,
        sourceHash: record.hash,
        status: record.status,
        source: unit.source,
        target: record.target,
        attempts: record.attempts,
        metadata: unit.metadata,
      }];
    });
  }
```

Keep `getReusableRecord()` unchanged so skipped checkpoints remain pending for normal resume semantics.

- [ ] **Step 5: Implement runner hooks**

In `packages/localization/src/job/TranslationJobRunner.ts`, add dependency types:

```ts
export interface TranslationJobRuntimeTMHooks {
  seed(results: UnitResult[]): Promise<void> | void;
  commit(
    results: UnitResult[],
    task: TranslationTask,
    job: TranslationJob,
  ): Promise<void> | void;
}
```

Add to `TranslationJobRunnerDependencies`:

```ts
runtimeTm?: TranslationJobRuntimeTMHooks;
```

Store it:

```ts
private readonly runtimeTm?: TranslationJobRuntimeTMHooks;
```

Set it in the constructor:

```ts
this.runtimeTm = dependencies.runtimeTm;
```

After resume checkpoint loading has happened and before planning, seed runtime TM:

```ts
if (job.options?.resume === true) {
  for (const unit of job.units) {
    const reusedResult = checkpointIndex.toReusedResult(unit);
    if (!reusedResult) continue;
    resultMap.set(sharedUnitKey(unit), reusedResult);
    await this.emitUnitEvent(job, unit, 'unit_done', reusedResult.status, resultMap.size);
  }

  await this.runtimeTm?.seed(checkpointIndex.toRuntimeSeedResults(job.units));
}
```

At the end of `persistTaskResult()`, after the loop that appends checkpoints/events and updates `resultMap`, add:

```ts
await this.runtimeTm?.commit(taskResult.results, task, job);
```

- [ ] **Step 6: Run runner tests**

Run:

```powershell
npx vitest run packages/localization/src/job/TranslationJobRunner.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add packages/localization/src/job/CheckpointStore.ts packages/localization/src/job/TranslationJobRunner.ts packages/localization/src/job/TranslationJobRunner.test.ts
git commit -m "feat: add runtime tm job hooks"
```

---

### Task 7: Wire Runtime TM Through LocalizationEngine File Jobs

**Files:**
- Modify: `packages/localization/src/fileTranslationJobAdapter.ts`
- Modify: `packages/localization/src/fileTranslationJobAdapter.test.ts`
- Modify: `packages/localization/src/LocalizationEngine.ts`

- [ ] **Step 1: Write failing adapter propagation test**

Append to `packages/localization/src/fileTranslationJobAdapter.test.ts`:

```ts
it('passes runtime TM hooks into the file job runner when provided', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cat-file-runtime-tm-'));
  try {
    const inputPath = join(root, 'mt.xlsx');
    const outputPath = join(root, 'mt.translated.xlsx');
    writeWorkbook(inputPath, [
      ['source', 'target'],
      ['Hello', ''],
    ]);
    const runtimeTm = { seed: vi.fn(), commit: vi.fn() };
    let seenRuntimeTm: unknown;

    await translateSpreadsheetFileJob(
      { projectId: 7, inputPath, outputPath },
      {
        taskExecutor: async () => ({ results: [] }),
        runtimeTm,
        runnerFactory: (dependencies) => ({
          run: async (job) => {
            seenRuntimeTm = dependencies.runtimeTm;
            return {
              jobId: job.id,
              summary: { total: 1, translated: 0, skipped: 0, reused: 0, failed: 0 },
              results: [],
            };
          },
        }),
      },
    );

    expect(seenRuntimeTm).toBe(runtimeTm);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the failing adapter test**

Run:

```powershell
npx vitest run packages/localization/src/fileTranslationJobAdapter.test.ts -t "runtime TM hooks"
```

Expected: FAIL because `TranslateSpreadsheetFileJobOptions` does not accept `runtimeTm`.

- [ ] **Step 3: Add adapter option**

In `packages/localization/src/fileTranslationJobAdapter.ts`, extend `TranslateSpreadsheetFileJobOptions`:

```ts
  runtimeTm?: TranslationJobRunnerDependencies['runtimeTm'];
```

Pass it into runner dependencies:

```ts
    runtimeTm: options.runtimeTm,
```

- [ ] **Step 4: Modify `LocalizationEngine.createTaskExecutor()`**

In `packages/localization/src/LocalizationEngine.ts`, import the resolver type:

```ts
import type { RequestModeReferenceResolver } from './requestModes/shared/references';
```

Change `createTaskExecutor()`:

```ts
  public createTaskExecutor(options: {
    referenceResolver?: RequestModeReferenceResolver;
  } = {}): TranslationTaskExecutor {
    return (task, context) => this.executeTranslationTask(task, context, options);
  }
```

Change `executeTranslationTask()` signature:

```ts
  public async executeTranslationTask(
    task: TranslationTask,
    context: TaskExecutionContext,
    options: { referenceResolver?: RequestModeReferenceResolver } = {},
  ): Promise<TaskExecutionResult> {
```

Pass the resolver to both strategies:

```ts
      referenceResolver: options.referenceResolver,
```

- [ ] **Step 5: Wire runtime creation in `translateFile()`**

In `LocalizationEngine.translateFile()` for `input.job`, after resolving `project`, create Runtime TM only for translation file jobs:

```ts
      const runtimeTm =
        (project.projectType ?? 'translation') === 'translation'
          ? RuntimeTMContext.create({ srcLang: project.srcLang, tgtLang: project.tgtLang })
          : undefined;
      const referenceResolver = runtimeTm
        ? new RuntimeTMReferenceResolver(runtimeTm).resolve
        : undefined;

      try {
        return await translateSpreadsheetFileJob(
          {
            ...input,
            job: {
              ...input.job,
              resumeFingerprint,
            },
          },
          {
            taskExecutor: this.createTaskExecutor({ referenceResolver }),
            defaultMaxConcurrency: this.options.maxConcurrency,
            runtimeTm: runtimeTm
              ? {
                  seed: (results) => {
                    runtimeTm.seedResults(results);
                  },
                  commit: (results) => {
                    runtimeTm.commitResults(results);
                  },
                }
              : undefined,
          },
        );
      } finally {
        runtimeTm?.dispose();
      }
```

Add imports:

```ts
import { RuntimeTMContext, RuntimeTMReferenceResolver } from './runtimeTm';
```

- [ ] **Step 6: Run adapter tests**

Run:

```powershell
npx vitest run packages/localization/src/fileTranslationJobAdapter.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run typecheck for localization**

Run:

```powershell
npx tsc --noEmit -p packages/localization/tsconfig.json
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add packages/localization/src/fileTranslationJobAdapter.ts packages/localization/src/fileTranslationJobAdapter.test.ts packages/localization/src/LocalizationEngine.ts
git commit -m "feat: wire runtime tm into file jobs"
```

---

### Task 8: Add End-To-End Runtime TM File Translation Tests

**Files:**
- Modify: `packages/localization/src/LocalizationEngine.test.ts`

- [ ] **Step 1: Add Window Mode runtime prompt test**

Append to `LocalizationEngine.test.ts` near existing file job Window Mode tests:

```ts
it('uses Runtime TM entries from earlier Window Mode batches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cat-runtime-tm-window-'));
  const db = new CATDatabase(':memory:');
  try {
    const projectId = db.createProject('Runtime Window', 'en', 'fr');
    seedConfiguredAIProvider(db, projectId);
    const mountedTmId = db.getProjectMountedTMs(projectId)[0]?.id;
    const inputPath = join(root, 'runtime.xlsx');
    const outputPath = join(root, 'runtime.translated.xlsx');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['source', 'target'],
        ['Install package', ''],
        ['Open menu', ''],
        ['Close menu', ''],
        ['Save settings', ''],
        ['Install packages', ''],
        ['Restart app', ''],
      ]),
      'Sheet1',
    );
    XLSX.writeFile(workbook, inputPath);
    const transport = createTransport();
    transport.createResponse
      .mockResolvedValueOnce({
        content: JSON.stringify({
          translations: [
            { id: 'runtime.xlsx#row-2', text: 'Installer le paquet' },
            { id: 'runtime.xlsx#row-3', text: 'Ouvrir le menu' },
            { id: 'runtime.xlsx#row-4', text: 'Fermer le menu' },
            { id: 'runtime.xlsx#row-5', text: 'Enregistrer les parametres' },
            { id: 'runtime.xlsx#row-6', text: 'Installer les paquets' },
          ],
        }),
        status: 200,
        endpoint: '/mock',
      })
      .mockImplementationOnce(async (request: { userPrompt: string }) => {
        expect(request.userPrompt).toContain('Runtime TM');
        expect(request.userPrompt).toContain('Install package');
        expect(request.userPrompt).toContain('Installer le paquet');
        return {
          content: JSON.stringify({
            translations: [{ id: 'runtime.xlsx#row-7', text: "Redemarrer l'application" }],
          }),
          status: 200,
          endpoint: '/mock',
        };
      });
    const engine = new LocalizationEngine(db, { dbPath: ':memory:', aiTransport: transport });

    await engine.translateFile({
      projectId,
      inputPath,
      outputPath,
      options: { requestMode: 'window', batchSize: 5 },
      job: { maxAttempts: 1 },
    });

    expect(transport.createResponse).toHaveBeenCalledTimes(2);
    expect(mountedTmId ? db.getTMStats(mountedTmId).entryCount : 0).toBe(0);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Add Window Partial existing-target runtime test**

Append:

```ts
it('commits existing-target rows from Window Partial batches into Runtime TM', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cat-runtime-tm-partial-'));
  const db = new CATDatabase(':memory:');
  try {
    const projectId = db.createProject('Runtime Partial', 'en', 'fr');
    seedConfiguredAIProvider(db, projectId);
    const inputPath = join(root, 'partial-runtime.xlsx');
    const outputPath = join(root, 'partial-runtime.translated.xlsx');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['source', 'target'],
        ['Launch game', 'Lancer le jeu'],
        ['Open menu', ''],
        ['Close menu', ''],
        ['Save settings', ''],
        ['Load profile', ''],
        ['Launch games', ''],
      ]),
      'Sheet1',
    );
    XLSX.writeFile(workbook, inputPath);
    const transport = createTransport();
    transport.createResponse
      .mockResolvedValueOnce({
        content: JSON.stringify({
          translations: [
            { id: 'partial-runtime.xlsx#row-3', text: 'Ouvrir le menu' },
            { id: 'partial-runtime.xlsx#row-4', text: 'Fermer le menu' },
            { id: 'partial-runtime.xlsx#row-5', text: 'Enregistrer les parametres' },
            { id: 'partial-runtime.xlsx#row-6', text: 'Charger le profil' },
          ],
        }),
        status: 200,
        endpoint: '/mock',
      })
      .mockImplementationOnce(async (request: { userPrompt: string }) => {
        expect(request.userPrompt).toContain('Runtime TM');
        expect(request.userPrompt).toContain('Launch game');
        expect(request.userPrompt).toContain('Lancer le jeu');
        return {
          content: JSON.stringify({
            translations: [{ id: 'partial-runtime.xlsx#row-7', text: 'Lancer les jeux' }],
          }),
          status: 200,
          endpoint: '/mock',
        };
      });
    const engine = new LocalizationEngine(db, { dbPath: ':memory:', aiTransport: transport });

    await engine.translateFile({
      projectId,
      inputPath,
      outputPath,
      options: { requestMode: 'window-partial', targetScope: 'blank-only', batchSize: 5 },
      job: { maxAttempts: 1 },
    });

    expect(transport.createResponse).toHaveBeenCalledTimes(2);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run the failing end-to-end tests**

Run:

```powershell
npx vitest run packages/localization/src/LocalizationEngine.test.ts -t "Runtime TM"
```

Expected before Tasks 1-7 are complete: FAIL. Expected after Tasks 1-7 are complete: PASS.

- [ ] **Step 4: Fix prompt assertions only if wording differs**

If the prompt says `Runtime TM (Working TM)` instead of `Runtime TM`, change `RuntimeTMDatabase.ts` so it creates a `custom` project and explicitly mounted working TM named exactly `Runtime TM`, as shown in Task 3.

- [ ] **Step 5: Run the full LocalizationEngine test file**

Run:

```powershell
npx vitest run packages/localization/src/LocalizationEngine.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/localization/src/LocalizationEngine.test.ts
git commit -m "test: cover runtime tm file translation"
```

---

### Task 9: Final Verification And Documentation Sync

**Files:**
- Historical note: this task originally allowed edits to the then-active
  `DOCS/70_RUNTIME_TM_SPEC.md`. That document is now archived beside this plan.
- Modify: `DOCS/60_TM_TB_REFERENCE.md` only if final behavior differs from current wording.

- [ ] **Step 1: Run focused Runtime TM tests**

Run:

```powershell
npx vitest run packages/localization/src/runtimeTm packages/localization/src/job/TranslationJobRunner.test.ts packages/localization/src/LocalizationEngine.test.ts -t "Runtime TM|runtime TM"
```

Expected: PASS.

- [ ] **Step 2: Run request-mode strategy tests**

Run:

```powershell
npx vitest run packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.test.ts packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run localization typecheck**

Run:

```powershell
npx tsc --noEmit -p packages/localization/tsconfig.json
```

Expected: PASS.

- [ ] **Step 4: Run package build**

Run:

```powershell
npm run build --workspace=packages/localization
```

Expected: PASS.

- [ ] **Step 5: Run CLI build**

Run:

```powershell
npm run build:cli
```

Expected: PASS.

- [ ] **Step 6: Review sensitive output policy**

Run:

```powershell
rg -n "Runtime TM|provider|baseUrl|apiKey|C:\\\\|D:\\\\|https?://" DOCS packages/localization/src/runtimeTm packages/localization/src/LocalizationEngine.test.ts
```

Expected: matches are generic docs/test strings only. No real local paths, provider endpoints, API keys, model names, project names from private data, or private source text.

- [ ] **Step 7: Commit verification docs only if changed**

If Task 9 changed docs:

```powershell
git add DOCS/archive/runtime-tm/70_RUNTIME_TM_SPEC.md DOCS/60_TM_TB_REFERENCE.md
git commit -m "docs: sync runtime tm implementation notes"
```

If Task 9 changed no docs, do not create an empty commit.

---

## Execution Notes

- Do not run a real provider smoke test without explicit approval in the execution session.
- Keep Runtime TM out of `apps/cli`; the CLI should inherit behavior by calling `@cat/localization`.
- Keep Runtime TM out of `apps/desktop`; future desktop adoption should call the shared file translation path.
- Keep file-job max concurrency at `1` when Runtime TM is enabled so task order remains causal.
- Do not persist Runtime TM sidecars. Resume rebuilds from checkpoints only.
