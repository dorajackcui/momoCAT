# 20_ENGINEERING_RUNBOOK

## Purpose

Define execution workflow, quality gates, and failure handling so contributors can ship changes safely and consistently.

## When to Read

Read before coding, before opening PRs, and whenever gate/test failures occur.

## Source of Truth

- Package scripts: `package.json`
- Architecture guard config: `DOCS/architecture/GATE05_GUARDRAILS.json`
- Current project status and priorities: `DOCS/40_STATUS_AND_ROADMAP.md`

## Last Updated

2026-05-06

## Owner

Core maintainers of `simple-cat-tool`

## Workflow Rules

1. Start from `DOCS/00_START_HERE.md`.
2. Keep changes scoped: feature + direct blockers + required tests.
3. Preserve public contracts unless an intentional contract cleanup is explicitly documented.
4. Update docs in the same change when behavior, boundaries, or process changes.

## Cross-Platform Baseline (Windows + macOS)

Use the same command set on both platforms:

```bash
npm ci
npm run dev
npm test
npm run build
```

Native module rebuild:

```bash
npm run rebuild:electron
```

Packaging boundary:

1. `npm run pack:win` must run on Windows only.
2. `npm run pack:mac` must run on macOS only.
3. Do not rely on cross-platform packaging for release signoff.
4. Use the repo packaging entrypoints instead of calling `electron-builder` directly so native rebuild + renderer build happen before packaging.

Desktop validation commands:

```bash
npm run test:e2e:smoke --workspace=apps/desktop
npm run test:e2e --workspace=apps/desktop
```

## Validation Ladder

Use this escalation path unless the task explicitly needs a later step first:

1. Start app on current host: `npm ci` -> `npm run rebuild:electron` -> `npm run dev`
2. Run unit/integration baseline: `npm test`
3. Run repo quality gate: `npm run gate:check`
4. Run desktop smoke validation: `npm run test:e2e:smoke --workspace=apps/desktop`
5. Run broader desktop regression if needed: `npm run test:e2e --workspace=apps/desktop`
6. Run platform-native packaging signoff: `npm run pack:win` on Windows or `npm run pack:mac` on macOS

Interpretation:

- `npm run gate:check` is the default cross-platform confidence check and should happen before guessing at pack failures.
- `npm run test:e2e:smoke --workspace=apps/desktop` is the fastest desktop behavior check when renderer/editor interactions changed.
- `npm run pack` is host-local packaging only; native release validation still belongs to `pack:win` or `pack:mac`.

## Gates and Checks

Primary command:

```bash
npm run gate:check
```

Current `gate:check` chain:

1. `npm run typecheck --workspace=apps/desktop`
2. `npm run gate:arch`
3. `npm run gate:style`
4. `npm run gate:file-size`
5. `npm run lint`
6. `npm run gate:smoke:large-file`

CI in plain language:

- Pull requests and pushes validate `npm ci` -> `npm run rebuild:electron` -> `npm run gate:check` on both `macos-latest` and `windows-latest`.
- Platform packaging is smoke-checked only on native hosts via manual/workflow-dispatch pack jobs; CI does not treat this as cross-platform pack equivalence.

## Required Test Policy

1. If you touch `ProjectService`, IPC contracts, or `CATDatabase` behavior, add or update tests in the same change.
2. If you touch `CATDatabase` schema/bootstrap behavior, run current-schema tests and document the startup/data impact.
3. If you touch AI/TM/editor boundaries, run targeted test suites before merge.

## Test Organization Convention

1. Keep unit, behavior, and integration tests colocated with the implementation they cover.
2. Prefer file-adjacent names such as `TMService.test.ts`, `useEditorFilters.behavior.test.ts`, and `EditorRow.integration.test.ts`.
3. Keep Playwright end-to-end suites under `apps/desktop/e2e`.
4. Introduce shared helpers or fixtures only for genuine reuse; keep them near the consuming area when possible.
5. Do not centralize tests into a top-level repo `tests/` directory unless a tool requires it or the suite is cross-cutting by design.

## Large-File Refactor Submission Requirements

1. Keep external contracts stable (`IPC`, facade public methods, hook export names) unless an explicit migration plan is included.
2. Use compatibility facades (`old entry -> new internal modules`) when splitting large files.
3. Add workflow/behavior tests for extracted modules; helper-only tests are not enough.
4. Run and record `gate:file-size` after refactor; avoid allowlist additions unless explicitly approved.
5. For `@cat/core`, use slice entrypoints (`models`, `project`, `tag`, `text`, `qa`) in repo code instead of the root barrel.
6. Inside `packages/core/src`, do not import the root `index.ts` barrel except for the dedicated barrel smoke test.

## PR Checklist

1. Scope is clear and minimal.
2. Gate command passes.
3. Touched boundary tests pass.
4. Public contract impact is documented (or explicitly “none”).
5. Documentation update is included.

## Documentation Update Policy

1. Keep architecture facts only in `DOCS/10_ARCHITECTURE.md`.
2. Keep data model facts only in `DOCS/30_DATA_MODEL.md`.
3. Keep live status only in `DOCS/40_STATUS_AND_ROADMAP.md`.
4. Keep historical retrospective content only in `DOCS/90_HISTORY_CONSOLIDATED.md`.

## Failure Playbooks

### Gate failure triage order

1. `typecheck`
2. `gate:arch`
3. `gate:style`
4. `gate:file-size`
5. `lint`
6. `gate:smoke:large-file`

CI matrix:

1. `macos-latest`: `npm ci` -> `npm run rebuild:electron` -> `npm run gate:check`
2. `windows-latest`: `npm ci` -> `npm run rebuild:electron` -> `npm run gate:check`
3. Nightly/manual smoke pack job runs platform-native pack commands only.

Desktop validation entrypoint:

1. Start with `npm run test:e2e:smoke --workspace=apps/desktop` for behavior regressions in editor/renderer flows.
2. Escalate to `npm run test:e2e --workspace=apps/desktop` only when smoke coverage is insufficient or multiple desktop flows changed.
3. Keep pack validation last; packaging failures are not the first debugging step for ordinary UI/test regressions.

### `gate:arch` failed

1. Compare changed callsites with guardrail definitions.
2. Decide whether to refactor code back into allowed boundary or update guardrail config intentionally.
3. Add tests for the new boundary.

### `gate:file-size` failed

1. Confirm line count and threshold.
2. Split by responsibility using internal services/hooks.
3. Avoid adding temporary allowlist entries unless explicitly approved.

### Lint warnings growth

1. Block net-new warning growth in touched files.
2. If unavoidable, document rationale and follow-up issue.

### DB schema/bootstrap issues

1. Re-run current-schema tests.
2. Verify empty DB bootstrap, current-marker reopen, and unsupported-old-DB rejection.
3. Update `DOCS/30_DATA_MODEL.md` in same change.

### Windows/macOS command mismatch

1. Verify Node/npm versions match `package.json` `volta` pins.
2. Run `npm run rebuild:electron` to rebind native module ABI.
3. Confirm platform-native packaging command (`pack:win` or `pack:mac`) is used.
4. On Windows, repo scripts intentionally launch `npm`/`npx` through the shell because direct `.cmd` spawning can fail with `spawnSync ... EINVAL` in some PowerShell/Volta environments.

### Desktop e2e/smoke issues

1. Re-run `npm run test:e2e:smoke --workspace=apps/desktop` before full e2e to confirm the failure reproduces in the smallest desktop path.
2. If smoke passes but broader coverage is still needed, run `npm run test:e2e --workspace=apps/desktop`.
3. Treat desktop e2e failures separately from packaging failures; do not jump to `pack:win` or `pack:mac` unless the problem is installer/build specific.

### TM match workflow triage

Use this when the active TM panel looks wrong and you need to determine whether the problem is recall, scoring/classification, or final ranking/diversity.

Run from repo root:

```bash
npm run trace:tm-flow -- --project-id <id> --source "<source text>"
npm run trace:tm-flow -- --project-id <id> --segment-id <segment id>
```

Useful options:

1. `--db <path>` uses a specific SQLite database; the default is `.cat_data/cat_v1.db`.
2. `--src-hash <hash>` enables exact-hash checks for synthetic `--source` traces.
3. `--focus-src-hash <hash[,hash]>` adds per-entry target buckets to recall summaries.
4. `--no-recall-debug` suppresses `CAT_TM_RECALL_DEBUG` event capture.

Interpret the JSON trace in this order:

1. `step0MountedTMs`: if empty, this is a mounted-TM/project setup issue.
2. `step1SourceText`: verify text-only serialization and tag boundaries.
3. `step2ExactHash`: if the expected 100% match is absent, compare `srcHash`, `matchKey`, and tags signature paths.
4. `step3FuzzyRecall` and `step4ConcordanceRecall`: if the expected `srcHash` is absent here, investigate repository recall/query-plan behavior.
5. `step5CandidateScoring`: if the expected candidate is present but `accepted: false`, inspect `droppedAt`, `standardSimilarity`, and `localOverlap`.
6. `step6FinalMatches`: if a candidate was accepted but is absent here, investigate sorting, top-10 truncation, or diversity buckets.

For deterministic regression coverage of the trace fixture itself, run:

```bash
npm run test:tm-flow
```

### Worktree dependency link issues

1. Run `npm run worktree:deps:link` first; if local `node_modules` already exists, rerun with `npm run worktree:deps:link:force`.
2. On Windows, the script automatically falls back from directory symlink to junction.
3. If source worktree has no `node_modules`, run `npm ci` in source first.

## Operational Conventions

1. Use `rg` for search and `rg --files` for discovery.
2. Prefer non-interactive commands for reproducibility.
3. Keep changelogs concise and test-backed.
