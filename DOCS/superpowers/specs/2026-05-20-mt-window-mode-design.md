# MT Window Mode Design

## Purpose

Define the next MT request model for the agent-first file translation path.

The external name is **Window Mode**. Internally, it is an ordered context-window
batch translation mode: each provider request translates a small batch of current
segments while carrying nearby translated/source context and per-segment
TM, concordance, TB, and row context.

Window Mode is the intended default request model for `translate:file` going
forward. The existing one-unit request path may remain as a compatibility
boundary while this mode is introduced incrementally.

## Goals

1. Improve context understanding by giving the model nearby previous
   translations and following source rows.
2. Improve terminology and translation-memory consistency by keeping each
   current segment's TM, concordance, and TB references attached to that segment.
3. Improve batch output stability by requiring strict JSON responses.
4. Keep resume, checkpoints, events, snapshots, and final output per unit.
5. Keep the file API stable. This is a request-mode change, not a file-format
   or project-data import change.
6. Keep prompt payloads useful but simple. The model should see translation
   material, not internal implementation details.

## Non-Goals

1. Do not add concurrent provider requests for one file in this mode.
2. Do not redesign the legacy desktop CAT editor workflow.
3. Do not move TM/TB ranking or persistence into this feature unless directly
   required.
4. Do not expose checkpoint, event, artifact, or database identities in the
   prompt unless they are needed for response mapping.
5. Do not require prompt artifacts for normal translation runs.

## Placement

Pure prompt and response capability belongs in `@cat/core`, initially under the
existing project prompt slice if that keeps the change small:

- Window Mode prompt contracts and types.
- Batch prompt builder.
- Strict JSON response parser.
- Response shape validator.
- Pure response identity checks for missing, duplicate, and unknown ids.

Headless orchestration belongs in `@cat/localization`:

- Batch task planning.
- Ordered file execution.
- Previous translated context selection.
- Next source context selection.
- TM, concordance, and TB lookup per current segment.
- MT provider dispatch through the existing transport port.
- Per-unit result, checkpoint, event, snapshot, and artifact preservation.

CLI scripts remain thin:

- Expose `--batch-size <n>` for Window Mode when needed.
- Call `@cat/localization`.
- Do not assemble TM/TB prompt blocks or parse provider responses.

## Request Model

Window Mode translates one ordered file as a sequence of provider requests.

Default:

- Mode: Window Mode.
- Batch size: `5`.
- Valid batch size range for the first implementation: `1..5`.
- Previous translated context size: up to `5` rows.
- Next source context size: up to `5` rows.
- Provider request concurrency for the same file: exactly `1`.

For a file with units `1..15`, the request order is:

```text
request 1: current units 1..5
  -> parse response
  -> write per-unit results/checkpoints/events

request 2: current units 6..10
  -> include previous translated context from completed units 1..5
  -> parse response
  -> write per-unit results/checkpoints/events

request 3: current units 11..15
  -> include previous translated context from completed units 6..10
  -> parse response
  -> write per-unit results/checkpoints/events
```

The old `maxConcurrency` option must not schedule later provider requests from
the same file before earlier Window Mode batches finish. Future multi-file
parallelism needs a separate design; even then, each file's internal Window Mode
chain must remain ordered.

## Prompt Contract

The model should receive enough translation material to do the job well, while
avoiding unnecessary internal details.

### System Prompt

The system prompt is the stable translation instruction sheet:

- State that this is a translation task, not summarization, rewriting, or
  explanation.
- Apply the project style guide and default translation rules.
- Explain how to use TM, concordance, TB, row context, previous translated rows,
  and next source rows.
- Require preserving all markers, tags, placeholders, and escape sequences
  exactly as they appear in the input source.
- Require strict JSON only, with no Markdown, commentary, or extra text.

### User Prompt

The user prompt is the current batch material package:

```text
Batch
- Source language: <srcLang>
- Target language: <tgtLang>
- Current segments: <count>
- Return translations for ids: <id list>

Current segments to translate
1. id: <response id>
   Source:
   <marker-preserved source>

   TM:
   <this segment's TM references only>

   Concordance:
   <this segment's concordance suggestions only>

   TB:
   <this segment's terminology references only>

   Context:
   <this segment's row/file context, if present>

2. id: <response id>
   ...

Previous 5 translated rows
1. <source> -> <target>
2. <source> -> <target>

Next 5 source rows
1. <source>
2. <source>

Return strict JSON only
```

Important simplifications:

- The prompt only includes the marker-preserved source payload. It does not show
  both raw source and marker-preserved source.
- Previous and next context rows do not include document ids or unit ids. They
  are context only and require no output.
- Current segment ids should be simple response ids. Internally, localization
  still maps them back to `documentId + unitId`.
- TM, concordance, and TB references are per current segment. They are not a
  shared reference pool for the whole batch.

## Strict JSON Response

Provider responses must be strict JSON:

```json
{
  "translations": [
    {
      "id": "unit-1",
      "text": "Translated text"
    }
  ]
}
```

Rules:

- Return exactly one translation object for each current segment id.
- Do not return translations for previous or next context rows.
- Do not return Markdown code fences.
- Do not include explanations, comments, alternatives, confidence scores, or
  extra top-level fields.

The parser must reject:

- Empty response content.
- Invalid JSON.
- Missing `translations`.
- Non-array `translations`.
- Missing, empty, duplicate, or unknown ids.
- Missing or non-string `text`.
- Any current segment id without exactly one result.

Rejected responses are task-level MT errors. The job retry layer may retry the
whole batch. MT-level repair retries can remain separate for marker/tag
validation.

## Current Segment References

Each current segment carries the same reference categories that the old
single-segment request mode provided:

- TM references.
- Concordance suggestions.
- TB references.
- Row/file context.

Reference lookup remains per segment:

```text
current segment A
  -> TM(A), concordance(A), TB(A), context(A)

current segment B
  -> TM(B), concordance(B), TB(B), context(B)
```

Batching must not merge references into one shared list. This avoids
cross-contaminating terminology or TM suggestions between neighboring segments.

## Context Window Selection

Previous translated context:

- Select up to 5 earlier rows from the same file order.
- Include only rows with a reliable target.
- Prefer results already produced by the current run.
- Reused checkpoints with valid targets may be included because they are trusted
  completed results.
- Skipped rows with non-empty existing targets may be included.
- Failed rows or rows with no target are skipped.
- Prompt form is `source -> target`; ids are not shown.

Next source context:

- Select up to 5 later source-bearing rows from the same file order.
- Include source text only.
- Do not include ids.
- Do not require output for these rows.

Because previous context depends on completed targets, requests for one file
must be ordered. Later batches cannot be sent before earlier batches finish.

## Job Execution

Add a Window Mode task planner for file jobs:

- Plan pending source-bearing units in file order.
- Build tasks of `batchSize` current units.
- Keep task ids deterministic.
- Default `batchSize` to `5`.
- Validate configured `batchSize` as an integer in `1..5`.

The job runner already stores and canonicalizes results by `documentId + unitId`.
It can keep writing checkpoints, events, snapshots, artifacts, and final output
per unit.

The task executor needs enough context to build previous translated rows. The
preferred implementation is to provide the executor with a read-only snapshot of
completed unit results before each task begins. Since Window Mode execution is
ordered, that snapshot reflects real completed targets from earlier batches.

Normal progress events stay per unit:

- `unit_done` for translated or skipped units.
- `unit_error` for failed units.
- Optional task-level events can be added later, but full prompt payloads should
  not be embedded in progress events.

## Inspect And Artifacts

`inspect:localization` remains the no-request path for prompt debugging.

Inspect should show Window Mode inputs clearly:

- Current segments in each inspected batch.
- Per-current-segment TM, concordance, TB, and context.
- Previous translated rows.
- Next source rows.
- Full system prompt.
- Full user prompt.
- Strict JSON response contract.

Normal translation runs remain clean:

- No prompt artifact JSONL by default.
- `translate:file --artifacts <path>` may write prompt diagnostics.
- Artifacts must not include API keys.

Prompt artifacts should preserve enough metadata for debugging while keeping
resume decisions tied to checkpoints, not artifacts.

## Compatibility And Migration

Window Mode is the default for `translate:file` job mode after this feature
lands.

The existing one-unit translation path may remain temporarily for:

- Direct `translateUnits` compatibility.
- Focused fallback tests.
- Future comparison during prompt evaluation.

This compatibility path should not be described as the new product direction.
The intended default request mode is Window Mode.

## Testing

Add focused tests at each boundary:

`@cat/core/project`:

- Builds Window Mode system and user prompts.
- Includes one to five current segments.
- Renders per-segment TM, concordance, TB, and context.
- Renders previous translated rows without ids.
- Renders next source rows without ids.
- Parses strict JSON success responses.
- Rejects invalid JSON, missing ids, duplicate ids, unknown ids, and missing text.

`@cat/localization`:

- Plans deterministic Window Mode batches with default size 5.
- Validates custom batch sizes.
- Executes file job batches sequentially.
- Includes previous translated context from completed results only.
- Includes reused checkpoint targets as previous context when resume is enabled.
- Includes next source context from following file rows.
- Preserves per-unit checkpoints, events, snapshots, final output, and artifacts.
- Does not let `maxConcurrency` parallelize same-file Window Mode provider
  requests.

`MTModule`:

- Sends one provider request per batch.
- Uses the batch prompt builder.
- Parses strict JSON responses into per-unit target tokens.
- Rejects missing, duplicate, and unknown response ids.
- Keeps tag/protected-marker validation behavior distinct from job-level retry.

`LocalizationInspector`:

- Writes inspect workbook and JSON sidecar with Window Mode prompt artifacts.
- Shows per-segment references and batch context clearly.
- Does not call provider transport.
- Does not include API keys.

## Validation

Before real provider smoke:

1. Run targeted core prompt/parser tests.
2. Run targeted localization planner, engine, job runner, MT module, and
   inspector tests.
3. Run `inspect:localization` on a representative spreadsheet and confirm:
   - current segments are grouped as expected,
   - each current segment has its own TM/concordance/TB/context,
   - previous translated rows show `source -> target`,
   - next context rows show source only,
   - JSON sidecars contain no API keys.
4. Run real `translate:file` smoke only when sending source text and references
   to the configured provider is intended.

## Open Decisions Closed In This Spec

1. Response format is strict JSON.
2. External name is Window Mode.
3. Default batch size is 5.
4. Batch size is configurable in the first version.
5. Same-file provider requests are ordered, not concurrent.
6. Current segment references are per segment, not shared across the batch.
7. Context rows do not expose internal ids.
8. Only marker-preserved source is shown to the model.
