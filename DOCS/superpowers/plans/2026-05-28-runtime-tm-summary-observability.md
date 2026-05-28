# Runtime TM Summary Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add low-overhead runtime TM summary counters so file translation callers can verify whether Runtime TM was seeded, populated, queried, and hit.

**Architecture:** Keep Runtime TM as an in-memory optimization and collect O(1) counters inside `RuntimeTMContext`. Thread one immutable summary snapshot through the existing job runner return value and final progress event; do not dump Runtime TM entries or add per-unit trace I/O.

**Tech Stack:** TypeScript, Vitest, `@cat/localization`, in-memory SQLite via `@cat/db`.

---

## Root Cause Notes

Current Runtime TM behavior is hard to inspect because:

- `RuntimeTMContext` owns a private SQLite `:memory:` database and disposes it at the end of `LocalizationEngine.translateFile`.
- `RuntimeTMReferenceResolver` merges persistent and runtime matches, but no component records how many runtime entries were available, how often inspect ran, or whether runtime matches were found.
- `TranslationJobRunner` accepts `runtimeTm.seed` and `runtimeTm.commit` hooks, but the hook contract has no summary channel.
- Existing artifacts can indirectly show `tmName: "Runtime TM"` when `--artifacts` is enabled, but normal runs and progress events do not expose Runtime TM health.

The optimization should therefore add counters at the Runtime TM owner, then expose one final summary without retaining the temporary DB.

## File Structure

- Modify `packages/localization/src/types.ts`
  - Add public `RuntimeTMSummary`.
  - Add optional `runtimeTm?: RuntimeTMSummary` to `TranslateUnitsResult`.
- Modify `packages/localization/src/job/types.ts`
  - Add optional `runtimeTm?: RuntimeTMSummary` to `ProgressEventRecord`.
- Modify `packages/localization/src/job/TranslationJobRunner.ts`
  - Extend `TranslationJobRuntimeTMHooks` with `summary?: () => RuntimeTMSummary`.
  - Add optional `runtimeTm?: RuntimeTMSummary` to `TranslationJobRunResult`.
  - Include summary in the final `job_done` event and returned run result.
- Modify `packages/localization/src/runtimeTm/RuntimeTMContext.ts`
  - Track seed/commit/inspect/hit/cap counters.
  - Add `summary(): RuntimeTMSummary`.
- Modify `packages/localization/src/LocalizationEngine.ts`
  - Pass the `summary` hook when Runtime TM is created.
- Modify `packages/localization/src/fileTranslationJobAdapter.ts`
  - Preserve `runResult.runtimeTm` in the returned `TranslateFileResult`.
- Test files:
  - `packages/localization/src/runtimeTm/RuntimeTMContext.test.ts`
  - `packages/localization/src/job/TranslationJobRunner.test.ts`
  - `packages/localization/src/LocalizationEngine.test.ts`
  - Optional narrow adapter test in `packages/localization/src/fileTranslationJobAdapter.test.ts` if the runner factory path is easier than a full engine test.

---

### Task 1: Add Public Runtime TM Summary Type

**Files:**
- Modify: `packages/localization/src/types.ts`
- Modify: `packages/localization/src/job/types.ts`

- [ ] **Step 1: Add a failing type-level usage test through existing runtime tests**

No standalone type test exists. The compile failure will be exercised by later tests importing `RuntimeTMSummary` and expecting `TranslateFileResult.runtimeTm`.

- [ ] **Step 2: Add the public summary type**

In `packages/localization/src/types.ts`, add near the translation result types:

```ts
export interface RuntimeTMSummary {
  enabled: boolean;
  tagPolicy: TagPolicy;
  seeded: number;
  appended: number;
  skipped: number;
  entryCount: number;
  inspectCalls: number;
  hitUnits: number;
  tmHits: number;
  concordanceHits: number;
  capped: boolean;
}
```

Then extend `TranslateUnitsResult`:

```ts
export interface TranslateUnitsResult {
  summary: {
    total: number;
    translated: number;
    skipped: number;
    failed: number;
    reused?: number;
  };
  results: TranslateUnitResult[];
  runtimeTm?: RuntimeTMSummary;
}
```

In `packages/localization/src/job/types.ts`, import and use the public type:

```ts
import type { PromptArtifact, TBArtifact, TMArtifact } from '../artifacts';
import type { RuntimeTMSummary } from '../types';
```

Extend `ProgressEventRecord`:

```ts
export interface ProgressEventRecord {
  job: string;
  event: ProgressEventName;
  doc?: string;
  unit?: string;
  task?: string;
  status?: UnitResultStatus;
  done?: number;
  total?: number;
  error?: string;
  runtimeTm?: RuntimeTMSummary;
  at: string;
}
```

- [ ] **Step 3: Run typecheck-targeted tests**

Run:

```bash
npx vitest run packages/localization/src/runtimeTm/RuntimeTMContext.test.ts -t "RuntimeTMContext"
```

Expected: existing tests still pass, or TypeScript compilation fails only where the new type has not been wired yet.

---

### Task 2: Track Runtime TM Counters In RuntimeTMContext

**Files:**
- Modify: `packages/localization/src/runtimeTm/RuntimeTMContext.ts`
- Modify: `packages/localization/src/runtimeTm/RuntimeTMContext.test.ts`

- [ ] **Step 1: Write failing summary tests**

Add this test to `RuntimeTMContext.test.ts`:

```ts
  it('tracks summary counters for seed, commit, inspect hits, and caps', async () => {
    const runtime = RuntimeTMContext.create({
      srcLang: 'en',
      tgtLang: 'fr',
      tagPolicy: 'none',
      maxEntries: 2,
    });

    try {
      expect(runtime.summary()).toEqual({
        enabled: true,
        tagPolicy: 'none',
        seeded: 0,
        appended: 0,
        skipped: 0,
        entryCount: 0,
        inspectCalls: 0,
        hitUnits: 0,
        tmHits: 0,
        concordanceHits: 0,
        capped: false,
      });

      runtime.seedResults([
        unitResult('seed-1', 'Save {1}', 'Enregistrer {1}'),
        {
          ...unitResult('seed-empty-target', 'Ignored', ''),
          status: 'skipped',
        },
      ]);

      runtime.commitResults([
        unitResult('commit-1', 'Open file', 'Ouvrir le fichier'),
        unitResult('commit-over-cap', 'Close file', 'Fermer le fichier'),
      ]);

      const artifact = await runtime.inspect(
        createInspectSegment('inspect-1', 'Save {1}'),
      );

      expect(artifact.rawMatches.some((match) => match.tmName === 'Runtime TM')).toBe(true);
      expect(runtime.summary()).toMatchObject({
        enabled: true,
        tagPolicy: 'none',
        seeded: 1,
        appended: 1,
        skipped: 2,
        entryCount: 2,
        inspectCalls: 1,
        hitUnits: 1,
        tmHits: 1,
        capped: true,
      });
    } finally {
      runtime.dispose();
    }
  });
```

If helper names differ in this file, add local helpers with these shapes:

```ts
function unitResult(unitId: string, source: string, target: string): UnitResult {
  return {
    jobId: 'job-1',
    documentId: 'doc.xlsx',
    unitId,
    sourceHash: unitId,
    status: 'translated',
    source,
    target,
    attempts: 1,
  };
}

function createInspectSegment(unitId: string, source: string): Segment {
  return createTransientSegment(
    {
      id: unitId,
      source,
      sourceLanguage: 'en',
      targetLanguage: 'fr',
    },
    0,
    {
      projectId: 1,
      sourceLanguage: 'en',
      targetLanguage: 'fr',
    },
    { tagPolicy: 'none' },
  );
}
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npx vitest run packages/localization/src/runtimeTm/RuntimeTMContext.test.ts -t "tracks summary counters"
```

Expected: FAIL with `runtime.summary is not a function`.

- [ ] **Step 3: Implement counters**

In `RuntimeTMContext.ts`, import the public type:

```ts
import type { RuntimeTMSummary } from '../types';
```

Add private counters:

```ts
  private seeded = 0;
  private appended = 0;
  private skipped = 0;
  private inspectCalls = 0;
  private hitUnits = 0;
  private tmHits = 0;
  private concordanceHits = 0;
  private capped = false;
```

Replace `seedResults` with a seed-specific wrapper:

```ts
  seedResults(results: readonly UnitResult[]): RuntimeTMCommitSummary {
    const summary = this.commitResultsInternal(results);
    this.seeded += summary.appended;
    return summary;
  }
```

Change public `commitResults`:

```ts
  commitResults(results: readonly UnitResult[]): RuntimeTMCommitSummary {
    const summary = this.commitResultsInternal(results);
    this.appended += summary.appended;
    return summary;
  }
```

Move the existing commit loop into a private helper:

```ts
  private commitResultsInternal(results: readonly UnitResult[]): RuntimeTMCommitSummary {
    this.assertOpen();

    let appended = 0;
    let skipped = 0;
    let disabled = false;

    for (const result of results) {
      if (!isRuntimeTMEligibleResult(result)) {
        skipped += 1;
        continue;
      }

      if (this.entryCount >= this.maxEntries) {
        skipped += 1;
        disabled = true;
        continue;
      }

      this.tmService.upsertFromConfirmedSegment(
        this.runtimeDb.projectId,
        createTransientSegment(
          {
            id: result.unitId,
            source: result.source,
            target: result.target,
            sourceLanguage: this.srcLang,
            targetLanguage: this.tgtLang,
            metadata: result.metadata,
          },
          this.entryCount,
          {
            projectId: this.runtimeDb.projectId,
            sourceLanguage: this.srcLang,
            targetLanguage: this.tgtLang,
          },
          { tagPolicy: this.tagPolicy },
        ),
      );
      this.entryCount += 1;
      appended += 1;
    }

    this.skipped += skipped;
    this.capped = this.capped || disabled;
    return { appended, skipped, disabled };
  }
```

Update `inspect`:

```ts
  async inspect(segment: Segment): Promise<TMArtifact> {
    this.assertOpen();
    this.inspectCalls += 1;
    const artifact = await this.tmModule.inspect(this.runtimeDb.projectId, segment);
    const tmHits = artifact.rawMatches.filter((match) => match.kind === 'tm').length;
    const concordanceHits = artifact.rawMatches.filter(
      (match) => match.kind === 'concordance',
    ).length;

    if (tmHits + concordanceHits > 0) {
      this.hitUnits += 1;
    }
    this.tmHits += tmHits;
    this.concordanceHits += concordanceHits;

    return artifact;
  }
```

Add `summary`:

```ts
  summary(): RuntimeTMSummary {
    return {
      enabled: true,
      tagPolicy: this.tagPolicy,
      seeded: this.seeded,
      appended: this.appended,
      skipped: this.skipped,
      entryCount: this.entryCount,
      inspectCalls: this.inspectCalls,
      hitUnits: this.hitUnits,
      tmHits: this.tmHits,
      concordanceHits: this.concordanceHits,
      capped: this.capped,
    };
  }
```

- [ ] **Step 4: Run the summary test**

Run:

```bash
npx vitest run packages/localization/src/runtimeTm/RuntimeTMContext.test.ts -t "tracks summary counters"
```

Expected: PASS.

---

### Task 3: Thread Summary Through TranslationJobRunner

**Files:**
- Modify: `packages/localization/src/job/TranslationJobRunner.ts`
- Modify: `packages/localization/src/job/TranslationJobRunner.test.ts`

- [ ] **Step 1: Write failing runner test**

Add a test near the Runtime TM hook tests in `TranslationJobRunner.test.ts`:

```ts
  it('returns and emits Runtime TM summary when the hook provides one', async () => {
    const summary = {
      enabled: true,
      tagPolicy: 'none',
      seeded: 2,
      appended: 3,
      skipped: 1,
      entryCount: 5,
      inspectCalls: 4,
      hitUnits: 2,
      tmHits: 2,
      concordanceHits: 1,
      capped: false,
    } as const;
    const harness = await createHarness();
    const runner = harness.makeRunner(successfulExecutor(), {
      runtimeTm: {
        seed: vi.fn(),
        commit: vi.fn(),
        summary: () => summary,
      },
    });

    const result = await runner.run(makeJob());
    const events = await readJsonlRecords<ProgressEventRecord>(harness.eventsPath);
    const jobDone = events.records.find((event) => event.event === 'job_done');

    expect(result.runtimeTm).toEqual(summary);
    expect(jobDone?.runtimeTm).toEqual(summary);
  });
```

Use existing local helpers instead of `createHarness`, `successfulExecutor`, `makeJob`, or `readJsonlRecords` if their names differ in the file.

- [ ] **Step 2: Run the failing runner test**

Run:

```bash
npx vitest run packages/localization/src/job/TranslationJobRunner.test.ts -t "returns and emits Runtime TM summary"
```

Expected: FAIL because `summary` is not part of `TranslationJobRuntimeTMHooks` and run results/events do not include `runtimeTm`.

- [ ] **Step 3: Implement runner summary plumbing**

In `TranslationJobRunner.ts`, import `RuntimeTMSummary`:

```ts
import type { RuntimeTMSummary } from '../types';
```

Extend the result and hook interfaces:

```ts
export interface TranslationJobRunResult {
  jobId: string;
  summary: TranslationJobSummary;
  results: UnitResult[];
  runtimeTm?: RuntimeTMSummary;
}

export interface TranslationJobRuntimeTMHooks {
  seed(results: UnitResult[]): Promise<void> | void;
  commit(results: UnitResult[], task: TranslationTask, job: TranslationJob): Promise<void> | void;
  summary?: () => RuntimeTMSummary;
}
```

After `const summary = summarizeResults(total, orderedResults);`, capture Runtime TM summary once:

```ts
    const runtimeTmSummary = this.runtimeTm?.summary?.();
```

Include it in `job_done`:

```ts
    await this.emit({
      job: job.id,
      event: 'job_done',
      done: orderedResults.length,
      total,
      ...(runtimeTmSummary ? { runtimeTm: runtimeTmSummary } : {}),
    });
```

Include it in the returned run result:

```ts
    return {
      jobId: job.id,
      summary,
      results: orderedResults,
      ...(runtimeTmSummary ? { runtimeTm: runtimeTmSummary } : {}),
    };
```

- [ ] **Step 4: Run the runner test**

Run:

```bash
npx vitest run packages/localization/src/job/TranslationJobRunner.test.ts -t "returns and emits Runtime TM summary"
```

Expected: PASS.

---

### Task 4: Expose Summary From File Translation Results

**Files:**
- Modify: `packages/localization/src/LocalizationEngine.ts`
- Modify: `packages/localization/src/fileTranslationJobAdapter.ts`
- Modify: `packages/localization/src/LocalizationEngine.test.ts`

- [ ] **Step 1: Add failing integration test**

Add a focused test in `LocalizationEngine.test.ts` near the Runtime TM file job tests:

```ts
  it('returns Runtime TM summary for Window Mode file jobs', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Runtime TM Summary', 'en', 'fr', 'translation');
      const tmId = db.createTM('Working TM', 'en', 'fr', 'working');
      db.mountTMToProject(projectId, tmId, 0, 'readwrite');

      const root = mkdtempSync(join(tmpdir(), 'runtime-tm-summary-'));
      const inputPath = join(root, 'input.xlsx');
      const outputPath = join(root, 'output.xlsx');
      writeWorkbook(inputPath, [
        ['source', 'target'],
        ['Save file', ''],
        ['Save file', ''],
      ]);

      const engine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        mt: {
          providerId: 'test',
          model: 'test-model',
        },
      });

      const result = await engine.translateFile({
        projectId,
        inputPath,
        outputPath,
        options: {
          requestMode: 'window',
          tagPolicy: 'none',
        },
        job: {
          eventsPath: join(root, 'events.jsonl'),
        },
      });

      expect(result.runtimeTm).toMatchObject({
        enabled: true,
        tagPolicy: 'none',
        entryCount: 2,
        appended: 2,
      });
      expect(result.runtimeTm?.inspectCalls).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });
```

Use the existing workbook and fake-provider helpers already present in `LocalizationEngine.test.ts`; if provider setup differs, mirror the closest existing Runtime TM integration test.

- [ ] **Step 2: Run the failing integration test**

Run:

```bash
npx vitest run packages/localization/src/LocalizationEngine.test.ts -t "returns Runtime TM summary for Window Mode file jobs"
```

Expected: FAIL because `TranslateFileResult.runtimeTm` is undefined.

- [ ] **Step 3: Pass the summary hook from LocalizationEngine**

In `LocalizationEngine.ts`, extend the `runtimeTm` dependency object:

```ts
            runtimeTm: runtimeTm
              ? {
                  seed: (results) => {
                    runtimeTm.seedResults(results);
                  },
                  commit: (results) => {
                    runtimeTm.commitResults(results);
                  },
                  summary: () => runtimeTm.summary(),
                }
              : undefined,
```

- [ ] **Step 4: Preserve runtimeTm in adapter result**

In `fileTranslationJobAdapter.ts`, change `jobRunResultToTranslateUnitsResult`:

```ts
function jobRunResultToTranslateUnitsResult(
  runResult: TranslationJobRunResult,
): TranslateUnitsResult {
  const result = unitResultsToTranslateUnitsResult(runResult.results);
  return {
    ...result,
    ...(runResult.runtimeTm ? { runtimeTm: runResult.runtimeTm } : {}),
  };
}
```

- [ ] **Step 5: Run the integration test**

Run:

```bash
npx vitest run packages/localization/src/LocalizationEngine.test.ts -t "returns Runtime TM summary for Window Mode file jobs"
```

Expected: PASS.

---

### Task 5: Regression Tests For Non-Artifact And Artifact Paths

**Files:**
- Modify: `packages/localization/src/job/TranslationJobRunner.test.ts`
- Modify: `packages/localization/src/fileTranslationJobAdapter.test.ts` if a narrow adapter test is simpler than a second engine test.

- [ ] **Step 1: Verify summary does not require artifact capture**

Add an assertion to the runner test from Task 3:

```ts
    expect(harness.artifactStoreWasConfigured).not.toBe(true);
```

If the harness does not expose that field, assert through the existing test helper that no artifact records were written:

```ts
    expect((await readJsonlRecords<ArtifactRecord>(harness.artifactsPath)).records).toEqual([]);
```

- [ ] **Step 2: Add adapter-level preservation test if needed**

If Task 4's engine test is expensive or brittle, add this narrow test to `fileTranslationJobAdapter.test.ts` using the existing `runnerFactory` pattern:

```ts
      const runtimeTm = {
        enabled: true,
        tagPolicy: 'none',
        seeded: 0,
        appended: 1,
        skipped: 0,
        entryCount: 1,
        inspectCalls: 0,
        hitUnits: 0,
        tmHits: 0,
        concordanceHits: 0,
        capped: false,
      } as const;

      const result = await translateSpreadsheetFileJob(input, {
        taskExecutor,
        runnerFactory: () => ({
          run: async () => ({
            jobId: 'job-1',
            summary: { total: 1, translated: 1, skipped: 0, reused: 0, failed: 0 },
            results: [unitResult],
            runtimeTm,
          }),
        }),
      });

      expect(result.runtimeTm).toEqual(runtimeTm);
```

- [ ] **Step 3: Run related tests**

Run:

```bash
npx vitest run packages/localization/src/runtimeTm/RuntimeTMContext.test.ts packages/localization/src/job/TranslationJobRunner.test.ts packages/localization/src/fileTranslationJobAdapter.test.ts packages/localization/src/LocalizationEngine.test.ts -t "Runtime TM|runtime TM|runtimeTm|summary"
```

Expected: PASS for the focused Runtime TM and summary tests.

---

### Task 6: Verification

**Files:**
- No code changes.

- [ ] **Step 1: Run the Runtime TM test slice**

Run:

```bash
npx vitest run packages/localization/src/runtimeTm/RuntimeTMContext.test.ts packages/localization/src/runtimeTm/RuntimeTMReferenceResolver.test.ts packages/localization/src/runtimeTm/RuntimeTMSelection.test.ts packages/localization/src/job/TranslationJobRunner.test.ts packages/localization/src/fileTranslationJobAdapter.test.ts packages/localization/src/LocalizationEngine.test.ts -t "Runtime TM|runtime TM|runtimeTm|summary"
```

Expected: PASS.

- [ ] **Step 2: Run broader related localization tests**

Run:

```bash
npx vitest run packages/localization/src/runtimeTm/RuntimeTMContext.test.ts packages/localization/src/runtimeTm/RuntimeTMReferenceResolver.test.ts packages/localization/src/runtimeTm/RuntimeTMSelection.test.ts packages/localization/src/job/TranslationJobRunner.test.ts packages/localization/src/fileTranslationJobAdapter.test.ts packages/localization/src/LocalizationEngine.test.ts packages/localization/src/tagPolicy.test.ts packages/localization/src/transientSegment.test.ts
```

Expected: PASS.

- [ ] **Step 3: Build CLI package**

Run:

```bash
npm run build:cli
```

Expected: PASS.

---

## Self-Review

- Spec coverage: The plan covers the approved summary-counter optimization only. It intentionally excludes entry caps, best-effort failure handling, per-unit runtime/persistent split artifacts, hit-only trace files, and retaining the in-memory DB after job completion.
- Placeholder scan: The plan contains no placeholder markers and no open-ended implementation instructions.
- Type consistency: `RuntimeTMSummary` is defined once in `types.ts`, used by job events/results, returned by `RuntimeTMContext.summary()`, and preserved by `fileTranslationJobAdapter`.
- Performance check: Runtime overhead is constant counter increments during existing seed/commit/inspect calls. No new DB query is introduced. No additional per-unit file I/O is introduced unless existing progress events are already being written.
