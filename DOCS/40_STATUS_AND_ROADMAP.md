# 40_STATUS_AND_ROADMAP

## Purpose

Provide a single live source for current execution status, risk posture, and roadmap direction.

## When to Read

Read at task start, before planning scope, and before merge.

## Source of Truth

- Validation commands and outputs in local environment
- Guard scripts in `package.json` and `scripts`

## Last Updated

2026-03-24

## Owner

Core maintainers of `simple-cat-tool`

## Live Status Contract

This is the only active documentation page that may contain live gate status and live risk status.

## Current Phase

- Phase: `Current-Only Simplification`
- Strategy: current-version-first simplification

## Current Gate Status (Local Verification)

Verification date: 2026-03-01

- `npm run gate:check`: passing
- Included chain: `typecheck`, `gate:arch`, `gate:style`, `gate:file-size`, `lint`, `gate:smoke:large-file`
- Notes: lint currently has historical warnings; no lint errors in latest verification.
- `gate:file-size` current warnings: `packages/core/src/index.ts` only.

## Current Top Risks

1. Remaining large-file hotspot in `packages/core/src/index.ts` (core model + algorithm + export surface mixed).
2. Historical warning backlog still exists in some workspaces.
3. Remaining cleanup follow-through is now mainly docs/guardrails alignment and residual large-file/historical warning work.

## Latest Completed Milestone (2026-03-24)

1. Replaced runtime DB migrations with a canonical current-schema bootstrap and validation path.
2. Current DB behavior is now explicit:
   - empty DB bootstraps latest schema,
   - current-marker DB opens,
   - unsupported old DB fails fast at startup with a blocking error.
3. Removed dead compatibility surfaces:
   - TM exact-match compatibility chain (`get100Match` / `find100Match`),
   - unused aggregate type `DatabaseGateway`,
   - legacy file-progress fallback for pre-extended file stats.

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
2. Revisit guardrails after the current-only cleanup:
   - remove compatibility-first wording from docs and checks,
   - shrink `legacyMultiRepoMethods` exceptions where the new structure allows it.
3. Keep targeted regression coverage current for DB bootstrap, TM query flow, and renderer file-progress shape.

### Next

1. Simplify import surfaces selectively:
   - keep stable entry files that still define useful module boundaries,
   - inline or remove zero-value pass-through wrappers.
2. Continue core package responsibility cleanup once compatibility noise is reduced.
3. Reduce historical warning backlog in touched workspaces.

### Later

1. If historical data recovery becomes necessary, build a one-off importer or reset/migrate utility outside the normal startup path.
2. Resume deeper provider pluggability for AI/TM/TB integrations on top of the simplified current-only baseline.
3. Expand operational tooling only after current-schema and current-contract boundaries are stable.

## Update Rules

1. Update this file whenever gate status, risk posture, or roadmap direction changes.
2. Keep architecture and data details in their dedicated docs.
3. Keep this file concise and execution-oriented.
