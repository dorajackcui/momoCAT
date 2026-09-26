# Data model

## Contract

The canonical SQLite schema is owned by [`packages/db/src/currentSchema.ts`](../packages/db/src/currentSchema.ts). Repository behavior is owned by [`packages/db/src/repos`](../packages/db/src/repos), and [`CATDatabase`](../packages/db/src/index.ts) is the application-facing facade.

The current schema marker is **v15**.

Startup behavior is intentionally strict:

1. An empty database is created directly at the current schema.
2. An existing database must contain exactly one `schema_version = 15` marker and every required base table/column.
3. A current-v15 database receives idempotent same-version maintenance before use.
4. A non-v15 or partial base schema is rejected; normal startup does not replay historical migrations.

“Same-version maintenance” is narrower than a historical migration. It currently creates performance indexes and additive support structures used by features introduced while the marker remained v15. Code that needs a recovery/import path must implement it explicitly rather than weakening startup validation.

## Repository ownership

Applications and shared services continue to call `CATDatabase`; TM workflows enter through `TMRepo`. Internal collaborators share the same SQLite connection and are not alternate application APIs.

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

| Table             | Role                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| `projects`        | Project identity, language pair, project type, AI selection/prompt compatibility fields, and QA settings. |
| `files`           | Imported project files, import options, segment totals, and confirmed totals.                             |
| `segments`        | Ordered token-backed source/target units, status, hashes, metadata, and QA issues.                        |
| `project_prompts` | Named project-level saved prompts. A grandfathered authoritative table added through v15 maintenance.     |

Important project fields:

- `projectType` selects Translation or Custom behavior. Repository reads expose legacy `review` rows as Custom with their effective review instruction materialized into `aiPrompt`; inputs, contexts, outputs, timestamps, and stored rows remain unchanged on read. Saving the project prompt or AI settings persists the Custom type and edited prompt, so language instructions are not reapplied. New Review projects are rejected.
- `aiModel` stores the selected provider id, not a secret. An unset provider uses the empty-string default; nullable API inputs are normalized on write so a project prompt can be saved before a provider is configured.
- `aiPrompt` is the legacy/default project prompt surface.
- `aiTemperature` remains for compatibility but is not the runtime tuning source of truth.
- `qaSettingsJson` stores enabled category IDs, disabled optional check IDs, instant-on-confirm, and tag/term/substring options (including standard tag types; legacy tagMode is accepted then removed during normalization). Missing fields receive shared defaults without enabling extra categories in existing saved configurations. The contract lives in [QA settings](../packages/core/src/project/qaSettings.ts); this remains schema v15 JSON.

Important file/segment fields:

- `files.importOptionsJson` persists column selection and file-level tag policy used by token parsing and QA.
- Renaming an imported file preserves its extension, identity, segments, statistics, import options, and `updatedAt`. When the internal project copy exists it is renamed with the metadata; if it is already missing, the metadata rename succeeds with an explicit degraded result so the desktop can warn that path-based operations remain unavailable.
- `segments.sourceTokensJson` and `targetTokensJson` are authoritative token payloads.
- Segment workflow status is `empty`, `draft`, or `confirmed`. Unconfirmed targets with non-whitespace content (including tags) are `draft`; the rest are `empty`. Explicit confirmation is retained until an edit replaces it. AI translation and custom processing produce unconfirmed targets and do not encode their origin in workflow status.
- This status change is repository-only compatibility on the existing v15 `TEXT` column: reads map legacy `new`, `translated`, and `reviewed` values by target content, while every insert/update writes a canonical state. Opening a database does not rewrite segment data or timestamps. Project/file aggregates use the same normalization for legacy rows, including readonly connections; file progress exposes `emptySegments` for the remaining empty bucket.
- `tagsSignature`, `matchKey`, and `srcHash` support tag-aware TM/repeat matching.
- `segments.metaJson` stores row/context metadata.
- `segments.qaIssuesJson` stores the last persisted QA findings, including optional group identity/label, terminology origins, and reference rows. NULL means no saved result; `[]` is a saved result with no findings. Neither alone proves whole-file freshness. Replacement, merging, and invalidation follow the [QA result lifecycle](LOCALIZATION.md#qa-result-lifecycle); legacy fields follow the [compatibility boundary](LOCALIZATION.md#qa-compatibility-boundaries).
- `files.totalSegments` and `confirmedSegments` are maintained statistics; segment state remains the behavioral source.

Repeat groups and their first occurrence are derived from `fileId`, `srcHash`, and `orderIndex`.
No follow/detach state is persisted. Legacy `metaJson.repeatPropagation` values are ignored and
left untouched; opening or editing an existing v15 database needs no metadata rewrite or schema
change. Propagation behavior is owned by [Localization](LOCALIZATION.md#desktop-working-tm-and-repeated-segments).

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

Each TM external-file sync value stores the linked file path, reviewed source/target columns, and a column identity. Header-based identities contain the reviewed positions and header text; headerless identities contain the reviewed positions, while their one-use review authorization remains process-local and is never persisted. Bindings created before this identity existed remain readable for UI display but must be reviewed and re-saved before strict sync. The same JSON also stores the latest run outcome and the last fully successful conflict baseline. A changed binding starts without the previous run history; legacy deletion-policy fields are tolerated on read but have no behavioral effect.

AI runtime tuning is deliberately outside SQLite in `ai-runtime.json` next to the resolved user-data database (under `.cat_data/` in source development). Optional proxy values live in `proxy.env`. Neither belongs in tracked documentation or diagnostics.

## Required shape vs maintained shape

`REQUIRED_TABLES` and `REQUIRED_COLUMNS` define the base v15 shape that must already exist. Additive structures such as `project_prompts`, `tm_sync_staging`, `ftsRowid`, and performance indexes are created by `applyCurrentSchemaMaintenance()` so current-v15 databases from earlier builds remain usable.

`project_prompts` is an existing exception: it stores authoritative user data even though it was introduced through same-version maintenance. Treat it as grandfathered behavior, not as precedent for adding more business tables without a schema-version design.

Do not casually add new business data through maintenance to avoid a version bump. Use this distinction:

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
