# Desktop Window Partial Runtime TM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop app's default translation-project file AI Translate path execute `window-partial` with Runtime TM through `@cat/localization`, then apply returned unit results back to the current app file segments.

**Architecture:** `apps/desktop` remains the owner of app file segments and persistence. `@cat/localization` owns window planning, prompt execution, Runtime TM injection/recall/commit, and returns/apply-callbacks unit results without writing desktop DB directly. Dialogue mode stays on the current desktop workflow; review/custom projects keep the current legacy file workflow for this change.

**Tech Stack:** TypeScript, Vitest, `@cat/localization` `LocalizationEngine`, `TranslationJobRunner`, `WindowPartialTaskPlanner`, `RuntimeTMContext`, desktop `SegmentService`.

---

## File Structure

- Modify: `packages/localization/src/job/types.ts`
  - Add a host-owned `locked?: boolean` flag to `JobUnit` so confirmed/read-only app segments can remain in the scan window without becoming request rows.
- Modify: `packages/localization/src/types.ts`
  - Add `locked?: boolean` to `ExternalTranslationUnit`.
  - Add project-segment job input/result types if they are exported from the package root.
- Modify: `packages/localization/src/job/TaskPlanner.ts`
  - Make `WindowPartialTaskPlanner` exclude locked units from `requestUnitKeys`, including overwrite scope.
- Modify: `packages/localization/src/requestModes/shared/results.ts`
  - Preserve `locked` when converting `JobUnit` to `ExternalTranslationUnit`.
- Modify: `packages/localization/src/LocalizationEngine.ts`
  - Treat locked units as skipped/read-only.
  - Add `translateProjectSegments()` as the desktop-friendly headless entrypoint.
  - Create/dispose Runtime TM for translation projects, exactly like file job mode.
- Modify: `packages/localization/src/job/TranslationJobRunner.ts`
  - Add an optional per-result host callback after checkpoint append and before Runtime TM commit.
- Create: `packages/localization/src/projectSegmentJobAdapter.ts`
  - Convert host-provided project file segment units into a `TranslationJob`.
  - Run the shared runner using `WindowPartialTaskPlanner` by default.
  - Keep checkpoint/event stores in memory for desktop app jobs.
- Modify: `packages/localization/src/index.ts`
  - Export the new project-segment adapter and `WindowPartialTaskPlanner`.
- Modify/Test: `packages/localization/src/job/TaskPlanner.test.ts`
  - Verify locked units are context-only even under overwrite scope.
- Modify/Test: `packages/localization/src/job/TranslationJobRunner.test.ts`
  - Verify the host apply callback runs before Runtime TM commit.
- Create/Test: `packages/localization/src/projectSegmentJobAdapter.test.ts`
  - Verify project segment units become window-partial jobs and callbacks receive ordered results.
- Modify/Test: `packages/localization/src/LocalizationEngine.test.ts`
  - Verify `translateProjectSegments()` wires Runtime TM hooks for translation projects and defaults to `window-partial`.
- Create: `apps/desktop/src/main/services/modules/ai/localizationFileTranslationWorkflow.ts`
  - Map desktop `Segment[]` to localization units.
  - Apply translated/reused unit results back via `SegmentService.updateSegment()`.
- Modify: `apps/desktop/src/main/services/modules/ai/AITranslationOrchestrator.ts`
  - Route translation-project default file AI Translate to localization workflow.
  - Keep dialogue mode on `runDialogueFileTranslation()`.
  - Keep review/custom projects on `runStandardFileTranslation()`.
- Modify: `apps/desktop/src/main/services/modules/AIModule.ts`
  - Accept a `LocalizationEngine` dependency and pass it to the orchestrator.
- Modify: `apps/desktop/src/main/services/ProjectService.ts`
  - Construct `LocalizationEngine` with the desktop DB, `dbPath`, shared transport, and runtime config provider.
- Modify/Test: `apps/desktop/src/main/services/modules/AIModule.test.ts`
  - Verify default translation-project file AI Translate calls localization with `requestMode: 'window-partial'`, respects locked confirmed segments, and applies returned results to app file segments.
- No renderer change:
  - `ProjectAITranslateModal.tsx` already defaults to `mode: 'default'` and `targetScope: 'blank-only'`.
  - Translation Scope remains visible and continues to control blank-only vs overwrite-non-confirmed.

---

### Task 1: Add Locked Unit Semantics To Window Partial Planning

**Files:**
- Modify: `packages/localization/src/job/types.ts`
- Modify: `packages/localization/src/types.ts`
- Modify: `packages/localization/src/job/TaskPlanner.ts`
- Modify: `packages/localization/src/requestModes/shared/results.ts`
- Modify: `packages/localization/src/LocalizationEngine.ts`
- Test: `packages/localization/src/job/TaskPlanner.test.ts`

- [ ] **Step 1: Write the failing planner test**

Append this test inside `describe('WindowPartialTaskPlanner', ...)` in `packages/localization/src/job/TaskPlanner.test.ts`:

```ts
  it('keeps locked rows as scan-window context without requesting them in overwrite scope', () => {
    const units = [
      makeUnit({ unitId: 'unit-1', target: '', locked: false }),
      makeUnit({ unitId: 'unit-2', target: 'confirmed target', locked: true }),
      makeUnit({ unitId: 'unit-3', target: 'draft target', locked: false }),
    ];
    const planner = new WindowPartialTaskPlanner();

    const tasks = planner.planJob({
      job: makeJob(units),
      completedResults: new Map(),
      targetScope: 'overwrite-non-confirmed',
    });

    expect(tasks).toEqual([
      expect.objectContaining({
        requestMode: 'window-partial',
        scanWindowUnits: units,
        units,
        requestUnitKeys: ['doc-1\u0000unit-1', 'doc-1\u0000unit-3'],
      }),
    ]);
  });
```

- [ ] **Step 2: Run the planner test to verify it fails**

Run:

```powershell
npx vitest run packages/localization/src/job/TaskPlanner.test.ts -t "locked rows"
```

Expected: FAIL because `JobUnit` has no `locked` field behavior and the planner requests `unit-2` under overwrite scope.

- [ ] **Step 3: Add `locked` to shared localization unit types**

In `packages/localization/src/job/types.ts`, change `JobUnit` to:

```ts
export interface JobUnit {
  documentId: string;
  unitId: string;
  source: string;
  target?: string;
  context?: string;
  rowNumber?: number;
  sourceHash: string;
  locked?: boolean;
  metadata?: Record<string, unknown>;
}
```

In `packages/localization/src/types.ts`, change `ExternalTranslationUnit` to:

```ts
export interface ExternalTranslationUnit {
  id: string;
  source: string;
  target?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  context?: string;
  fileName?: string;
  rowNumber?: number;
  locked?: boolean;
  metadata?: Record<string, unknown>;
}
```

- [ ] **Step 4: Preserve `locked` when converting job units**

In `packages/localization/src/requestModes/shared/results.ts`, update `jobUnitToExternalUnit()`:

```ts
export function jobUnitToExternalUnit(unit: {
  unitId: string;
  source: string;
  target?: string;
  context?: string;
  rowNumber?: number;
  locked?: boolean;
  metadata?: Record<string, unknown>;
}): ExternalTranslationUnit {
  return {
    id: unit.unitId,
    source: unit.source,
    target: unit.target,
    context: unit.context,
    rowNumber: unit.rowNumber,
    locked: unit.locked,
    metadata: unit.metadata,
  };
}
```

- [ ] **Step 5: Exclude locked units from Window Partial request rows**

In `packages/localization/src/job/TaskPlanner.ts`, update `shouldRequestUnit()`:

```ts
function shouldRequestUnit(unit: JobUnit, targetScope: LocalizationTargetScope): boolean {
  if (unit.locked) {
    return false;
  }

  if (!unit.source.trim()) {
    return false;
  }

  return targetScope === 'overwrite-non-confirmed' || !unit.target?.trim();
}
```

- [ ] **Step 6: Make locked units intrinsically skipped by the runner fallback**

In `packages/localization/src/job/TranslationJobRunner.ts`, update `isIntrinsicallySkippedUnit()`:

```ts
function isIntrinsicallySkippedUnit(job: TranslationJob, unit: JobUnit): boolean {
  if (unit.locked) {
    return true;
  }

  if (!unit.source.trim()) {
    return true;
  }

  const targetScope = resolveBatchTargetScope(job.translationOptions?.targetScope);
  return targetScope === 'blank-only' && Boolean(unit.target?.trim());
}
```

- [ ] **Step 7: Make `LocalizationEngine.prepareUnit()` return skipped for locked units**

In `packages/localization/src/LocalizationEngine.ts`, add this check immediately after the empty-source check in `prepareUnit()`:

```ts
    if (unit.locked) {
      return {
        kind: 'skipped',
        result: {
          id: unit.id,
          source,
          target: unit.target ?? '',
          status: 'skipped',
          metadata: unit.metadata,
        },
      };
    }
```

- [ ] **Step 8: Run the planner test**

Run:

```powershell
npx vitest run packages/localization/src/job/TaskPlanner.test.ts
```

Expected: PASS.

---

### Task 2: Add A Host Apply Callback To TranslationJobRunner

**Files:**
- Modify: `packages/localization/src/job/TranslationJobRunner.ts`
- Test: `packages/localization/src/job/TranslationJobRunner.test.ts`

- [ ] **Step 1: Write the failing callback-order test**

Append this test to `describe('TranslationJobRunner', ...)` in `packages/localization/src/job/TranslationJobRunner.test.ts`:

```ts
  it('applies host results before committing them to runtime TM', async () => {
    const order: string[] = [];
    const unit = makeUnit({ unitId: 'unit-1', source: 'Hello' });
    const runner = new TranslationJobRunner({
      checkpointStore: makeMemoryCheckpointStore(),
      eventSink: makeMemoryEventSink(),
      taskPlanner: {
        plan: () => [{ taskId: 'task-1', units: [unit] }],
      },
      taskExecutor: async (task, context) => ({
        results: task.units.map((taskUnit) => ({
          jobId: context.job.id,
          documentId: taskUnit.documentId,
          unitId: taskUnit.unitId,
          sourceHash: taskUnit.sourceHash,
          status: 'translated',
          source: taskUnit.source,
          target: 'Bonjour',
        })),
      }),
      applyResult: async (result) => {
        order.push(`apply:${result.unitId}`);
      },
      runtimeTm: {
        seed: vi.fn(),
        commit: vi.fn(async (results) => {
          order.push(`runtime:${results[0]?.unitId}`);
        }),
      },
    });

    await runner.run(makeJob([unit]));

    expect(order).toEqual(['apply:unit-1', 'runtime:unit-1']);
  });
```

If this test file does not already have `makeMemoryCheckpointStore()`, `makeMemoryEventSink()`, `makeUnit()`, and `makeJob()` helpers with compatible signatures, add local helpers at the bottom:

```ts
function makeMemoryCheckpointStore() {
  return {
    load: vi.fn(async () => ({
      toReusedResult: () => undefined,
      toRuntimeSeedResults: () => [],
    })),
    append: vi.fn(async () => undefined),
  };
}

function makeMemoryEventSink() {
  return {
    append: vi.fn(async () => undefined),
  };
}
```

- [ ] **Step 2: Run the runner test to verify it fails**

Run:

```powershell
npx vitest run packages/localization/src/job/TranslationJobRunner.test.ts -t "host results"
```

Expected: FAIL because `applyResult` is not a dependency yet.

- [ ] **Step 3: Add the callback type and field**

In `packages/localization/src/job/TranslationJobRunner.ts`, extend `TranslationJobRunnerDependencies`:

```ts
  applyResult?: (
    result: UnitResult,
    context: TranslationJobRunnerCallbackContext & { task: TranslationTask },
  ) => Promise<void> | void;
```

Add a private field:

```ts
  private readonly applyResult?: TranslationJobRunnerDependencies['applyResult'];
```

Assign it in the constructor:

```ts
    this.applyResult = dependencies.applyResult;
```

- [ ] **Step 4: Invoke the callback after checkpoint append and before Runtime TM commit**

In `persistTaskResult()`, after `await this.checkpointStore.append(checkpoint);` and before `resultMap.set(...)`, add:

```ts
      await this.applyResult?.(result, {
        job,
        task,
        resultMap,
      });
```

The resulting order in `TranslationJobRunner.run()` remains:

```ts
          await this.persistTaskResult(job, task, taskResult, resultMap, throttle);
          await this.runtimeTm?.commit(taskResult.results, task, job);
```

- [ ] **Step 5: Run the runner tests**

Run:

```powershell
npx vitest run packages/localization/src/job/TranslationJobRunner.test.ts
```

Expected: PASS.

---

### Task 3: Add The Project Segment Job Adapter In `@cat/localization`

**Files:**
- Create: `packages/localization/src/projectSegmentJobAdapter.ts`
- Modify: `packages/localization/src/index.ts`
- Test: `packages/localization/src/projectSegmentJobAdapter.test.ts`

- [ ] **Step 1: Write adapter tests**

Create `packages/localization/src/projectSegmentJobAdapter.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  prepareProjectSegmentTranslationJob,
  translateProjectSegmentsJob,
} from './projectSegmentJobAdapter';
import type { TranslationJob, TranslationTask, UnitResult } from './job/types';

describe('projectSegmentJobAdapter', () => {
  it('prepares project segment units with window-partial as the default request mode', async () => {
    const prepared = prepareProjectSegmentTranslationJob({
      projectId: 7,
      documentId: 'file-1:demo.xlsx',
      units: [
        { id: 's1', source: 'One', target: '', metadata: { orderIndex: 0 } },
        { id: 's2', source: 'Two', target: 'Deux', metadata: { orderIndex: 1 } },
        { id: 's3', source: 'Three', target: 'Trois', locked: true, metadata: { orderIndex: 2 } },
      ],
      options: { targetScope: 'overwrite-non-confirmed', batchSize: 3 },
    });

    expect(prepared.job.translationOptions?.requestMode).toBe('window-partial');
    expect(prepared.job.options?.maxConcurrency).toBe(1);
    expect(prepared.job.units).toEqual([
      expect.objectContaining({ unitId: 's1', target: '', locked: undefined }),
      expect.objectContaining({ unitId: 's2', target: 'Deux', locked: undefined }),
      expect.objectContaining({ unitId: 's3', target: 'Trois', locked: true }),
    ]);
  });

  it('uses the window-partial planner and keeps locked rows out of requestUnitKeys', async () => {
    const plannedTasks: TranslationTask[] = [];

    await translateProjectSegmentsJob(
      {
        projectId: 7,
        documentId: 'file-1:demo.xlsx',
        units: [
          { id: 's1', source: 'One', target: '' },
          { id: 's2', source: 'Two', target: 'Deux' },
          { id: 's3', source: 'Three', target: 'Trois', locked: true },
        ],
        options: { targetScope: 'overwrite-non-confirmed', batchSize: 3 },
      },
      {
        taskExecutor: async () => ({ results: [] }),
        runnerFactory: (dependencies) => ({
          run: async (job: TranslationJob) => {
            const planner = dependencies.taskPlanner as unknown as {
              planJob(input: {
                job: TranslationJob;
                completedResults: ReadonlyMap<string, UnitResult>;
                targetScope: 'overwrite-non-confirmed';
              }): TranslationTask[];
            };
            plannedTasks.push(
              ...planner.planJob({
                job,
                completedResults: new Map(),
                targetScope: 'overwrite-non-confirmed',
              }),
            );

            return {
              jobId: job.id,
              summary: { total: 3, translated: 0, skipped: 0, reused: 0, failed: 0 },
              results: [],
            };
          },
        }),
      },
    );

    expect(plannedTasks[0]).toEqual(
      expect.objectContaining({
        requestMode: 'window-partial',
        requestUnitKeys: ['file-1:demo.xlsx\u0000s1', 'file-1:demo.xlsx\u0000s2'],
      }),
    );
  });

  it('applies translated results through the host callback', async () => {
    const applied: UnitResult[] = [];

    const result = await translateProjectSegmentsJob(
      {
        projectId: 7,
        documentId: 'file-1:demo.xlsx',
        units: [{ id: 's1', source: 'One', target: '' }],
        options: { targetScope: 'blank-only' },
      },
      {
        taskExecutor: async (task, context) => ({
          results: task.units.map((unit) => ({
            jobId: context.job.id,
            documentId: unit.documentId,
            unitId: unit.unitId,
            sourceHash: unit.sourceHash,
            status: 'translated',
            source: unit.source,
            target: 'Un',
            metadata: unit.metadata,
          })),
        }),
        applyResult: async (unitResult) => {
          applied.push(unitResult);
        },
      },
    );

    expect(result.summary).toEqual({ total: 1, translated: 1, skipped: 0, failed: 0 });
    expect(applied).toEqual([expect.objectContaining({ unitId: 's1', target: 'Un' })]);
  });
});
```

- [ ] **Step 2: Run the adapter tests to verify they fail**

Run:

```powershell
npx vitest run packages/localization/src/projectSegmentJobAdapter.test.ts
```

Expected: FAIL because the adapter file does not exist.

- [ ] **Step 3: Create the adapter**

Create `packages/localization/src/projectSegmentJobAdapter.ts`:

```ts
import { createHash } from 'crypto';
import { tagPolicyFingerprintValue } from './tagPolicy';
import { resolveBatchTargetScope } from './translationTargetScope';
import { computeSourceHash } from './job/sourceHash';
import { WindowModeTaskPlanner, WindowPartialTaskPlanner } from './job/TaskPlanner';
import {
  TranslationJobRunner,
  type TranslationJobRunResult,
  type TranslationJobRunnerDependencies,
} from './job/TranslationJobRunner';
import type { JobUnit, TranslationJob, TranslationTaskExecutor, UnitResult } from './job/types';
import type { LocalizationRequestMode, TranslateUnitsOptions, TranslateUnitsResult } from './types';

export interface ProjectSegmentTranslationUnit {
  id: string;
  source: string;
  target?: string;
  context?: string;
  rowNumber?: number;
  locked?: boolean;
  metadata?: Record<string, unknown>;
}

export interface TranslateProjectSegmentsJobInput {
  projectId: number;
  documentId: string;
  units: ProjectSegmentTranslationUnit[];
  options?: TranslateUnitsOptions;
  job?: {
    jobId?: string;
    maxAttempts?: number;
  };
}

export interface PreparedProjectSegmentTranslationJob {
  job: TranslationJob;
}

export type ProjectSegmentTranslationJobRunnerFactory = (
  dependencies: TranslationJobRunnerDependencies,
) => Pick<TranslationJobRunner, 'run'>;

export interface TranslateProjectSegmentsJobOptions {
  taskExecutor: TranslationTaskExecutor;
  runnerFactory?: ProjectSegmentTranslationJobRunnerFactory;
  runtimeTm?: TranslationJobRunnerDependencies['runtimeTm'];
  applyResult?: TranslationJobRunnerDependencies['applyResult'];
  onProgress?: (data: { current: number; total: number; message?: string }) => void;
}

export function prepareProjectSegmentTranslationJob(
  input: TranslateProjectSegmentsJobInput,
): PreparedProjectSegmentTranslationJob {
  const requestMode: LocalizationRequestMode = input.options?.requestMode ?? 'window-partial';
  const translationOptions: TranslateUnitsOptions = {
    ...input.options,
    requestMode,
  };
  const resumeFingerprint = computeProjectSegmentResumeFingerprint({
    ...input,
    options: translationOptions,
  });
  const units: JobUnit[] = input.units.map((unit, index) => ({
    documentId: input.documentId,
    unitId: unit.id,
    source: unit.source,
    target: unit.target,
    context: unit.context,
    rowNumber: unit.rowNumber,
    sourceHash: computeSourceHash({
      source: unit.source,
      context: unit.context,
      resumeFingerprint,
    }),
    ...(unit.locked ? { locked: true } : {}),
    metadata: unit.metadata,
  }));

  return {
    job: {
      id: input.job?.jobId ?? defaultProjectSegmentJobId(input, resumeFingerprint),
      projectId: input.projectId,
      units,
      translationOptions,
      options: {
        maxAttempts: input.job?.maxAttempts,
        maxConcurrency: 1,
      },
    },
  };
}

export async function translateProjectSegmentsJob(
  input: TranslateProjectSegmentsJobInput,
  options: TranslateProjectSegmentsJobOptions,
): Promise<TranslateUnitsResult> {
  const prepared = prepareProjectSegmentTranslationJob(input);
  const runnerDependencies: TranslationJobRunnerDependencies = {
    checkpointStore: new MemoryCheckpointStore(),
    eventSink: new MemoryEventSink(options.onProgress),
    taskPlanner:
      prepared.job.translationOptions?.requestMode === 'window'
        ? new WindowModeTaskPlanner({ batchSize: input.options?.batchSize })
        : new WindowPartialTaskPlanner({ batchSize: input.options?.batchSize }),
    taskExecutor: options.taskExecutor,
    runtimeTm: options.runtimeTm,
    applyResult: options.applyResult,
  };
  const runner = (options.runnerFactory ?? defaultRunnerFactory)(runnerDependencies);
  const runResult = await runner.run(prepared.job);

  return jobRunResultToTranslateUnitsResult(runResult);
}

class MemoryCheckpointStore implements TranslationJobRunnerDependencies['checkpointStore'] {
  async load() {
    return {
      toReusedResult: () => undefined,
      toRuntimeSeedResults: () => [],
    };
  }

  async append(): Promise<void> {
    return undefined;
  }
}

class MemoryEventSink implements TranslationJobRunnerDependencies['eventSink'] {
  constructor(private readonly onProgress?: (data: { current: number; total: number; message?: string }) => void) {}

  async append(record: Parameters<TranslationJobRunnerDependencies['eventSink']['append']>[0]): Promise<void> {
    if (record.done !== undefined && record.total !== undefined) {
      this.onProgress?.({
        current: record.done,
        total: record.total,
        message: progressMessage(record.event, record.done, record.total),
      });
    }
  }
}

function defaultRunnerFactory(
  dependencies: TranslationJobRunnerDependencies,
): Pick<TranslationJobRunner, 'run'> {
  return new TranslationJobRunner(dependencies);
}

function jobRunResultToTranslateUnitsResult(
  runResult: TranslationJobRunResult,
): TranslateUnitsResult {
  const results = runResult.results.map((result) => {
    if (result.status === 'failed') {
      return {
        id: result.unitId,
        source: result.source,
        target: result.target,
        status: 'failed' as const,
        error: result.error ?? 'Translation failed',
        references: result.references,
        metadata: result.metadata,
      };
    }

    return {
      id: result.unitId,
      source: result.source,
      target: result.target ?? '',
      status:
        result.status === 'translated' || result.status === 'reused'
          ? result.status
          : 'skipped',
      references: result.references,
      metadata: result.metadata,
    };
  });
  const reused = results.filter((result) => result.status === 'reused').length;
  const summary: TranslateUnitsResult['summary'] = {
    total: results.length,
    translated: results.filter((result) => result.status === 'translated').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    failed: results.filter((result) => result.status === 'failed').length,
  };

  if (reused > 0) {
    summary.reused = reused;
  }

  return {
    summary,
    results,
    ...(runResult.runtimeTm ? { runtimeTm: runResult.runtimeTm } : {}),
  };
}

function defaultProjectSegmentJobId(
  input: TranslateProjectSegmentsJobInput,
  resumeFingerprint: string,
): string {
  return `project-segments:${input.projectId}:${input.documentId}:${resumeFingerprint}`;
}

function computeProjectSegmentResumeFingerprint(input: TranslateProjectSegmentsJobInput): string {
  return hashCanonicalPayload([
    ['projectId', String(input.projectId)],
    ['documentId', input.documentId],
    ['targetScope', resolveBatchTargetScope(input.options?.targetScope)],
    ['mode', input.options?.mode ?? 'standard'],
    ['requestMode', input.options?.requestMode ?? 'window-partial'],
    ['tagPolicy', tagPolicyFingerprintValue(input.options?.tagPolicy)],
    ['providerOverride', input.options?.providerOverride],
    ['mt.providerId', input.options?.mt?.providerId],
    ['mt.model', input.options?.mt?.model],
    ['mt.reasoningEffort', input.options?.mt?.reasoningEffort],
    ['mt.systemPrompt', input.options?.mt?.systemPrompt],
    ['mt.temperature', normalizeNumberOption(input.options?.mt?.temperature)],
  ]);
}

function hashCanonicalPayload(entries: Array<[string, string | undefined]>): string {
  const payload = entries.filter((entry): entry is [string, string] => entry[1] !== undefined);

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function normalizeNumberOption(value: number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

function progressMessage(event: string, done: number, total: number): string {
  if (event === 'job_done') {
    return `Translated ${done} of ${total} segments`;
  }
  return `Translating segment ${done} of ${total}`;
}
```

- [ ] **Step 4: Export the adapter and WindowPartialTaskPlanner**

In `packages/localization/src/index.ts`, change the task planner export to include `WindowPartialTaskPlanner`:

```ts
export {
  OneUnitTaskPlanner,
  WindowModeTaskPlanner,
  WindowPartialTaskPlanner,
  normalizeWindowModeBatchSize,
} from './job/TaskPlanner';
```

Add:

```ts
export {
  prepareProjectSegmentTranslationJob,
  translateProjectSegmentsJob,
} from './projectSegmentJobAdapter';
export type {
  PreparedProjectSegmentTranslationJob,
  ProjectSegmentTranslationJobRunnerFactory,
  ProjectSegmentTranslationUnit,
  TranslateProjectSegmentsJobInput,
  TranslateProjectSegmentsJobOptions,
} from './projectSegmentJobAdapter';
```

- [ ] **Step 5: Run adapter tests**

Run:

```powershell
npx vitest run packages/localization/src/projectSegmentJobAdapter.test.ts
```

Expected: PASS.

---

### Task 4: Add `LocalizationEngine.translateProjectSegments()`

**Files:**
- Modify: `packages/localization/src/LocalizationEngine.ts`
- Modify: `packages/localization/src/types.ts`
- Test: `packages/localization/src/LocalizationEngine.test.ts`

- [ ] **Step 1: Add public input types**

In `packages/localization/src/types.ts`, add:

```ts
export interface TranslateProjectSegmentUnit extends ExternalTranslationUnit {
  id: string;
}

export interface TranslateProjectSegmentsInput {
  projectId: number;
  documentId: string;
  units: TranslateProjectSegmentUnit[];
  options?: TranslateUnitsOptions;
  job?: {
    jobId?: string;
    maxAttempts?: number;
  };
  onResult?: (result: TranslateUnitResult) => Promise<void> | void;
  onProgress?: (data: { current: number; total: number; message?: string }) => void;
}
```

- [ ] **Step 2: Write the failing engine test**

In `packages/localization/src/LocalizationEngine.test.ts`, add a test near the file/job tests:

```ts
  it('runs project segment jobs through window-partial with runtime TM enabled', async () => {
    const db = createTestDatabase();
    const transport = makeBatchTransport([
      JSON.stringify({ translations: [{ id: 's1', text: 'Bonjour' }] }),
      JSON.stringify({ translations: [{ id: 's3', text: 'Monde' }] }),
    ]);
    const engine = new LocalizationEngine(db, {
      dbPath: ':memory:',
      aiTransport: transport,
      aiRuntimeConfigProvider: {
        getModelConfig: async () => ({ reasoningEffort: 'medium' }),
      },
    });
    const projectId = createTranslationProject(db, {
      srcLang: 'en',
      tgtLang: 'fr',
      aiModel: 'provider:test',
    });
    seedProviderSettings(db, {
      providerId: 'provider:test',
      model: 'gpt-test',
      apiKey: 'test-key',
      baseUrl: 'https://api.test/v1',
    });
    const applied: string[] = [];

    const result = await engine.translateProjectSegments({
      projectId,
      documentId: 'file-1:demo.xlsx',
      units: [
        { id: 's1', source: 'Hello', target: '' },
        { id: 's2', source: 'Already done', target: 'Deja fait' },
        { id: 's3', source: 'World', target: '' },
      ],
      options: { targetScope: 'blank-only', batchSize: 2 },
      onResult: async (unitResult) => {
        if (unitResult.status === 'translated') {
          applied.push(unitResult.id);
        }
      },
    });

    expect(result.summary).toEqual({ total: 3, translated: 2, skipped: 1, failed: 0 });
    expect(result.runtimeTm?.enabled).toBe(true);
    expect(result.runtimeTm?.appended).toBeGreaterThanOrEqual(2);
    expect(applied).toEqual(['s1', 's3']);
    expect(transport.createResponse).toHaveBeenCalledTimes(2);
    const secondPrompt = (transport.createResponse as ReturnType<typeof vi.fn>).mock.calls[1][0]
      .userPrompt;
    expect(secondPrompt).toContain('Runtime TM');
  });
```

Adjust helper names to match the existing `LocalizationEngine.test.ts` helper style. Do not introduce real network calls.

- [ ] **Step 3: Run the engine test to verify it fails**

Run:

```powershell
npx vitest run packages/localization/src/LocalizationEngine.test.ts -t "project segment jobs"
```

Expected: FAIL because `translateProjectSegments()` is missing.

- [ ] **Step 4: Import adapter and types in `LocalizationEngine.ts`**

Add imports:

```ts
import { translateProjectSegmentsJob } from './projectSegmentJobAdapter';
import type { TranslateProjectSegmentsInput } from './types';
```

If `TranslateProjectSegmentsInput` is added to the existing grouped import from `./types`, do not duplicate the import.

- [ ] **Step 5: Implement `translateProjectSegments()`**

Add this public method before `translateFile()` in `LocalizationEngine`:

```ts
  public async translateProjectSegments(
    input: TranslateProjectSegmentsInput,
  ): Promise<TranslateUnitsResult> {
    const project = this.projectRepo.getProject(input.projectId);
    if (!project) {
      throw new Error(`Project not found: ${input.projectId}`);
    }

    const mode = this.resolveMode(input.options?.mode);
    if (mode === 'dialogue') {
      throw new Error('Dialogue mode is not supported for project segment jobs.');
    }

    const tagPolicy = resolveTagPolicy(input.options?.tagPolicy);
    const runtimeTm =
      (project.projectType ?? 'translation') === 'translation'
        ? RuntimeTMContext.create({
            srcLang: project.srcLang,
            tgtLang: project.tgtLang,
            tagPolicy,
          })
        : undefined;
    const referenceResolver = runtimeTm
      ? new RuntimeTMReferenceResolver(runtimeTm).resolve
      : undefined;

    try {
      return await translateProjectSegmentsJob(
        {
          projectId: input.projectId,
          documentId: input.documentId,
          units: input.units,
          options: {
            ...input.options,
            requestMode: input.options?.requestMode ?? 'window-partial',
          },
          job: input.job,
        },
        {
          taskExecutor: this.createTaskExecutor({ referenceResolver }),
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
          applyResult: input.onResult
            ? async (result) => {
                await input.onResult?.({
                  id: result.unitId,
                  source: result.source,
                  target: result.target ?? '',
                  status:
                    result.status === 'translated' || result.status === 'reused'
                      ? result.status
                      : result.status === 'failed'
                        ? 'failed'
                        : 'skipped',
                  ...(result.status === 'failed'
                    ? { error: result.error ?? 'Translation failed' }
                    : {}),
                  references: result.references,
                  metadata: result.metadata,
                });
              }
            : undefined,
          onProgress: input.onProgress,
        },
      );
    } finally {
      runtimeTm?.dispose();
    }
  }
```

- [ ] **Step 6: Run localization engine tests**

Run:

```powershell
npx vitest run packages/localization/src/LocalizationEngine.test.ts
```

Expected: PASS.

---

### Task 5: Wire Desktop Default File Translation To Localization

**Files:**
- Create: `apps/desktop/src/main/services/modules/ai/localizationFileTranslationWorkflow.ts`
- Modify: `apps/desktop/src/main/services/modules/ai/AITranslationOrchestrator.ts`
- Modify: `apps/desktop/src/main/services/modules/AIModule.ts`
- Modify: `apps/desktop/src/main/services/ProjectService.ts`
- Test: `apps/desktop/src/main/services/modules/AIModule.test.ts`

- [ ] **Step 1: Write the failing desktop routing test**

In `apps/desktop/src/main/services/modules/AIModule.test.ts`, add this test inside `describe('AIModule.aiTranslateFile', ...)`:

```ts
  it('uses localization window-partial runtime TM for default translation project file translation', async () => {
    const segments: Segment[] = [
      createSegment({ segmentId: 's1', sourceText: 'Hello' }),
      createSegment({ segmentId: 's2', sourceText: 'Already done', targetText: 'Deja fait' }),
      createSegment({
        segmentId: 's3',
        sourceText: 'Confirmed',
        targetText: 'Confirme',
        status: 'confirmed',
      }),
    ];
    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'fr',
        projectType: 'translation',
        aiPrompt: '',
        aiTemperature: 0.2,
        aiModel: TEST_PROVIDER_ID,
      }),
      listProjects: vi.fn().mockReturnValue([]),
    } as unknown as ProjectRepository;
    const segmentRepo = {
      getSegmentsPage: vi.fn((_fileId: number, offset: number) =>
        offset === 0 ? segments : [],
      ),
    } as unknown as SegmentRepository;
    const settingsRepo = createAISettingsRepository();
    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;
    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn(),
    } as unknown as AITransport;
    const localizationEngine = {
      translateProjectSegments: vi.fn(async (input) => {
        expect(input.options).toEqual(
          expect.objectContaining({
            requestMode: 'window-partial',
            targetScope: 'blank-only',
            mt: expect.objectContaining({ providerId: TEST_PROVIDER_ID }),
          }),
        );
        expect(input.units).toEqual([
          expect.objectContaining({ id: 's1', source: 'Hello', target: '', locked: undefined }),
          expect.objectContaining({
            id: 's2',
            source: 'Already done',
            target: 'Deja fait',
            locked: undefined,
          }),
          expect.objectContaining({
            id: 's3',
            source: 'Confirmed',
            target: 'Confirme',
            locked: true,
          }),
        ]);
        await input.onResult?.({
          id: 's1',
          source: 'Hello',
          target: 'Bonjour',
          status: 'translated',
          metadata: { segmentId: 's1' },
        });
        return {
          summary: { total: 3, translated: 1, skipped: 2, failed: 0 },
          results: [],
          runtimeTm: {
            enabled: true,
            tagPolicy: 'default',
            seeded: 0,
            appended: 1,
            skipped: 2,
            entryCount: 1,
            inspectCalls: 0,
            hitUnits: 0,
            tmHits: 0,
            concordanceHits: 0,
            capped: false,
          },
        };
      }),
    };

    const module = new AIModule(
      projectRepo,
      segmentRepo,
      settingsRepo,
      segmentService,
      transport,
      undefined,
      {
        getModelConfig: vi.fn().mockResolvedValue({ reasoningEffort: 'medium' }),
      },
      {},
      localizationEngine as never,
    );

    const result = await module.aiTranslateFile(1);

    expect(result).toEqual({ translated: 1, skipped: 2, failed: 0, total: 3 });
    expect(localizationEngine.translateProjectSegments).toHaveBeenCalledTimes(1);
    expect(transport.createResponse).not.toHaveBeenCalled();
    expect(segmentService.updateSegment).toHaveBeenCalledWith(
      's1',
      expect.any(Array),
      'translated',
    );
  });
```

- [ ] **Step 2: Run the desktop test to verify it fails**

Run:

```powershell
npx vitest run apps/desktop/src/main/services/modules/AIModule.test.ts -t "localization window-partial"
```

Expected: FAIL because `AIModule` does not accept/use a localization engine yet.

- [ ] **Step 3: Create the desktop localization workflow**

Create `apps/desktop/src/main/services/modules/ai/localizationFileTranslationWorkflow.ts`:

```ts
import { type Segment, type SegmentStatus } from '@cat/core/models';
import { parseEditorTextToTokens } from '@cat/core/tag';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type {
  LocalizationEngine,
  TranslateProjectSegmentsInput,
  TranslateUnitResult,
} from '@cat/localization';
import type { Project } from '@cat/core/project';
import type { AIBatchTargetScope } from '../../../../shared/ipc';
import { SegmentService } from '../../SegmentService';
import { SegmentPagingIterator } from './SegmentPagingIterator';
import { getAIProgressVerb } from './aiProgressVerb';
import { logAIBatchDebug } from './aiBatchDebug';

export interface LocalizationFileTranslationParams {
  fileId: number;
  fileName: string;
  project: Project;
  targetScope: AIBatchTargetScope;
  providerId?: string | null;
  localizationEngine: Pick<LocalizationEngine, 'translateProjectSegments'>;
  segmentPagingIterator: SegmentPagingIterator;
  segmentService: SegmentService;
  onProgress?: (data: { current: number; total: number; message?: string }) => void;
}

export async function runLocalizationFileTranslation(
  params: LocalizationFileTranslationParams,
): Promise<{ translated: number; skipped: number; failed: number; total: number }> {
  const segments = Array.from(params.segmentPagingIterator.iterateFileSegments(params.fileId));
  const segmentsById = new Map(segments.map((segment) => [segment.segmentId, segment]));
  const aiStatus: SegmentStatus = 'translated';

  logAIBatchDebug({
    event: 'localization_file_start',
    mode: 'window-partial',
    fileId: params.fileId,
    projectId: params.project.id,
    projectType: params.project.projectType || 'translation',
    targetScope: params.targetScope,
    totalSegments: segments.length,
  });

  const result = await params.localizationEngine.translateProjectSegments({
    projectId: params.project.id,
    documentId: `file-${params.fileId}:${params.fileName}`,
    units: segments.map((segment): TranslateProjectSegmentsInput['units'][number] => ({
      id: segment.segmentId,
      source: serializeTokensToDisplayText(segment.sourceTokens),
      target: serializeTokensToDisplayText(segment.targetTokens),
      context: segment.meta?.context ? String(segment.meta.context).trim() : undefined,
      rowNumber: segment.orderIndex + 1,
      locked: segment.status === 'confirmed' ? true : undefined,
      metadata: {
        segmentId: segment.segmentId,
        orderIndex: segment.orderIndex,
        status: segment.status,
      },
    })),
    options: {
      mode: 'standard',
      requestMode: 'window-partial',
      targetScope: params.targetScope,
      mt: {
        providerId: params.providerId ?? undefined,
      },
    },
    onResult: async (unitResult: TranslateUnitResult) => {
      if (unitResult.status !== 'translated' && unitResult.status !== 'reused') {
        return;
      }

      const segmentId = String(unitResult.metadata?.segmentId ?? unitResult.id);
      const segment = segmentsById.get(segmentId);
      if (!segment) {
        throw new Error(`Translated segment not found in app file: ${segmentId}`);
      }

      const targetTokens = parseEditorTextToTokens(unitResult.target, segment.sourceTokens);
      await params.segmentService.updateSegment(segment.segmentId, targetTokens, aiStatus);
    },
    onProgress: (event) => {
      params.onProgress?.({
        current: event.current,
        total: event.total,
        message: `${getAIProgressVerb(params.project.projectType || 'translation')} segment ${event.current} of ${event.total}`,
      });
    },
  });

  logAIBatchDebug({
    event: 'localization_file_complete',
    mode: 'window-partial',
    fileId: params.fileId,
    projectId: params.project.id,
    translated: result.summary.translated + (result.summary.reused ?? 0),
    skipped: result.summary.skipped,
    failed: result.summary.failed,
    total: segments.length,
    runtimeTm: result.runtimeTm,
  });

  return {
    translated: result.summary.translated + (result.summary.reused ?? 0),
    skipped: result.summary.skipped,
    failed: result.summary.failed,
    total: segments.length,
  };
}
```

- [ ] **Step 4: Add localization engine dependency to AIModule**

In `apps/desktop/src/main/services/modules/AIModule.ts`, import the type:

```ts
import type { LocalizationEngine } from '@cat/localization';
```

Add a final optional constructor parameter:

```ts
    localizationEngine?: Pick<LocalizationEngine, 'translateProjectSegments'>,
```

Pass it to `AITranslationOrchestrator`:

```ts
      localizationEngine,
```

- [ ] **Step 5: Add localization engine dependency to AITranslationOrchestrator**

In `apps/desktop/src/main/services/modules/ai/AITranslationOrchestrator.ts`, import:

```ts
import type { LocalizationEngine } from '@cat/localization';
import { runLocalizationFileTranslation } from './localizationFileTranslationWorkflow';
```

Add a final optional constructor parameter:

```ts
    private readonly localizationEngine?: Pick<LocalizationEngine, 'translateProjectSegments'>,
```

In `aiTranslateFile()`, after the dialogue branch and before `runStandardFileTranslation()`, add:

```ts
    if ((project.projectType || 'translation') === 'translation' && this.localizationEngine) {
      return runLocalizationFileTranslation({
        fileId,
        fileName: file.name,
        project,
        targetScope,
        providerId: options?.model ?? project.aiModel,
        localizationEngine: this.localizationEngine,
        segmentPagingIterator: this.segmentPagingIterator,
        segmentService: this.segmentService,
        onProgress: options?.onProgress,
      });
    }
```

Keep the existing `runStandardFileTranslation()` call unchanged for review/custom projects and test fallback construction.

- [ ] **Step 6: Construct LocalizationEngine in ProjectService**

In `apps/desktop/src/main/services/ProjectService.ts`, import:

```ts
import { LocalizationEngine } from '@cat/localization';
```

After `const aiRuntimeConfigProvider = deps.aiRuntimeConfigProvider;`, add:

```ts
    const localizationEngine = new LocalizationEngine(db, {
      dbPath,
      aiTransport,
      ...(aiRuntimeConfigProvider ? { aiRuntimeConfigProvider } : {}),
    });
```

Pass `localizationEngine` as the final `AIModule` constructor argument:

```ts
        localizationEngine,
```

- [ ] **Step 7: Run the desktop routing test**

Run:

```powershell
npx vitest run apps/desktop/src/main/services/modules/AIModule.test.ts -t "localization window-partial"
```

Expected: PASS.

- [ ] **Step 8: Run the full AIModule test file**

Run:

```powershell
npx vitest run apps/desktop/src/main/services/modules/AIModule.test.ts
```

Expected: PASS. Existing tests that instantiate `AIModule` without a localization engine continue to exercise the legacy workflow fallback.

---

### Task 6: Verify Scope UI Remains Behavior-Only

**Files:**
- Inspect only: `apps/desktop/src/renderer/src/components/project-detail/ProjectAITranslateModal.tsx`
- Inspect only: `apps/desktop/src/renderer/src/hooks/projectDetail/useProjectAIController.ts`
- Optional Test: `apps/desktop/src/main/ipc/aiHandlers.test.ts`

- [ ] **Step 1: Inspect current modal defaults**

Confirm `ProjectAITranslateModal.tsx` still has:

```ts
  const [mode, setMode] = useState<AIBatchMode>('default');
  const [targetScope, setTargetScope] = useState<AIBatchTargetScope>('blank-only');
```

- [ ] **Step 2: Do not add a request-mode UI control**

No code change is needed in the renderer. The desktop default path now sets `requestMode: 'window-partial'` inside the main-process workflow.

- [ ] **Step 3: Confirm IPC still forwards target scope**

Run:

```powershell
npx vitest run apps/desktop/src/main/ipc/aiHandlers.test.ts
```

Expected: PASS. The IPC shape remains `{ mode, targetScope }`.

---

### Task 7: Final Verification

**Files:**
- All modified source/tests from Tasks 1-6.

- [ ] **Step 1: Run targeted localization tests**

Run:

```powershell
npx vitest run packages/localization/src/job/TaskPlanner.test.ts packages/localization/src/job/TranslationJobRunner.test.ts packages/localization/src/projectSegmentJobAdapter.test.ts packages/localization/src/LocalizationEngine.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run targeted desktop tests**

Run:

```powershell
npx vitest run apps/desktop/src/main/services/modules/AIModule.test.ts apps/desktop/src/main/services/modules/ai/AITranslationWorkflows.test.ts apps/desktop/src/main/ipc/aiHandlers.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run desktop typecheck**

Run:

```powershell
npm run typecheck --workspace=apps/desktop
```

Expected: PASS.

- [ ] **Step 4: Check dependency direction**

Run:

```powershell
rg "apps/desktop" packages/localization/src
```

Expected: no matches. `@cat/localization` must not import desktop code.

- [ ] **Step 5: Check git diff for sensitive data**

Run:

```powershell
git diff --check
```

Expected: PASS, no whitespace errors. Also manually inspect diffs for local paths, provider URLs, API keys, and project names.

---

## Self-Review

Spec coverage:
- Desktop default translation-project file AI Translate moves to `window-partial`: covered by Tasks 4 and 5.
- Runtime TM is used for desktop window-partial jobs: covered by Task 4.
- Localization does not write desktop DB directly: covered by Task 2 host callback and Task 5 workflow ownership.
- Existing app file segments are the commit surface; export remains desktop-owned: covered by Task 5.
- Translation Scope UI is left alone: covered by Task 6.
- Dialogue mode is not migrated in this change: covered by Task 5 routing.
- Dependency direction stays `apps/desktop -> @cat/localization -> @cat/db -> @cat/core`: covered by Task 7.

Placeholder scan:
- No task contains TBD/TODO/later placeholders.
- Test commands and expected outcomes are explicit.
- Code snippets define new public signatures before later tasks consume them.

Type consistency:
- `locked` is added to both host units and job units, preserved by `jobUnitToExternalUnit()`, and consumed by planner/engine.
- `TranslateProjectSegmentsInput` uses `onResult` with public `TranslateUnitResult`; runner internals use `UnitResult`.
- Desktop workflow depends on `Pick<LocalizationEngine, 'translateProjectSegments'>` so tests can inject a mock without constructing a real DB engine.
