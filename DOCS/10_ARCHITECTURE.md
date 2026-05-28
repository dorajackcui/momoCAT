# 10_ARCHITECTURE

## Purpose

Describe development boundaries, ownership, and dependency direction for shared
localization capability.

This branch is agent-first and CLI-first. New TM/TB/MT behavior should land in
shared packages and headless workflows before legacy desktop UI integration.

## When to Read

Read before changing package boundaries, cross-layer contracts, localization
orchestration, persistence access, or desktop integration points.

## Dependency Direction

```text
apps/cli -> @cat/localization -> @cat/db -> @cat/core
apps/desktop -> @cat/localization
```

`apps/cli` owns the `momocat` app surface only. It may parse arguments, print
help, control stdout/stderr, and call `@cat/localization` command APIs. It must
not import `apps/desktop`, `@cat/db`, or `@cat/core` directly.

`@cat/localization` owns headless localization orchestration: file adapters,
inspect, job planning, checkpoints, events, artifacts, `LocalizationEngine`,
and TM/TB/MT modules.

`@cat/core` owns pure contracts and algorithms. MT prompt builders, strict JSON
response parsers, tag/protected-marker helpers, and shared domain types belong
there when they are pure.

## Desktop Boundary

The desktop app is a peer consumer of shared localization capability, not the
owner of headless localization behavior.

- Renderer code owns view orchestration and UI state.
- Preload code exposes the typed bridge and stays thin.
- Main process services own desktop application orchestration.
- IPC handlers delegate to services and modules instead of holding domain logic.
- Desktop file-level translation remains legacy workflow surface area unless a
  separate migration explicitly moves it onto shared localization APIs.

## CLI Boundary

The CLI package is an app shell around `@cat/localization` command APIs.

- Owns argument parsing, help text, terminal output, and exit behavior.
- Does not own file parsing, job planning, TM/TB/MT behavior, persistence, or
  prompt/response contracts.
- Does not import desktop internals or lower-level shared packages directly.

CLI command syntax and operating procedures belong in `40_CLI_OPERATION.md`.

## Package Boundary

- `@cat/localization`: headless localization orchestration and command-facing
  APIs.
- `@cat/db`: schema bootstrap, validation, repositories, and persistence
  contracts.
- `@cat/core`: pure domain contracts, types, prompt builders, response parsers,
  tag/protected-marker helpers, text helpers, and QA algorithms.

Repo code should import `@cat/core` through focused slice entrypoints where
available. The root package entrypoint is a compatibility surface, not the
preferred internal dependency.

## File Layer

The file layer adapts external inputs and outputs for headless localization.

Responsibilities:

- Read external spreadsheets or other supported file formats.
- Detect source, target, and optional context fields.
- Convert rows into typed localization or job units.
- Preserve source file shape where possible.
- Write final translated files and throttled snapshots.

Non-responsibilities:

- TM matching.
- TB matching.
- MT prompt construction.
- Provider request scheduling.
- Resume decisions.

## Job Layer

The job layer owns resumable execution.

Responsibilities:

- Plan work into translation tasks.
- Run tasks with bounded concurrency.
- Retry failed tasks according to configured attempts.
- Append checkpoints as resume truth.
- Append progress events for observability.
- Trigger snapshot and final-output callbacks.
- Capture diagnostic artifacts only when configured.

Non-responsibilities:

- File format parsing.
- TM/TB business rules.
- Prompt composition.
- Provider-specific request body decisions.

## LocalizationEngine Layer

`LocalizationEngine` coordinates headless localization for external units.

Responsibilities:

- Resolve project configuration through shared package APIs.
- Build transient segments from external units.
- Normalize target baseline before job/request planning.
- Coordinate TM, TB, and MT resource modules.
- Expose file and unit translation APIs for headless callers.

Non-responsibilities:

- Owning external file format details.
- Owning checkpoint storage format.
- Owning progress event persistence.
- Owning CLI command grammar.

## Resource Modules

TM, TB, and MT modules stay independently replaceable behind structured
contracts.

- `TMModule`: inspect mounted TM resources, raw matches, selected references,
  and TM diagnostics.
- `TBModule`: inspect mounted TB resources, raw matches, selected terms, and TB
  diagnostics.
- `MTModule`: compose prompts, resolve request settings, send MT requests,
  validate responses, and return translated tokens.

The MT module consumes structured TM/TB artifacts. TM and TB modules do not know
how prompts are written.

## Runtime Artifacts

| Artifact | Default | Purpose |
| --- | --- | --- |
| Final output file | Yes | User-facing translated file. |
| Checkpoint JSONL | Yes | Resume truth for completed output units. |
| Event JSONL | Yes | Lightweight progress stream for humans, agents, and future services. |
| Snapshot output | Yes, throttled | Partial translated output during long runs. |
| Diagnostic artifacts | No | Opt-in records for inspectability and debugging. |
| Inspect outputs | Inspect only | No-request outputs for module and prompt-contract review. |

Normal runs should stay lightweight. Detailed diagnostics are opt-in.

## Stable Contracts

- File adapters call `LocalizationEngine` or the job layer through typed inputs,
  not through DB side effects.
- Job results are matched by `documentId` and `unitId`, not by array order.
- Checkpoints do not depend on diagnostic artifact files.
- Resume identity includes project and resolved translation policy
  fingerprints.
- Secrets must never be written into checkpoints, events, artifacts, snapshots,
  or inspect outputs.
- New prompt builders, strict JSON parsers, tag/protected-marker helpers, and
  shared domain types move to `@cat/core` when they are pure.

## Boundary Rules

### Do

1. Put reusable localization capability in shared packages.
2. Keep CLI and desktop app surfaces thin.
3. Keep IPC and app-service orchestration separate from domain logic.
4. Keep file, job, engine, and resource modules separately understandable.
5. Add focused validation at the boundary being changed.

### Don't

1. Don't make desktop UI state the source of truth for shared localization
   behavior.
2. Don't add agent-first MT batching behavior to legacy desktop workflows.
3. Don't bypass `@cat/localization` from the CLI to reach persistence or core
   helpers.
4. Don't couple file adapters to DB writes for external files.
5. Don't add large monolithic services when a typed module boundary can carry
   the behavior.
