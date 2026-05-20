# Agent-First Architecture

## Purpose

This branch treats the project as an agent-first localization engine. The existing CAT UI can remain, but the new center of gravity is a headless workflow that lets agents and humans run, inspect, resume, and automate translation jobs.

The core product shape is:

```text
External files or future API clients
  -> file adapters
  -> TranslationJobRunner
  -> LocalizationEngine
  -> TMModule + TBModule + MTModule
  -> existing DB, services, and AI provider transport
```

## Design Principles

- Keep normal runs lightweight. Persist only results, checkpoints, progress events, and throttled snapshots by default.
- Keep diagnostic detail opt-in. Full prompt/TM/TB artifacts are written only by inspect flows or `translate:file --artifacts <path>`.
- Keep files external. External spreadsheets are not imported into project `files` or `segments` tables during headless translation.
- Keep modules orthogonal. TM, TB, and MT can change independently as long as their structured contracts stay stable.
- Keep recovery per segment. Request grouping can change later, but checkpoint identity remains per output unit.
- Keep progress readable by agents. Events should explain what is happening without embedding large prompt payloads.

## Layers

### File Layer

Code:

- `packages/localization/src/modules/FileModule.ts`
- `packages/localization/src/fileTranslationJobAdapter.ts`
- `packages/localization/src/spreadsheetFileAdapter.ts`

Responsibilities:

- Read external spreadsheets.
- Detect source, target, and optional context columns.
- Convert file rows into localization units or job units.
- Write final translated files and throttled snapshots.
- Preserve original file shape where possible.

Non-responsibilities:

- TM matching.
- TB matching.
- Prompt construction.
- Provider request scheduling.
- Resume decisions.

### Job Layer

Code:

- `packages/localization/src/job/TranslationJobRunner.ts`
- `packages/localization/src/job/CheckpointStore.ts`
- `packages/localization/src/job/EventSink.ts`
- `packages/localization/src/job/ArtifactStore.ts`
- `packages/localization/src/job/TaskPlanner.ts`

Responsibilities:

- Plan work into translation tasks.
- Run tasks with bounded concurrency.
- Retry failed tasks with configurable `maxAttempts`.
- Append checkpoint records for resumability.
- Append progress events for observability.
- Write throttled snapshots and final output through callbacks.
- Enable artifact capture only when an artifact store is configured.

Non-responsibilities:

- Prompt composition.
- TM/TB business rules.
- File parsing details.
- Provider-specific request body decisions.

### LocalizationEngine Layer

Code:

- `packages/localization/src/LocalizationEngine.ts`

Responsibilities:

- Resolve project configuration.
- Build transient segments from external units.
- Apply target-scope policy such as `blank-only`.
- Coordinate TMModule, TBModule, and MTModule.
- Expose file and unit translation APIs for headless callers.

Non-responsibilities:

- Owning external file format details.
- Owning checkpoint storage format.
- Owning progress event persistence.

### Resource Modules

Code:

- `packages/localization/src/modules/TMModule.ts`
- `packages/localization/src/modules/TBModule.ts`
- `packages/localization/src/modules/MTModule.ts`

Responsibilities:

- `TMModule`: inspect mounted TM resources, raw matches, selected references, and TM diagnostics.
- `TBModule`: inspect mounted TB resources, raw matches, selected terms, and TB diagnostics.
- `MTModule`: compose prompts, resolve provider settings, send MT requests, validate responses, and return translated tokens.

The MT module consumes structured TM/TB artifacts. TM and TB modules should not know how prompts are written.

## Runtime Artifacts

| Artifact | Default | Purpose |
| --- | --- | --- |
| Final output file | Yes | User-facing translated file. |
| Checkpoint JSONL | Yes | Resume truth. Latest translated checkpoint per unit can be reused. |
| Event JSONL | Yes | Lightweight progress stream for humans, agents, and future services. |
| Snapshot XLSX | Yes, throttled | Partial translated output during long runs. |
| Prompt artifact JSONL | No | Opt-in diagnostic record with TM/TB/prompt details. |
| Inspect XLSX/JSON | Only inspect command | No-request transparent artifact for module debugging. |

## Stable Contracts

- File adapters call `LocalizationEngine` or `TranslationJobRunner` through typed inputs, not through DB side effects.
- `TranslationJobRunner` matches task results by `documentId + unitId`, not by array order.
- Checkpoints do not depend on prompt artifact files.
- Resume identity includes project and resolved translation policy fingerprints.
- API keys must never be written into checkpoints, events, artifacts, snapshots, or inspect outputs.

## Near-Term Direction

- Keep `translate:file` as the file-driven smoke and regression path.
- Add a service/API layer above the same file and job boundary when needed.
- Move MT prompt orchestration and provider request grouping behind the MT/task boundary.
- Prepare for multi-file concurrent jobs by keeping job identity, document identity, and unit identity explicit.
