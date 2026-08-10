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

## Base tables

### Projects and files

| Table             | Role                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| `projects`        | Project identity, language pair, project type, AI selection/prompt compatibility fields, and QA settings. |
| `files`           | Imported project files, import options, segment totals, and confirmed totals.                             |
| `segments`        | Ordered token-backed source/target units, status, hashes, metadata, and QA issues.                        |
| `project_prompts` | Named project-level saved prompts. A grandfathered authoritative table added through v15 maintenance.     |

Important project fields:

- `projectType` controls translation/review/custom behavior.
- `aiModel` stores the selected provider id, not a secret.
- `aiPrompt` is the legacy/default project prompt surface.
- `aiTemperature` remains for compatibility but is not the runtime tuning source of truth.
- `qaSettingsJson` stores the project QA rule configuration.

Important file/segment fields:

- `files.importOptionsJson` persists column selection and file-level tag policy used by edit, translation, QA, TM commit, and export.
- Renaming an imported file preserves its extension, identity, segments, statistics, import options, and `updatedAt`. When the internal project copy exists it is renamed with the metadata; if it is already missing, the metadata rename succeeds with an explicit degraded result so the desktop can warn that path-based operations remain unavailable.
- `segments.sourceTokensJson` and `targetTokensJson` are authoritative token payloads.
- `tagsSignature`, `matchKey`, and `srcHash` support tag-aware TM/repeat matching.
- `segments.metaJson` stores row/context metadata and repeat-propagation state.
- `segments.qaIssuesJson` stores current QA issues.
- `files.totalSegments` and `confirmedSegments` are maintained statistics; segment state remains the behavioral source.

Repeat state inside `metaJson` is one of:

- `leader`: first source occurrence that can propagate when confirmed within its file;
- `following` with `sourceSegmentId`: follows that leader and receives its confirmed target;
- `detached`: a later occurrence that no longer receives automatic propagation.

Leader identity is always determined by the first source occurrence in file order, even before its
metadata is written. Repeat state is persisted lazily: touching a later occurrence writes only that
occurrence, while changing or confirming the leader materializes the follower states needed for
propagation. Later empty or same-target occurrences start `following`; a later non-empty different
target starts `detached`. Manually changing or directly confirming a later occurrence also detaches
it. AI translation alone does not detach a follower, and confirmation propagated from the leader
keeps it following.

This is a JSON contract, not a separate schema column. Changes require model, repository, service, and regression-test updates together.

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
