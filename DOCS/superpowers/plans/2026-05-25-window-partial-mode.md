# Window Partial Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `window-partial` request mode for file translation jobs.
The existing `window` mode remains unchanged and available as the rollback path.
`window-partial` preserves physical 1..5 row scan windows, treats already
populated target rows as read-only context, and requests provider output only
for rows requiring target text.

**Architecture:** Keep pure prompt and strict JSON response behavior in
`@cat/core/project`; keep planning, context assembly, request-mode execution,
checkpoint/event/artifact behavior, and file job wiring in `@cat/localization`;
keep CLI as a thin option parser over `@cat/localization`. Add the new mode as
an explicit request-mode option instead of overloading `LocalizationMode`.

**Tech Stack:** TypeScript, Vitest, `@cat/core/project`,
`@cat/localization`, existing MT/TM/TB modules, existing spreadsheet job
adapter, existing `momocat translate file` CLI.

**Source spec:** `DOCS/superpowers/specs/2026-05-25-window-partial-mode-design.md`

---

## Design Invariants

These constraints are the north star for every implementation task:

1. Existing `window` behavior must remain unchanged unless a task explicitly
   says to extend shared metadata in a backward-compatible way.
2. `window-partial` is opt-in through `requestMode: 'window-partial'` and CLI
   `--request-mode window-partial`.
3. Prompt-visible wording should use neutral target-text language:
   `Rows requiring target text`, `Return target text for ids`, and `Do not
   produce output or return ids for read-only rows`.
4. Rows requiring target text must reuse the existing Window Mode current
   segment rendering logic. Do not invent a new TM/TB/current-row prompt format.
5. Read-only context rows must not expose response ids.
6. Provider response validation must use only the dynamic request id set.
7. Planning must preserve physical file-order scan windows even when resume,
   checkpoints, or existing target cells remove rows from the request set.
8. Same-file provider requests remain sequential.
9. Skip-only windows must not resolve provider config or require provider
   credentials.
10. Do not commit real DB paths, provider base URLs, provider IDs, project names,
   or local smoke fixture paths.

---

## Subagent-Driven Execution Map

The implementation is safe to split into disjoint ownership slices after this
plan is approved.

- **Worker A: Core prompt and MT module contract**
  - Owns `packages/core/src/project/windowModePrompt*`.
  - Owns `packages/localization/src/modules/MTModule*`.
  - Does not edit job runner, planners, CLI, or engine orchestration.

- **Worker B: Job planning and runner**
  - Owns `packages/localization/src/job/*`.
  - Owns planner tests and runner tests.
  - Does not edit core prompt, MTModule, CLI, or engine strategy wiring.

- **Worker C: Partial strategy and engine wiring**
  - Owns `packages/localization/src/requestModes/windowPartialSequentialBatch/*`.
  - Owns shared partial context helpers if created.
  - Owns the `LocalizationEngine` wiring and strategy tests.

- **Worker D: CLI, inspect, docs, and smoke support**
  - Owns `packages/localization/src/cli/translateFileCommand.ts`.
  - Owns `apps/cli/src/commands/translateFileCommand.ts` and CLI tests.
  - Owns `LocalizationInspector` support and documentation updates.
  - Owns smoke helper changes only if they are needed and do not commit secrets.

All workers must assume the worktree may contain unrelated changes. Do not
revert edits outside the owned files. Coordinate before editing shared files
such as `packages/localization/src/types.ts`.

---

## File Structure

Create:

- `packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.ts`
  - Executes `window-partial` request tasks.
  - Sends only request rows to `MTModule.translateBatch`.
  - Builds read-only context rows from physical scan windows.

- `packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.test.ts`
  - Covers request row filtering, read-only current-existing context, response
    mapping, artifacts, and provider failure behavior.

- Optional:
  `packages/localization/src/requestModes/shared/windowPartialContextBuilder.ts`
  - Builds role-labeled read-only context rows if the logic is too large for
    the strategy file.

- Optional:
  `packages/localization/src/requestModes/shared/windowPartialContextBuilder.test.ts`
  - Unit tests for previous/current-existing/next context selection.

Modify:

- `packages/core/src/project/windowModePromptTypes.ts`
  - Add read-only context row and request-mode prompt types.

- `packages/core/src/project/windowModePrompt.ts`
  - Render role-based read-only context rows for `window-partial`.
  - Keep current segment rendering shared with `window`.

- `packages/core/src/project/windowModePrompt.test.ts`
  - Add focused `window-partial` prompt and parser tests.

- `packages/localization/src/artifacts.ts`
  - Allow prompt batch metadata mode to include `window-partial`.
  - Add optional `scanWindowCount`, `requestCount`, and
    `readOnlyContextCount`.

- `packages/localization/src/modules/MTModuleTypes.ts`
  - Thread read-only context rows and request mode through batch prompt inputs.

- `packages/localization/src/modules/MTModule.ts`
  - Pass new fields to `buildAIWindowModePromptBundle`.
  - Preserve existing `window` call behavior.

- `packages/localization/src/modules/MTModule.test.ts`
  - Add prompt artifact metadata and wording coverage.

- `packages/localization/src/types.ts`
  - Add `LocalizationRequestMode = 'window' | 'window-partial'`.
  - Add `requestMode?: LocalizationRequestMode` to `TranslateUnitsOptions`.

- `packages/localization/src/job/types.ts`
  - Add optional task metadata:
    `requestMode`, `scanWindowUnits`, and `requestUnitKeys`.

- `packages/localization/src/job/TaskPlanner.ts`
  - Add `JobAwareTaskPlanner` and `WindowPartialTaskPlanner`.
  - Keep `WindowModeTaskPlanner` behavior unchanged.

- `packages/localization/src/job/TaskPlanner.test.ts`
  - Add physical scan-window and request-key tests.

- `packages/localization/src/job/TranslationJobRunner.ts`
  - Use `planJob` when a planner supports it.
  - Keep the existing `plan(pendingUnits)` fallback for all current planners.

- `packages/localization/src/job/TranslationJobRunner.test.ts`
  - Verify job-aware planning sees full job order and completed results.

- `packages/localization/src/fileTranslationJobAdapter.ts`
  - Select `WindowPartialTaskPlanner` when `options.requestMode` is
    `window-partial`; otherwise select existing `WindowModeTaskPlanner`.
  - Keep same-file `maxConcurrency: 1`.

- `packages/localization/src/fileTranslationJobAdapter.test.ts`
  - Cover request-mode planner selection and resume fingerprint behavior.

- `packages/localization/src/LocalizationEngine.ts`
  - Instantiate and route to the partial strategy when the task/request mode is
    `window-partial`.
  - Preserve `translateUnits` legacy strategy behavior.

- `packages/localization/src/LocalizationEngine.test.ts`
  - Add integration coverage for partial windows with existing targets.

- `packages/localization/src/LocalizationInspector.ts`
  - Compose no-provider `window-partial` prompt artifacts.

- `packages/localization/src/LocalizationInspector.test.ts`
  - Add inspect coverage for request ids and read-only context counts.

- `packages/localization/src/cli/translateFileCommand.ts`
  - Accept and pass `requestMode`.

- `apps/cli/src/commands/translateFileCommand.ts`
  - Parse `--request-mode window|window-partial`.
  - Update help text.

- `apps/cli/src/cli.test.ts`
  - Add CLI parser/help coverage.

- `DOCS/agent-first/MT_MODULE.md`
  - Document `window-partial` as opt-in and explain fallback to `window`.

- `DOCS/agent-first/CLI.md`
  - Document `--request-mode`.

Do not modify:

- `apps/desktop/**` unless TypeScript proves an import type must be adjusted.
- Provider catalog or AI transport behavior.
- TM/TB ranking.

---

### Task 1: Add Request Mode Types

**Files:**

- Modify: `packages/localization/src/types.ts`
- Modify: `packages/localization/src/job/types.ts`
- Modify: `packages/localization/src/artifacts.ts`

- [ ] **Step 1: Add localization request-mode type**

In `packages/localization/src/types.ts`, add:

```ts
export type LocalizationRequestMode = 'window' | 'window-partial';
```

Then add `requestMode?: LocalizationRequestMode` to `TranslateUnitsOptions`.

Do not add `window-partial` to `LocalizationMode`; that type describes content
mode (`standard` / `dialogue`), not request scheduling.

- [ ] **Step 2: Add optional task metadata**

In `packages/localization/src/job/types.ts`, extend `TranslationTask`:

```ts
export interface TranslationTask {
  taskId: string;
  units: JobUnit[];
  requestMode?: 'window' | 'window-partial';
  scanWindowUnits?: JobUnit[];
  requestUnitKeys?: string[];
}
```

Use optional fields so existing `window` and legacy tests remain valid.

- [ ] **Step 3: Extend prompt artifact batch metadata**

In `packages/localization/src/artifacts.ts`, allow:

```ts
mode: 'window' | 'window-partial';
scanWindowCount?: number;
requestCount?: number;
readOnlyContextCount?: number;
```

Keep all new fields optional to avoid breaking existing artifact assertions.
Do not add API keys or new sensitive provider fields. Existing artifact
provider metadata may include non-secret diagnostic fields such as provider id,
name, and base URL; do not expand that surface.

- [ ] **Step 4: Run focused typecheck or affected tests**

Run:

```text
npm test --workspace=packages/localization -- --runInBand
```

If the workspace test runner does not support that exact flag, use the nearest
existing package test command and record the actual command in the final note.

---

### Task 2: Extend Core Window Prompt Without Changing Current Segment Rendering

**Files:**

- Modify: `packages/core/src/project/windowModePromptTypes.ts`
- Modify: `packages/core/src/project/windowModePrompt.ts`
- Modify: `packages/core/src/project/windowModePrompt.test.ts`

- [ ] **Step 1: Add read-only context prompt types**

Add:

```ts
export type WindowModeRequestMode = 'window' | 'window-partial';

export interface WindowModeReadOnlyContextRow {
  role: 'previous' | 'current-existing' | 'next';
  source: string;
  target?: string;
  rowNumber?: number;
}
```

Extend `WindowModePromptBundleBuildParams` with:

```ts
requestMode?: WindowModeRequestMode;
readOnlyContextRows?: WindowModeReadOnlyContextRow[];
```

Keep `previousContext` and `nextContext` for existing `window`.

- [ ] **Step 2: Write prompt tests first**

Add tests that prove:

- `window` prompt output is unchanged for existing inputs.
- `window-partial` renders `Read-only context rows`.
- read-only context text uses neutral target-text wording, not `Do not
  translate`.
- `Rows requiring target text` reuses the same per-current-segment rendering,
  including source, context, TM, concordance, and TB.
- strict JSON placeholder is `<target text>`.

- [ ] **Step 3: Render read-only context rows**

Add a role-based read-only context block:

```text
Read-only context rows. Do not produce output or return ids for these rows.
1. [previous] row 10
Source:
...
Target:
...
```

For `next` rows without target, omit the `Target:` line or use the exact spec
choice consistently. Prefer omission to keep the prompt compact.

- [ ] **Step 4: Keep current segment rendering shared**

Do not fork `buildCurrentSegmentBlock` for `window-partial`. The new mode only
changes which rows become `currentSegments`.

- [ ] **Step 5: Parser remains expected-id driven**

Do not create a new parser. `parseAIWindowModeResponse(content, expectedIds)`
already validates against the dynamic id list and rejects unknown ids.

- [ ] **Step 6: Verify core tests**

Run:

```text
npm test --workspace=packages/core
```

---

### Task 3: Thread Partial Prompt Inputs Through MTModule

**Files:**

- Modify: `packages/localization/src/modules/MTModuleTypes.ts`
- Modify: `packages/localization/src/modules/MTModule.ts`
- Modify: `packages/localization/src/modules/MTModule.test.ts`

- [ ] **Step 1: Extend batch prompt input types**

Add optional `requestMode` and `readOnlyContextRows` to:

- `ComposeBatchPromptInput`
- `PreparedBatchPromptInput`
- `TranslatePreparedBatchPromptInput`

Use the exported core prompt types for the context row shape.

- [ ] **Step 2: Pass fields into core prompt builder**

In `composePreparedBatchPrompt`, pass:

```ts
requestMode: input.requestMode,
readOnlyContextRows: input.readOnlyContextRows,
```

For existing callers that omit the fields, behavior must remain `window`.

- [ ] **Step 3: Preserve artifact metadata for `window`**

For existing `window`, artifact metadata should still include:

- `mode: 'window'`
- `taskId`
- `currentIds`
- previous/next context counts

For `window-partial`, include:

- `mode: 'window-partial'`
- `scanWindowCount`
- `requestCount`
- `readOnlyContextCount`

- [ ] **Step 4: Add MTModule tests**

Cover:

- existing `window` prompt artifacts still pass;
- `window-partial` prompt contains read-only context;
- `batch.currentIds` contains request ids only;
- `requestCount` equals current segment count;
- no API key enters prompt artifacts.

- [ ] **Step 5: Verify localization module tests affected by MTModule**

Run:

```text
npm test --workspace=packages/localization -- MTModule
```

Use the package's actual Vitest filter syntax if needed.

---

### Task 4: Add Job-Aware Window Partial Planner

**Files:**

- Modify: `packages/localization/src/job/TaskPlanner.ts`
- Modify: `packages/localization/src/job/TaskPlanner.test.ts`

- [ ] **Step 1: Add planner interface**

Add a job-aware planner interface without changing `TaskPlanner`:

```ts
export interface JobAwareTaskPlanner extends TaskPlanner {
  planJob(input: {
    job: TranslationJob;
    completedResults: ReadonlyMap<string, UnitResult>;
    targetScope: LocalizationTargetScope;
  }): TranslationTask[];
}
```

Import only types to avoid runtime cycles.

- [ ] **Step 2: Add helper predicates**

Create small helpers in `TaskPlanner.ts`:

- `isCompleted(unit, completedResults)`
- `requiresTargetText(unit, targetScope)`
- `taskRequestKey(unit)`

Use the same unit key shape as `requestModes/shared/unitIdentity.ts`. If
importing that helper creates a clean dependency, prefer reuse. Otherwise add a
tiny local helper and cover it through tests.

- [ ] **Step 3: Implement `WindowPartialTaskPlanner`**

Behavior:

- chunk `job.units` in physical `batchSize` windows;
- `scanWindowUnits` is the physical chunk;
- `task.units` contains scan-window rows not already in `completedResults`;
- `requestUnitKeys` contains rows in `task.units` that require target text;
- skip windows with empty `task.units`;
- assign `requestMode: 'window-partial'`;
- keep task ids stable: `window-partial-task-1`, `window-partial-task-2`, etc.

Do not put already reused or completed rows into `task.units`; the runner uses
`task.units` as the result/checkpoint contract.

For `blank-only`, rows with non-empty `target` are not request rows.

For `overwrite-non-confirmed`, source-bearing rows not already completed are
request rows, matching current `prepareUnit` behavior.

- [ ] **Step 4: Add planner tests**

Cover:

1. fresh rows `1..5` with targets on `2` and `4` produce request keys
   `1,3,5` and scan window `1..5`;
2. resume/completed rows do not collapse physical windows;
3. all rows already targeted creates a skip-only task on fresh run;
4. all rows completed creates no task;
5. `overwrite-non-confirmed` requests existing-target rows;
6. invalid batch sizes still throw through `normalizeWindowModeBatchSize`.

- [ ] **Step 5: Verify planner tests**

Run:

```text
npm test --workspace=packages/localization -- TaskPlanner
```

---

### Task 5: Teach TranslationJobRunner To Use Job-Aware Planners

**Files:**

- Modify: `packages/localization/src/job/TranslationJobRunner.ts`
- Modify: `packages/localization/src/job/TranslationJobRunner.test.ts`

- [ ] **Step 1: Detect `planJob` after checkpoint load**

After checkpoint reuse has populated `resultMap`, choose planning path:

```ts
const targetScope = resolveBatchTargetScope(job.translationOptions?.targetScope);
const tasks = isJobAwarePlanner(this.taskPlanner)
  ? this.taskPlanner.planJob({ job, completedResults: resultMap, targetScope })
  : this.taskPlanner.plan(pendingUnits);
```

Keep current `pendingUnits` fallback exactly as-is for existing planners.

- [ ] **Step 2: Keep retry/fallback behavior task-unit based**

Do not change `executeTaskWithAttempts` fallback semantics. For
`window-partial`, `task.units` includes rows that may become skipped. Existing
`makeFallbackResult` already returns skipped for intrinsically skipped rows.

- [ ] **Step 3: Add runner tests**

Cover:

- a job-aware planner receives full `job.units`, not only pending rows;
- `completedResults` includes reused checkpoint rows before planning;
- non-job-aware planners still receive `pendingUnits`;
- a failed `window-partial` task marks request rows failed while existing
  target rows become skipped through fallback.

- [ ] **Step 4: Verify runner tests**

Run:

```text
npm test --workspace=packages/localization -- TranslationJobRunner
```

---

### Task 6: Build Partial Read-Only Context Selection

**Files:**

- Create or modify:
  `packages/localization/src/requestModes/shared/windowPartialContextBuilder.ts`
- Create or modify:
  `packages/localization/src/requestModes/shared/windowPartialContextBuilder.test.ts`

- [ ] **Step 1: Define output shape**

Return core-compatible rows:

```ts
Array<{
  role: 'previous' | 'current-existing' | 'next';
  source: string;
  target?: string;
  rowNumber?: number;
}>
```

- [ ] **Step 2: Define trusted target lookup**

Trusted target order:

1. `completedResults` target, including reused checkpoint results;
2. `skippedResults` generated during the current task;
3. non-empty `JobUnit.target`.

Ignore failed rows and empty targets for previous/current-existing target
context.

- [ ] **Step 3: Select rows**

Given `job.units`, `scanWindowUnits`, and `requestUnitKeys`:

- previous: up to 5 source-bearing rows before the scan window with trusted
  targets;
- current-existing: rows inside the scan window that are not request rows and
  have trusted targets;
- next: up to 5 source-bearing rows after the scan window, carrying target when
  known and source-only otherwise.

Return rows in prompt order:

```text
previous rows in file order
current-existing rows in file order
next rows in file order
```

- [ ] **Step 4: Add context builder tests**

Cover:

- example `1..5` with `2/4` existing targets;
- previous context uses current-run completed results;
- next context includes target when known and source-only when blank;
- failed previous rows are ignored as target context;
- request rows never appear as read-only context.

---

### Task 7: Add WindowPartialSequentialBatchStrategy

**Files:**

- Create:
  `packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.ts`
- Create:
  `packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.test.ts`

- [ ] **Step 1: Copy the high-level shape from Window Mode strategy**

Start from the existing `WindowModeSequentialBatchStrategy` flow:

```text
resolve references per request row
-> build current segment inputs
-> build context rows
-> call MTModule.translateBatch
-> map response tokens to UnitResult
-> attach artifacts
```

Do not change the existing strategy first. Keep rollback obvious.

- [ ] **Step 2: Filter request rows explicitly**

Only prepared translatable units whose key appears in `task.requestUnitKeys`
should enter `current`.

If `task.requestUnitKeys` is absent, fail fast with a clear error. The partial
strategy should not silently behave like normal `window`.

- [ ] **Step 3: Resolve TM/TB only for request rows**

Read-only context rows do not get per-row TM/TB blocks. They enter only through
`readOnlyContextRows`.

- [ ] **Step 4: Build read-only context rows**

Use:

- `task.scanWindowUnits ?? task.units` as the physical scan window fallback;
- `input.context.job.units` as full job order;
- merged completed results including `input.skippedResults`;
- `task.requestUnitKeys` as the request row set.

- [ ] **Step 5: Call MTModule with partial mode fields**

Pass:

```ts
requestMode: 'window-partial',
readOnlyContextRows,
current: requestRowsOnly,
```

Keep `taskId`, provider config, model, reasoning effort, and language metadata
consistent with existing Window Mode.

- [ ] **Step 6: Map response results**

Map only request rows to translated results. Skipped existing-target rows are
already produced by `LocalizationEngine.executeTranslationTask` before strategy
execution.

- [ ] **Step 7: Add strategy tests**

Cover:

1. provider receives only rows `1,3,5` when `2,4` have targets;
2. prompt input includes `2,4` as `current-existing`;
3. response mapping returns translated results only for request rows;
4. artifacts use `mode: 'window-partial'`;
5. unknown or missing response ids still fail through MTModule parser;
6. project type `custom` uses empty references like existing Window Mode;
7. absent `requestUnitKeys` fails clearly.

---

### Task 8: Wire File Job Planner And LocalizationEngine

**Files:**

- Modify: `packages/localization/src/fileTranslationJobAdapter.ts`
- Modify: `packages/localization/src/fileTranslationJobAdapter.test.ts`
- Modify: `packages/localization/src/LocalizationEngine.ts`
- Modify: `packages/localization/src/LocalizationEngine.test.ts`

- [ ] **Step 1: Select planner by request mode**

In `translateSpreadsheetFileJob`, use:

```ts
const requestMode = input.options?.requestMode ?? 'window';
const taskPlanner =
  requestMode === 'window-partial'
    ? new WindowPartialTaskPlanner({ batchSize: input.options?.batchSize })
    : new WindowModeTaskPlanner({ batchSize: input.options?.batchSize });
```

Keep forced same-file `maxConcurrency: 1`.

- [ ] **Step 2: Include request mode in resume fingerprint**

Add `['requestMode', input.options?.requestMode ?? 'window']` to file
translation resume fingerprint. A partial-mode run must not reuse a checkpoint
created by normal `window` unless explicitly compatible by design later.

- [ ] **Step 3: Instantiate partial strategy in `LocalizationEngine`**

Add a private `windowPartialStrategy`.

Route in `executeTranslationTask`:

```ts
if (task.requestMode === 'window-partial' || translationOptions?.requestMode === 'window-partial') {
  return this.windowPartialStrategy.translate(...);
}
```

Prefer `task.requestMode` when present because the planner owns task shape.

- [ ] **Step 4: Preserve skip-only behavior**

If `preparedUnits` contains no translatable units, continue returning skipped
results without a provider call. This covers scan windows where every row has a
trusted target.

This path must also avoid provider config resolution so skip-only runs do not
require a valid provider key.

- [ ] **Step 5: Add file job adapter tests**

Cover:

- default request mode selects existing `WindowModeTaskPlanner`;
- `requestMode: 'window-partial'` selects `WindowPartialTaskPlanner`;
- resume fingerprint differs between `window` and `window-partial`;
- batch size is still propagated.

- [ ] **Step 6: Add engine integration tests**

Use mocked AI transport and a workbook-like job fixture:

1. rows `1..5`, targets on `2` and `4`;
2. provider sees expected ids `1,3,5` only;
3. user prompt contains read-only context rows for `2,4`;
4. final output keeps targets for `2,4`;
5. summary reports `translated: 3`, `skipped: 2`;
6. provider failure keeps `2,4` skipped and marks `1,3,5` failed;
7. default `window` test still expects dense current ids.

---

### Task 9: Add Inspect Support

**Files:**

- Modify: `packages/localization/src/LocalizationInspector.ts`
- Modify: `packages/localization/src/LocalizationInspector.test.ts`

- [ ] **Step 1: Add request mode handling**

Inspector should accept `options.requestMode`. Default remains `window`.

- [ ] **Step 2: Compose physical partial windows**

For `window-partial`, inspect should:

- chunk source-bearing rows by physical batch size;
- determine request rows by target scope;
- include current-existing rows as read-only context;
- compose prompt artifacts without provider calls.

Keep the current distinction between inspector ids and engine/provider ids
deliberate. Inspector artifacts may use inspect-local row ids, while real file
translation provider ids are document-qualified through the existing
`batchResponseId` helper.

- [ ] **Step 3: Preserve normal inspect behavior**

Existing `window` inspect output should remain unchanged except for optional
artifact metadata fields that are absent by default.

- [ ] **Step 4: Add inspect tests**

Cover:

- prompt artifact `batch.mode` is `window-partial`;
- requested ids exclude existing-target rows;
- read-only context count includes current-existing rows;
- TM/TB counts are collected only for request rows;
- no provider secrets appear in inspect output.

---

### Task 10: Add CLI Request Mode

**Files:**

- Modify: `packages/localization/src/cli/translateFileCommand.ts`
- Modify: `apps/cli/src/commands/translateFileCommand.ts`
- Modify: `apps/cli/src/cli.test.ts`
- Modify: `DOCS/agent-first/CLI.md`

- [ ] **Step 1: Add command config field**

In localization CLI command config, add:

```ts
requestMode?: 'window' | 'window-partial';
```

Pass it into `TranslateFileInput.options`.

- [ ] **Step 2: Parse `--request-mode` in `momocat`**

Accept only:

- `window`
- `window-partial`

Error message:

```text
--request-mode must be window or window-partial.
```

- [ ] **Step 3: Update help text**

Document:

```text
--request-mode <mode>            window or window-partial.
```

Keep examples defaulting to no flag so the safe fallback remains obvious.

- [ ] **Step 4: Add CLI tests**

Cover:

- `--request-mode window-partial` reaches `runTranslateFileCommand`;
- `--request-mode window` reaches config;
- unknown values fail clearly;
- `--request-mode=value` syntax works if other options support equals syntax;
- help includes the flag.

---

### Task 11: Update Agent-Facing MT Docs

**Files:**

- Modify: `DOCS/agent-first/MT_MODULE.md`
- Modify: `DOCS/agent-first/CLI.md`

- [ ] **Step 1: Document request modes**

Add a short section:

```text
Request modes:
- window: default dense Window Mode.
- window-partial: opt-in physical scan window with dynamic request rows.
```

- [ ] **Step 2: Document prompt contract**

State:

- read-only context rows are context only;
- rows requiring target text reuse existing Window Mode current segment
  rendering;
- response ids are dynamic and request-only.

- [ ] **Step 3: Document rollback**

Rollback command shape:

```text
momocat translate file ... --request-mode window
```

---

### Task 12: Verification

**Targeted tests:**

- [ ] `npm test --workspace=packages/core`
- [ ] `npm test --workspace=packages/localization -- TaskPlanner`
- [ ] `npm test --workspace=packages/localization -- TranslationJobRunner`
- [ ] `npm test --workspace=packages/localization -- MTModule`
- [ ] `npm test --workspace=packages/localization -- WindowPartialSequentialBatchStrategy`
- [ ] `npm test --workspace=packages/localization -- LocalizationEngine`
- [ ] `npm test --workspace=packages/localization -- LocalizationInspector`
- [ ] `npm test --workspace=apps/cli`

**Build/typecheck:**

- [ ] `npm run build --workspace=packages/core`
- [ ] `npm run build --workspace=packages/localization`
- [ ] `npm run build:cli`

**Architecture gate:**

- [ ] Run the existing architecture gate if the current branch expects it.

**Smoke tests:**

- [ ] Run the standard local smoke with default `window`.
- [ ] Run a partial-mode smoke using a copied fixture with some target cells
  pre-populated and `--request-mode window-partial`.
- [ ] Inspect artifacts to confirm provider requests include only request rows
  and prompt context includes current-existing read-only rows.

Smoke configuration must stay local and ignored. Do not commit real local
paths, provider base URLs, provider IDs, model names, API keys, or project
names.

---

## Completion Criteria

The implementation is complete when:

1. `window` remains the default and existing Window Mode tests pass.
2. `window-partial` is opt-in through API and CLI.
3. Rows with existing targets inside a physical scan window become read-only
   context under `blank-only`.
4. Provider calls include only rows requiring target text.
5. Provider response validation expects only request ids.
6. Current segment prompt rendering is shared with existing Window Mode.
7. Read-only prompt wording uses neutral target-text language.
8. Resume does not collapse physical scan windows.
9. Inspect can compose partial-mode prompt artifacts without provider calls.
10. Targeted tests, build, and smoke verification are recorded.

---

## Known Risks

1. **`task.units` has existing semantics.** It is used by runner fallback,
   normalization, events, checkpoints, and snapshots. Keep `scanWindowUnits`
   and `requestUnitKeys` optional metadata rather than redefining `units`.
2. **Resume planning can collapse windows.** The job-aware planner must plan
   from full job order, not only pending units.
3. **Prompt wording can confuse response ids.** Read-only context rows must not
   expose ids that look like response ids.
4. **Existing `window` tests are regression guards.** If many existing prompt
   snapshots change, stop and review whether shared code leaked partial-mode
   wording into normal Window Mode.
5. **Skip-only windows can accidentally require provider setup.** Keep provider
   config resolution after the "has request rows" check.
6. **Inspector ids and provider ids differ.** Preserve the existing distinction
   unless a separate design says to unify them.
7. **Smoke configs may contain secrets.** Keep all real smoke values in ignored
   local files.
