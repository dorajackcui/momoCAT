# Docs System Consolidation Design

Status: approved design for implementation planning.

## Purpose

Consolidate the active documentation system into one clean, maintainable
outer-numbered structure. The result should serve two agent audiences:

- Coding agents need to understand architecture boundaries, ownership, and
  validation responsibilities before editing code.
- Work agents need to understand how to operate the CLI/headless workflows
  without reading internal implementation notes.

The documentation system should be agent-first and CLI-first. The legacy
desktop app remains a peer consumer of shared localization capability, but it
is not the center of new active docs.

## Current Problem

Active information is split between outer `DOCS/*.md` files and
`DOCS/agent-first/*`. Several topics are repeated in both places:

- CLI/headless direction.
- Localization architecture boundaries.
- MT Window Mode and request-mode behavior.
- Smoke and artifact workflows.

This makes it unclear which file is authoritative. Historical specs and plans
also risk looking like active policy when they are really design records.

## Target Topology

The active docs should be the outer numbered docs only:

```text
DOCS/
  00_START_HERE.md
  10_ARCHITECTURE.md
  20_ENGINEERING_RUNBOOK.md
  30_DATA_MODEL.md
  40_CLI_OPERATION.md
  50_MT_REQUEST_MODEL.md
  60_TM_TB_REFERENCE.md
  90_STATUS_AND_ROADMAP.md
  99_HISTORY.md
  archive/
```

`DOCS/agent-first/` should not remain an active documentation directory after
the migration.

## Document Responsibilities

### `00_START_HERE.md`

The only onboarding entrypoint.

It should answer:

- What is the current project direction?
- Am I acting as a coding agent or a work agent?
- Which document should I open next?

It should not duplicate command details, prompt contracts, or long architecture
sections.

### `10_ARCHITECTURE.md`

The development architecture authority.

It should define:

- Layer boundaries.
- Module ownership.
- Dependency direction.
- Allowed and forbidden imports.
- The active shared localization chain:

```text
apps/cli -> @cat/localization -> @cat/db -> @cat/core
apps/desktop -> @cat/localization
```

The CLI must stay a thin app surface over `@cat/localization`. It must not
depend on `apps/desktop` or own persistence/domain behavior directly.

### `20_ENGINEERING_RUNBOOK.md`

The coding workflow and validation authority.

It should define:

- Test and build ladder.
- Required checks before completion.
- Failure playbooks.
- Documentation update rules.
- PR or commit hygiene.

It should link to `40_CLI_OPERATION.md` for CLI smoke details instead of
duplicating the commands.

### `30_DATA_MODEL.md`

The database and persistence reference.

It should define:

- Current schema contract.
- Critical tables and indexes.
- Persistence change protocol.
- DB-related code entry points.

It should be read only when schema, repositories, or persistence behavior are
in scope.

### `40_CLI_OPERATION.md`

The work-agent operating manual.

It should define:

- `momocat inspect projects`.
- `momocat inspect localization`.
- `momocat translate file`.
- Request mode options.
- Standard local smoke flow.
- Checkpoint, events, artifact, and snapshot outputs.
- Resume behavior.
- How to inspect real translation results.
- Real-provider risk notes.

It should use neutral placeholders for all local environment values:

- `<project-id>`
- `<input.xlsx>`
- `<local-db>`
- `<provider-id>`
- `<model>`
- `<output-dir>`

It should not explain internal architecture beyond links to `10` and `50`.

### `50_MT_REQUEST_MODEL.md`

The MT/headless request-model authority.

It should define:

- `window`.
- `window-partial`.
- Physical scan windows.
- Request rows versus read-only context rows.
- Prompt order.
- Strict JSON response contract.
- Retry and validation behavior.
- Inspect and artifact interpretation for MT prompts.

Partial Window Mode prompt order should be authoritative here:

```text
batch instruction
read-only context rows
rows requiring target text
validation feedback if present
strict JSON format
```

### `60_TM_TB_REFERENCE.md`

The active TM/TB behavior reference.

It should consolidate the useful current facts from the old TM matching and
recall documents:

- Current TM matching flow summary.
- Concordance behavior summary.
- TB reference behavior.
- How TM/TB references enter MT prompts.
- Key code entry points.
- Debugging path for recall/reference issues.

Long historical design reasoning should move to archive or be summarized in
`99_HISTORY.md`. This file should be a current reference, not a large execution
plan.

### `90_STATUS_AND_ROADMAP.md`

The live status page.

It should contain:

- Current phase.
- Current top risks.
- Latest focused verification.
- Latest completed milestone.
- Now/next/later roadmap.

It should not duplicate command syntax, architecture diagrams, or request-mode
contracts.

### `99_HISTORY.md`

The historical index.

It should contain concise, sanitized summaries of retired decisions, old
specs, old plans, and prior incidents. It should clearly state that historical
material is not active policy.

### `archive/`

The non-active historical storage area.

Archive material is optional. If historical material contains sensitive local
or business information, prefer a sanitized summary in `99_HISTORY.md` over
preserving the full text.

## Migration Rules

1. Move active agent-first architecture facts from `DOCS/agent-first/ARCHITECTURE.md`
   into `10_ARCHITECTURE.md`.
2. Turn `DOCS/agent-first/CLI.md` into `40_CLI_OPERATION.md`.
3. Turn `DOCS/agent-first/MT_MODULE.md` into `50_MT_REQUEST_MODEL.md`.
4. Consolidate `35_TM_MATCH_FLOW.md`, `36_TM_RECALL_DESIGN.md`, and
   `45_TM_CONCORDANCE_TODO.md` into `60_TM_TB_REFERENCE.md`.
5. Rename or replace `40_STATUS_AND_ROADMAP.md` with
   `90_STATUS_AND_ROADMAP.md`.
6. Rename or replace `90_HISTORY_CONSOLIDATED.md` with `99_HISTORY.md`.
7. Archive or summarize old `DOCS/superpowers/*` material. Do not keep old
   specs and plans linked from active docs as if they were current policy.
8. Remove `DOCS/agent-first/` after its active content has been migrated.

## Deduplication Rules

- One active fact has one owner document.
- Other active docs should link to the owner instead of restating the fact.
- Command syntax belongs in `40_CLI_OPERATION.md`.
- MT request and prompt contracts belong in `50_MT_REQUEST_MODEL.md`.
- Architecture boundaries and forbidden imports belong in
  `10_ARCHITECTURE.md`.
- Current verification and roadmap status belong in `90_STATUS_AND_ROADMAP.md`.
- Historical context belongs in `99_HISTORY.md` or `archive/`.

## Sanitization Rules

Active docs must not include real local or business-sensitive values:

- No real project names.
- No character, customer, venue, or content names from private work.
- No provider endpoints.
- No model names from private provider configuration.
- No local absolute paths.
- No API keys or partial API keys.
- No prompt artifacts containing private source or target text.

Use neutral placeholders instead.

Archive is not an exception. If a historical document contains sensitive
values, either sanitize it before archiving or summarize it in `99_HISTORY.md`
without preserving the full text.

## Validation

The implementation should run at least:

```bash
rg "DOCS/agent-first|DOCS/superpowers/specs|DOCS/superpowers/plans" DOCS
rg "provider endpoint|local path|api key|baseUrl" DOCS
git diff --check
```

The first command should return no active-doc references except inside
`99_HISTORY.md` or archive indexes. The second command is a coarse prompt to
review whether sensitive environment details slipped into active docs.

## Acceptance Criteria

1. A new coding agent can start at `00_START_HERE.md` and identify the correct
   architecture, runbook, request-model, or data-model doc within 10 minutes.
2. A work agent can use `40_CLI_OPERATION.md` to inspect, run smoke, translate,
   resume, and locate outputs without reading internal architecture docs.
3. Active docs do not reference `DOCS/agent-first/` as an active location.
4. Active docs do not reference old `DOCS/superpowers/specs` or
   `DOCS/superpowers/plans` as active policy.
5. Real local paths, provider details, project names, and private content names
   are absent from active docs.
6. Historical material is clearly marked as non-active and sanitized.
7. The docs system remains small enough that each file has one obvious reason
   to exist.
