# Translation Audit Lite Design

Date: 2026-06-17

## Purpose

Add a lightweight observability trail for file translation runs so we can prove
the runtime path:

```text
batch translate -> tag validation error -> single-segment repair -> result persisted -> runtime TM commit
```

The report must work for both CLI file translation and desktop file translation.
It should answer "what requests and repair decisions happened?" without dumping
large prompts or slowing provider calls.

## Constraints

- Default behavior must be unchanged and effectively free.
- The audit trail must not record full system prompts, user prompts, raw provider
  responses, full source text, or full target text.
- Audit writes must not block provider requests or result persistence.
- The report must be small enough to leave enabled during a focused desktop
  debugging session.
- Existing artifacts remain available for deep prompt inspection, but Audit Lite
  is not a replacement for artifacts.
- The feature must cover the desktop `translateProjectSegments` workflow, where
  current memory-only events and disabled artifacts do not expose enough detail.

## Existing Observability

CLI `translate file` already supports sidecars:

- `checkpoint.jsonl`: final persisted unit checkpoints.
- `events.jsonl`: coarse job/unit progress events.
- `artifacts.jsonl`: optional full prompt/reference/result artifacts.

Desktop project segment translation currently uses in-memory checkpoint and
event sinks. It writes results through `applyResult`, but does not persist prompt
artifacts. This means desktop cannot easily show whether a tag error triggered a
single repair, whether repair succeeded, or when runtime TM committed task
results.

## Design

Introduce an optional `TranslationAuditSink` in `packages/localization`.

```ts
interface TranslationAuditSink {
  record(event: TranslationAuditEvent): void;
  flush?(): Promise<void>;
}
```

All call sites receive a no-op sink unless audit is explicitly enabled. The hot
path calls `record()` with small objects only. File-backed implementations append
JSONL through a buffered stream or equivalent non-blocking queue. Provider
request paths do not `await` audit writes. Job shutdown may flush the sink.

## Event Set

Events are intentionally short and structural.

```json
{"event":"mt_batch_request","job":"...","task":"window-partial-task-4","mode":"window-partial","units":[{"unit":"row-20","rid":"r4","row":20}]}
{"event":"mt_batch_response","job":"...","task":"window-partial-task-4","latencyMs":30211,"returnedIds":["r1","r2","r3","r4","r5"]}
{"event":"mt_tag_invalid","job":"...","task":"window-partial-task-4","unit":"row-20","rid":"r4","messages":["Missing tags: {1}"],"targetHash":"...","targetChars":84}
{"event":"mt_repair_request","job":"...","task":"window-partial-task-4","unit":"row-20","rid":"r4","reason":"tag_invalid"}
{"event":"mt_repair_success","job":"...","task":"window-partial-task-4","unit":"row-20","rid":"r4","targetHash":"...","targetChars":96}
{"event":"unit_persisted","job":"...","task":"window-partial-task-4","unit":"row-20","status":"translated","attempts":1}
{"event":"runtime_tm_commit","job":"...","task":"window-partial-task-4","units":["row-17","row-18","row-19","row-20","row-21"]}
```

Optional failure events:

```json
{"event":"mt_batch_error","job":"...","task":"...","message":"Missing translation id: r4"}
{"event":"mt_repair_failed","job":"...","task":"...","unit":"row-20","rid":"r4","message":"Tag validation failed after 3 attempts"}
```

`targetHash` is a short SHA-256 prefix of the serialized target text. It lets us
compare whether batch, repair, persisted, and checkpoint values are the same
without storing the target itself. `targetChars` helps spot empty or suspiciously
short outputs.

## Data Flow

1. Job adapters create or receive an audit sink.
2. `TranslationJobRunner` passes the sink through `TaskExecutionContext`.
3. Window strategies pass the sink to `MTModule.translateBatch`.
4. `MTModule.translateBatch` records batch request, batch response, tag-invalid,
   repair-request, repair-success, and repair-failed events.
5. `TranslationJobRunner.persistTaskResult` records `unit_persisted` after
   `applyResult` and checkpoint persistence have succeeded.
6. Runtime TM commit records `runtime_tm_commit` after the existing commit hook
   completes.

This preserves current behavior: audit follows the existing execution path and
does not decide success or failure.

## CLI Entry

Add:

```text
--audit <path>
```

When provided, CLI writes Audit Lite JSONL to that path. It can be used together
with `--events` and `--artifacts`, but does not require either.

## Desktop Entry

Add environment flags:

```text
CAT_TRANSLATION_AUDIT=1
CAT_TRANSLATION_AUDIT_FILE=<optional path>
```

When enabled, desktop writes to `translation_audit_debug.jsonl` under userData
unless `CAT_TRANSLATION_AUDIT_FILE` is set. The main process logs the active
audit file path once at startup.

## Performance Notes

- Disabled audit uses a shared no-op sink.
- Enabled audit records bounded metadata only.
- No prompt or response string copies are made for audit.
- Text hashes are computed only when the target string already exists in memory
  for validation or persistence.
- File writes are not awaited in provider request flow.
- Flush is done at job completion or process shutdown boundaries.

## Testing

Unit tests should cover:

- Disabled audit does not call a sink.
- Batch request/response events include task id, mode, response ids, and unit ids.
- Invalid tag batch results produce `mt_tag_invalid`, `mt_repair_request`, and
  either `mt_repair_success` or `mt_repair_failed`.
- `unit_persisted` is emitted only after successful result application and
  checkpoint persistence.
- Runtime TM commit emits task-level unit ids after commit succeeds.
- CLI maps `--audit` into the localization command config.

Integration-style tests should use fake transport responses to create one bad
batch unit and verify the audit event order:

```text
mt_batch_request
mt_batch_response
mt_tag_invalid
mt_repair_request
mt_repair_success
unit_persisted
runtime_tm_commit
```

## Out Of Scope

- Full prompt or provider response capture.
- UI report viewer.
- Database persistence for audit logs.
- Real-time renderer event display.
- Changing retry policy or tag validation behavior.
