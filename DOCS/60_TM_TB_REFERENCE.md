# 60_TM_TB_REFERENCE

## Purpose

Current reference for TM/TB behavior used by headless localization and MT
prompt composition.

## When to Read

Read this when changing TM recall, concordance behavior, TB matching, or how
references are selected for MT prompts.

## Current TM Flow

- Mounted TM resources are resolved from the project before recall.
- Source text is normalized for matching while protected marker behavior stays
  explicit in prompt composition and tag validation layers.
- Exact matches use source hash and tag structure; fuzzy recall and
  source-side concordance recall provide additional candidates.
- Concordance candidates are scored and classified with local-overlap evidence,
  then final results are capped and diversified before prompt selection.
- Selected TM and concordance references are passed to localization prompt
  composition as structured artifacts.

## Concordance Behavior

Concordance recall contributes source-side evidence when a full TM match is not
the right shape. It should remain bounded, evidence-gated, and diverse enough
to avoid flooding MT prompts with near-duplicate references.

Explicit Concordance Search is a separate route from the active TM match flow;
confirm the intended path before changing recall policy.

## TB Behavior

Mounted TB resources are queried for source terms. Selected terms become
structured prompt references attached to request rows.

## MT Prompt Inputs

TM, concordance, and TB references are attached to request rows. Read-only
context rows in Partial Window Mode do not get per-row TM/TB prompt blocks.

## Key Code Entry Points

- `packages/localization/src/modules/TMModule.ts` selects TM and concordance
  prompt references from service matches.
- `packages/localization/src/modules/TBModule.ts` selects TB prompt references
  from service matches.
- `packages/localization/src/modules/MTModule.ts` composes structured TM,
  concordance, and TB references into MT prompts.
- `packages/localization/src/services/TMService.ts` implements TM exact,
  fuzzy, concordance scoring, classification, and diversity behavior.
- `packages/localization/src/services/TBService.ts` implements TB term matching
  behavior for localization.
- `packages/db/src/repos/TMRepo.ts` implements TM recall queries and repository
  diversity gates.
- `packages/db/src/repos/TBRepo.ts` implements TB lookup queries.
- `packages/core/src/text` contains text normalization and token text helpers.
- `packages/core/src/tag` contains protected marker and tag helpers.
- `package.json` script `test:tm-flow` runs the focused active TM flow checks.

## Debugging Path

1. Inspect project resources with `momocat inspect projects`.
2. Inspect composed prompt references with `momocat inspect localization`.
3. Check selected TM/TB artifacts in the inspect JSON sidecar.
4. Only run real translate after the inspect artifacts show the expected
   references.

## Historical Notes

Detailed historical recall designs were retired during docs consolidation. See
`DOCS/99_HISTORY.md` for sanitized summaries.
