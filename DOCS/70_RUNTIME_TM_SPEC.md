# 70_RUNTIME_TM_SPEC

## Purpose

Design the job-local Runtime TM layer for headless file translation.

Runtime TM lets later Window Mode requests reuse source-target pairs produced
or observed earlier in the same file translation job. It improves same-file
consistency without writing to the user's Working TM, Main TM, or project
database.

## Status

Implemented for headless file translation in `@cat/localization`.

Runtime TM currently runs only for `translateFile()` jobs using
`requestMode=window` or `requestMode=window-partial`. Each file translation job
owns one job-local in-memory TM lifecycle: seed from reusable checkpoint results
on resume, commit eligible translated and skipped task results during the job,
then dispose when the job ends.

Runtime TM keeps independent selection caps of 3 TM matches and 3 concordance
matches alongside the existing persistent caps. Runtime entries do not write to
Working TM, Main TM, or the persistent project database.

Verification uses mocked/local tests only. Do not add real provider config,
base URLs, API keys, local paths, or private prompt/artifact data to docs or
source.

## Scope

Runtime TM is enabled only for headless file translation through
`@cat/localization`.

Enabled:

- `momocat translate file`
- `requestMode=window`
- `requestMode=window-partial`

Disabled:

- Inspect commands.
- Legacy concurrent translation.
- Legacy desktop workflow surfaces.
- Persistent Working TM or Main TM writes.

Desktop may consume this capability later only by calling the shared
`@cat/localization` file translation path.

## Ownership

- `@cat/localization` owns Runtime TM lifecycle, seed, commit, reference
  resolution, selection budgets, and file job integration.
- `@cat/db` owns reusable SQLite schema and repository primitives needed to
  bootstrap an isolated runtime database.
- `@cat/core` owns pure token, text, prompt, and response contracts.
- `apps/cli` owns command parsing only and must not contain Runtime TM logic.
- `apps/desktop` must not be imported by Runtime TM code.

The dependency direction remains:

```text
apps/cli -> @cat/localization -> @cat/db -> @cat/core
apps/desktop -> @cat/localization
```

## Architecture

Each headless file translation job creates one job-local Runtime TM database.
The database is isolated from the user's project database and is disposed when
the job ends, fails, or is cancelled.

```text
file translate job start
  -> create runtime SQLite DB
  -> create runtime project and runtime TM
  -> execute planned window tasks sequentially
  -> after each task completes, commit eligible source-target pairs
  -> later tasks query runtime references plus persistent references
  -> job finish/fail/cancel
  -> dispose runtime DB
```

Runtime TM uses SQLite so recall stays aligned with the persistent TM path.
The runtime repository should reuse the same `TMRepo -> TMService -> TMModule`
matching path where possible, including exact match, fuzzy recall, concordance
recall, scoring, classification, caps, and diversity behavior.

## Modules

Runtime TM should live in an isolated module namespace:

```text
packages/localization/src/runtimeTm/
  RuntimeTMContext.ts
  RuntimeTMDatabase.ts
  RuntimeTMReferenceResolver.ts
  RuntimeTMSelection.ts
  index.ts
```

Suggested responsibilities:

- `RuntimeTMContext`: job-scoped lifecycle, entry count, seed, commit, inspect,
  and dispose.
- `RuntimeTMDatabase`: in-memory SQLite bootstrap and runtime project/TM setup.
- `RuntimeTMReferenceResolver`: persistent plus runtime reference resolution.
- `RuntimeTMSelection`: independent slot selection and merged prompt ordering.

Existing runner and request-mode code should receive narrow interfaces. They
should not know runtime database internals.

## Reference Budgets

Runtime references have independent selection budgets:

```text
runtime TM matches:          max 3
runtime concordance matches: max 3
persistent TM matches:       existing max 3
persistent concordance:      existing max 3
```

Runtime references do not compete with persistent TM references for selection
slots. After independent selection, runtime and persistent references are
merged into the existing prompt blocks:

- TM references render in the normal TM reference block.
- Concordance references render in the normal concordance block.

No separate Runtime TM prompt section should be added. Prompt shape should stay
simple for the provider.

Merged references are ordered by score or rank descending. Runtime references
may use a runtime source label such as `Runtime TM` in artifacts and prompt
reference names, but the model should see them as normal references.

## Window Commit Flow

Runtime TM commit happens after a `TranslationTask` finishes and its results
are normalized near checkpoint/event persistence. It must not happen inside the
MT request strategy immediately after provider response parsing.

Eligible committed rows:

- `translated` results with non-empty source and target.
- `skipped` results with non-empty source and target.

In Partial Window Mode, commit uses the completed physical scan window:

```text
scan physical window
  -> request only rows requiring target text
  -> receive provider results for requested rows
  -> combine requested translated rows with existing-target skipped rows
  -> commit reliable source-target pairs for the window
```

Failed rows and empty source or target rows are never committed to Runtime TM.

## Resume

Runtime TM is not persisted as a sidecar. Normal job completion destroys it.

When a job resumes from checkpoints, Runtime TM is rebuilt during resume
startup from reusable checkpoint results:

- Use `translated` and `skipped` results only.
- Require non-empty source and target.
- Ignore `failed` results.

This cost is paid only for resume runs. Normal runs do not write extra runtime
TM artifacts.

## Performance Guardrails

Version 1 uses an in-memory SQLite runtime database.

Expected file-level usage, including files with around one thousand eligible
rows, should stay small compared with provider request time and normal Node
runtime memory.

Current v1 behavior:

- Default to in-memory SQLite.
- File translation jobs do not wire an append or entry cap yet.
- `RuntimeTMContext` supports an optional cap for tests and future callers, but
  defaults to no cap when `maxEntries` is not provided.
- Do not add temp-file SQLite fallback in v1 unless real workloads require it.

Follow-up behavior, if real workloads need it:

- Stop appending new runtime entries after a conservative cap.
- Continue translating normally when the cap is reached.
- Emit a diagnostic warning when runtime append is disabled by the cap.

## Artifacts And Diagnostics

Prompt rendering should stay merged and simple. Diagnostic artifacts may expose
runtime provenance for debugging, as long as no secrets are written.

Useful artifact signals:

- Runtime reference count.
- Runtime TM selected references.
- Runtime concordance selected references.
- Runtime append count for each completed task.
- Runtime append disabled warning if a future append cap is wired and reached.

Prompt artifacts may contain private source text, target text, and reference
content. They must stay out of tracked docs and source files.

## Tests

Required focused tests:

- Runtime seed and commit include only eligible `translated` and `skipped`
  non-empty pairs.
- Runtime TM and persistent TM each keep independent max 3 selected TM slots.
- Runtime concordance and persistent concordance each keep independent max 3
  selected concordance slots.
- Merged prompt references sort by score or rank.
- Empty Runtime TM skips runtime lookup.
- Window Mode task 2 can use Runtime TM entries committed by task 1.
- Partial Window Mode commits both provider-translated rows and existing-target
  skipped rows from the same physical scan window.
- Resume rebuilds Runtime TM from reusable checkpoint results.
- Runtime TM does not write to the persistent project database.

## Non-Goals

- Do not write Runtime TM entries into Working TM or Main TM.
- Do not expose Runtime TM as a user-managed TM resource.
- Do not enable Runtime TM for inspect in v1.
- Do not enable Runtime TM for legacy concurrent translation.
- Do not add CLI-owned Runtime TM business logic.
