# 40_STATUS_AND_ROADMAP

## Purpose

Provide a single live source for current execution status, risk posture, and roadmap direction.

## When to Read

Read at task start, before planning scope, and before merge.

## Source of Truth

- Validation commands and outputs in local environment
- Guard scripts in `package.json` and `scripts`

## Last Updated

2026-05-25

## Owner

Core maintainers of `simple-cat-tool`

## Live Status Contract

This is the only active documentation page that may contain live gate status and live risk status.

## Current Phase

- Phase: `Agent-First CLI App`
- Strategy: keep shared localization capability behind `@cat/localization` and expose it through the `momocat` CLI app.

## Current Gate Status (Local Verification)

Verification date: 2026-05-25

- Latest full `npm run gate:check` is not re-claimed by this document update.
- Latest focused verification for the active CLI/window-partial work:
  - `npx vitest run packages/core/src/project/windowModePrompt.test.ts packages/localization/src/modules/MTModule.test.ts packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.test.ts packages/localization/src/LocalizationInspector.test.ts`
  - `npm run build --workspace=packages/core`
  - `npm run build --workspace=packages/localization`
  - `npm run build:cli`
  - `git diff --check`
- Standard real-provider smoke is local-configured through `.momocat-smoke.local.json`; do not commit local paths, provider endpoints, model names, or prompt artifacts.

## Current Top Risks

1. Historical warning backlog still exists in some workspaces.
2. New `@cat/core` slice boundaries depend on import-discipline and guardrails staying current.
3. `apps/cli` must remain a thin `momocat` command surface over `@cat/localization`, without direct desktop, DB, or core coupling.
4. Real smoke artifacts can contain user text, provider metadata, TM/TB names, and prompt payloads; keep them out of tracked docs and source files.

## Latest Completed Milestone (2026-05-25)

1. Extracted the agent-first `momocat` CLI app surface under `apps/cli`, with root scripts kept as repo orchestration helpers.
2. Kept the dependency boundary clear: `apps/cli -> @cat/localization -> @cat/db -> @cat/core`; CLI must not depend on `apps/desktop`.
3. Added opt-in `window-partial` request mode for headless file translation and inspect.
4. Standardized local smoke through gitignored `.momocat-smoke.local.json` and `scripts/momocat-standard-smoke.mjs`.

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
4. Keep targeted regression coverage current for CLI command grammar, prompt composition, request-mode planning, DB bootstrap, TM query flow, renderer file-progress shape, and core slice exports.

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
