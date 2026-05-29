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

## English TM Profile

TM matching resolves a source-language profile from the project source locale.
Default/CJK projects keep the existing recall, normalization, scoring,
concordance, diversity, and cap behavior.

English source projects use a small profile-specific overlay for active TM
matching. Recall adds bounded English variants for regular singular/plural
forms, hyphen/space equivalents, and dotted acronym equivalents. These recall
variants only widen the candidate pool; final scoring and evidence gates still
decide whether a match is emitted.

English scoring compares canonical forms for conservative variants such as
`A.P.I.`/`API`, `Lumie Trees`/`Lumie Tree`, and hyphenated compounds. Short
acronym handling rejects one-sided acronym collisions like `U.S.` versus
ordinary lowercase `us`.

English concordance requires phrase-level evidence for multi-word candidates.
Single ordinary-token overlap such as `Tree` for `Lumie Tree` or stopword-heavy
overlap such as `the` for `The Truth` is not sufficient. Short English phrase
fuzzy candidates are also suppressed unless the full canonical candidate phrase
appears in the source.

## Concordance Behavior

Concordance recall contributes source-side evidence when a full TM match is not
the right shape. It should remain bounded, evidence-gated, and diverse enough
to avoid flooding MT prompts with near-duplicate references.

Explicit Concordance Search is a separate route from the active TM match flow;
confirm the intended path before changing recall policy.

## TB Behavior

Mounted TB resources are queried for source terms. Selected terms become
structured prompt references attached to request rows.

TB matching resolves a source-language profile from the project source locale.
The default/CJK profile uses strict normalized term matching. English source
projects add a conservative overlay for regular plural/singular forms,
possessives, hyphen/space equivalents, and dotted acronym equivalents for
uppercase acronym-shaped tokens. English TB recall does not use fuzzy
edit-distance matching or general stemming.

## MT Prompt Inputs

TM, concordance, and TB references are attached to request rows. Read-only
context rows in Partial Window Mode do not get per-row TM/TB prompt blocks.

Runtime references reuse the persistent TM recall path where possible and merge
into the existing TM and concordance prompt blocks.

## Runtime TM

Runtime TM is an isolated, job-local TM used by headless file translation.
It reuses the normal TM repository, service, module, and concordance recall
path in an in-memory SQLite CAT database, then discards that database when the
file job ends.

Runtime TM accepts eligible `translated` and `skipped` results with non-empty
source and target. This lets Window Partial Mode reuse both provider-produced
targets and existing target text observed earlier in the same file job.

Runtime TM must not write to Working TM, Main TM, or the persistent project
database, and it must not appear as a user-managed TM resource. File jobs do
not currently pass a global append cap; prompt selection remains capped by
the independent 3 TM plus 3 concordance runtime reference slots.

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

For English source projects, inspect both candidate recall and final TM/TB
matches when debugging terminology. Candidate variants and final profile gates
should agree; if candidates appear without final matches, check the
source-language profile rules before changing SQL recall.

## Historical Notes

Detailed historical recall designs were retired during docs consolidation. See
`DOCS/99_HISTORY.md` for sanitized summaries.
