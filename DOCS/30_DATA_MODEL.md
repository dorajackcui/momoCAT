# 30_DATA_MODEL

## Purpose
Document the persistent data model and current-schema bootstrap contract used by the app.

## When to Read
Read before changing schema, repositories, or SQL-level behavior.

## Source of Truth
- Schema bootstrap/validation: `packages/db/src/currentSchema.ts`
- Repositories: `packages/db/src/repos/*.ts`

## Last Updated
2026-03-30

## Owner
Core maintainers of `simple-cat-tool`

## Schema Version
- Current target schema version: `v14`
- Version table: `schema_version`
- Bootstrap behavior: create latest schema for empty DBs, allow current-marker DBs, reject unsupported old DBs

## Current-Schema Contract
1. Empty database files bootstrap directly to the latest schema.
2. Existing databases open only when they already carry the current `schema_version` marker and current required tables/columns.
3. Older or partial databases are intentionally rejected with a startup error; the app does not perform in-place historical migration.
4. Future schema changes must update the canonical schema definition and current marker together.

## Core Tables
### Project and file layer
- `projects`
- `files`
- `segments`

Key fields:
- `projects.aiModel`
- `projects.qaSettingsJson`
- `segments.qaIssuesJson`
- segment token/json payload columns and status/hash keys

AI runtime config:
- Runtime model tuning is stored outside SQLite in `userData/ai-runtime.json`
- Development path resolves to `.cat_data/ai-runtime.json`
- The runtime config currently stores per-model `reasoningEffort` for `gpt-5.4`, `gpt-5.4-mini`, `gpt-5`, and `gpt-5-mini`

### TM layer
- `tms`
- `project_tms`
- `tm_entries`
- `tm_fts` (FTS5)

### TB layer
- `term_bases`
- `project_term_bases`
- `tb_entries`

### App settings
- `app_settings`

## Critical Indexes
1. Segment lookup and order indexes (`fileId`, `orderIndex`, `srcHash`).
2. TM uniqueness and search indexes (`tmId+srcHash`, `matchKey`).
3. TB uniqueness and term lookup indexes (`tbId+srcNorm`, `srcTerm`).
4. Project mounting indexes for TM/TB priority and enabled-state retrieval.

## Compatibility Notes
1. Current-version-only startup is intentional in this project phase.
2. Historical database recovery, if needed later, should be implemented as an explicit import/reset tool, not as a permanent startup migration path.
3. The canonical current schema includes:
   - `projects.projectType`, `projects.aiPrompt`, `projects.aiTemperature`, `projects.aiModel`, `projects.qaSettingsJson`
   - `files.importOptionsJson`
   - `segments.qaIssuesJson`
   - TM/TB mounting and search tables (`tms`, `project_tms`, `tm_entries`, `tm_fts`, `term_bases`, `project_term_bases`, `tb_entries`)
   - `app_settings`
4. `projects.aiTemperature` is a legacy compatibility column. The app no longer reads it as the runtime source of truth and no longer exposes it in the UI.

## Change Protocol
1. Update the canonical schema definition in `packages/db/src/currentSchema.ts`.
2. Update the current schema marker if the persistent shape changes.
3. Cover at least:
- empty DB bootstrap
- current-marker reopen
- unsupported old/non-current DB rejection
4. Update this document in the same change.

## Related Code Entry Points
- `packages/db/src/index.ts`
- `packages/db/src/currentSchema.ts`
