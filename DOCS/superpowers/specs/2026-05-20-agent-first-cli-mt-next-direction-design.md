# Agent-First CLI MT Next Direction Design

## Purpose

Lock the next development phase before adding the MT context-window batch prompt mode.

The repository has already moved the agent-first localization engine into `@cat/localization` and cleaned the desktop `main/localization` and misleading `main/headless` leftovers. The next work should avoid drifting back into desktop-owned MT behavior or broad refactors. The product center for this branch is now agent-first CLI/headless localization.

## Approved Direction

Proceed in this order:

1. Keep architecture documentation explicit about agent-first + CLI as the next product direction.
2. Implement the new MT context-window batch prompt and request mode.
3. Refactor only when a boundary blocks the MT work or when a pure capability must move to `@cat/core` to stay reusable.

Do not start a broad cleanup of all TM/TB services, all SQLite adapters, or all desktop AI workflows before the MT batch prompt work. Those may be separate later migrations.

## Boundary Rules

Use the same placement rules as the localization package boundary design:

```text
Pure capability        -> @cat/core
Persistence            -> @cat/db
Headless orchestration -> @cat/localization
Desktop interaction    -> apps/desktop
CLI arguments          -> scripts or future @cat/cli
```

The target dependency direction remains:

```text
apps/desktop -> @cat/localization -> @cat/db -> @cat/core
scripts/CLI  -> @cat/localization -> @cat/db -> @cat/core
```

`@cat/localization` must not import desktop main, desktop shared IPC, or renderer code. Desktop can call localization APIs, but desktop must not own new agent-first MT capabilities.

## CLI Product Direction

The next visible workflow is CLI-first:

- `inspect:projects` remains the project readiness check.
- `inspect:localization` remains the no-request prompt/TM/TB artifact inspection path.
- `translate:file` remains the real translation and smoke path.

The old CAT editor UI remains available, but it is not the place to add the new MT batch prompt mode. Legacy desktop AI diagnostics may remain under `apps/desktop/src/main/diagnostics`, but they should be described as desktop diagnostics, not as the agent-first headless engine.

## MT Batch Prompt Shape

The next MT mode translates a small batch of current units per provider request.

Default target shape:

- Each request contains 1 to 5 current source segments.
- Each request includes up to 5 previous translated context units.
- Each request includes up to 5 next source context units.
- Each current unit carries its selected TM references.
- Each current unit carries its selected TB references.
- Each current unit carries stable identifiers so provider responses can map back to `documentId + unitId`.

The prompt should make clear which units require translation and which units are context only. Context units must not require output rows.

## Capability Placement For MT Work

### `@cat/core`

Own pure MT prompt and response capability:

- batch prompt contracts and type definitions
- prompt builder for context-window batch translation
- response JSON schema or shape validator
- response parser that maps provider text into structured batch results
- pure validation helpers that do not need DB, filesystem, provider transport, or checkpoints

If the initial implementation keeps this under `@cat/core/project`, it should be organized so it can later move to a dedicated `@cat/core/mt` slice without changing callers.

### `@cat/localization`

Own headless orchestration:

- plan job units into 1 to 5 unit batch tasks
- collect previous translated context and next source context from file/job units
- call `TMModule` and `TBModule` for the current units
- call `MTModule` or a batch MT module through explicit typed inputs
- run provider requests through the localization-owned transport port
- map batch responses back to per-unit `UnitResult`
- preserve per-unit checkpoint and retry semantics
- write artifacts only for inspect or explicit diagnostic runs

The first batch mode should avoid concurrent provider requests. It may still use the existing task abstraction, but the effective provider request concurrency should be one unless a later design explicitly reintroduces bounded parallelism.

### `scripts`

Own CLI surface only:

- parse `--batch-size` or equivalent options if exposed
- parse context-window options only if they are meant to be user-facing
- format command output and errors
- set exit codes
- call `@cat/localization`

Scripts must not assemble TM/TB references, write prompt policy, parse provider responses, or manage checkpoints directly.

### `apps/desktop`

No new support is required for the old GUI. The desktop app may consume stable localization APIs later, but it should not receive new GUI-specific prompt batching behavior in this phase.

## Request And Recovery Semantics

The request model changes from one current unit per provider request to one small batch per provider request.

Stable requirements:

- Provider response must identify each translated current unit.
- Missing, duplicate, or unknown unit ids are task-level response errors.
- A failed batch task can be retried by the job runner.
- Successfully parsed units are still written as per-unit results and checkpoints.
- Prompt artifacts should include batch metadata only when artifacts are enabled.
- Progress events stay lightweight and should not embed full prompts.

MT-level repair retries, such as tag validation repair, remain distinct from job-level retries.

## Refactor Policy

Refactor only where it directly supports this next MT mode.

Allowed now:

- Move pure prompt contracts/builders/parsers into `@cat/core`.
- Add small core helpers for protected marker or response validation if needed by the batch prompt.
- Add localization task planner/executor types for grouped units.
- Keep legacy desktop diagnostics clearly named and isolated.

Defer:

- moving all TM/TB ranking logic into `@cat/core`
- moving all SQLite adapters into `@cat/db`
- redesigning old desktop GUI AI workflows
- creating a full `@cat/cli` package
- tightening every `@cat/localization` public export

## Inspect And Smoke Expectations

Before real provider smoke:

1. Run `inspect:localization` with a real project and real spreadsheet.
2. Confirm the generated workbook and JSON sidecar show batch prompt inputs clearly.
3. Confirm context-only units are distinguishable from current units.
4. Confirm TM/TB references are attached to the correct current units.
5. Confirm no API keys appear in inspect artifacts.

Real `translate:file` smoke should be used only when sending source text, TM/TB references, and context to the configured provider is intended.

## Next Plan Target

The next implementation plan should focus on MT context-window batch mode:

- core contracts, builder, parser, and validator
- localization batch task planning
- localization batch prompt artifact shape
- sequential provider request execution
- per-unit checkpoint/result preservation
- inspect-first smoke, then optional real translation smoke

This plan should not include broad architecture cleanup beyond the blockers discovered while implementing this MT mode.
