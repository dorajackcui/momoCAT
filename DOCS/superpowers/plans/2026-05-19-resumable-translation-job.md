# Resumable Translation Job Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Keep the design centered on the new agent-first translation job model, not the legacy CAT editor UI. Use checkbox (`- [ ]`) syntax to track progress.

**Spec:** `DOCS/superpowers/specs/2026-05-19-resumable-translation-job-design.md`

**Goal:** Add a resumable, transparent translation job layer with lightweight checkpoints, progress events, prompt artifacts, and throttled snapshots. The first implementation is file-driven, but the architecture must remain ready for multi-file jobs and future MT tasks that batch multiple segments into one provider request.

**Architecture:** Introduce `job / unit / task` abstractions under `apps/desktop/src/main/localization/job`. A file adapter converts external spreadsheets into `JobUnit[]` and output writers. `TranslationJobRunner` schedules tasks, calls a task executor backed by `LocalizationEngine`, and writes JSONL checkpoint/event/artifact records as units finish.

**Tech Stack:** TypeScript, Vitest, Node scripts, `xlsx`, Node `fs/promises`, existing `LocalizationEngine`, `FileModule`, `TMModule`, `TBModule`, `MTModule`, and `RequestScheduler`.

---

## Scope Check

This plan covers one coherent slice: resumable file translation jobs.

In scope:

- Unit-level checkpoint recovery.
- Task-level execution abstraction.
- One-unit task planner for MVP.
- JSONL checkpoint/events/artifacts.
- File-driven snapshot/final XLSX writers.
- CLI options for checkpoint/resume/progress.
- Tests proving resume does not re-request completed units.

Out of scope:

- New UI.
- Database persistence of external files.
- Full queue/server process.
- Multi-file CLI UX beyond internal-compatible data structures.
- Five-segment MT batching implementation. Only the task abstraction is added now.
- Provider-specific rate limit policies beyond current `maxConcurrency`.

## File Structure

Create:

- `apps/desktop/src/main/localization/job/types.ts`
  - Job/unit/task/result/record type definitions.
- `apps/desktop/src/main/localization/job/sourceHash.ts`
  - Stable source hash helper for resume validation.
- `apps/desktop/src/main/localization/job/JsonlStore.ts`
  - Append-only JSONL reader/writer helpers.
- `apps/desktop/src/main/localization/job/CheckpointStore.ts`
  - Checkpoint index loading and reusable-record lookup.
- `apps/desktop/src/main/localization/job/EventSink.ts`
  - JSONL + optional stdout event sink.
- `apps/desktop/src/main/localization/job/ArtifactStore.ts`
  - Prompt artifact JSONL writer.
- `apps/desktop/src/main/localization/job/TaskPlanner.ts`
  - `OneUnitTaskPlanner` and task planner interface.
- `apps/desktop/src/main/localization/job/SnapshotThrottle.ts`
  - Count/time based snapshot trigger.
- `apps/desktop/src/main/localization/job/TranslationJobRunner.ts`
  - Runner orchestration.
- `apps/desktop/src/main/localization/job/*.test.ts`
  - Focused unit tests for the above.
- `apps/desktop/src/main/localization/fileTranslationJobAdapter.ts`
  - Converts spreadsheet files to jobs and writes snapshots/finals.
- `apps/desktop/src/main/localization/fileTranslationJobAdapter.test.ts`
  - File adapter integration tests.

Modify:

- `apps/desktop/src/main/localization/LocalizationEngine.ts`
  - Add task executor support for the job runner while preserving existing `translateUnits` behavior.
- `apps/desktop/src/main/localization/types.ts`
  - Add optional file job settings to `TranslateFileInput` or a nearby exported type.
- `apps/desktop/src/main/localization/index.ts`
  - Export public job types and runner where appropriate.
- `apps/desktop/src/main/localization/LocalizationEngine.test.ts`
  - Add resume/task executor coverage without DB file imports.
- `apps/desktop/src/main/localization/LocalizationEngine.cli.test.ts`
  - Pass job env options to the file translation command runner.
- `scripts/translate-file.mjs`
  - Parse checkpoint/events/artifacts/resume/max-attempts/snapshot/progress flags.
- `scripts/translate-file.test.mjs`
  - CLI validation coverage for new flags.
- `DOCS/00_START_HERE.md`
  - Document resumable translate command after implementation.

## Execution Order

Tasks are sequenced so each task leaves the repo understandable and testable:

1. Add job types and source hashing.
2. Add JSONL stores and checkpoint lookup.
3. Add task planner and snapshot throttle.
4. Add TranslationJobRunner with a mock executor.
5. Add LocalizationEngine task executor.
6. Add spreadsheet file job adapter.
7. Wire CLI options and dynamic runner.
8. Docs, focused verification, and smoke procedure.

---

## Task 1: Job Types And Source Hashing

**Files:**

- Create: `apps/desktop/src/main/localization/job/types.ts`
- Create: `apps/desktop/src/main/localization/job/sourceHash.ts`
- Create: `apps/desktop/src/main/localization/job/sourceHash.test.ts`
- Modify: `apps/desktop/src/main/localization/index.ts`

- [ ] **Step 1: Define minimal job model**

Create types for:

- `JobUnit`
- `TranslationTask`
- `JobOptions`
- `TranslationJob`
- `UnitResult`
- `CheckpointRecord`
- `ProgressEventRecord`
- `ArtifactRecord`
- `TranslationTaskExecutor`

Keep names aligned with the spec:

```text
job / unit / task / checkpoint / events / artifacts
```

Do not add document runtime objects in the runner layer. Use `documentId` on units.

- [ ] **Step 2: Define result statuses**

Use a compact status union:

```ts
type UnitResultStatus = "translated" | "skipped" | "reused" | "failed";
```

Checkpoint records should support `translated`, `skipped`, and `failed`. `reused` can be a runtime/event result derived from an existing successful checkpoint; do not require writing a new checkpoint for reused units in MVP.

- [ ] **Step 3: Add source hash helper**

Implement a deterministic hash using Node `crypto`.

Hash input should include:

- `source`
- `context` when present

Do not include target text. Resume should still reuse a completed translation when an input file target column changes but source/context did not.

- [ ] **Step 4: Add source hash tests**

Cover:

- same source/context produces same hash
- changed source changes hash
- changed context changes hash
- changed target does not affect hash

- [ ] **Step 5: Export public job types**

Export stable types from `apps/desktop/src/main/localization/index.ts`. Keep internal store classes unexported unless needed by tests or future API clients.

---

## Task 2: JSONL Stores And Checkpoint Lookup

**Files:**

- Create: `apps/desktop/src/main/localization/job/JsonlStore.ts`
- Create: `apps/desktop/src/main/localization/job/CheckpointStore.ts`
- Create: `apps/desktop/src/main/localization/job/EventSink.ts`
- Create: `apps/desktop/src/main/localization/job/ArtifactStore.ts`
- Create tests beside each file or one combined `stores.test.ts`.

- [ ] **Step 1: Implement append-only JSONL helpers**

Implement small helpers:

- `appendJsonlRecord(path, record)`
- `readJsonlRecords(path)`

Behavior:

- Missing file reads as empty list.
- Invalid JSON lines are ignored or surfaced as diagnostics, but should not crash checkpoint loading for all other lines. Prefer returning diagnostics from checkpoint loading.
- Writes append one JSON object plus newline.

- [ ] **Step 2: Implement CheckpointStore**

Responsibilities:

- load all records for a job into an index
- last valid record wins per `job + doc + unit`
- determine reusable records by matching `hash`
- expose whether a unit is pending

Rules:

- `translated` and `skipped` with matching hash are reusable.
- `failed`, missing, invalid, or hash mismatch are pending.
- API should return enough data to build `UnitResult` for reused units.

- [ ] **Step 3: Implement EventSink**

Responsibilities:

- append event records to `events.jsonl`
- optionally write the same JSON object to stdout as one NDJSON line

Keep stdout writing injectable/testable. Do not call `console.log` directly from deep code unless wrapped.

- [ ] **Step 4: Implement ArtifactStore**

Artifact writer only appends records. It does not read during resume.

- [ ] **Step 5: Add store tests**

Cover:

- missing files
- append/read roundtrip
- last checkpoint wins
- hash mismatch is not reusable
- failed record is pending
- event stdout output is NDJSON

---

## Task 3: Task Planner And Snapshot Throttle

**Files:**

- Create: `apps/desktop/src/main/localization/job/TaskPlanner.ts`
- Create: `apps/desktop/src/main/localization/job/SnapshotThrottle.ts`
- Create tests.

- [ ] **Step 1: Add TaskPlanner interface**

```ts
interface TaskPlanner {
  plan(units: JobUnit[]): TranslationTask[];
}
```

- [ ] **Step 2: Add OneUnitTaskPlanner**

MVP planner:

```text
1 pending unit => 1 task
```

Task ids should be deterministic within a run, for example `task-1`, `task-2`.

- [ ] **Step 3: Add SnapshotThrottle**

Inputs:

- `snapshotEveryUnits`
- `snapshotEverySeconds`

Behavior:

- trigger when completed count delta reaches threshold
- trigger when elapsed time reaches threshold
- final writer is handled separately and should not depend on throttle firing

- [ ] **Step 4: Add tests**

Cover task count/order and throttle count/time behavior with injectable clock.

---

## Task 4: TranslationJobRunner Core With Mock Executor

**Files:**

- Create: `apps/desktop/src/main/localization/job/TranslationJobRunner.ts`
- Create: `apps/desktop/src/main/localization/job/TranslationJobRunner.test.ts`

- [ ] **Step 1: Implement runner constructor**

Runner dependencies:

- `checkpointStore`
- `eventSink`
- `artifactStore`
- `taskPlanner`
- `taskExecutor`
- optional clock

Keep constructor explicit rather than global-singleton based.

- [ ] **Step 2: Implement run flow**

Flow:

1. Emit `job_start`.
2. Load checkpoint index.
3. Build in-memory result map from reusable checkpoint records when `resume=true`.
4. Emit `unit_done` with `status="reused"` for reused units.
5. Plan pending units into tasks.
6. Run tasks with existing `runBounded`.
7. For each unit result:
   - append artifact when available
   - append checkpoint for translated/skipped/failed
   - emit `unit_done` or `unit_error`
   - update result map
   - maybe write snapshot
8. Write final output if configured.
9. Emit `job_done`.

- [ ] **Step 3: Implement task attempts**

Use `maxAttempts` from job options. Default to 3.

MVP behavior:

- Retry the whole task when the executor throws.
- If all attempts fail, write failed results for every unit in the task.
- If executor returns per-unit failed results, do not retry those unless executor threw for the task. This keeps MVP simple.

Note: `MTModule` still has internal tag-validation retries. Job `attempts` are task attempts, not provider retry count.

- [ ] **Step 4: Preserve per-unit result shape**

The runner must return a final summary and ordered results that include:

- reused results
- skipped results
- translated results
- failed results

Ordering should follow original `job.units`.

- [ ] **Step 5: Add runner tests**

Cover:

- successful unit writes artifact/checkpoint/event
- failed thrown task writes failed checkpoint/event after max attempts
- resume skips reusable translated unit and does not call executor for it
- hash mismatch forces re-execution
- snapshot callback is throttled
- final callback receives result map including reused units

---

## Task 5: LocalizationEngine Task Executor

**Files:**

- Modify: `apps/desktop/src/main/localization/LocalizationEngine.ts`
- Modify: `apps/desktop/src/main/localization/LocalizationEngine.test.ts`
- Possibly create: `apps/desktop/src/main/localization/job/LocalizationTaskExecutor.ts`

- [ ] **Step 1: Add a small executor boundary**

Add a function/class that implements `TranslationTaskExecutor` using `LocalizationEngine` internals.

Preferred shape:

```ts
type TranslationTaskExecutor = (task: TranslationTask, context: TaskExecutionContext) => Promise<TaskExecutionResult>;
```

MVP may reject or internally iterate multi-unit tasks, but the interface must accept tasks.

- [ ] **Step 2: Reuse existing per-unit logic**

Reuse current pieces:

- project lookup
- target scope preparation
- transient segment creation
- TMModule inspect
- TBModule inspect
- MTModule translate
- prompt artifact returned by `MTModule.translate`

Avoid duplicating prompt composition logic.

- [ ] **Step 3: Return artifact data per unit**

For each executed unit, return:

- result status and target/error
- TM artifact
- TB artifact
- prompt artifact
- provider/model metadata already present in prompt artifact
- attempts filled by runner

Do not include API key in artifacts.

- [ ] **Step 4: Preserve existing APIs**

Existing `translateUnits` behavior should remain green. It can continue using the current path initially or share the new executor if that stays small.

- [ ] **Step 5: Add tests**

Cover:

- task executor translates a unit without creating DB file/segment rows
- artifact includes TM/TB/prompt data
- skip-only unit does not require provider setup
- current `translateUnits` tests still pass

---

## Task 6: Spreadsheet File Job Adapter

**Files:**

- Create: `apps/desktop/src/main/localization/fileTranslationJobAdapter.ts`
- Create: `apps/desktop/src/main/localization/fileTranslationJobAdapter.test.ts`
- Modify: `apps/desktop/src/main/localization/LocalizationEngine.ts`
- Modify: `apps/desktop/src/main/localization/types.ts`

- [ ] **Step 1: Add file job options**

Add an optional job config for file translation, for example:

```ts
interface TranslateFileJobOptions {
  jobId?: string;
  checkpointPath?: string;
  eventsPath?: string;
  artifactsPath?: string;
  snapshotPath?: string;
  resume?: boolean;
  maxAttempts?: number;
  snapshotEveryUnits?: number;
  snapshotEverySeconds?: number;
  progressStdout?: boolean;
}
```

Keep this separate from MT options.

- [ ] **Step 2: Convert parsed spreadsheet rows to JobUnit**

Use `FileModule.parseExternalSpreadsheet`.

Mapping:

- `documentId`: default to input basename for MVP
- `unitId`: existing row unit id
- `source`, `target`, `context`, `rowNumber`: from file row artifact
- `sourceHash`: from source/context hash helper
- `metadata`: preserve `rowIndex`, `rowNumber`

- [ ] **Step 3: Build file output writers**

Implement snapshot/final callbacks that reuse `writeTranslatedSpreadsheet`.

Convert runner results into `TranslateUnitsResult` shape. Failed units should not overwrite targets. Reused/skipped/translated successful units should write their target when available.

- [ ] **Step 4: Add default sidecar path inference**

For output `C:\tmp\mt.translated.xlsx`, infer:

```text
C:\tmp\mt.translated.checkpoint.jsonl
C:\tmp\mt.translated.events.jsonl
C:\tmp\mt.translated.artifacts.jsonl
C:\tmp\mt.translated.snapshot.xlsx
```

Explicit CLI/API paths override defaults.

- [ ] **Step 5: Wire LocalizationEngine.translateFile**

When file job options are present, run through `TranslationJobRunner`.

Keep legacy behavior available for programmatic callers that omit job options, unless implementation remains simple enough to enable job mode by default without surprising sidecar writes. CLI should enable job mode by default.

- [ ] **Step 6: Add adapter tests**

Cover:

- xlsx file becomes job units with hashes
- final xlsx is written from runner results
- snapshot xlsx can be written before final
- existing bloated range fix still applies
- external file is not imported into DB

---

## Task 7: CLI And Dynamic Smoke Harness

**Files:**

- Modify: `scripts/translate-file.mjs`
- Modify: `scripts/translate-file.test.mjs`
- Modify: `apps/desktop/src/main/localization/LocalizationEngine.cli.test.ts`

- [ ] **Step 1: Parse new CLI options**

Add:

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

Support both `--flag value` and `--flag=value` where appropriate.

- [ ] **Step 2: Validate numeric options**

Validate positive integers for:

- `max-attempts`
- `snapshot-every-units`
- `snapshot-every-seconds`

- [ ] **Step 3: Pass env vars into dynamic test runner**

Extend the dynamic Vitest runner environment with job options.

Sanitize stale `LOCALIZATION_ENGINE_*` job env vars before assigning new values, following the pattern used by inspect CLI.

- [ ] **Step 4: Enable job mode by default in CLI**

CLI should produce checkpoint/events/artifacts by default using inferred paths, even when the user does not pass explicit paths.

`--progress-stdout` should control live NDJSON event output. If implementation chooses default stdout progress, document it clearly and test it.

- [ ] **Step 5: Add CLI tests**

Cover:

- help output lists new options
- invalid numeric options fail
- unknown args fail
- explicit paths are passed through
- resume flag is passed through

---

## Task 8: Documentation, Verification, And Real Smoke Procedure

**Files:**

- Modify: `DOCS/00_START_HERE.md`
- Possibly create: `DOCS/superpowers/reports/2026-05-19-resumable-translation-job-verification.md`

- [ ] **Step 1: Document command usage**

Add concise examples:

```text
npm run translate:file -- --db <db> --project-id <id> --input mt.xlsx --output mt.translated.xlsx --resume
```

Document generated sidecars:

- checkpoint JSONL
- events JSONL
- artifacts JSONL
- snapshot XLSX

- [ ] **Step 2: Run focused tests**

Run:

```text
npx vitest run apps/desktop/src/main/localization/job
npx vitest run apps/desktop/src/main/localization/fileTranslationJobAdapter.test.ts
npx vitest run apps/desktop/src/main/localization/LocalizationEngine.test.ts apps/desktop/src/main/localization/LocalizationEngine.cli.test.ts
node --test scripts/translate-file.test.mjs
npm run typecheck --workspace=apps/desktop
```

- [ ] **Step 3: Run simulated interruption/resume test**

Use a mock transport that succeeds for some units and fails after N units, then rerun with resume. Verify:

- completed units are not re-requested
- failed/missing units are retried
- checkpoint summary matches final output

- [ ] **Step 4: Run real file smoke only after tests pass**

Use:

```text
C:\Users\yizhi003\Downloads\memoQ上传\vibe\mt.xlsx
C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db
project 3
```

Procedure:

1. Run inspect.
2. Run translate with checkpoint/events/artifacts.
3. If interrupted, rerun with `--resume`.
4. Verify final xlsx source/target counts.
5. Verify events and checkpoint summaries explain any missing target rows.

- [ ] **Step 5: Commit implementation**

Use small commits by task or logical milestone. Do not squash away the plan trace.

---

## Implementation Notes

- Keep checkpoint writes append-only and lightweight.
- Do not rewrite XLSX on every unit completion.
- Do not let artifacts participate in resume decisions.
- Do not store API keys in artifacts.
- Prefer runner tests with mock executors before wiring real engine internals.
- Preserve old `translateUnits` behavior unless a focused refactor clearly reduces duplication.
- Keep task abstraction real but minimal: MVP is one unit per task.

## Completion Criteria

- `translate:file` can produce checkpoint/events/artifacts sidecars.
- A resumed run does not call MT for already translated units whose source hash still matches.
- A failed unit is retried by default on resume, bounded by `maxAttempts`.
- Snapshot/final XLSX files are written through the existing file module and compact range behavior.
- Events are understandable as NDJSON by both humans and agents.
- Artifacts contain complete prompts for prompt debugging without secrets.
