# Localization engine

## Scope

This document owns the durable contracts for tokens/tags, MT request planning, TM/TB references, Runtime TM, and desktop resource behavior.

Ownership by package:

- `@cat/core`: pure tokens, tag/protected-marker transforms, text normalization/hashes, QA, prompt builders, strict response parsing, and shared contracts.
- `@cat/db`: persistent TM/TB/project repositories and FTS recall primitives.
- `@cat/localization`: file/unit orchestration, request modes, jobs, modules, provider transport, Runtime TM, inspect, and artifacts.
- `apps/desktop`: project editing, Working/Main TM lifecycle, repeated-segment behavior, resource UI, and external-file sync.
- `apps/cli`: syntax and terminal behavior only.

Stable facades keep cross-layer callers independent of maintenance-oriented splits:

| Boundary                    | Stable entrypoint                      | Internal collaborators                                                                                            |
| --------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Term matching               | `@cat/core/text` and `termMatching.ts` | normalization, search planning, and English inflection helpers                                                    |
| Persistent TM matching      | desktop `TMService`                    | shared scoring and result-selection collaborators in `@cat/localization`; diagnostic traces still call the facade |
| Persistent TM sync          | `CATDatabase` / `TMRepo`               | `TMSyncRepo`; the caller continues to own the transaction                                                         |
| MT prompt/response handling | `MTModule`                             | prompt-parameter construction and batch-response processing                                                       |
| Engine orchestration        | `LocalizationEngine`                   | assembly, unit preparation, resume fingerprinting, and option helpers                                             |

Callers should use the stable entrypoint rather than importing these collaborators as alternate public APIs.

## Token and tag contract

Segments store source and target as `Token[]`, not as display strings. Tags can be paired starts/ends or standalone tokens; tag metadata and order are part of translation correctness.

Three text forms must remain distinct:

| Form                 | Purpose                                                                              |
| -------------------- | ------------------------------------------------------------------------------------ |
| Display text         | User-facing tag/placeholder representation.                                          |
| Editor text          | Editable representation whose markers can map back to source tag tokens.             |
| Protected MT payload | Numbered markers such as paired `{1>…<2}` and standalone `{3}` sent through prompts. |

The MT module boundary (`MTModule` and its batch-response collaborator) is the only localization layer that interprets provider output as editor-marker text. It parses the response back to tokens and validates tag integrity before request-mode strategies produce display-text `UnitResult.target` values.

A consumer persisting a `UnitResult.target` into a token store must use `parseDisplayTextToTokens()` (or preserve returned tokens if the API grows that field). Running `parseEditorTextToTokens()` a second time can reinterpret literal placeholder-like text and corrupt tag identity.

File tag policy is resolved at import/planning time:

- `default`: marker-like text may become CAT tag tokens.
- `none`: marker-like text remains ordinary text.

Desktop imports persist this policy in file import options and reuse it for edit, AI, QA, TM commit, and export. Changing the policy for an already-tokenized file requires re-import rather than silently reparsing stored content.

## MT request planning

CLI inspect/translate defaults to `window-partial` with `use-current-targets`.

| Mode             | Contract                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `window`         | Dense ordered windows; every eligible current unit becomes a requested row.                                                                |
| `window-partial` | Physical scan windows remain stable, but only units requiring target text receive response ids. Existing targets can be read-only context. |

Window requests use one to five current units, stay ordered and sequential within a file, and write results through per-unit persistence surfaces.

Target baseline is resolved before planning:

- `use-current-targets`: preserve existing target cells; partial mode requests eligible blanks and can use existing targets as context.
- `ignore-current-targets`: clear eligible, non-confirmed current targets before planning so they can be regenerated.

Legacy `targetScope` belongs to single-unit concurrent translation and is not interpreted by window planners.

### Partial-window prompt order

```text
batch instruction
read-only context rows
requested rows with per-row references
validation feedback (repair only)
strict response format
```

Read-only rows have no response id, no per-row TM/TB blocks, and must not appear in the provider response. Requested rows receive source payload, optional context, TM, concordance, and TB references.

Provider ids identify response rows only. Runtime correlation remains document-qualified by unit identity; never match results by array position.

## Strict response and repair

The provider response shape is:

```json
{ "translations": [{ "id": "<id>", "text": "<target text>" }] }
```

Only the `translations` field is allowed. Every requested id must appear exactly once; extra, missing, or duplicate ids and unexpected fields are validation failures. Array order is irrelevant.

Two recovery layers have different jobs:

- The MT module response processor handles malformed JSON, missing rows, and tag validation feedback for a provider request; request modes continue to call it through `MTModule`.
- `TranslationJobRunner` task retry handles failed planned work, attempts, and resumable execution.

Do not turn progress events or diagnostic artifacts into retry/resume truth.

## TM matching and prompt selection

Mounted persistent TMs are resolved by project. Matching uses normalized source text while preserving tag-aware hashes/signatures:

- exact candidates use source hash/tag structure;
- fuzzy recall adds similarity candidates;
- source-side concordance adds bounded local-overlap evidence;
- final scoring/classification/diversity prevents near-duplicate prompt flooding.

For one persistent prompt row, selection is capped at:

- **3 TM references** (exact/fuzzy, similarity ordered);
- **7 concordance references**;
- **10 total persistent references** before Runtime TM merging.

Explicit Concordance Search is a separate desktop route from the active TM-match flow. Confirm which route is wrong before changing recall SQL or scoring.

The desktop CAT panel keeps TM/TB application behavior unchanged while comparing the selected TM source with the active segment source. Removed TM text and added current text are highlighted separately, and tag tokens remain atomic; TB rows do not drive the source comparison.

### Language profiles

Default/CJK behavior uses the established normalization, scoring, concordance, diversity, and cap rules.

English TM recall adds bounded conservative variants for regular singular/plural forms, hyphen/space forms, and dotted acronyms. Variants only widen candidates; final evidence gates still decide emission. Canonical scoring handles cases such as dotted acronyms and regular plurals while rejecting one-sided short-acronym collisions. Multi-word concordance requires phrase-level evidence; one ordinary token or stopword overlap is insufficient.

## TB matching

Mounted TBs are queried for source terms, and selected terms become structured per-request references.

Default/CJK matching uses strict normalized term matching. The English overlay supports conservative regular singular/plural, possessive, hyphen/space, and uppercase dotted-acronym equivalents. It does not use general stemming or fuzzy edit distance.

Read-only partial-window context rows do not receive TB blocks.

## Source terminology precheck

Source terminology precheck is a provider-backed, read-only workflow that discovers source-language term candidates not already covered by the project's mounted TB matches. The reusable extractor belongs to `@cat/localization`; desktop file handling is its first application adapter, and future CLI surfaces must delegate to the same contract instead of recreating extraction logic.

The extractor accepts document-qualified units with source text and per-unit historical terms. Equivalent source rows may share one provider request, but results are mapped back to every original unit identity. Provider requests contain at most ten unique source rows and may be split earlier by prompt-size budget. Independent batches use the shared bounded scheduler and honor `maxConcurrency`. Strict responses return every opaque request id exactly once and contain source terms only—no target suggestions, translations, classifications, or prose. Malformed or contract-invalid responses may receive bounded repair feedback; provider transport and authentication failures fail that batch immediately instead of being resent as validation feedback.

Provider candidates are treated as untrusted. Extraction is deliberately precision-first: the prompt rejects ordinary vocabulary, descriptive phrases, and incidental concepts, says that an empty result is normal, forbids forced extraction, and allows the complete segment when it is itself one glossary-worthy unit. Capitalization, repetition, and phrase shape are explicitly insufficient on their own; glossary value is a semantic model decision based on localization consistency risk, not a language-specific word list or casing heuristic. Local validation remains deterministic: a candidate must be an exact substring of its source unit, is normalized and deduplicated, and is removed when the existing language-aware TB rules consider it covered by a historical term. Batch failures stay scoped to their units. Global aggregation preserves the first source spelling, records other surface variants, occurrence counts, document/unit identities, row numbers, and bounded source examples.

The desktop Settings dialog exposes the selection-policy portion of this prompt as an app-wide named-prompt library. The current precision-first policy remains a read-only built-in default; users can create, rename, edit, activate, and delete multiple custom policies, while activating the Default card preserves the saved library. A legacy single custom policy is surfaced as a named prompt and migrates into the library on the next mutation. Invalid catalog data falls back to the valid entries or Default and surfaces a recovery warning before the next mutation replaces the invalid stored value. Source language, source rows, historical terms, prompt-injection protection, exact-substring/source-only requirements, strict response shape, id correlation, and validation-repair feedback remain application-owned and cannot be replaced by a customization. Each extraction job reads the active prompt in one settings snapshot when it starts, and prompt-size batching includes that policy.

The desktop `TM/TB` action offers source-term extraction alongside the existing TM/TB reference export. Reference export preserves the retained source sheet, overlays its target column from the file's current stored segments (including cleared targets), and appends the per-row TM/TB reference columns. Precheck runs in a worker, uses the project's configured provider, and writes an output workbook containing per-row historical TB/source candidates plus a `New_Terms` summary sheet. Cancellation is cooperative: no new lookup or provider batch starts after the request is observed, in-flight provider responses may finish, and their completed candidates are preserved in a partial workbook while untouched rows are marked `cancelled`. When the retained source workbook exists, the output preserves its first sheet; when that workbook is unavailable, desktop reconstructs a temporary source-only sheet from the file's stored segments and removes the temporary file after the worker finishes. Valid UTF-8 CSV source text is decoded explicitly so non-Latin content survives this fallback unchanged, while other encodings retain the existing binary parser path. It does not translate terms, update a TB, modify project segments, or feed candidates into AI translation. Those are separate future workflows.

## Runtime TM

Runtime TM is an isolated in-memory SQLite TM for one headless file translation job. It reuses the normal repository/service/module recall path and is discarded when the job ends.

It is enabled only for `translateFile()` with `window` or `window-partial`. It is not used by inspect, legacy concurrent `translateUnits()`, or legacy desktop flows.

Eligible non-empty `translated` and `skipped` results are appended after their task results have been persisted. On resume, compatible checkpoint results rebuild Runtime TM before new requests continue.

Runtime references merge into the existing TM/concordance blocks, never a separate prompt section. Selection has independent slots:

| Source                |  TM | Concordance |
| --------------------- | --: | ----------: |
| Persistent TMs        |   3 |           7 |
| Runtime TM            |   3 |           7 |
| Maximum merged prompt |   6 |          14 |

Runtime matches duplicating a selected persistent match with the same source hash and target text are removed. The merged maximum is therefore 20 references, often fewer.

Runtime TM never writes Working TM, Main TM, or the persistent project database and never appears as a user-managed resource.

## Desktop Working TM and repeated segments

Every translation project has a mounted read/write Working TM. Confirming a translation segment normally updates that TM inside the same transaction as the segment/file state. Review and custom project types do not perform this commit.

The Files tab `Commit` action can write a whole file to either its writable Working TM or a mounted Main TM. It defaults to confirmed segments; `All with translations` also includes other statuses when both source and target are non-empty. Entry and FTS updates for the file run in one transaction, so a failed commit leaves the target TM unchanged. A Working TM target must be the writable Working TM mounted to that file's translation project, and review/custom projects cannot use this route to populate a Working TM.

The Project Translation Memory tab keeps Working TM management intentionally narrow: users can export its source/target rows to XLSX or reset all entries after confirmation. Export reads one stable database snapshot and serializes the workbook in a background worker, writing the stored source/target content and original tag text into two visible columns. Reset runs in a background worker and atomically removes the current entries plus their FTS rows, then reloads the pane and publishes a project-wide `working-tm-reset` invalidation. The TM resource, project mount, project files, and translated segments are preserved.

Same-source repeats are scoped to the current file:

- the first occurrence is the `leader` and propagates when confirmed;
- later empty or same-target occurrences start as `following`;
- a later non-empty different target starts as `detached`;
- manually changing or directly confirming a follower makes it `detached`;
- automated TM batch confirmation preserves an existing follower link;
- AI translation alone keeps a follower linked, and leader propagation confirms it without detaching;
- detached later occurrences are not overwritten, and a later occurrence cannot start a second propagation chain;
- unique sources do not persist repeat metadata.

The editor marks every occurrence in a same-source repeat group. The first occurrence uses the same repeat icon with a small superscript `1`; later occurrences use the plain repeat icon. The `首次重复` quick filter isolates those first occurrences.

Post-commit `working-tm-updated` and segment events refresh match/reference state. Whole-file commits to Working TM publish a project-scoped `working-tm-updated` invalidation after the write succeeds. Batch workflows that deliberately should not pollute Working TM pass `commitToWorkingTM: false` while preserving their own propagation/event behavior.

## Persistent resource import and sync

Import is a one-time addition/overwrite operation. Sync creates a durable link to a local spreadsheet and exposes the linked file in desktop resource UI.

The desktop management cards can rename TM/TB metadata in place. Renaming preserves the resource id, language pair, entries, project mounts, external-file sync binding, and `updatedAt`; resource-list order and equal-priority mount order therefore remain stable.

All four write paths (TM import, TM sync, TB import, TB sync) treat a file as a key-to-entry mapping with last-wins semantics: rows sharing a conflict key (TM `srcHash`, TB `srcNorm`) collapse to the final occurrence, and duplicates count as skipped. TM import streams the file in one pass, tracking this run's writes per `srcHash` so a later duplicate rewrites the same entry in place; TB paths reduce in memory (`dedupeRowsLastWins`); TM sync reduces via `INSERT OR REPLACE` staging. `ON CONFLICT` clauses therefore express only file-vs-database policy: import `overwrite` replaces existing DB entries, otherwise they win.

Project resource pickers offer only unmounted TMs and TBs whose directed source/target language pair exactly matches the project.

### TB sync

TB sync parses the entire linked workbook before mutation, then mirrors valid rows by clearing and rewriting the TB in one transaction. A read/parse/insert failure rolls back instead of leaving a partial TB. Sync records its latest outcome in `app_settings` and publishes reference invalidation after success.

### TM sync

TM sync is incremental and worker-only for large-file safety:

1. Parse the first sheet and stage valid normalized rows in `tm_sync_staging` by sync run.
2. Diff staged rows against existing entries in SQL.
3. Apply additions, changes, and deletions in bounded transactions.
4. Maintain base rows and FTS rows together, then clean staging.

TM sync strictly mirrors the valid deduplicated rows in the linked file: entries missing from the file are removed, including local edits or entries committed through other workflows. A header-based file containing only its reviewed header row therefore clears the TM. The completed or partial report counts only overwritten/deleted local edits whose apply transaction completed. Cancellation can leave a consistent applied prefix; rerunning converges, and only a full success advances the conflict baseline.

Source/target columns must be distinct nonnegative indexes at the main-process trust boundary. Saving a binding persists the reviewed column positions and, for header-based files, the selected header text. Every sync revalidates that identity before staging or entry mutation; a legacy binding without identity, changed header/position, missing selected header, or invalid configuration requires mapping review instead of risking a whole-TM rewrite. Headerless files have no semantic header identity, so both reviewed positions must contain observable values and the user must review the mapping before every strict sync. That one-use review authorization is process-local and expires when the sync starts or the app restarts; this prevents a semantic column move from being accepted merely because the old numeric positions still contain data. Changing the file, positions, header mode, or header identity starts fresh sync history; re-saving the exact reviewed binding preserves it. Legacy deletion-policy fields no longer affect behavior and are removed on the next config or outcome write.

Same-TM delete, import, file commit, mapping update, and sync operations are mutually exclusive in the desktop service so another writer cannot invalidate a successful strict-mirror result. Different TMs may sync independently and isolate their staging cleanup.

## Inspect, audit, artifacts, and resume

- Inspect composes prompt/reference artifacts without provider requests.
- Checkpoint JSONL is the only resume truth.
- Event JSONL is a lightweight progress stream.
- Snapshot output is throttled partial user output.
- Audit JSONL records request/repair/persist/Runtime-TM events without full text.
- Full artifacts are opt-in prompt/TM/TB diagnostics and may contain private content.

Inspect and translate should use the same request mode, baseline, and tag policy during diagnosis. Secrets must never be serialized into any of these outputs.

## Key entrypoints

| Concern                               | Source                                                                                                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token/tag helpers                     | [`packages/core/src/tag`](../packages/core/src/tag)                                                                                                                                                                                                                 |
| Prompt and strict response contracts  | [`packages/core/src/project`](../packages/core/src/project)                                                                                                                                                                                                         |
| Localization engine facade            | [`packages/localization/src/LocalizationEngine.ts`](../packages/localization/src/LocalizationEngine.ts)                                                                                                                                                             |
| Engine orchestration collaborators    | [`packages/localization/src/engine`](../packages/localization/src/engine)                                                                                                                                                                                           |
| Window request modes                  | [`packages/localization/src/requestModes`](../packages/localization/src/requestModes)                                                                                                                                                                               |
| MT module facade                      | [`packages/localization/src/modules/MTModule.ts`](../packages/localization/src/modules/MTModule.ts)                                                                                                                                                                 |
| MT prompt/response collaborators      | [`packages/localization/src/modules/MTModulePromptParams.ts`](../packages/localization/src/modules/MTModulePromptParams.ts), [`MTBatchResponseProcessor.ts`](../packages/localization/src/modules/MTBatchResponseProcessor.ts)                                      |
| TM/TB prompt modules                  | [`packages/localization/src/modules/TMModule.ts`](../packages/localization/src/modules/TMModule.ts), [`TBModule.ts`](../packages/localization/src/modules/TBModule.ts)                                                                                              |
| Source terminology precheck           | [`packages/localization/src/SourceTerminologyExtractor.ts`](../packages/localization/src/SourceTerminologyExtractor.ts), [`LocalizationSourceTerminologyPrechecker.ts`](../packages/localization/src/LocalizationSourceTerminologyPrechecker.ts)                    |
| Runtime TM merge                      | [`packages/localization/src/runtimeTm`](../packages/localization/src/runtimeTm)                                                                                                                                                                                     |
| Shared match services                 | [`packages/localization/src/services`](../packages/localization/src/services)                                                                                                                                                                                       |
| Desktop TM match facade/collaborators | [`apps/desktop/src/main/services/TMService.ts`](../apps/desktop/src/main/services/TMService.ts), [`TMMatchScoring.ts`](../packages/localization/src/services/TMMatchScoring.ts), [`TMMatchSelection.ts`](../packages/localization/src/services/TMMatchSelection.ts) |
| TM/TB repositories                    | [`packages/db/src/repos/TMRepo.ts`](../packages/db/src/repos/TMRepo.ts), [`TMSyncRepo.ts`](../packages/db/src/repos/TMSyncRepo.ts), [`TBRepo.ts`](../packages/db/src/repos/TBRepo.ts)                                                                               |
| Desktop segment behavior              | [`apps/desktop/src/main/services/SegmentService.ts`](../apps/desktop/src/main/services/SegmentService.ts)                                                                                                                                                           |
| Desktop TM/TB modules                 | [`apps/desktop/src/main/services/modules/TMModule.ts`](../apps/desktop/src/main/services/modules/TMModule.ts), [`TBModule.ts`](../apps/desktop/src/main/services/modules/TBModule.ts)                                                                               |

## Change checklist

When changing this system:

1. Identify the owner layer and keep app shells thin.
2. Test protected tags and literal placeholder-like text.
3. Test missing/extra/out-of-order provider ids and repair boundaries when response behavior changes.
4. Test persistent and Runtime TM limits/dedup separately when reference selection changes.
5. Test default/CJK and English profiles separately when normalization or recall changes.
6. Test transaction, FTS, cache invalidation, cancellation, and missing-file behavior for resource changes.
7. Update this document only with the durable resulting contract.
