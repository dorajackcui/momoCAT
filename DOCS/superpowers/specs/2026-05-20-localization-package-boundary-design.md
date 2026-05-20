# Localization Package Boundary Design

## Status

Completed migration design and historical decision record.

This document describes the extraction that created `@cat/localization` and removed the agent-first localization engine from desktop ownership. Do not treat the migration steps below as pending work. For the next MT context-window batch mode, use:

- `DOCS/agent-first/MT_MODULE.md`
- `DOCS/superpowers/specs/2026-05-20-agent-first-cli-mt-next-direction-design.md`

## Purpose

Extract the agent-first CLI/headless localization workflow from the desktop main process into an orthogonal package before adding the new MT batch prompt mode.

The current repository mixes reusable CAT capabilities, SQLite persistence, desktop services, and headless orchestration. This makes future MT work risky because prompt composition, TM/TB lookup, provider dispatch, CLI behavior, and desktop GUI behavior can easily become tangled. The first move should be a boundary cleanup, not a new MT feature.

## Approved Direction

Create a workspace package:

```text
packages/localization
```

The package name should be `@cat/localization`.

It owns headless orchestration:

- `LocalizationEngine`
- `LocalizationInspector`
- file parsing and writing adapters for headless flows
- `TranslationJobRunner`
- checkpoint, event, snapshot, and artifact stores
- headless `TMModule`, `TBModule`, and `MTModule` orchestration adapters
- provider/runtime ports needed by headless translation

The package is independent from `apps/desktop`. Desktop can call it, and CLI scripts can call it, but `@cat/localization` must not import desktop code.

## Package Responsibilities

### `@cat/core`

Pure reusable CAT capabilities.

Allowed responsibilities:

- shared domain models
- tag parsing, protected marker handling, and tag serialization
- tag validation and QA logic
- text serialization, match keys, source hashes, and term matching primitives
- existing prompt template builders
- future TM/TB/MT pure contracts, prompt builders, response parsers, and schema validators

Not allowed:

- SQLite access
- filesystem job side effects
- provider requests
- desktop IPC or UI behavior

### `@cat/db`

SQLite persistence and repository behavior.

Allowed responsibilities:

- current schema bootstrap and validation
- project, file, segment, TM, TB, and settings repositories
- TM/TB candidate recall queries
- SQLite FTS details

Not allowed:

- provider dispatch
- CLI argument parsing
- prompt construction policy beyond persisted settings
- desktop UI or IPC behavior

### `@cat/localization`

Headless orchestration.

Allowed responsibilities:

- inspect project localization readiness
- inspect localization prompt/reference artifacts without provider requests
- translate external files without importing them into project `files` or `segments`
- plan units into tasks
- run tasks with bounded concurrency
- retry tasks and preserve per-unit checkpoint semantics
- write events, checkpoints, snapshots, final output, and optional artifacts
- assemble TM/TB/MT artifacts for a project/unit
- call provider adapters through explicit ports

Not allowed:

- import from `apps/desktop/src/main/*`
- own desktop IPC contracts
- own renderer behavior
- become the source of truth for pure prompt algorithms that belong in `@cat/core`

### `apps/desktop`

Desktop host.

Allowed responsibilities:

- Electron main/preload/renderer
- IPC registration and typed bridge
- renderer UI workflows
- legacy GUI AI workflows until they are intentionally migrated
- desktop-specific wiring for settings, services, and host behavior

Not allowed:

- own agent-first headless engine source after extraction
- be a dependency of `@cat/localization`

### CLI Scripts Or Future `@cat/cli`

Thin command entrypoints.

Allowed responsibilities:

- parse argv
- validate command options
- format stdout/stderr
- set exit codes
- call `@cat/localization`

Not allowed:

- implement TM/TB/MT business logic
- use Vitest tests as command runtime
- own checkpoint, artifact, or prompt behavior

## Dependency Direction

The target dependency direction is:

```text
apps/desktop  -> @cat/localization -> @cat/db -> @cat/core
scripts/CLI   -> @cat/localization -> @cat/db -> @cat/core
```

`@cat/localization` may depend on `@cat/core` and `@cat/db`.

`@cat/localization` must not depend on `apps/desktop`.

If localization needs host-specific behavior, it should receive it through ports or adapters.

## First-Stage Migration Scope

Move these files from:

```text
apps/desktop/src/main/localization
```

to:

```text
packages/localization/src
```

Initial migration set:

- `LocalizationEngine.ts`
- `LocalizationInspector.ts`
- `types.ts`
- `artifacts.ts`
- `transientSegment.ts`
- `spreadsheetFileAdapter.ts`
- `fileTranslationJobAdapter.ts`
- `RequestScheduler.ts`
- `job/*`
- `modules/FileModule.ts`
- `modules/TMModule.ts`
- `modules/TBModule.ts`
- `modules/MTModule.ts`

Move their tests with them, keeping colocated test layout.

Do not add the new MT batch prompt mode during this extraction. The extraction creates the place where that later work can land cleanly.

## Desktop Service Decoupling

Current localization code imports these desktop main services and adapters:

- `apps/desktop/src/main/services/TMService.ts`
- `apps/desktop/src/main/services/TBService.ts`
- `apps/desktop/src/main/services/adapters/Sqlite*Repository.ts`
- `apps/desktop/src/main/services/modules/ai/*`
- `apps/desktop/src/main/services/providers/AIProviderTransport.ts`
- `apps/desktop/src/main/services/ports.ts`

After extraction, `@cat/localization` must not import those paths.

Required decoupling:

- Move or duplicate only the necessary port types into `@cat/localization`.
- Prefer moving reusable SQLite repository adapters into `@cat/db`.
- If moving all repository adapters into `@cat/db` is too broad for the first change, use `@cat/localization/adapters/sqlite` as a temporary headless adapter location.
- Move provider runtime/catalog/transport behavior needed by headless translation into `@cat/localization/providers`, or expose it through explicit ports.
- Leave legacy desktop GUI services in `apps/desktop` until a separate migration is designed.

## Public Capability Placement Rules

Use these placement rules for future work:

```text
Pure capability       -> @cat/core
Persistence           -> @cat/db
Headless orchestration -> @cat/localization
Desktop interaction   -> apps/desktop
CLI arguments         -> scripts or future @cat/cli
```

Examples:

- Protected marker preprocessing and restoration belong in `@cat/core/tag`.
- Tag validation belongs in `@cat/core/qa`.
- Text hashes, match keys, token serialization, and term matching primitives belong in `@cat/core/text`.
- Future TM ranking or reference selection algorithms belong in `@cat/core/tm` or another core slice if they become pure and reusable.
- Future TB normalization and term ranking belong in `@cat/core/tb` or `@cat/core/text`, depending on final slice shape.
- MT prompt contracts, batch prompt builders, response JSON parsers, and response schema validation belong in `@cat/core/project` initially or a future `@cat/core/mt` slice.
- SQLite schema, repositories, and FTS query behavior belong in `@cat/db`.
- Project/unit TM/TB artifact assembly belongs in `@cat/localization/modules`.
- Provider dispatch and request-level orchestration belong in `@cat/localization`.
- Legacy GUI AI translate/refine/test workflows remain in `apps/desktop` for this phase.

## CLI Runtime Cleanup

The current `translate:file` and `inspect:localization` scripts run real command behavior by spawning Vitest dynamic tests. That should be treated as a temporary bridge.

After extraction:

- `scripts/translate-file.mjs` should call `@cat/localization` directly.
- `scripts/inspect-localization.mjs` should call `@cat/localization` directly.
- `*.cli.test.ts` files should remain tests, not command runtimes.
- `inspect:projects` can remain a standalone script initially, then be moved later if useful.

## Implementation Order

### Step 1: Create The Package And Guardrails

Create:

- `packages/localization/package.json`
- `packages/localization/tsconfig.json`
- `packages/localization/src/index.ts`

Update docs:

- `DOCS/10_ARCHITECTURE.md`
- `DOCS/agent-first/ARCHITECTURE.md`
- `DOCS/agent-first/CLI.md` if command behavior changes

Update architecture guardrails so `packages/localization/src` cannot import `apps/desktop/src/main/*`.

Acceptance:

- `npm run build --workspace=packages/localization` works.
- guardrails reject new localization-to-desktop imports.

### Step 2: Move Headless Job And File Infrastructure

Move the lowest-coupling files first:

- `RequestScheduler`
- `job/*`
- `types.ts`
- `artifacts.ts`
- `transientSegment.ts`
- spreadsheet and file job adapters

Acceptance:

- job runner tests pass in the new package.
- checkpoint, event, artifact, and file adapter tests pass in the new package.
- desktop behavior remains unchanged.

### Step 3: Move Headless Modules, Engine, And Inspector

Move:

- `modules/FileModule`
- `modules/TMModule`
- `modules/TBModule`
- `modules/MTModule`
- `LocalizationEngine`
- `LocalizationInspector`

Resolve dependencies through `@cat/db`, `@cat/core`, and localization-owned ports/adapters.

Acceptance:

- `LocalizationEngine.test.ts` passes from the new package.
- `LocalizationInspector.test.ts` passes from the new package.
- `TMModule.test.ts`, `TBModule.test.ts`, and `MTModule.test.ts` pass from the new package.
- no `packages/localization/src` file imports `apps/desktop/src/main/*`.

### Step 4: Make CLI Scripts Real Entrypoints

Replace Vitest-backed command execution with direct package calls.

Acceptance:

- `npm run inspect:localization -- ...` runs as a real CLI command.
- `npm run translate:file -- ...` runs as a real CLI command.
- command behavior and sidecar outputs remain compatible.

## Validation Requirements

Targeted validation after the full extraction:

```bash
npm run build --workspace=packages/localization
npx vitest run packages/localization/src
npm run inspect:localization -- --help
npm run translate:file -- --help
npm run gate:check
```

Run existing desktop-focused tests only when touched desktop host wiring changes.

## Non-Goals

This design does not:

- implement the new MT context-window batch prompt mode
- redesign the old desktop GUI AI workflow
- migrate all desktop services into packages in one change
- create a separate `@cat/cli` package immediately
- change checkpoint, event, artifact, snapshot, or external file semantics

## Later MT Batch Prompt Design

After this extraction, the MT batch prompt work should use the new boundary:

```text
@cat/core
  defines batch prompt contracts, builders, response parsers, and validation

@cat/localization
  plans 1-5 segment tasks
  assembles previous translated context, next source context, TM, and TB
  calls provider adapters
  maps batch responses back to per-unit results
  writes per-unit checkpoints and artifacts
```

This keeps MT prompt capability reusable while keeping request scheduling and recovery in the headless orchestration layer.
