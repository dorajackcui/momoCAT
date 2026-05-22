# 40_STATUS_AND_ROADMAP

## Purpose

Provide a single live source for current execution status, risk posture, and roadmap direction.

## When to Read

Read at task start, before planning scope, and before merge.

## Source of Truth

- Validation commands and outputs in local environment
- Guard scripts in `package.json` and `scripts`

## Last Updated

2026-05-22

## Owner

Core maintainers of `simple-cat-tool`

## Live Status Contract

This is the only active documentation page that may contain live gate status and live risk status.

## Current Phase

- Phase: `Agent-First CLI App`
- Strategy: keep shared localization capability behind `@cat/localization` and expose it through the `momocat` CLI app.

## Current Gate Status (Local Verification)

Verification date: 2026-03-25

- `npm run gate:check`: passing
- Included chain: `typecheck`, `gate:arch`, `gate:style`, `gate:file-size`, `lint`, `gate:smoke:large-file`
- Notes: lint currently has historical warnings; no lint errors in latest verification.
- `gate:file-size` current warnings: no known `@cat/core` root-barrel hotspot; monitor newly extracted slice files instead.
- Current task only verified documentation command references with `rg` and whitespace with `git diff --check` on 2026-05-22; no new full gate result is claimed here.

## Current Top Risks

1. Historical warning backlog still exists in some workspaces.
2. New `@cat/core` slice boundaries depend on import-discipline and guardrails staying current.
3. `apps/cli` must remain a thin `momocat` command surface over `@cat/localization`, without direct desktop, DB, or core coupling.

## Latest Completed Milestone (2026-03-25)

1. Split `@cat/core` into `models`, `project`, `tag`, `text`, and `qa` slices while keeping runtime behavior stable.
2. Shrunk `packages/core/src/index.ts` to a thin compatibility barrel and moved repo callers to slice entrypoints.
3. Added architecture guard coverage for root-barrel regressions and colocated core slice tests near the extracted modules.

## Cleanup Rules

1. Remove compatibility code only when all in-repo callers already use the newer shape or can be switched in the same change.
2. Keep architectural boundaries that still provide a clear import seam; do not delete facades just because they are thin.
3. Prefer replacing multi-step upgrade logic with one canonical latest-schema bootstrap for current-only environments.
4. If old user data must be handled later, add an explicit import/reset tool rather than keeping permanent runtime compatibility paths.

## Roadmap

### Now (1-2 iterations)

1. Freeze net-new compatibility debt:
   - no new legacy fallbacks,
   - no new compatibility facades unless they are justified as long-term boundaries.
2. Keep agent-first commands centered on `apps/cli`:
   - active command surface is `momocat inspect projects`, `momocat inspect localization`, and `momocat translate file`,
   - root scripts are repo orchestration plus `build:cli`, `npm --silent run cli -- ...`, and the local-configured `smoke:momocat` helper.
3. Keep `@cat/core` slice boundaries stable:
   - no new repo imports from root `@cat/core`,
   - no new internal imports from `packages/core/src/index.ts`.
4. Keep targeted regression coverage current for DB bootstrap, TM query flow, renderer file-progress shape, and core slice exports.

### Next

1. Simplify import surfaces selectively:
   - keep stable entry files that still define useful module boundaries,
   - inline or remove zero-value pass-through wrappers.
2. Continue hardening `momocat` help, stdout/stderr, exit codes, and command grammar around the `@cat/localization` APIs.
3. Continue core package responsibility cleanup inside individual slices once compatibility noise is reduced.
4. Reduce historical warning backlog in touched workspaces.

### Later

1. If historical data recovery becomes necessary, build a one-off importer or reset/migrate utility outside the normal startup path.
2. Resume deeper provider pluggability for AI/TM/TB integrations on top of the simplified current-only baseline. Connection-backed OpenAI-compatible providers replace the old fixed built-in OpenAI model list. Remaining provider work should focus on protocol expansion, not on maintaining a model allowlist.
3. Expand operational tooling only after current-schema and current-contract boundaries are stable.

## Update Rules

1. Update this file whenever gate status, risk posture, or roadmap direction changes.
2. Keep architecture and data details in their dedicated docs.
3. Keep this file concise and execution-oriented.
