# Window Partial Mode Design

## Purpose

Define an opt-in derivative of Window Mode for file translation jobs where some
target rows are already populated.

The existing `window` behavior remains available as the fallback path. The new
mode is named `window-partial` in this spec. It preserves the physical 5-row
scan window, but sends only the rows that still need translation to the MT
provider.

## Decision

`window-partial` is a request-mode variant, not a replacement for the current
Window Mode.

```text
window
  -> current behavior
  -> task batches are dense current rows
  -> provider response is expected for every current row

window-partial
  -> physical scan windows remain 1..5 source-bearing rows
  -> rows with existing targets become read-only context
  -> provider response is expected only for request rows
```

The prompt should not expose the engine's internal split between scan windows,
request units, skipped results, checkpoints, and artifacts. For the LLM, the
prompt has only two roles:

1. Read-only context rows.
2. Rows to translate.

This keeps the task simple: context is reference material, and only the listed
request ids need JSON output.

## Goals

1. Preserve the current Window Mode behavior and rollback path.
2. Keep a physical scan window of up to 5 source-bearing rows.
3. Dynamically request only rows that need translation under the target-scope
   policy.
4. Include already translated rows inside the current scan window as read-only
   context.
5. Include previous and next context around the scan window without requiring
   provider output for those rows.
6. Validate provider responses against the dynamic request id set only.
7. Keep per-unit checkpoint, event, snapshot, output, and artifact behavior
   understandable.

## Non-Goals

1. Do not remove or silently change the existing `window` mode.
2. Do not change the legacy desktop app flow.
3. Do not redesign TM, concordance, or TB ranking.
4. Do not ask the model to reason about skipped, reused, checkpointed, or
   completed unit states.
5. Do not expose read-only context row ids as response ids.
6. Do not add same-file provider concurrency for this mode.

## Terms

- `scanWindowUnits`: the physical file-order window, up to `batchSize` rows,
  defaulting to 5.
- `requestUnits`: rows inside the scan window that need provider output.
- `readOnlyContextRows`: previous rows, current-window existing target rows,
  and next rows used only as context.
- `currentExistingRows`: rows inside the scan window that have a trusted target
  and should not be sent for translation.
- `expectedResponseIds`: response ids derived only from `requestUnits`.

## Prompt Contract

The model-facing prompt should be organized by role, not by internal engine
concept.

```text
Batch
Source language: <srcLang>
Target language: <tgtLang>
Request mode: window-partial
Return translations for ids: <request id list>

Read-only context rows. Do not translate or return these rows.
1. [previous] row <display row>
Source:
<source>
Target:
<target>

2. [current-existing] row <display row>
Source:
<source>
Target:
<existing target>

3. [next] row <display row>
Source:
<source>
Target:
<target if known, otherwise omitted or marked empty>

Rows to translate. Return exactly these ids.

Segment 1
id: <response id>
Source:
<marker-preserved source>

TM References:
<this segment's TM references only>

Concordance Suggestions:
<this segment's concordance suggestions only>

Terminology References:
<this segment's TB references only>

Context:
<this segment's row/file context, if present>

Strict JSON format
Return exactly: {"translations":[{"id":"<id>","text":"<translation>"}]}
The translations array must include exactly one object for each requested id.
Do not include read-only context rows.
```

### Prompt Rules

1. The phrase "current segments" should be avoided for read-only rows. It is
   reserved for rows to translate in the existing Window Mode prompt and can
   confuse the response contract.
2. Read-only context rows should be ordered in file order and labeled by role:
   `previous`, `current-existing`, or `next`.
3. Only rows to translate should expose response ids.
4. TM, concordance, and TB references remain per request row only.
5. Current-window existing rows should not receive TM, concordance, or TB
   blocks.
6. Next context may include target text when the source file or completed
   results already provide one. Otherwise it remains source-only.

## Response Contract

`expectedResponseIds` is the dynamic id list from `requestUnits`.

The parser must:

1. require strict JSON;
2. require the top-level `translations` field only;
3. reject missing request ids;
4. reject duplicate request ids;
5. reject unknown ids, including ids from read-only context rows;
6. preserve response ordering by mapping back to `expectedResponseIds`;
7. require at least one request id when a provider call is made.

If a scan window has no request rows, no provider call should be made.

## Planning Model

The important design split is:

```text
scan window:   rows 1, 2, 3, 4, 5
request rows:  rows 1,    3,    5
context rows:        2,    4
```

`window-partial` needs a job-aware planner because resume and checkpoint reuse
can remove rows from the pending set. Planning over only pending rows would
collapse the physical window:

```text
wrong after resume: rows 1, 3, 5, 6, 7
right after resume: scan window rows 1, 2, 3, 4, 5
```

Recommended internal shape:

```ts
interface TranslationTask {
  taskId: string;
  units: JobUnit[];
  scanWindowUnits?: JobUnit[];
  requestUnitKeys?: string[];
  requestMode?: 'window' | 'window-partial';
}
```

Semantics:

- `scanWindowUnits` is the physical window used for prompt context.
- `requestUnitKeys` identifies the subset that needs MT output.
- `units` remains the set of pending rows for which this task may produce new
  results. On a fresh run it can include skipped existing-target rows so they
  are checkpointed as skipped. On resume it excludes rows already present in
  the completed result map.

To avoid changing existing `window` behavior, add a job-aware planner interface
instead of changing every planner's assumptions:

```ts
interface JobAwareTaskPlanner extends TaskPlanner {
  planJob(input: {
    job: TranslationJob;
    completedResults: ReadonlyMap<string, UnitResult>;
    targetScope: LocalizationTargetScope;
  }): TranslationTask[];
}
```

`TranslationJobRunner` can use `planJob` when a planner provides it, otherwise
it keeps the current `plan(pendingUnits)` path.

## Execution Flow

For each scan window:

1. Build `scanWindowUnits` from full job order.
2. Build `task.units` from scan-window rows that are not already completed or
   reused.
3. Build `requestUnitKeys` from rows in the scan window that need translation
   under target scope and are not already completed or reused.
4. If `task.units` is empty, skip the task.
5. If `requestUnitKeys` is empty, execute a skip-only task and make no provider
   call.
6. Prepare `task.units` as today:
   - blank source rows remain skipped before file job units are created;
   - existing target rows under `blank-only` become skipped results;
   - request rows become translatable prepared units.
7. Build read-only context from:
   - up to 5 previous rows with trusted targets;
   - current scan-window rows with trusted targets that are not request rows;
   - up to 5 next rows, carrying target when known.
8. Send only request rows to `MTModule.translateBatch`.
9. Parse and validate only `expectedResponseIds`.
10. Return translated results for request rows and skipped results for
    skipped existing-target rows.

## Context Source Rules

Trusted target text can come from:

1. completed results from the current run;
2. reused checkpoint results;
3. skipped results generated from non-empty existing target cells;
4. non-empty `JobUnit.target` for next rows that have not been processed yet.

Failed rows and rows without target text are not previous/current-existing
target context. They may still appear as next source context if they are after
the scan window.

## Target Scope

For `blank-only`:

- non-empty target rows inside the scan window are read-only context;
- blank target rows inside the scan window are request rows.

For `overwrite-non-confirmed`:

- all source-bearing rows that are not completed or reused are request rows
  unless a later confirmed-state concept says otherwise;
- current-window existing target rows usually do not become read-only context,
  because they are being overwritten.

This keeps `window-partial` aligned with the existing `prepareUnit` behavior.

## MT Module Changes

Extend the Window Mode prompt input types in `@cat/core/project`:

```ts
interface WindowModeReadOnlyContextRow {
  role: 'previous' | 'current-existing' | 'next';
  source: string;
  target?: string;
  rowNumber?: number;
}

interface WindowModePromptBundleBuildParams {
  requestMode?: 'window' | 'window-partial';
  readOnlyContextRows?: WindowModeReadOnlyContextRow[];
  currentSegments: WindowModeCurrentSegment[];
}
```

The existing `previousContext` and `nextContext` fields can either be kept for
`window` and adapted into `readOnlyContextRows`, or gradually migrated behind a
small compatibility mapper. The public prompt contract should stay role-based
for `window-partial`.

`PromptArtifact.batch` should record enough diagnostic shape without leaking
sensitive data:

```ts
batch: {
  mode: 'window-partial';
  taskId: string;
  currentIds: string[];
  scanWindowCount: number;
  requestCount: number;
  readOnlyContextCount: number;
}
```

## CLI And API Shape

Use an explicit request-mode option so agents can choose the safe fallback:

```text
momocat translate file ... --request-mode window
momocat translate file ... --request-mode window-partial
```

Recommended type:

```ts
export type LocalizationRequestMode = 'window' | 'window-partial';

interface TranslateUnitsOptions {
  requestMode?: LocalizationRequestMode;
}
```

Do not overload `LocalizationMode`; it currently means project/content mode
such as `standard` or `dialogue`, not MT request scheduling.

Default behavior should remain `window` until `window-partial` passes targeted
tests and the standard smoke test.

## Inspect Mode

`LocalizationInspector` should be able to compose `window-partial` prompt
artifacts without provider calls.

Inspect output should show:

- request mode;
- scan window count;
- requested ids;
- read-only context count;
- prompt character counts;
- TM/TB counts for request rows only.

It should not include API keys or provider secrets.

## Test Plan

Core prompt tests:

1. Builds a `window-partial` prompt with read-only context rows and request rows.
2. Does not expose read-only row ids as expected response ids.
3. Includes TM, concordance, and TB blocks only under request rows.
4. Parser accepts exactly the dynamic request id set.
5. Parser rejects extra context ids.

Planner tests:

1. Fresh run with rows `1..5`, existing targets on `2` and `4`, creates one
   scan window with request keys `1,3,5`.
2. Resume run with completed results for `2` and `4` still preserves the
   physical scan window `1..5`.
3. All rows in a scan window have existing targets: creates a skip-only task on
   fresh run and no provider request.
4. Completed or reused rows are not duplicated in `task.units`.

Strategy and engine tests:

1. Provider receives only `1,3,5` for the example window.
2. Prompt includes `2` and `4` as `current-existing` read-only context with
   source and target.
3. Response validation expects only `1,3,5`.
4. Output preserves existing targets for `2` and `4`.
5. Summary counts translated rows and skipped rows correctly.
6. Provider failure marks request rows failed while existing-target rows remain
   skipped.
7. Next context includes target when known and source-only rows when target is
   blank.

CLI tests:

1. `--request-mode window-partial` parses and reaches localization options.
2. Unknown request modes fail with a clear message.
3. Help text documents both `window` and `window-partial`.

Smoke test:

1. Run the standard local translate smoke with `--request-mode window` to prove
   fallback still works.
2. Run the same smoke fixture with `--request-mode window-partial` after
   preparing a copy with some target cells already populated.
3. Compare artifacts to confirm provider requests only contain blank target
   rows from each scan window.

## Rollback

Rollback is operationally simple:

```text
--request-mode window
```

No database schema migration is required. The output file, checkpoint JSONL,
event JSONL, and artifact JSONL formats should remain compatible, with only the
optional prompt artifact batch metadata gaining `mode: 'window-partial'`.

## Implementation Sequence

1. Add request-mode types and CLI parsing.
2. Add core prompt support for role-based read-only context rows.
3. Add `WindowPartialTaskPlanner` as a job-aware planner.
4. Teach `TranslationJobRunner` to use `planJob` when available.
5. Add `WindowPartialSequentialBatchStrategy`, or extend the existing Window
   strategy only if the branch stays small and readable.
6. Wire `LocalizationEngine` and `LocalizationInspector` by request mode.
7. Add tests from the test plan.
8. Run targeted package tests.
9. Run the standard translate smoke in both fallback and partial modes.

## Open Implementation Notes

1. Prefer a separate `WindowPartialSequentialBatchStrategy` if it keeps the
   existing Window Mode stable and makes rollback obvious.
2. Reuse strict JSON parsing with a dynamic expected id list.
3. Keep all prompt and parser logic in `@cat/core`.
4. Keep orchestration in `@cat/localization`.
5. Keep CLI as a thin argument layer over `@cat/localization`.
