# Docs System Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split outer-docs plus `DOCS/agent-first/` system with one clean outer-numbered active docs system for coding agents and work agents.

**Architecture:** Active facts have one owner document. The outer numbered docs become the only active documentation surface; historical plans/specs move to sanitized history or archive. CLI usage belongs in `40_CLI_OPERATION.md`, MT request contracts belong in `50_MT_REQUEST_MODEL.md`, and architecture boundaries belong in `10_ARCHITECTURE.md`.

**Tech Stack:** Markdown, PowerShell, ripgrep, git, existing `DOCS/` structure.

---

## Source Design

- Spec: `DOCS/superpowers/specs/2026-05-25-docs-system-consolidation-design.md`
- Branch: `cat-cli`
- Scope: documentation only

## Constraints

1. Preserve unrelated user changes. Start each task with `git status --short DOCS`.
2. Do not add real local paths, provider endpoints, model names, project names, character names, customer names, API keys, or prompt artifacts to active docs.
3. Use neutral placeholders such as `<project-id>`, `<input.xlsx>`, `<local-db>`, `<provider-id>`, `<model>`, and `<output-dir>`.
4. Do not keep `DOCS/agent-first/` as an active docs directory.
5. Do not keep old `DOCS/superpowers/specs` or `DOCS/superpowers/plans` references in active docs. Historical mentions belong only in `99_HISTORY.md` or `DOCS/archive/`.
6. Prefer sanitized summaries over full archival copies when old content contains private business or environment details.

## Target Active Files

- Keep and rewrite: `DOCS/00_START_HERE.md`
- Keep and rewrite: `DOCS/10_ARCHITECTURE.md`
- Keep and lightly update: `DOCS/20_ENGINEERING_RUNBOOK.md`
- Keep and lightly update: `DOCS/30_DATA_MODEL.md`
- Create from migrated content: `DOCS/40_CLI_OPERATION.md`
- Create from migrated content: `DOCS/50_MT_REQUEST_MODEL.md`
- Create from consolidated TM/TB content: `DOCS/60_TM_TB_REFERENCE.md`
- Rename and rewrite: `DOCS/40_STATUS_AND_ROADMAP.md` -> `DOCS/90_STATUS_AND_ROADMAP.md`
- Rename and rewrite: `DOCS/90_HISTORY_CONSOLIDATED.md` -> `DOCS/99_HISTORY.md`
- Create: `DOCS/archive/README.md`

## Task 0: Preflight Inventory

**Files:**
- Read only: `DOCS/**/*.md`

- [ ] **Step 1: Check doc worktree state**

Run:

```powershell
git status --short DOCS
```

Expected: either no output or only intentional docs changes from the current execution session. If unrelated user changes appear, keep them and adapt edits around them.

- [ ] **Step 2: Inventory active document headings**

Run:

```powershell
rg -n "^#|^##|^###" DOCS\00_START_HERE.md DOCS\10_ARCHITECTURE.md DOCS\20_ENGINEERING_RUNBOOK.md DOCS\30_DATA_MODEL.md DOCS\35_TM_MATCH_FLOW.md DOCS\36_TM_RECALL_DESIGN.md DOCS\40_STATUS_AND_ROADMAP.md DOCS\45_TM_CONCORDANCE_TODO.md DOCS\90_HISTORY_CONSOLIDATED.md DOCS\agent-first\ARCHITECTURE.md DOCS\agent-first\CLI.md DOCS\agent-first\MT_MODULE.md
```

Expected: command prints current section maps. Use this output to avoid losing unique content while deduplicating.

- [ ] **Step 3: Inventory sensitive strings before editing**

Run:

```powershell
rg -n "https?://|[A-Za-z]:\\\\|api[_ -]?key|baseUrl|provider endpoint|local path|prompt artifact" DOCS
```

Expected: no output in active docs except generic policy text. Also manually review changed docs for private project names, character names, customer names, provider ids, model names, and private source or target text.

- [ ] **Step 4: No commit**

This task is read-only. Do not commit.

## Task 1: Establish Final Top-Level File Topology

**Files:**
- Rename: `DOCS/40_STATUS_AND_ROADMAP.md` -> `DOCS/90_STATUS_AND_ROADMAP.md`
- Rename: `DOCS/90_HISTORY_CONSOLIDATED.md` -> `DOCS/99_HISTORY.md`
- Create: `DOCS/archive/README.md`

- [ ] **Step 1: Check doc worktree state**

Run:

```powershell
git status --short DOCS
```

Expected: no unrelated docs changes.

- [ ] **Step 2: Rename status and history files**

Run:

```powershell
git mv DOCS\40_STATUS_AND_ROADMAP.md DOCS\90_STATUS_AND_ROADMAP.md
git mv DOCS\90_HISTORY_CONSOLIDATED.md DOCS\99_HISTORY.md
```

Expected: `git status --short DOCS` shows the two renames.

- [ ] **Step 3: Create archive README**

Create `DOCS/archive/README.md` with:

```markdown
# Archive

This directory stores non-active historical documentation.

Active docs live in the outer numbered `DOCS/*.md` files. Archive material is
not active policy and should not be required for normal coding-agent or
work-agent flows.

Do not archive real local paths, provider endpoints, API keys, model names,
project names, customer names, character names, or private prompt artifacts. If
historical material contains sensitive values, summarize it in
`DOCS/99_HISTORY.md` instead of preserving the full text.
```

- [ ] **Step 4: Verify file topology progress**

Run:

```powershell
Get-ChildItem DOCS -File | Sort-Object Name | Select-Object Name
```

Expected: output includes `90_STATUS_AND_ROADMAP.md` and `99_HISTORY.md`, and no longer includes `40_STATUS_AND_ROADMAP.md` or `90_HISTORY_CONSOLIDATED.md`.

- [ ] **Step 5: Commit topology shell**

Run:

```powershell
git add DOCS\90_STATUS_AND_ROADMAP.md DOCS\99_HISTORY.md DOCS\archive\README.md
git commit -m "docs: establish consolidated docs topology"
```

Expected: commit succeeds.

## Task 2: Rewrite the Entry Point and Architecture Boundary

**Files:**
- Modify: `DOCS/00_START_HERE.md`
- Modify: `DOCS/10_ARCHITECTURE.md`
- Delete after migration: `DOCS/agent-first/ARCHITECTURE.md`

- [ ] **Step 1: Check doc worktree state**

Run:

```powershell
git status --short DOCS
```

Expected: no unrelated docs changes.

- [ ] **Step 2: Rewrite `00_START_HERE.md` as the router**

Make `DOCS/00_START_HERE.md` follow this structure:

```markdown
# 00_START_HERE

## Purpose

Provide the single entrypoint for coding agents and work agents.

## Project Direction

This branch is agent-first and CLI-first. New localization capability should
land in shared packages and headless workflows before legacy desktop UI
integration. The desktop app remains a peer consumer of shared localization
capability.

## Choose Your Path

| Agent mode | Read first | Goal |
| --- | --- | --- |
| Coding agent | `10_ARCHITECTURE.md`, then `20_ENGINEERING_RUNBOOK.md` | Understand boundaries and validation before editing. |
| Work agent | `40_CLI_OPERATION.md` | Inspect projects, run translation, resume jobs, and read outputs. |
| MT/request-model work | `50_MT_REQUEST_MODEL.md` | Understand Window Mode and Partial Window Mode contracts. |
| TM/TB behavior work | `60_TM_TB_REFERENCE.md` | Understand current reference matching and prompt inputs. |
| DB/schema work | `30_DATA_MODEL.md` | Understand persistence contracts. |
| Planning or risk review | `90_STATUS_AND_ROADMAP.md` | Understand current phase and active risks. |

## Active Docs

- `10_ARCHITECTURE.md`: development boundaries and dependency direction.
- `20_ENGINEERING_RUNBOOK.md`: coding workflow and verification.
- `30_DATA_MODEL.md`: database and persistence reference.
- `40_CLI_OPERATION.md`: CLI/headless operating manual.
- `50_MT_REQUEST_MODEL.md`: MT request and prompt contracts.
- `60_TM_TB_REFERENCE.md`: TM/TB reference behavior.
- `90_STATUS_AND_ROADMAP.md`: live status and roadmap.
- `99_HISTORY.md`: sanitized historical index.

## Documentation Rules

- Active facts have one owner document.
- Link to the owner instead of repeating details.
- Do not put real local paths, provider details, project names, or private text
  in active docs.
- Archive material is not active policy.
```

Preserve any useful existing entry index only if it fits this routing role.

- [ ] **Step 3: Rewrite `10_ARCHITECTURE.md` as the development boundary**

Ensure `DOCS/10_ARCHITECTURE.md` contains these exact dependency facts:

````markdown
## Dependency Direction

```text
apps/cli -> @cat/localization -> @cat/db -> @cat/core
apps/desktop -> @cat/localization
```

`apps/cli` owns the `momocat` app surface only. It may parse arguments, print
help, control stdout/stderr, and call `@cat/localization` command APIs. It must
not import `apps/desktop`, `@cat/db`, or `@cat/core` directly.

`@cat/localization` owns headless localization orchestration: file adapters,
inspect, job planning, checkpoints, events, artifacts, `LocalizationEngine`,
and TM/TB/MT modules.

`@cat/core` owns pure contracts and algorithms. MT prompt builders, strict JSON
response parsers, tag/protected-marker helpers, and shared domain types belong
there when they are pure.
```
````

Also migrate the useful layer descriptions from `DOCS/agent-first/ARCHITECTURE.md` into focused sections:

- File layer.
- Job layer.
- LocalizationEngine layer.
- Resource modules.
- Runtime artifacts.
- Stable contracts.

Keep the document development-focused. Move CLI command details to `40_CLI_OPERATION.md`.

- [ ] **Step 4: Remove migrated agent-first architecture file**

Run:

```powershell
git rm DOCS\agent-first\ARCHITECTURE.md
```

Expected: file is staged for deletion.

- [ ] **Step 5: Validate no active architecture drift**

Run:

```powershell
rg -n "apps/cli -> @cat/localization|apps/desktop -> @cat/localization|DOCS/agent-first/ARCHITECTURE" DOCS\00_START_HERE.md DOCS\10_ARCHITECTURE.md
```

Expected: dependency facts appear in `10_ARCHITECTURE.md`; no active reference to `DOCS/agent-first/ARCHITECTURE.md`.

- [ ] **Step 6: Commit entry and architecture migration**

Run:

```powershell
git add DOCS\00_START_HERE.md DOCS\10_ARCHITECTURE.md DOCS\agent-first\ARCHITECTURE.md
git commit -m "docs: consolidate entrypoint and architecture"
```

Expected: commit succeeds.

## Task 3: Create the CLI Operation Manual

**Files:**
- Rename and rewrite: `DOCS/agent-first/CLI.md` -> `DOCS/40_CLI_OPERATION.md`
- Modify: `DOCS/20_ENGINEERING_RUNBOOK.md`

- [ ] **Step 1: Check doc worktree state**

Run:

```powershell
git status --short DOCS
```

Expected: no unrelated docs changes.

- [ ] **Step 2: Rename CLI doc**

Run:

```powershell
git mv DOCS\agent-first\CLI.md DOCS\40_CLI_OPERATION.md
```

Expected: status shows a rename.

- [ ] **Step 3: Rewrite `40_CLI_OPERATION.md` for work agents**

Make `DOCS/40_CLI_OPERATION.md` use this section structure:

````markdown
# 40_CLI_OPERATION

## Purpose

Operational guide for work agents using the `momocat` CLI and headless
localization flows.

## Before Running Commands

- Build the CLI after source changes: `npm run build:cli`.
- From source checkout, use `npm --silent run cli -- <momocat arguments>`.
- Use placeholders in docs and examples. Keep real local values in ignored
  local config files.

## Inspect Projects

```bash
momocat inspect projects --db <local-db> --project-id <project-id>
momocat inspect projects --db <local-db> --project-id <project-id> --json
```

## Inspect Localization

```bash
momocat inspect localization --db <local-db> --project-id <project-id> --input <input.xlsx> --output <inspect.xlsx>
momocat inspect localization --db <local-db> --project-id <project-id> --input <input.xlsx> --output <inspect.xlsx> --json-output <inspect.json> --request-mode window-partial
```

Inspect does not send provider requests. Use the same `--request-mode` planned
for real translation.

## Translate File

```bash
momocat translate file --db <local-db> --project-id <project-id> --input <input.xlsx> --output <translated.xlsx>
momocat translate file --db <local-db> --project-id <project-id> --input <input.xlsx> --output <translated.xlsx> --request-mode window-partial
```

## Standard Smoke

```bash
npm run smoke:momocat
npm run smoke:momocat -- --dry-run
npm run smoke:momocat -- --inspect-only
npm run smoke:momocat -- --request-mode window-partial --prefix <run-prefix>
```

The smoke helper reads `.momocat-smoke.local.json`, which is gitignored.
`requestMode` applies to both inspect and translate.

## Sidecars and Outputs

| Output | Purpose |
| --- | --- |
| `<output>.checkpoint.jsonl` | Resume truth per unit. |
| `<output>.events.jsonl` | Lightweight progress stream. |
| `<output>.snapshot.xlsx` | Throttled partial output. |
| `<output>.artifacts.jsonl` | Opt-in prompt/TM/TB diagnostics for real translate runs. |
| `<prefix>-inspect.json` | No-request inspect artifacts. |
| `<prefix>-inspect.xlsx` | No-request inspect workbook. |

## Resume

```bash
momocat translate file --db <local-db> --project-id <project-id> --input <input.xlsx> --output <translated.xlsx> --resume
```

Use the same output and sidecar paths when resuming.

## Real Provider Risk

Real translate sends source text and project context to the configured
provider. Run inspect first when debugging prompt shape.
```
````

Keep concise helpful details from the old CLI doc, but do not repeat MT prompt contract details. Link to `50_MT_REQUEST_MODEL.md` for request-mode semantics.

- [ ] **Step 4: Update runbook to link CLI smoke details**

In `DOCS/20_ENGINEERING_RUNBOOK.md`, replace any detailed momocat smoke instructions with a short pointer:

```markdown
For CLI/headless inspect, smoke, translate, resume, and artifact interpretation,
use `DOCS/40_CLI_OPERATION.md`.
```

Keep development validation guidance in `20`.

- [ ] **Step 5: Validate CLI operation doc uses placeholders only**

Run:

```powershell
rg -n "https?://|[A-Za-z]:\\\\|api[_ -]?key|baseUrl|provider endpoint|local path|prompt artifact" DOCS\40_CLI_OPERATION.md
```

Expected: no output except generic risk text. Manually confirm examples use placeholders only.

- [ ] **Step 6: Commit CLI operation migration**

Run:

```powershell
git add DOCS\40_CLI_OPERATION.md DOCS\20_ENGINEERING_RUNBOOK.md DOCS\agent-first\CLI.md
git commit -m "docs: add cli operation manual"
```

Expected: commit succeeds.

## Task 4: Create the MT Request Model Authority

**Files:**
- Rename and rewrite: `DOCS/agent-first/MT_MODULE.md` -> `DOCS/50_MT_REQUEST_MODEL.md`

- [ ] **Step 1: Check doc worktree state**

Run:

```powershell
git status --short DOCS
```

Expected: no unrelated docs changes.

- [ ] **Step 2: Rename MT module doc**

Run:

```powershell
git mv DOCS\agent-first\MT_MODULE.md DOCS\50_MT_REQUEST_MODEL.md
```

Expected: status shows a rename.

- [ ] **Step 3: Rewrite `50_MT_REQUEST_MODEL.md`**

Make `DOCS/50_MT_REQUEST_MODEL.md` use this section structure:

````markdown
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

## Request Modes

| Mode | Meaning |
| --- | --- |
| `window` | Dense Window Mode. Physical batches request rows in target scope. |
| `window-partial` | Partial Window Mode. Physical scan windows remain stable, but only rows requiring target text become request rows. |

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

## Read-Only Context Rows

Read-only rows may include previous translated rows, existing-target rows
inside the current physical window, and following source rows. They never
receive response ids and must not appear in the provider JSON response.

## Strict JSON Response

```json
{"translations":[{"id":"<id>","text":"<target text>"}]}
```

The response must contain only the `translations` field. The array must include
exactly one object for each requested id.

## Retry and Validation

- Job retry happens in `TranslationJobRunner`.
- MT response repair happens in `MTModule`.
- These two layers must stay separate.

## Inspect and Artifacts

- Inspect composes prompt artifacts without provider requests.
- Real translate writes full prompt/TM/TB diagnostics only when artifacts are
  explicitly enabled.
- For `window-partial`, inspect and translate should use the same request mode
  to make prompt shape comparable.
```
````

Keep useful existing MT details, but remove CLI command tutorials and route them to `40_CLI_OPERATION.md`.

- [ ] **Step 4: Validate MT prompt contract is present once**

Run:

```powershell
rg -n "Window Partial Prompt Order|read-only context rows|rows requiring target text|Strict JSON Response" DOCS\50_MT_REQUEST_MODEL.md
```

Expected: all four contract phrases appear in `50_MT_REQUEST_MODEL.md`.

- [ ] **Step 5: Commit MT request model migration**

Run:

```powershell
git add DOCS\50_MT_REQUEST_MODEL.md DOCS\agent-first\MT_MODULE.md
git commit -m "docs: add mt request model reference"
```

Expected: commit succeeds.

## Task 5: Consolidate TM/TB Reference Docs

**Files:**
- Create: `DOCS/60_TM_TB_REFERENCE.md`
- Delete after summary: `DOCS/35_TM_MATCH_FLOW.md`
- Delete after summary: `DOCS/36_TM_RECALL_DESIGN.md`
- Delete after summary: `DOCS/45_TM_CONCORDANCE_TODO.md`
- Modify: `DOCS/99_HISTORY.md`

- [ ] **Step 1: Check doc worktree state**

Run:

```powershell
git status --short DOCS
```

Expected: no unrelated docs changes.

- [ ] **Step 2: Extract current TM/TB facts**

Read these files:

```powershell
Get-Content DOCS\35_TM_MATCH_FLOW.md
Get-Content DOCS\36_TM_RECALL_DESIGN.md
Get-Content DOCS\45_TM_CONCORDANCE_TODO.md
```

Extract only current behavior facts, code entry points, and debugging guidance. Do not copy long execution plans or private example text.

- [ ] **Step 3: Create `60_TM_TB_REFERENCE.md`**

Create `DOCS/60_TM_TB_REFERENCE.md` with this structure:

```markdown
# 60_TM_TB_REFERENCE

## Purpose

Current reference for TM/TB behavior used by headless localization and MT
prompt composition.

## When to Read

Read this when changing TM recall, concordance behavior, TB matching, or how
references are selected for MT prompts.

## Current TM Flow

- Mounted TM resources are resolved from the project.
- Source text is normalized for matching while protected marker behavior stays
  explicit in prompt and validation layers.
- Exact matches, fuzzy recall, and concordance recall feed selected
  references.
- Selected references are passed to localization prompt composition as
  structured artifacts.

## Concordance Behavior

Concordance recall contributes source-side evidence when a full TM match is not
the right shape. It should remain bounded, evidence-gated, and diverse enough
to avoid flooding MT prompts with near-duplicate references.

## TB Behavior

Mounted TB resources are queried for source terms. Selected terms become
structured prompt references attached to request rows.

## MT Prompt Inputs

TM, concordance, and TB references are attached to request rows. Read-only
context rows in Partial Window Mode do not get per-row TM/TB prompt blocks.

## Key Code Entry Points

- `packages/localization/src/modules/TMModule.ts`
- `packages/localization/src/modules/TBModule.ts`
- `packages/localization/src/modules/MTModule.ts`
- `packages/core/src/text`
- `packages/core/src/tag`

## Debugging Path

1. Inspect project resources with `momocat inspect projects`.
2. Inspect prompt artifacts with `momocat inspect localization`.
3. Check selected TM/TB artifacts in the inspect JSON sidecar.
4. Only run real translate after the inspect artifacts show the expected
   references.

## Historical Notes

Detailed historical recall designs were retired during docs consolidation. See
`DOCS/99_HISTORY.md` for sanitized summaries.
```

Refine the factual bullets from the old docs before committing, but keep the final file short enough to be a reference, not a plan.

- [ ] **Step 4: Update `99_HISTORY.md` with sanitized TM/TB history**

Add a section:

```markdown
## Retired TM/TB Design Records

Earlier TM recall, concordance recall, and matching-flow documents were
consolidated into `60_TM_TB_REFERENCE.md`. The active reference now records
current behavior and debugging paths; the long-form design records are no
longer active policy.
```

Do not include private source strings or project names from the old docs.

- [ ] **Step 5: Remove old active TM/TB docs**

Run:

```powershell
git rm DOCS\35_TM_MATCH_FLOW.md DOCS\36_TM_RECALL_DESIGN.md DOCS\45_TM_CONCORDANCE_TODO.md
```

Expected: files are staged for deletion.

- [ ] **Step 6: Validate TM/TB reference is clean**

Run:

```powershell
rg -n "https?://|[A-Za-z]:\\\\|api[_ -]?key|baseUrl|provider endpoint|local path|prompt artifact" DOCS\60_TM_TB_REFERENCE.md DOCS\99_HISTORY.md
```

Expected: no output except generic policy text. Manually confirm no private project, character, customer, model, or provider names were copied from retired docs.

- [ ] **Step 7: Commit TM/TB consolidation**

Run:

```powershell
git add DOCS\60_TM_TB_REFERENCE.md DOCS\99_HISTORY.md DOCS\35_TM_MATCH_FLOW.md DOCS\36_TM_RECALL_DESIGN.md DOCS\45_TM_CONCORDANCE_TODO.md
git commit -m "docs: consolidate tm tb reference"
```

Expected: commit succeeds.

## Task 6: Rewrite Status and History

**Files:**
- Modify: `DOCS/90_STATUS_AND_ROADMAP.md`
- Modify: `DOCS/99_HISTORY.md`

- [ ] **Step 1: Check doc worktree state**

Run:

```powershell
git status --short DOCS
```

Expected: no unrelated docs changes.

- [ ] **Step 2: Rewrite `90_STATUS_AND_ROADMAP.md` as live status only**

Make sure `DOCS/90_STATUS_AND_ROADMAP.md` contains only:

```markdown
# 90_STATUS_AND_ROADMAP

## Purpose

Single live source for current phase, risk posture, and roadmap.

## Current Phase

Agent-first CLI/headless localization. Shared capability lives behind
`@cat/localization`; `momocat` is the CLI app surface.

## Current Top Risks

1. CLI must remain thin over `@cat/localization`.
2. Prompt/request-mode contracts must stay centralized in `50_MT_REQUEST_MODEL.md`.
3. Real smoke artifacts may contain private source text and provider metadata;
   keep them out of active docs and source files.

## Latest Focused Verification

Focused docs consolidation verification will be recorded after final validation
runs in this implementation sequence.

## Roadmap

### Now

- Keep active docs consolidated in outer numbered files.
- Keep CLI/headless behavior documented for work agents.
- Keep architecture and request contracts documented for coding agents.

### Next

- Continue hardening CLI command grammar and inspect artifacts.
- Continue strengthening `@cat/localization` and pure `@cat/core` MT helpers.

### Later

- Add service/API surfaces above the same headless localization boundary when
  needed.
```

Replace the "Latest Focused Verification" placeholder sentence with the actual validation commands from the final task after validation is run.

- [ ] **Step 3: Rewrite `99_HISTORY.md` as sanitized history index**

Make sure `DOCS/99_HISTORY.md` contains:

```markdown
# 99_HISTORY

## Purpose

Sanitized index of retired decisions, old design records, and historical
incidents. This file is not active policy.

## Active Policy Lives Elsewhere

- Architecture: `10_ARCHITECTURE.md`
- Engineering workflow: `20_ENGINEERING_RUNBOOK.md`
- CLI operation: `40_CLI_OPERATION.md`
- MT request model: `50_MT_REQUEST_MODEL.md`
- TM/TB reference: `60_TM_TB_REFERENCE.md`
- Live status: `90_STATUS_AND_ROADMAP.md`

## Retired Documentation Sets

- Earlier agent-first architecture, CLI, and MT notes were consolidated into
  the active outer numbered docs.
- Earlier TM/TB recall and concordance notes were consolidated into
  `60_TM_TB_REFERENCE.md`.
- Earlier implementation specs and plans under `DOCS/superpowers` were retired
  as active policy.

## Sanitization Policy

History entries must not include real project names, character names, provider
endpoints, model names from private provider configuration, local paths, API
keys, or private source/target text.
```

Preserve useful historical lessons from the old file only when they are concise and sanitized.

- [ ] **Step 4: Validate status/history do not duplicate details**

Run:

```powershell
rg -n "momocat translate file|Window Partial Prompt Order|apps/cli -> @cat/localization" DOCS\90_STATUS_AND_ROADMAP.md DOCS\99_HISTORY.md
```

Expected: no command tutorial or prompt-contract duplication in `90` or `99`. A historical mention is acceptable only if it points to the active owner doc.

- [ ] **Step 5: Commit status and history rewrite**

Run:

```powershell
git add DOCS\90_STATUS_AND_ROADMAP.md DOCS\99_HISTORY.md
git commit -m "docs: rewrite status and history references"
```

Expected: commit succeeds.

## Task 7: Archive or Remove Superpowers Design Records

**Files:**
- Create: `DOCS/archive/superpowers/README.md`
- Move or delete: `DOCS/superpowers/**`
- Modify: `DOCS/99_HISTORY.md`

- [ ] **Step 1: Check doc worktree state**

Run:

```powershell
git status --short DOCS
```

Expected: no unrelated docs changes.

- [ ] **Step 2: Create archive index for superpowers records**

Create `DOCS/archive/superpowers/README.md` with:

```markdown
# Superpowers Design Records

This directory may contain sanitized historical specs and plans. These files
are not active policy.

Active docs live in the outer numbered `DOCS/*.md` files. If a historical
record contains private local paths, provider metadata, project names,
character names, or prompt text, keep only a sanitized summary in
`DOCS/99_HISTORY.md`.
```

- [ ] **Step 3: Decide per superpowers file**

Run:

```powershell
Get-ChildItem DOCS\superpowers -Recurse -File | Select-Object FullName
```

For each file:

- If it contains sensitive values or long obsolete implementation detail, remove it and summarize in `99_HISTORY.md`.
- If it is concise and sanitized, move it under `DOCS/archive/superpowers/` with the same leaf filename.
- The docs-system consolidation spec and this plan may be moved to `DOCS/archive/superpowers/` after implementation, because active docs should not depend on `DOCS/superpowers/`.

- [ ] **Step 4: Remove empty `DOCS/superpowers` directories**

After moving or deleting files, run:

```powershell
Get-ChildItem DOCS\superpowers -Recurse -Force
```

Expected: no files remain. If empty directories remain, remove them with `Remove-Item` only after verifying the path is exactly `DOCS\superpowers` under the repository root.

- [ ] **Step 5: Update history with sanitized superpowers summary**

Add this to `DOCS/99_HISTORY.md`:

```markdown
## Retired Superpowers Specs And Plans

Historical specs and implementation plans were consolidated during the docs
system cleanup. Active guidance is now in the outer numbered docs. Archived
records, when retained, are sanitized and non-active.
```

- [ ] **Step 6: Validate no active superpowers dependency**

Run:

```powershell
rg -n "DOCS/superpowers/specs|DOCS/superpowers/plans|DOCS/superpowers/reports" DOCS\00_START_HERE.md DOCS\10_ARCHITECTURE.md DOCS\20_ENGINEERING_RUNBOOK.md DOCS\30_DATA_MODEL.md DOCS\40_CLI_OPERATION.md DOCS\50_MT_REQUEST_MODEL.md DOCS\60_TM_TB_REFERENCE.md DOCS\90_STATUS_AND_ROADMAP.md
```

Expected: no output.

- [ ] **Step 7: Commit archive cleanup**

Run:

```powershell
git add DOCS\archive DOCS\99_HISTORY.md DOCS\superpowers
git commit -m "docs: archive retired design records"
```

Expected: commit succeeds.

## Task 8: Remove Agent-First Directory and Update References

**Files:**
- Delete: `DOCS/agent-first/`
- Modify references across active docs and `README.md` if needed.

- [ ] **Step 1: Check doc worktree state**

Run:

```powershell
git status --short DOCS
```

Expected: no unrelated docs changes.

- [ ] **Step 2: Remove empty or migrated `DOCS/agent-first` directory**

Run:

```powershell
Get-ChildItem DOCS\agent-first -Force
```

Expected: no files remain. If no files remain, remove the directory:

```powershell
Remove-Item -LiteralPath DOCS\agent-first
```

Only run `Remove-Item` after verifying the path is exactly `DOCS\agent-first` under the repository root.

- [ ] **Step 3: Update old active-doc references**

Run:

```powershell
rg -n "DOCS/agent-first|agent-first/|40_STATUS_AND_ROADMAP|90_HISTORY_CONSOLIDATED|35_TM_MATCH_FLOW|36_TM_RECALL_DESIGN|45_TM_CONCORDANCE_TODO" DOCS README.md
```

Patch every active reference:

- `DOCS/agent-first/CLI.md` -> `DOCS/40_CLI_OPERATION.md`
- `DOCS/agent-first/MT_MODULE.md` -> `DOCS/50_MT_REQUEST_MODEL.md`
- `DOCS/agent-first/ARCHITECTURE.md` -> `DOCS/10_ARCHITECTURE.md`
- `DOCS/40_STATUS_AND_ROADMAP.md` -> `DOCS/90_STATUS_AND_ROADMAP.md`
- `DOCS/90_HISTORY_CONSOLIDATED.md` -> `DOCS/99_HISTORY.md`
- `DOCS/35_TM_MATCH_FLOW.md`, `DOCS/36_TM_RECALL_DESIGN.md`, and `DOCS/45_TM_CONCORDANCE_TODO.md` -> `DOCS/60_TM_TB_REFERENCE.md`

References inside `DOCS/99_HISTORY.md` may describe retired files, but should clearly mark them as retired.

- [ ] **Step 4: Commit reference cleanup**

Run:

```powershell
git add DOCS README.md
git commit -m "docs: remove old active doc references"
```

Expected: commit succeeds.

## Task 9: Final Validation Pass

**Files:**
- Modify: `DOCS/90_STATUS_AND_ROADMAP.md`
- Read all active docs.

- [ ] **Step 1: Validate active top-level files**

Run:

```powershell
Get-ChildItem DOCS -File | Sort-Object Name | Select-Object -ExpandProperty Name
```

Expected top-level active files:

```text
00_START_HERE.md
10_ARCHITECTURE.md
20_ENGINEERING_RUNBOOK.md
30_DATA_MODEL.md
40_CLI_OPERATION.md
50_MT_REQUEST_MODEL.md
60_TM_TB_REFERENCE.md
90_STATUS_AND_ROADMAP.md
99_HISTORY.md
```

Archive directories may exist under `DOCS/archive`.

- [ ] **Step 2: Validate old active references are gone**

Run:

```powershell
rg -n "DOCS/agent-first|DOCS/superpowers/specs|DOCS/superpowers/plans" DOCS\00_START_HERE.md DOCS\10_ARCHITECTURE.md DOCS\20_ENGINEERING_RUNBOOK.md DOCS\30_DATA_MODEL.md DOCS\40_CLI_OPERATION.md DOCS\50_MT_REQUEST_MODEL.md DOCS\60_TM_TB_REFERENCE.md DOCS\90_STATUS_AND_ROADMAP.md
```

Expected: no output.

- [ ] **Step 3: Validate sensitive strings are absent from active docs**

Run:

```powershell
rg -n "https?://|[A-Za-z]:\\\\|api[_ -]?key|baseUrl|provider endpoint|local path|prompt artifact" DOCS\00_START_HERE.md DOCS\10_ARCHITECTURE.md DOCS\20_ENGINEERING_RUNBOOK.md DOCS\30_DATA_MODEL.md DOCS\40_CLI_OPERATION.md DOCS\50_MT_REQUEST_MODEL.md DOCS\60_TM_TB_REFERENCE.md DOCS\90_STATUS_AND_ROADMAP.md DOCS\99_HISTORY.md
```

Expected: no output except generic policy text. Manually confirm no private project, character, customer, provider, model, source-text, or target-text values are present.

- [ ] **Step 4: Validate one-owner rule by topic**

Run:

```powershell
rg -n "momocat translate file|Window Partial Prompt Order|apps/cli -> @cat/localization|checkpoint.jsonl|Read-only context rows" DOCS\00_START_HERE.md DOCS\10_ARCHITECTURE.md DOCS\20_ENGINEERING_RUNBOOK.md DOCS\30_DATA_MODEL.md DOCS\40_CLI_OPERATION.md DOCS\50_MT_REQUEST_MODEL.md DOCS\60_TM_TB_REFERENCE.md DOCS\90_STATUS_AND_ROADMAP.md DOCS\99_HISTORY.md
```

Expected:

- CLI command syntax appears in `40_CLI_OPERATION.md`.
- MT prompt/order contracts appear in `50_MT_REQUEST_MODEL.md`.
- Dependency chain appears in `10_ARCHITECTURE.md`.
- Status and history do not carry detailed command or prompt contracts.

- [ ] **Step 5: Validate markdown whitespace**

Run:

```powershell
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 6: Update `90_STATUS_AND_ROADMAP.md` with final docs validation**

Add the validation commands that were actually run:

```markdown
## Latest Focused Verification

Verification date: 2026-05-25

- `Get-ChildItem DOCS -File | Sort-Object Name | Select-Object -ExpandProperty Name`
- `rg -n "DOCS/agent-first|DOCS/superpowers/specs|DOCS/superpowers/plans" <active docs>`
- `rg -n "https?://|[A-Za-z]:\\\\|api[_ -]?key|baseUrl|provider endpoint|local path|prompt artifact" <active docs>`
- `git diff --check`
```

- [ ] **Step 7: Commit final validation note**

Run:

```powershell
git add DOCS\90_STATUS_AND_ROADMAP.md
git commit -m "docs: record consolidated docs validation"
```

Expected: commit succeeds.

- [ ] **Step 8: Show final status**

Run:

```powershell
git status --short
git log --oneline -8
```

Expected: no unintended changes remain. The recent commits should show the docs consolidation sequence.
