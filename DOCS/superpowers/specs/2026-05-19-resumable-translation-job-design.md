# Resumable Translation Job Design

Date: 2026-05-19

## Purpose

This branch is becoming a new agent-first batch AI translation project. It reuses the existing TM, TB, MT, spreadsheet, and project configuration modules, but the center of the product is no longer the CAT editor UI. The center is a transparent, resumable translation workstation that can run large AI translation jobs, inspect their intermediate artifacts, and recover from interruption without redoing completed work.

The immediate target is file-driven translation for external spreadsheets. The architecture must also support future multi-file jobs and future MT request batching, such as sending five segments in one provider request.

## Goals

- Translate external files without importing those files into the project database.
- Treat the database as the TM/TB/MT configuration and resource engine.
- Persist progress incrementally so interruption does not discard completed translations.
- Make runtime progress visible to humans and agents.
- Keep recovery state lightweight and separate from inspect/debug artifacts.
- Keep the design small enough to implement as the next branch slice.
- Preserve room for future task batching without redesigning checkpoint files.

## Non-Goals

- Do not redesign the existing desktop CAT editor UI.
- Do not store external file rows in the database.
- Do not make XLSX snapshots the source of truth for resume.
- Do not build a full queue server in this slice.
- Do not solve every future provider-specific rate limit strategy in the MVP.

## Core Model

The new execution model has three first-class concepts: job, unit, and task.

```ts
interface TranslationJob {
  id: string;
  projectId: number;
  units: JobUnit[];
  options: JobOptions;
  io: JobIO;
}

interface JobUnit {
  documentId: string;
  unitId: string;
  source: string;
  target?: string;
  context?: string;
  rowNumber?: number;
  sourceHash: string;
  metadata?: Record<string, unknown>;
}

interface TranslationTask {
  taskId: string;
  units: JobUnit[];
}
```

A document is represented by `documentId` on each unit rather than by a heavy runtime object inside the runner. File adapters own document parsing and writing. The runner owns execution, progress, checkpointing, and recovery.

## Architecture

```text
File Adapter(s)
  -> parse one or more external files into JobUnit[]
  -> write snapshot/final outputs per document

TranslationJobRunner
  -> load checkpoint index
  -> decide reusable vs pending units
  -> ask TaskPlanner to group pending units
  -> schedule tasks with maxConcurrency
  -> write checkpoint/artifact/event records
  -> throttle snapshot writes

LocalizationEngine
  -> execute TM/TB/MT for task units
  -> return per-unit results and prompt artifacts

Stores
  -> CheckpointStore: recovery truth
  -> ArtifactStore: inspect/debug truth
  -> EventSink: progress truth
```

The runner should not know XLSX columns or workbook details. The file adapter should not know provider request scheduling. The engine should not know JSONL storage paths. This keeps file usage, job orchestration, and TM/TB/MT internals orthogonal.

## Unit Recovery And Task Execution

Recovery is unit-level. Execution is task-level.

MVP task planning is simple:

```text
OneUnitTaskPlanner: 1 task = 1 unit
```

Future MT batching can replace the planner:

```text
ContextBatchTaskPlanner: 1 task = 5 units
```

Checkpoint records remain unit-level even when tasks contain multiple units. This prevents future batch request logic from changing resume semantics.

## Job IO

```ts
interface JobIO {
  checkpointPath: string;
  eventsPath: string;
  artifactsPath: string;
  writeSnapshot?: (results: UnitResult[]) => Promise<void>;
  writeFinal?: (results: UnitResult[]) => Promise<void>;
  emitStdout?: boolean;
}
```

For the first file-driven CLI, paths can default from the output file:

```text
mt.translate.checkpoint.jsonl
mt.translate.events.jsonl
mt.translate.artifacts.jsonl
mt.snapshot.xlsx
mt.translated.xlsx
```

For future multi-file jobs, one job can share JSONL stores and write outputs per document:

```text
job.checkpoint.jsonl
job.events.jsonl
job.artifacts.jsonl
outputs/
  file-a.snapshot.xlsx
  file-a.translated.xlsx
  file-b.snapshot.xlsx
  file-b.translated.xlsx
```

## Checkpoint Records

Checkpoint JSONL is the only recovery source of truth. It is intentionally small.

```json
{"job":"j1","doc":"mt.xlsx","unit":"row-33","hash":"abc","status":"translated","target":"...","attempts":1,"at":"2026-05-19T00:00:00.000Z"}
```

Failed records are also persisted:

```json
{"job":"j1","doc":"mt.xlsx","unit":"row-33","hash":"abc","status":"failed","error":"AI provider response was empty","attempts":3,"at":"2026-05-19T00:00:00.000Z"}
```

Rules:

- `translated`, `skipped`, and `reused` are successful states for final output.
- `failed` is recoverable and is retried by default on the next resume run.
- If multiple checkpoint records exist for the same job/document/unit, the last valid record wins.
- A record is reusable only when the stored hash matches the current unit `sourceHash`.
- Stale records are ignored during checkpoint loading; no extra stale checkpoint record is required.

Resume rule:

```text
resume=true: translated/skipped/reused + matching sourceHash are reused.
missing/failed/stale units are pending and will run.
```

## Event Records

Events are for humans, agents, stdout, and progress monitoring. They should be compact and readable.

MVP event names:

```text
job_start
unit_start
unit_done
unit_error
snapshot
job_done
```

Example:

```json
{"job":"j1","event":"unit_done","doc":"mt.xlsx","unit":"row-33","status":"translated","done":31,"total":52,"at":"2026-05-19T00:00:00.000Z"}
```

The same event object can be appended to `events.jsonl` and optionally emitted to stdout as NDJSON. More detailed TM/TB/prompt internals belong in artifacts, not in the progress stream.

## Artifact Records

Artifacts explain what happened. They are not used for resume and should be opt-in for translation jobs so normal output directories stay lightweight.

When artifact capture is enabled, artifact detail is complete prompt artifacts without secrets:

```json
{"job":"j1","task":"task-7","doc":"mt.xlsx","unit":"row-33","tm":{},"tb":{},"prompt":{},"result":{},"at":"2026-05-19T00:00:00.000Z"}
```

Artifacts should include:

- selected TM references and diagnostics
- selected TB references and diagnostics
- full system prompt
- full user prompt
- provider id/name, model, and reasoning effort
- prompt character counts
- attempt metadata
- final target or error

Artifacts must not include API keys.

For future batched MT requests, each unit artifact may include the same `task` or `batchId`. The checkpoint remains per unit.

## Execution Flow

```text
1. File adapter parses one or more files into JobUnit[].
2. JobRunner loads checkpoint index.
3. JobRunner reuses matching successful checkpoint records when resume=true.
4. Missing, failed, or stale units become pending.
5. TaskPlanner groups pending units into TranslationTask[].
6. Runner schedules tasks with maxConcurrency.
7. Each task returns per-unit UnitResult[] and artifact data.
8. For every unit result:
   - append artifact
   - append checkpoint
   - emit event
9. SnapshotThrottle writes snapshot outputs by count or time.
10. Final writer writes final outputs per document.
11. Runner emits job_done.
```

The runner should keep an in-memory result map assembled from reused checkpoint records plus newly completed unit results. This map is used for snapshots and final outputs.

## Attempts And Failures

`maxAttempts` means total attempts, including the first attempt.

```text
maxAttempts=3 => first attempt + up to 2 retries
```

MVP single-unit tasks:

```text
attempt 1 fails
attempt 2 fails
attempt 3 fails
=> unit_error event
=> failed checkpoint
=> artifact with error
```

Future batch tasks:

- If the entire provider request fails, retry the whole task until `maxAttempts` is exhausted.
- If the provider request succeeds but one unit cannot be parsed, write successful checkpoints for parsed units and failed checkpoints for parse failures.
- On resume, only failed/missing/stale units are planned again, so the next planner may form different tasks.

## Snapshot And Final Output

Snapshot output is for human inspection during long jobs. It does not participate in resume.

Defaults:

```text
snapshotEveryUnits=10
snapshotEverySeconds=60
```

Either threshold can trigger a snapshot. A final output is written at job completion even if no snapshot threshold fires.

File outputs must use the compact spreadsheet range behavior introduced in this branch, so generated files do not preserve bloated XLSX `!ref` ranges.

## CLI Surface

The existing `translate:file` CLI should gain a small set of options:

```text
--checkpoint <path>
--events <path>
--artifacts <path>
--resume
--max-attempts <n>
--snapshot <path>
--snapshot-every-units <n>
--snapshot-every-seconds <n>
--progress-stdout
```

Defaults should keep the command easy to run:

- checkpoint/events/snapshot inferred from output path
- artifacts disabled unless `--artifacts <path>` is provided
- `maxAttempts=3`
- `snapshotEveryUnits=10`
- `snapshotEverySeconds=60`
- stdout progress enabled for CLI runs unless disabled later by a separate quiet flag

## Testing Strategy

Core tests:

1. `CheckpointStore`
   - reads JSONL
   - last record wins
   - hash mismatch is not reusable
   - failed records are pending on resume

2. `TranslationJobRunner`
   - successful unit writes artifact, checkpoint, and event
   - failed unit writes failed checkpoint and error event
   - resume reuses translated/skipped records and does not call the transport for them
   - result map includes both reused and newly translated units

3. `TaskPlanner`
   - one-unit planner creates one task per pending unit
   - task abstraction returns per-unit results

4. File adapter integration
   - xlsx parses to units
   - runner writes snapshot/final xlsx
   - external file rows are not imported into the database
   - compact output ranges are preserved

5. CLI
   - accepts checkpoint/events/artifacts/resume/max-attempts/snapshot options
   - emits NDJSON progress
   - supports resume after a simulated interruption

6. Real smoke
   - inspect the file
   - translate with checkpoint/events/artifacts
   - interrupt and rerun with `--resume`
   - verify completed units are not re-requested
   - verify final output and checkpoint summary agree

## Open Extension Points

These are intentionally small and should not be implemented beyond MVP needs:

- `TaskPlanner`: allows future five-segment MT requests.
- `JobIO.writeSnapshot` and `writeFinal`: allows file, folder, or API payload outputs.
- `EventSink`: allows future UI/API subscription.
- `ArtifactStore`: allows future richer provider debug mode without changing checkpoint semantics.

## Success Criteria

- A file translation job can be interrupted and resumed without redoing completed successful units.
- Progress can be inspected during and after a run through `events.jsonl`.
- Prompt/TM/TB internals can be inspected per unit through `artifacts.jsonl`.
- Resume decisions are understandable from checkpoint records alone.
- The first implementation remains file-driven while keeping the job/unit/task model ready for multi-file and future batched MT requests.
