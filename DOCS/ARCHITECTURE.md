# Architecture

## System shape

momoCAT is a monorepo with two application surfaces and three shared packages:

```text
apps/cli ───────────> @cat/localization ─────> @cat/db ─────> @cat/core
                              │                    │
                              └────────────────────┴────────> @cat/core

apps/desktop ───────> @cat/localization
       │────────────> @cat/db
       └────────────> @cat/core
```

The CLI is deliberately thin. The desktop is a richer application host and currently consumes all three shared packages directly. Shared headless behavior belongs in `@cat/localization`; desktop-only UI and lifecycle behavior belongs under `apps/desktop`.

## Workspace ownership

### `apps/desktop`

The Electron application owns windows, IPC, desktop lifecycle, project editing, UI state, local file dialogs, background jobs, and native packaging.

Its internal dependency direction is:

```text
renderer -> typed preload API -> IPC handlers -> services/modules -> adapters/shared packages
```

- `renderer` owns presentation and transient UI state. It must not access Node.js or SQLite directly.
- `preload` exposes the typed `DesktopApi` and stays mechanical.
- IPC handlers validate the transport boundary and delegate; they do not own domain workflows.
- Main-process services/modules coordinate transactions, jobs, workers, and shared packages.
- Adapters translate desktop service ports to `CATDatabase` and other infrastructure.
- Workers handle expensive import, sync, and reference work without blocking the Electron main thread.

Desktop file translation has both legacy single-unit workflows and adapters over the shared localization engine. Keep the boundary explicit when moving behavior; do not silently give the desktop a second implementation of a shared request contract.

### `apps/cli`

The `momocat` executable owns:

- argument parsing and help;
- database/runtime path resolution;
- stdout/stderr formatting and exit codes;
- delegation to command APIs exported by `@cat/localization`.

It must not import `@cat/db`, `@cat/core`, or desktop internals directly. This rule is enforced by the architecture gate.

### `packages/localization`

The shared orchestration layer owns:

- external file adapters and transient units;
- inspect and reference-export workflows;
- request-mode planning and resumable jobs;
- checkpoints, events, snapshots, audit records, and optional artifacts;
- `LocalizationEngine` plus TM, TB, MT, provider, and Runtime TM modules;
- engine composition, unit preparation, and resume fingerprint collaborators behind the `LocalizationEngine` facade;
- SQLite adapters used by command-facing APIs.

It may depend on `@cat/db` and focused `@cat/core` entrypoints. It must not depend on either application.

### `packages/db`

The persistence package owns the canonical current SQLite schema, schema validation/maintenance, repositories, and the `CATDatabase` facade. Large repository workflows may delegate to focused collaborators, such as `TMSyncRepo`, while `CATDatabase` and `TMRepo` preserve their public contracts. It depends on pure contracts from `@cat/core`, not on app or localization code.

### `packages/core`

The leaf package owns pure domain types and algorithms: tokens, projects, tag/protected-marker handling, text normalization/hashes, QA, prompts, strict response parsing, and request contracts.

Repository code should prefer focused entrypoints (`@cat/core/models`, `/project`, `/tag`, `/text`, `/qa`) over the compatibility root barrel.

## Major flows

### Desktop segment edit and confirmation

1. The renderer edits token-backed target state through the typed preload API.
2. IPC delegates to `SegmentService`.
3. `SegmentService` applies the segment update, file statistics, repeat propagation, and optional Working TM upsert in one transaction.
4. Post-commit events refresh renderer state and invalidate reference caches when Working TM changed.

For translation projects, the first confirmed occurrence of a repeated source in a file can lead later followers. A manual divergence detaches that later occurrence. Review/custom projects do not commit to Working TM or run translation repeat propagation.

### Headless file translation

1. CLI parsing produces a typed command config.
2. A localization command opens `CATDatabase`, resolves the project/provider, and reads the external workbook.
3. File adapters create document-qualified units and resolve the target baseline.
4. A request-mode strategy plans ordered tasks.
5. `LocalizationEngine` delegates composition to its assembly, obtains TM/TB context, and asks the MT module boundary for validated target tokens.
6. The job writes per-unit checkpoint/event state, throttled snapshots, and final workbook output.

Resume truth is the checkpoint, not diagnostic artifacts or progress events.

### Reference lookup and resource changes

TM/TB services provide the shared matching semantics. Desktop adapters may run reference lookups or exports in workers. Mount/import/sync/Working-TM changes publish invalidation events so renderer caches do not continue serving stale references.

### TM/TB external-file sync

The desktop stores link configuration in `app_settings`. TB sync parses the linked sheet, then mirrors it by clearing and rewriting the TB in one transaction. Large TM sync runs in a worker, stages normalized rows in SQLite, diffs them against the TM, and applies bounded transactions. `TMRepo` keeps the facade methods while `TMSyncRepo` owns staging/diff/apply SQL. Missing-file, cancellation, and destructive-delete behavior stay explicit at the service/UI boundary.

## Stable boundary rules

1. CLI code delegates to `@cat/localization`; it does not recreate domain logic.
2. Renderer code never reaches the filesystem, Electron shell, provider transport, or database directly.
3. IPC schemas and preload APIs change together and receive boundary tests.
4. Pure prompt, parsing, tag, text, and QA behavior belongs in `@cat/core`.
5. File parsing, job execution, and TM/TB/MT modules remain separable.
6. Results are correlated by document and unit identity, never response array position.
7. Secrets never enter checkpoints, events, inspect output, audit records, tracked docs, or logs.
8. Provider artifacts are opt-in because rendered prompts can contain private text.
9. Expensive spreadsheet/reference work uses bounded paging, chunked transactions, or workers.
10. A persistent-shape change follows the schema protocol in [Data model](DATA_MODEL.md).

## Guardrails and entrypoints

| Concern                      | Source                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture rules           | [`DOCS/architecture/GATE05_GUARDRAILS.json`](architecture/GATE05_GUARDRAILS.json)                                                     |
| Architecture gate            | [`scripts/gate-architecture-check.mjs`](../scripts/gate-architecture-check.mjs)                                                       |
| Desktop composition root     | [`apps/desktop/src/main/index.ts`](../apps/desktop/src/main/index.ts)                                                                 |
| Typed desktop API            | [`apps/desktop/src/shared/ipc.ts`](../apps/desktop/src/shared/ipc.ts)                                                                 |
| Desktop service facade       | [`apps/desktop/src/main/services/ProjectService.ts`](../apps/desktop/src/main/services/ProjectService.ts)                             |
| Segment transaction workflow | [`apps/desktop/src/main/services/SegmentService.ts`](../apps/desktop/src/main/services/SegmentService.ts)                             |
| CLI dispatcher               | [`apps/cli/src/cli.ts`](../apps/cli/src/cli.ts)                                                                                       |
| Shared engine facade         | [`packages/localization/src/LocalizationEngine.ts`](../packages/localization/src/LocalizationEngine.ts)                               |
| Shared engine composition    | [`packages/localization/src/engine/LocalizationEngineAssembly.ts`](../packages/localization/src/engine/LocalizationEngineAssembly.ts) |
| DB facade/schema             | [`packages/db/src/index.ts`](../packages/db/src/index.ts), [`packages/db/src/currentSchema.ts`](../packages/db/src/currentSchema.ts)  |
| Core public slices           | [`packages/core/src`](../packages/core/src)                                                                                           |

Run `npm run gate:arch` after changing any of these boundaries.
