# Data model

## Contract

The canonical SQLite schema is owned by [`packages/db/src/currentSchema.ts`](../packages/db/src/currentSchema.ts). Repository behavior is owned by [`packages/db/src/repos`](../packages/db/src/repos), and [`CATDatabase`](../packages/db/src/index.ts) is the application-facing facade.

The current schema marker is **v15**.

Startup behavior is intentionally strict:

1. An empty database is created directly at the current schema.
2. An existing database must contain exactly one `schema_version = 15` marker and every required base table/column.
3. A current-v15 database receives idempotent same-version maintenance before use.
4. A non-v15 or partial base schema is rejected; normal startup does not replay historical migrations.

## Repository ownership

Applications and shared services call `CATDatabase`; TM workflows enter through `TMRepo`. Internal collaborators share the same SQLite connection and are not alternate application APIs.

| Responsibility                                                    | Owner                                                                                                                                                      |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TM catalog, mounts, and public delegation                         | [TMRepo.ts](../packages/db/src/repos/TMRepo.ts)                                                                                                            |
| Entry writes/reads, FTS maintenance, and write transactions       | [TMEntryRepo.ts](../packages/db/src/repos/tm/TMEntryRepo.ts)                                                                                               |
| Fuzzy recall SQL and its query plan                               | [TMFuzzyRecall.ts](../packages/db/src/repos/tm/TMFuzzyRecall.ts), [tmRecallQuery.ts](../packages/db/src/repos/tm/tmRecallQuery.ts)                         |
| Source-side concordance recall, evidence gates, and query budgets | [TMConcordanceRecall.ts](../packages/db/src/repos/tm/TMConcordanceRecall.ts), [tmConcordancePolicy.ts](../packages/db/src/repos/tm/tmConcordancePolicy.ts) |
| Row decoding and result diversity                                 | [tmEntryRows.ts](../packages/db/src/repos/tm/tmEntryRows.ts), [tmRecallDiversity.ts](../packages/db/src/repos/tm/tmRecallDiversity.ts)                     |
| External-file staging, diff, and apply SQL                        | [TMSyncRepo.ts](../packages/db/src/repos/TMSyncRepo.ts)                                                                                                    |

Explicit Concordance Search composes source-and-target recall through the facade; it remains distinct from source-side concordance references used during translation. Recall collaborators resolve mounted resources for each call, so mount changes remain visible without rebuilding the repository. Changes to scoring, language profiles, or result selection follow [Localization](LOCALIZATION.md#tm-matching-and-prompt-selection).

Validate facade behavior in [TMRepo.test.ts](../packages/db/src/repos/TMRepo.test.ts) and [TMRepo.sync.test.ts](../packages/db/src/repos/TMRepo.sync.test.ts), then run the cross-layer reference checks from [Development](DEVELOPMENT.md#validation-strategy). Keep transaction, ordering, scope, limit, and diagnostic-event behavior stable when moving internals.

## Base tables

### Projects and files

| Table             | Role                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `projects`        | Project identity, language pair, project type, AI provider/prompt settings, and QA settings. |
| `files`           | Imported project files, import options, segment totals, and confirmed totals.                |
| `segments`        | Ordered token-backed source/target units, status, hashes, metadata, and QA issues.           |
| `project_prompts` | Named project-level saved prompts.                                                           |

Important project fields:

- `projectType` accepts Translation or Custom. Stored `review` rows read as Custom with their effective instruction in `aiPrompt`, without database writes. Saving the prompt or AI settings persists that conversion. [Compatibility tests](../packages/db/src/repos/ProjectRepo.compatibility.test.ts) own this boundary.
- `aiModel` stores the selected provider id, not a secret. An unset provider uses the empty-string default; nullable API inputs are normalized on write so a project prompt can be saved before a provider is configured.
- `aiPrompt` stores the active project instruction; `project_prompts` stores reusable named prompts.
- `aiTemperature` remains for compatibility but is not the runtime tuning source of truth.
- `qaSettingsJson` stores enabled categories, disabled optional checks, instant-on-confirm, and tag/term/substring options. [QA settings](../packages/core/src/project/qaSettings.ts) owns defaults and normalization; [QA compatibility](LOCALIZATION.md#qa-compatibility-boundaries) owns accepted older values.

Important file/segment fields:

- `files.importOptionsJson` persists column selection and file-level tag policy used by token parsing and QA.
- Renaming an imported file preserves its extension, identity, segments, statistics, import options, and `updatedAt`. When the internal project copy exists it is renamed with the metadata; if it is already missing, the metadata rename succeeds with an explicit degraded result so the desktop can warn that path-based operations remain unavailable.
- `segments.sourceTokensJson` and `targetTokensJson` are authoritative token payloads.
- Segment workflow status is `empty`, `draft`, or `confirmed`. Unconfirmed targets with non-whitespace content (including tags) are `draft`; the rest are `empty`. Explicit confirmation is retained until an edit replaces it. AI translation and custom processing produce unconfirmed targets and do not encode their origin in workflow status.
- Reads normalize stored `new`, `translated`, and `reviewed` values by target content without rewriting data or timestamps; writes use canonical states. Project/file aggregates apply the same normalization, including on readonly connections; file progress exposes `emptySegments` for the empty bucket.
- `tagsSignature`, `matchKey`, and `srcHash` support tag-aware TM/repeat matching.
- `segments.metaJson` stores row/context metadata.
- `segments.qaIssuesJson` stores the last persisted QA findings, including optional group identity/label, terminology origins, and reference rows. NULL means no saved result; `[]` is a saved result with no findings. Neither alone proves whole-file freshness. Replacement, merging, and invalidation follow the [QA result lifecycle](LOCALIZATION.md#qa-result-lifecycle); legacy fields follow the [compatibility boundary](LOCALIZATION.md#qa-compatibility-boundaries).
- `files.totalSegments` and `confirmedSegments` are maintained statistics; segment state remains the behavioral source.

Repeat groups and their first occurrence are derived from `fileId`, `srcHash`, and `orderIndex`. Stored `metaJson.repeatPropagation` values are ignored and left untouched. Propagation behavior is owned by [Localization](LOCALIZATION.md#desktop-working-tm-and-repeated-segments).

### Translation memories

| Table             | Role                                                         |
| ----------------- | ------------------------------------------------------------ |
| `tms`             | Working/Main TM metadata and language pair.                  |
| `project_tms`     | Project mount, priority, permission, and enabled state.      |
| `tm_entries`      | Token-backed TM entries keyed by TM and source hash.         |
| `tm_fts`          | FTS5 trigram source/target index for recall and concordance. |
| `tm_sync_staging` | Disk-backed scratch rows for chunked external-file TM sync.  |

`tm_entries.ftsRowid` is an additive performance mapping to the matching FTS row. Current-v15 maintenance adds/backfills it when needed, removes duplicate/orphan FTS rows encountered during mapping, and uses `0` for a known entry with no FTS row.

`tm_sync_staging` is not user data. Rows are scoped by `tmId` and `syncRunId`, cleared around sync runs, and may be dropped/recreated when an obsolete scratch shape is found.

Sync transaction ownership remains above the repository collaborator: callers open the bounded transaction, `TMRepo` forwards the established public method, and `TMSyncRepo` updates entry and FTS rows within that transaction. Do not call the collaborator as a second public persistence API.

### Term bases

| Table                | Role                                                           |
| -------------------- | -------------------------------------------------------------- |
| `term_bases`         | TB metadata and language pair.                                 |
| `project_term_bases` | Project mount, priority, and enabled state.                    |
| `tb_entries`         | Normalized source term, target term, note, and usage metadata. |
| `tb_fts`             | FTS5 trigram index used by bounded term recall.                |

`tb_entries.ftsRowid` has the same additive maintenance and writer semantics as the TM mapping.

### Settings

`app_settings` is a key/value store for app-level configuration.

Durable key families include:

- AI connection catalog and provider catalog;
- separately stored AI connection keys;
- TM/TB external-file sync configuration and last outcome;
- other app-level settings owned by repository/services.

TM external-file sync settings store the linked path, source/target column positions, column identity, latest outcome, and last successful conflict baseline. Header-based identities also store header text; headerless one-use approval is process-local. Mapping validation, binding changes, and older fields follow the [TM sync contract](LOCALIZATION.md#tm-sync).

AI runtime tuning is deliberately outside SQLite in `ai-runtime.json` next to the resolved user-data database (under `.cat_data/` in source development). Optional proxy values live in `proxy.env`. Neither belongs in tracked documentation or diagnostics.

## Cloud cache format

Cloud copies retain the local v15 document schema. [CloudAccountSnapshot](../packages/db/src/cloud/CloudAccountSnapshot.ts) uses transport format 2 and explicit column allowlists; it never exports `app_settings`, external paths, or FTS rows. Projects include their Working TM and mount references; Main TM/TB have independent snapshots. Scoped restoration validates identities and foreign keys, maps UUIDs to device-local integer IDs, rebuilds resource indexes, and preserves other cached projects/resources. TB restoration retains normal QA invalidation for every mounted project. Isolating the FTS corpus can change BM25 recall ordering compared with a local database containing unrelated resources; identical matching code does not imply identical rankings across different corpora.

Only an isolated cloud account cache receives the cloud cache format marker, [CloudAccountTracker](../packages/db/src/cloud/CloudAccountTracker.ts), and dirty-tracking triggers. Each project and independent resource has its own generation, confirmed generation, revision, signature, and durable pending operation. Generations change in the same SQLite transaction as authoritative writes. A full upload snapshot, original file chunks, and operation ID persist before transmission; acknowledgement only advances the captured generation, preserving subsequent edits. Project downloads use a durable original-file installation journal and a receipt committed with the SQL snapshot; startup recovery restores or retains the correct files and acknowledges only the installed generation. Derived QA invalidation while receiving a TB is acknowledged only for projects that were clean before restoration. Cache metadata is scoped by service origin and account. Cloud-side identity, revision comparison, operation deduplication, and immutable blob manifests use separate [D1 migrations](../apps/cloud-api/migrations); they do not change the local schema marker. Prototype V1 routes remain readable; opening a V1-only project lazily copies its existing device cache into V2 with fresh subordinate/resource identities, retaining the original cache and requiring explicit Sync to publish.

## Required shape vs maintained shape

`REQUIRED_TABLES` and `REQUIRED_COLUMNS` define the base v15 shape that must already exist. Additive structures such as `project_prompts`, `tm_sync_staging`, `ftsRowid`, and performance indexes are created by `applyCurrentSchemaMaintenance()` so current-v15 databases from earlier builds remain usable.

The authoritative `project_prompts` table is a v15 maintenance exception. For other schema changes:

- Rebuildable indexes, scratch tables, and safely derivable mappings may be maintenance.
- New authoritative data, changed meaning, destructive transforms, or a required non-derivable column need an explicit schema-version and compatibility design.

## Index and consistency invariants

- Files are indexed by project; segments by file/order and file/source hash.
- TM entries are unique by `(tmId, srcHash)` and indexed by match key/update time.
- TB entries are unique by `(tbId, srcNorm)` and indexed for normalized/source-term lookup.
- Project TM/TB mounts are keyed by project/resource and ordered by enabled state/priority.
- Entry writers update the base table and FTS row together.
- Project/file/segment cascades and resource-mount cascades must remain valid with foreign keys enabled.
- Sync staging cleanup for one TM must not delete an active run for another TM.

## Change protocol

1. Decide whether the change is base schema, same-version maintenance, repository-only behavior, or a JSON contract.
2. Update the canonical schema/maintenance and relevant types/repositories together.
3. Bump `CURRENT_SCHEMA_VERSION` when the required authoritative shape changes.
4. Add tests for empty bootstrap, current-marker reopen, the maintenance path, and non-current/partial rejection as applicable.
5. Add repository/service tests for transactions, FTS consistency, and app-visible behavior.
6. Update this document and run:

```bash
npm run test:db-schema
npm run docs:check
```

Never test schema recovery against a real user database. Use an in-memory or temporary copy and preserve the original before any manual investigation.
