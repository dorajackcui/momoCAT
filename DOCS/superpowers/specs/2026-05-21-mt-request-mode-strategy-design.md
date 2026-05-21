# MT Request Mode Strategy Design

## Purpose

Define a clean internal boundary for MT request modes before the next round of
Window Mode and agent-first CLI work.

Legacy concurrent single-unit requests and Window Mode are not the same
implementation detail. They are parallel MT execution strategies. Each strategy
combines a prompt composition policy, a provider request scheduling policy, and
a response-to-unit mapping policy.

The product direction is not parallel, however. Window Mode is the agent-first
default path. Legacy concurrent single-unit mode remains a compatibility path.

## Background

The repository already extracted the agent-first localization engine from the
desktop host into `@cat/localization`. The current boundary direction remains:

```text
Pure capability        -> @cat/core
Persistence            -> @cat/db
Headless orchestration -> @cat/localization
Desktop interaction    -> apps/desktop
CLI arguments          -> scripts or future @cat/cli
```

The current Window Mode implementation has the correct high-level package
placement:

- Pure prompt and strict JSON response parsing live in `@cat/core`.
- Headless task planning and provider orchestration live in `@cat/localization`.
- CLI scripts stay thin and call the localization package.
- The legacy desktop UI is retained but is not the focus of this branch.

The remaining issue is inside `@cat/localization`: `LocalizationEngine` and
`LocalizationInspector` still contain request-mode-specific Window Mode logic.
That makes it too easy for future prompt, request scheduling, inspect, and
artifact behavior to grow back into one large engine class.

## Design Principle

Model MT request modes as strategies:

```text
MT request mode =
  prompt composition strategy
  + request scheduling strategy
  + response mapping strategy
```

This keeps the two current modes conceptually parallel:

```text
LegacySingleUnitConcurrentStrategy
  -> single current segment per prompt
  -> multiple provider requests may run through bounded concurrency
  -> each response maps to one unit result

WindowModeSequentialBatchStrategy
  -> 1..5 current segments per prompt
  -> previous translated context and next source context
  -> one ordered provider request at a time per file
  -> strict JSON response maps to multiple unit results
```

The strategy boundary is internal to `@cat/localization`. It should not become a
new CLI abstraction or desktop IPC concept.

## Proposed Structure

Create a request mode slice under `@cat/localization`:

```text
packages/localization/src/requestModes/
  shared/
    contextWindowBuilder.ts
    references.ts
    results.ts
  legacySingleUnitConcurrent/
    LegacySingleUnitConcurrentStrategy.ts
  windowSequentialBatch/
    WindowModeSequentialBatchStrategy.ts
```

Exact filenames can follow repository style during implementation, but the
ownership should remain clear:

- `shared` contains small helpers only.
- The legacy strategy owns legacy single-unit concurrent request behavior.
- The Window Mode strategy owns ordered context-window batch request behavior.

Avoid a large abstract base class. Shared behavior should be extracted only when
it is small, stable, and obviously common.

## Strategy Responsibilities

Both strategies use the same high-level flow:

```text
prepare current units
-> collect references/context
-> compose prompt input
-> call MT/provider facade
-> map responses to per-unit results/artifacts
```

Strategies may:

- use `TMModule`, `TBModule`, and `MTModule`;
- call pure prompt/response helpers through `MTModule`;
- return task-level results and optional artifacts;
- own request-mode-specific prompt material assembly;
- own request-mode-specific response mapping.

Strategies must not:

- import desktop code;
- read or write SQLite repositories directly;
- parse CLI arguments;
- write checkpoints, events, snapshots, or final XLSX files;
- decide resume behavior from artifacts;
- put API keys in artifacts or inspect output.

The job runner continues to own retry, checkpoint, event, snapshot, and final
output behavior.

## Legacy Single-Unit Concurrent Strategy

This strategy preserves the current compatibility behavior:

- Each translatable unit gets one single-unit prompt.
- Each request returns one translated result.
- Bounded concurrency may be used for multiple single-unit requests.
- Each unit has its own TM, concordance, TB, and row context.
- It does not build previous translated or next source context windows.

This mode should be named so it is not confused with Window Mode batching.
Preferred internal names:

- `LegacySingleUnitConcurrentStrategy`
- `SingleUnitConcurrentStrategy`

Avoid naming it `BatchMode`, because Window Mode batches multiple current
segments into one provider request.

## Window Mode Sequential Batch Strategy

This strategy is the agent-first default for `translate:file` job mode:

- Each task contains 1 to 5 current units.
- Each current unit carries its own TM, concordance, TB, and row context.
- The prompt includes up to 5 previous translated context rows.
- The prompt includes up to 5 next source context rows.
- Same-file provider requests are ordered and sequential.
- Provider responses use strict JSON.
- Results may arrive out of order but must map back to requested response ids.
- Missing, duplicate, or unknown ids are task-level MT errors.
- Per-unit result, checkpoint, event, snapshot, and final output semantics stay
  unchanged.

The previous translated context builder should prefer trusted completed
targets:

- completed results from the current run;
- reused checkpoint targets when resume is active;
- skipped rows with non-empty existing targets.

It should skip failed rows and rows without targets.

Next source context should include later source-bearing rows only. Context rows
are prompt context and must not require provider output.

## `LocalizationEngine` Role

`LocalizationEngine` should become a thinner orchestration shell:

- load project and options;
- resolve localization mode and target scope;
- prepare external units and transient segments;
- choose the request mode strategy;
- create task executors for the job runner;
- delegate request-mode-specific work to strategies.

It should not directly own:

- Window Mode previous/next context construction;
- Window Mode batch response mapping;
- legacy request concurrency details;
- prompt material assembly for any specific request mode.

The engine can still own project-level config resolution and dependency
construction until a separate dependency-injection cleanup is justified.

## `MTModule` Role

`MTModule` remains the provider and prompt-call facade inside
`@cat/localization`.

It may:

- resolve provider configuration;
- compose single-unit and batch prompts through pure `@cat/core` helpers;
- send provider requests through the transport port;
- parse responses through pure `@cat/core` helpers;
- validate tags and protected markers;
- return prompt artifacts.

It should not become the owner of request-mode scheduling. Strategy code should
decide whether requests are single-unit concurrent or Window Mode sequential
batch.

## `LocalizationInspector` Role

`LocalizationInspector` remains the no-provider-request diagnostics path.

It should reuse the same Window Mode context-window helper as translation where
possible, while still composing inspect artifacts without sending requests.

Inspect should continue to show:

- current batch segments;
- per-current-segment TM, concordance, TB, and row context;
- previous translated rows;
- next source rows;
- full system and user prompt artifacts;
- no API keys.

## CLI And Desktop Scope

CLI scripts remain thin:

- parse command arguments;
- format stdout/stderr;
- set exit codes;
- call `@cat/localization`.

Scripts must not assemble request-mode prompts, run TM/TB lookup, parse provider
responses, or write checkpoint logic.

Legacy desktop UI support is retained but not expanded in this branch. New
agent-first MT behavior should be built for CLI/headless first.

## Migration Order

1. Add request mode strategy types and directories.
2. Extract shared Window Mode context-window construction.
3. Move current Window Mode task execution logic out of `LocalizationEngine`
   into `WindowModeSequentialBatchStrategy`.
4. Make `LocalizationEngine` delegate file-job task execution to the Window Mode
   strategy.
5. Move or wrap the legacy single-unit concurrent path into
   `LegacySingleUnitConcurrentStrategy`.
6. Make `LocalizationInspector` reuse the shared context-window helper.
7. Keep public CLI behavior stable and avoid desktop UI changes.

If implementation scope needs to be split, prioritize steps 1 to 4 first. The
legacy strategy wrapper can follow as a second small change, as long as the
design direction is documented and tests protect current behavior.

## Testing

Add or keep focused tests around each boundary.

`contextWindowBuilder`:

- selects up to 5 previous translated rows;
- selects up to 5 next source rows;
- skips current units in context;
- skips empty previous targets;
- keeps context rows free of internal ids.

`WindowModeSequentialBatchStrategy`:

- sends one provider request for a current batch;
- includes per-current-unit TM/TB references;
- includes previous and next context windows;
- maps strict JSON responses back to per-unit results;
- returns per-unit artifacts only when capture is enabled;
- fails the task on missing, duplicate, or unknown response ids.

`LegacySingleUnitConcurrentStrategy`:

- preserves single-unit prompt behavior;
- preserves bounded concurrency behavior;
- maps one response to one unit result;
- does not include Window Mode context windows.

`LocalizationEngine`:

- chooses the expected strategy for file-job execution;
- preserves skipped-unit handling;
- keeps checkpoint/event/final-output behavior delegated to existing job
  surfaces.

`LocalizationInspector`:

- emits Window Mode inspect artifacts without provider requests;
- shows batch prompt inputs clearly;
- omits API keys.

## Smoke Validation

Use inspect before real provider translation.

Representative smoke inputs:

```text
file: C:\Users\yizhi003\Downloads\memoQ<U+4E0A><U+4F20>\vibe\mt.xlsx
db: C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db
project: Nikki(zh-fr)
```

Smoke order:

1. Run `inspect:localization` against the real project and spreadsheet.
2. Confirm current segments are grouped in Window Mode batches.
3. Confirm each current segment has its own TM, concordance, and TB references.
4. Confirm previous context appears as source-to-target pairs.
5. Confirm next context contains source only.
6. Confirm artifacts contain no API keys.
7. Run real `translate:file` only when sending source text and references to the
   configured provider is intended.

## Non-Goals

This design does not:

- rewrite all TM/TB service internals;
- move all repository adapters into `@cat/db`;
- create a full `@cat/cli` package;
- redesign the legacy desktop CAT editor workflow;
- reintroduce same-file provider concurrency for Window Mode;
- change external file formats, checkpoint formats, or final output formats.

## Acceptance Criteria

After implementation:

- Legacy single-unit concurrent mode and Window Mode are represented as parallel
  strategy concepts inside `@cat/localization`.
- Window Mode remains the default agent-first `translate:file` request model.
- `LocalizationEngine` no longer owns Window Mode context construction or batch
  response mapping directly.
- CLI scripts remain thin and desktop UI behavior is not expanded.
- Existing Window Mode prompt/parser tests continue to pass.
- Architecture guardrails continue to prevent localization-to-desktop imports.
