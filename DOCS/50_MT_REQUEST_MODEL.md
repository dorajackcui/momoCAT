# 50_MT_REQUEST_MODEL

## Purpose

Authoritative contract for headless MT request planning, prompt structure, and
response handling.

## Ownership

- `@cat/core/project`: pure prompt builders, strict JSON parsers, validation
  helpers, and request/response contracts.
- `@cat/localization`: file/job planning, context assembly, MTModule
  orchestration, retries, checkpoints, events, artifacts, and inspect.
- `apps/cli`: command parsing only; no prompt assembly.

`MTModule` consumes structured context from localization planning. It should not
query TM or TB directly, and it should not depend on spreadsheet row shape.

## Request Modes

| Mode | Meaning |
| --- | --- |
| `window` | Dense Window Mode. Physical batches request rows that require target text. |
| `window-partial` | Partial Window Mode. Physical scan windows remain stable, but only rows requiring target text become request rows. |

Dense Window Mode groups one to five current units in one provider request,
keeps same-file requests ordered and sequential, and writes results through the
normal per-unit checkpoint, event, snapshot, and final output surfaces.

Partial Window Mode keeps the physical scan stable while making provider
request ids dynamic. Existing target text inside the window can be prompt
context without becoming requested output. If a physical scan window has zero
request rows, it is skip-only and must not send a provider request or require
provider config.

Target baseline is resolved before request-mode planning. `use-current-targets`
keeps existing targets as the baseline; `ignore-current-targets` normalizes
eligible current targets away before planning. Window planners do not interpret
legacy `targetScope` values such as `blank-only`; those belong to legacy
single-unit concurrent translation APIs.

## Window Partial Prompt Order

```text
batch instruction
read-only context rows
rows requiring target text
validation feedback if present
strict JSON format
```

## Request Rows

Request rows receive per-row source payload, context, TM references,
concordance references, and TB references. The response must include exactly
one strict JSON item per request id.

Request ids are provider-response ids only. Runtime mapping remains tied to the
document-qualified unit identity used by localization checkpoints and results.
Inspect artifacts may use shorter local row ids when that improves readability.

## Read-Only Context Rows

Read-only rows may include previous translated rows, existing-target rows
inside the current physical window, and following source rows. They never
receive response ids and must not appear in the provider JSON response.

Context rows are prompt context only. They may carry source text or existing
target text needed for continuity, but they do not receive per-request TM/TB
blocks and they do not require provider output.

## Runtime TM In Requests

Runtime TM is job-local and currently enabled only for headless
`translateFile()` jobs using `requestMode=window` or `requestMode=window-partial`.
It is not enabled for inspect, legacy concurrent `translateUnits()`, or legacy
desktop flows.

Runtime references must merge into the existing TM and concordance prompt
blocks. Do not add a separate Runtime TM prompt section. Runtime TM keeps
independent prompt slots of at most 3 TM references and at most 3 concordance
references, then merges with persistent references by rank.

Runtime TM commit happens after task results have been persisted to checkpoint,
events, snapshots, and final output surfaces. Resume rebuilds Runtime TM from
reusable checkpoint results before continuing.

## Strict JSON Response

```json
{"translations":[{"id":"<id>","text":"<target text>"}]}
```

The response must contain only the `translations` field. The array must include
exactly one object for each requested id.

Results may arrive out of order, but every requested id must be present exactly
once. Extra ids, missing ids, duplicate ids, or fields outside this schema are
validation failures.

## Retry and Validation

- Job retry happens in `TranslationJobRunner`.
- MT response repair happens in `MTModule`.
- These two layers must stay separate.

Job retry is task-level recovery around planned work, attempts, checkpoints,
and progress surfaces. MT response repair is provider-response validation and
prompt feedback for the current request. Do not use artifacts or progress
events as resume truth.

## Inspect and Artifacts

- Inspect composes prompt artifacts without provider requests.
- Real translate writes full prompt/TM/TB diagnostics only when artifacts are
  explicitly enabled.
- For `window-partial`, inspect and translate should use the same request mode
  to make prompt shape comparable.

Prompt artifacts may include provider identity, project prompt metadata, source
payloads, TM/TB/concordance prompt blocks, rendered prompts, batch metadata, and
character counts. They must not include API keys or other secrets. Rendered
prompts and source payloads may contain private text and must stay out of
tracked docs and source.

CLI command usage and smoke procedures belong in `DOCS/40_CLI_OPERATION.md`.

## Guardrails

- Keep prompt composition in pure core helpers and localization orchestration,
  not CLI scripts.
- Keep request scheduling replaceable behind the task/executor boundary.
- Keep same-file provider requests sequential unless a later explicit design
  introduces bounded concurrency.
- Keep checkpoint writes and progress events per unit.
- Do not write large prompt payloads to progress events.
- Do not route new headless batching behavior through legacy desktop GUI flows.
