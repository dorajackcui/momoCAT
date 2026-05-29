# English TM Profile Design

Date: 2026-05-29

## Purpose

Improve TM matching for English source projects while preserving current CJK
and default TM behavior.

The design follows the same direction as English TB recall: keep the existing
strict/CJK-capable matcher as the shared foundation, and add a source-language
profile layer for English-specific recall and scoring. English rules must be
opt-in through `project.srcLang`; they must not leak into CJK/default matching.

## Background

The current active TM flow is shared for all languages:

- `TMService.findMatches` resolves mounted TMs, checks exact source-hash
  matches, collects fuzzy recall and concordance recall candidates, scores
  candidates, classifies them as `tm` or `concordance`, then sorts, diversifies,
  and caps final results.
- `TMRepo.searchTMFuzzyRecallCandidates` builds a source-side recall plan from
  extracted search terms plus CJK fragments.
- `TMRepo.searchTMConcordanceRecallCandidates` builds a source-side
  concordance recall plan with CJK fragment tiers and Latin FTS terms.
- Final scoring currently normalizes by lowercasing and collapsing whitespace.
  CJK recall, local-overlap promotion, and diversity bucketing are tightly
  tuned around the current behavior.

This works for the existing CJK-heavy use cases, but English source projects
miss useful TM evidence when the difference is linguistic or orthographic
rather than semantic:

- regular singular/plural: `Lumie Trees` versus `Lumie Tree`
- hyphen/space: `real-time` versus `real time`
- conservative acronym punctuation: `A.P.I.` versus `API`, `U.S.` versus `US`
- punctuation/case/width differences

The English TB work showed the main failure mode to avoid: using token aliases
as final evidence can create broad noise, such as matching every term that
contains `the`. TM must therefore separate broad candidate recall from strict
final evidence.

## Scope

In scope for v1:

- English source projects: `srcLang === "en"` or `srcLang` starts with `en-`.
- Active TM fuzzy matching for whole-segment TM candidates.
- Conservative English phrase concordance for multi-token named phrases such as
  `Lumie Tree`.
- English recall variants for regular plural/singular, hyphen/space, and
  conservative dotted/undotted acronyms.
- English final scoring overlay that can improve candidate similarity when the
  canonical English forms are equivalent or nearly equivalent.
- Tests proving CJK/default behavior stays on the current path.

Out of scope for v1:

- General stemming, edit-distance token aliases, semantic similarity, or
  irregular plural dictionaries.
- Matching a multi-token English phrase from a single ordinary token. For
  example, `Tree` must not match `Lumie Tree`.
- Loosening CJK local-overlap thresholds, CJK recall fragments, or CJK
  diversity behavior.
- TM import-time alias materialization or schema changes.
- Explicit concordance search UI behavior unless it reuses the same profile
  helpers in a later, separately reviewed change.

## Options Considered

### A. Service-only English scoring

Only `TMService` would add English-aware normalization during final scoring.

This is low risk because it does not touch database recall. It is incomplete:
if `A.P.I.` never recalls `API`, final scoring never sees the candidate.

### B. English recall plus English scoring

The shared TM flow remains intact, but English source projects pass an explicit
profile into recall and scoring. The repository adds bounded English recall
variants, and the service adds an English canonical scoring overlay.

This improves both candidate discovery and final acceptance while keeping
CJK/default behavior equivalent when no profile is passed.

### C. Insert-time English alias index

TM import/upsert would materialize English aliases into an index.

This may help performance later, but it adds schema/reindex/staleness cost.
Rules will likely iterate, so v1 should avoid storing derived aliases.

Recommendation: use option B, with the conservative English phrase concordance
extension described below.

## Architecture

Introduce a small TM text profile layer:

```text
TMService common flow
  exact hash: shared, unchanged
  fuzzy recall:
    default profile -> current TMRepo recall plan, unchanged
    english profile -> current plan plus bounded English variants
  concordance recall:
    default profile -> current TMRepo concordance plan, unchanged
    english profile -> current plan plus phrase/canonical evidence gates
  candidate merge: shared, unchanged
  scoring:
    default profile -> current normalization and scoring, unchanged
    english profile -> current scoring plus English canonical scoring overlay
  sort/diversity/cap: shared, unchanged
```

The profile is resolved from the project source language:

```ts
type TMTextProfile = 'default' | 'english';
```

`english` is selected only for `en` and `en-*`. All other locales, including
CJK locales, use `default`.

The profile helper should live outside CJK-specific code. A good location is a
new core text helper, for example `packages/core/src/text/tmMatchingProfiles.ts`,
because both `packages/localization` and `packages/db` can depend on
`@cat/core/text`.

The helper should expose behavior-level functions rather than raw internal
rules:

- resolve a TM text profile from a locale
- build English recall terms for a source string
- canonicalize English text for TM similarity
- decide whether an English phrase concordance candidate has enough evidence

Default callers should not need to know how English rules work.

## Data Flow

`TMService.findMatches` should fetch the project once for source-language
profile resolution. Missing project records should fall back to `default`.

When calling repository recall:

- default/CJK projects pass the current options object exactly as today
- English projects pass `profile: 'english'`

The repository option types can gain an optional profile field:

```ts
interface TMRecallOptions {
  scope?: TMRecallScope;
  limit?: number;
  profile?: 'english';
}

interface TMConcordanceRecallOptions {
  scope?: 'source';
  limit?: number;
  rawLimit?: number;
  profile?: 'english';
}
```

Omitting `profile` is the default path and must keep the same query plan,
evidence gates, ordering, and caps as the current implementation.

## English Recall Rules

English recall variants are candidate generators, not final proof.

Allowed v1 variants:

- regular singular/plural on whole tokens and final word of multi-word phrases
  - `Birds` <-> `Bird`
  - `Lynxes` <-> `Lynx`
  - `Lumie Trees` <-> `Lumie Tree`
- hyphen/space equivalence
  - `real-time` <-> `real time`
  - `Lumie-Tree` <-> `Lumie Tree`
- conservative acronym punctuation
  - uppercase acronym-shaped raw token `API` -> `a.p.i.`
  - uppercase dotted acronym-shaped raw token `A.P.I.` -> `api`
  - do not turn ordinary words into dotted acronyms
- NFKC/case/punctuation normalization where it improves recall without
  introducing short-token noise

Not allowed in v1:

- broad substring matching for ordinary Latin tokens
- general stemming
- irregular plural expansion
- accepting stopwords or single common words as evidence for multi-token
  phrases

Recall terms must remain bounded. The English variant layer should have a
small max-additions budget, similar in spirit to the TB profile cap, so long
English segments do not produce unbounded OR queries.

## English Scoring Rules

Final scoring for default/CJK stays exactly as today.

For English profile candidates, calculate the existing strict score first.
Then calculate a canonical English score and use it only as an overlay:

- exact canonical equality can produce a high fuzzy TM score, capped below exact
  hash matches, for example 99
- near equality after English canonicalization can improve the weighted score
  when length bounds still make sense
- canonical scoring must not convert weak token overlap into a TM match

Examples:

- source `A.P.I.`, TM source `API` -> `tm`, high score
- source `real-time updates`, TM source `real time updates` -> `tm`, high score
- source `Masquerade Lynxes appear`, TM source `Masquerade Lynx appears` ->
  improved fuzzy score
- source `Open the menu`, TM source `The Curator` -> no match

Exact source-hash matches remain the only 100% TM matches.

## English Phrase Concordance

`Lumie Tree` belongs in v1, but only as conservative phrase concordance.

The English concordance gate should require phrase-level evidence, not token
OR evidence:

- source contains canonical candidate phrase
- candidate phrase contains canonical source phrase when the candidate is the
  shorter phrase
- high-coverage canonical overlap on a multi-token English phrase

Acceptance examples:

```text
source: ... Lumie Tree ...
TM source: Lumie Tree
result: concordance hit

source: ... Lumie Trees ...
TM source: Lumie Tree
result: concordance hit through final-word plural canonicalization

source: ... Lumie-Tree ...
TM source: Lumie Tree
result: concordance hit through hyphen/space canonicalization
```

Rejection examples:

```text
source: ... Tree ...
TM source: Lumie Tree
result: no hit

source: Open the menu.
TM source: The Curator
result: no hit

source: The value changed.
TM source: The Truth
result: no hit
```

This is intentionally narrower than general English concordance fuzzy matching.
If later usage shows real recall gaps, the English phrase evidence function can
be expanded in small, test-backed increments.

## CJK and Default Guardrails

The implementation must preserve these invariants:

- Non-English projects do not pass `profile: 'english'` to TM repository recall.
- `buildTMRecallQueryPlan` and `buildTMConcordanceRecallQueryPlan` return the
  same default plans when the profile is omitted.
- CJK local-overlap scoring, contained-CJK promotion, and CJK diversity buckets
  are not changed by English work.
- Existing CJK tests in `TMService.test.ts` and `TMMatchFlow.test.ts` remain
  meaningful and must pass.
- English helpers must not be called from default/CJK scoring paths except
  through explicit profile dispatch.

## Testing Strategy

Unit/profile tests:

- resolve `en` and `en-*` to `english`
- resolve `zh-CN`, `ja-JP`, `fr-FR`, and missing locale to `default`
- canonicalize English acronym, hyphen/space, and regular plural examples
- reject ordinary-token overreach such as `The Curator` from `the`

Service tests:

- English projects pass `profile: 'english'` to fuzzy and concordance recall
- CJK/default projects keep the current recall options exactly
- recalled English candidates score correctly for acronym, hyphen/space, and
  regular plural cases
- weak English overlap does not become a TM or concordance match

Repository/flow tests:

- memory DB flow recalls and scores `A.P.I.` against TM source `API`
- memory DB flow recalls and accepts `Lumie Trees` against TM source
  `Lumie Tree`
- memory DB flow rejects `Tree` against TM source `Lumie Tree`
- existing CJK flow tests continue to pass unchanged

Verification commands should include the focused TM service/flow tests, the
core text tests if profile helpers live in `@cat/core/text`, DB typecheck, app
typecheck, and `git diff --check`.

## Rollout

V1 should be implemented as a small, reversible profile overlay:

1. Add profile helper tests and helper APIs.
2. Thread optional `profile: 'english'` through TM recall options.
3. Add English recall variants behind the profile gate.
4. Add English scoring overlay behind the profile gate.
5. Add conservative English phrase concordance evidence behind the profile
   gate.
6. Update `DOCS/60_TM_TB_REFERENCE.md` after behavior is implemented.

The first implementation should prefer clarity over breadth. When in doubt,
leave an English variant out until a real example proves it is needed.

## Acceptance Criteria

- English source projects can match useful TM candidates across conservative
  plural, hyphen/space, acronym, punctuation, and case differences.
- `Lumie Tree`-style multi-token English phrases can appear as concordance
  evidence without allowing single ordinary tokens to flood results.
- CJK/default behavior is equivalent when no English profile is selected.
- No schema migration or import-time alias materialization is introduced.
- The profile boundary is explicit enough that future English TM iterations can
  add rules by changing isolated helpers plus tests, not by editing CJK logic.
