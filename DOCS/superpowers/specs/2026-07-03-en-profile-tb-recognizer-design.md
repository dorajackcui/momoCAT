# EN Profile TB Recognizer Design

Date: 2026-07-03

## Purpose

Improve terminology recall for non-CJK source projects, with the Nikki
`en-fr` failure as the motivating case:

- source segment: `Change Details: The Self Reclaimed (Backpiece) The Day of Birth (Dress)`
- TB entry: `The Day of Birth -> Premier souffle`
- failure mode: the entry exists in the mounted TB and the final matcher can
  validate it, but candidate recall does not include it.

The fix should move EN/general TB lookup away from head-biased SQL fragment
recall and toward a recognizer-driven pipeline. Existing CJK TB behavior should
remain on its current path.

## Non-Goals

- Do not change the TB database schema in the first implementation.
- Do not migrate existing local DB files.
- Do not replace the CAT stack with an external CAT project.
- Do not change CJK TM recall, scoring, or matching behavior.
- Do not change CJK TB recall, candidate merge, fallback, or final matching
  behavior.
- Do not make full mounted-TB scans the default fallback for every lookup.
- Do not introduce broad stemming, edit distance, or semantic matching in v1.

## Profile Rule

Project source language chooses the text recall profile for both TM and TB.
Segment content does not choose the profile.

```text
project.srcLang in zh/ja/ko/cmn/yue family -> cjk profile
all other project.srcLang values -> en profile
```

The `en` profile name is historical. Internally, the implementation may use a
name such as `general` or `latin` if that makes the code clearer, but the
behavior is the non-CJK profile described here.

This rule has two important consequences:

- An English project containing Chinese text still uses the EN/general profile.
- A Chinese, Japanese, or Korean project containing English terms still uses the
  CJK profile.

## CJK Route Invariance

The shared profile resolver is only a routing boundary. It must not change the
implementation selected for CJK source projects.

For CJK source projects:

- TM continues to use the existing CJK/default TM route, including current
  recall terms, fuzzy/concordance candidate selection, scoring, diversity, and
  thresholds.
- TB continues to use the existing CJK TB route, including current exact lookup,
  FTS fragments, candidate merge behavior, mounted-TB fallback policy, and final
  position matching.
- The EN/general recognizer, EN article handling, EN hyphen/acronym variants,
  and EN single-word FTS fallback do not run.

Any future CJK TM or TB redesign requires a separate spec. This document is only
for the EN/general TB route.

## Current Problem

The current TB lookup has three coupled responsibilities inside the repository
layer:

1. build a source-side search plan,
2. issue exact and FTS SQL queries,
3. merge candidate pools before final term-position validation.

This makes the recall strategy hard to reason about. It also means a fixed
fragment budget can become a product behavior instead of an implementation
safety limit.

For long EN source segments, head-biased fragment selection can miss terms in
the middle or tail of the segment. FTS recall may find other entries, so
`TBService` does not fall back to mounted-TB scanning. The missing term never
reaches `findTermPositionsInTextForLocale`, even though that final matcher is
strict enough to accept the correct match.

## Chosen Approach

Use an EN/general `TermRecognizer` as the primary EN TB lookup mechanism, with
the existing DB recall retained as a bounded fallback. Keep CJK on the legacy
path.

This is preferred over two alternatives:

- Continuing to patch SQL query budgets only: lower risk, but still leaves the
  EN path dependent on fragment selection and candidate-pool merge behavior.
- Materializing a new TB variant index in the schema immediately: cleaner in
  the long run, but too large for this iteration because it requires migration,
  import/update integration, and compatibility handling.

The recognizer approach gives EN TB recall a clearer model without breaking old
DB files.

## Architecture

Add an explicit profile dispatch above the repository details:

```text
TBService.findMatches(projectId, segment)
  -> serialize source tokens
  -> resolveSourceRecallProfile(project.srcLang)
  -> cjk: legacy TB lookup
  -> en: EnglishTBLookupProfile.findMatches
```

The EN lookup profile is responsible for EN-specific candidate recognition and
ranking. The repository remains responsible for reading mounted TB entries and
running SQL fallback queries.

Suggested boundaries:

- `resolveSourceRecallProfile(locale)` lives in `@cat/core/text` and is shared
  by TM and TB.
- `EnglishTBLookupProfile` lives in localization/service code because it
  coordinates repository reads and match assembly.
- `EnglishTermRecognizer` lives in core text code because it is deterministic
  text logic and should be easy to unit test without a database.
- `TBRepo` keeps exact/FTS query helpers but stops owning EN profile policy over
  time.

## EN Lookup Data Flow

```text
segment source tokens
  -> serialize with token boundaries
  -> EN tokenization with source positions
  -> load mounted TB entries
  -> get or build recognizer index
  -> scan source tokens once
  -> validate matches against source text
  -> optional DB fallback candidates
  -> merge, rank, suppress nested matches
```

The recognizer returns candidate matches with:

- TB entry id,
- matched source span,
- matched variant text,
- variant kind,
- TB priority and usage metadata.

The final result remains `TBMatch[]`. The existing final validation step remains
authoritative so recall expansion cannot become final output noise.

## Recognizer Index

Build an in-memory index from currently mounted TB entries. The first
implementation does not persist this index.

Cache key:

```text
projectId
mounted TB ids and priorities
max mounted TB entry updatedAt
profile version
```

If a TB is mounted, unmounted, edited, imported, or reprioritized, the cache key
changes and the index is rebuilt.

The index maps normalized token sequences to one or more TB entries. A token
trie is enough for v1. An Aho-Corasick implementation can replace the internals
later without changing the public recognizer interface.

### Amendment (2026-07-03, post-implementation)

The stats-based cache key above was replaced by an in-process TB data version:

- `TBRepo` keeps a monotonic counter bumped by every structural TB write
  (create/delete TB, mount/unmount, entry insert/upsert). The recognizer cache
  key is `profile version + data version`, so the steady-state lookup path does
  not run `COUNT(*)`/`MAX(updatedAt)` per segment.
- `incrementTBUsage` deliberately does not bump the version. Usage counts only
  refine ranking tie-breaks; bumping would rebuild the index on every use.
  Recognizer entries may therefore hold slightly stale usage counts until the
  next structural write.
- The per-service recognizer cache is LRU-bounded (4 projects) so switching
  between many projects cannot grow memory without bound.
- When the index is incomplete (mounted entries exceed the project entry read
  limit), the rebuild logs a warning naming the covered/total entry counts, so
  degraded per-segment DB fallback recall is observable.
- The recognizer scan is prefix-gated: span extension stops as soon as the
  token sequence is no longer a prefix of any indexed variant, so one long
  indexed term does not slow scanning of unrelated text.
- Implementation note: DB fallback candidates currently share a single
  `dbFallback` rank tier instead of the exact/phrase/single split listed under
  Ranking and Merge Policy; fallback candidates still require recognizer
  position validation, so the coarser tiering has no recall effect.

## Variant Rules

Variant generation must be conservative. It should improve known CAT
terminology cases without turning the EN profile into a stemmer.

V1 variants:

- canonical normalized source term,
- leading article handling for `the`, `a`, `an`,
- hyphen and space equivalence, such as `real-time` and `real time`,
- dotted and undotted acronym equivalence, such as `U.S.` and `US`,
- regular final-word singular/plural handling, such as `Lumie Trees` and
  `Lumie Tree`.

V1 exclusions:

- general stemming,
- edit distance,
- synonym expansion,
- arbitrary stopword deletion,
- semantic similarity.

Every generated variant should carry a `variantKind` so ranking and debugging
can explain why a term matched.

## Tokenization and Boundaries

The EN recognizer tokenization should:

- normalize Unicode width and case,
- treat tags and protected markers as hard boundaries,
- keep token offsets back to the serialized source text,
- preserve punctuation behavior needed for acronym and hyphen variants,
- avoid matching across tag boundaries.

This keeps the recognizer aligned with CAT segment structure and prevents
matches that only exist because tags were removed.

## Ranking and Merge Policy

Use deterministic ordering:

1. exact canonical variant,
2. conservative generated variant,
3. DB exact fallback candidate,
4. DB phrase FTS fallback candidate,
5. DB single-word FTS fallback candidate.

Within each tier:

- lower mounted TB priority wins,
- longer source term wins,
- higher usage count wins,
- stable entry id order breaks remaining ties.

Nested matches are suppressed after ranking, using the existing
`suppressNestedTermMatches` behavior unless tests show EN needs a narrower
rule.

## DB Fallback

Keep the existing SQL recall path as fallback and safety coverage, but make the
EN behavior explicit:

- Exact alias generation should be allowed to cover the whole source. Batch size
  is a SQL implementation detail, not a global recall cap.
- Single-word FTS for EN/general should use unique content words with a high
  safety cap. The cap prevents pathological input from creating unbounded DB
  fanout.
- Phrase and multi-word FTS may remain budgeted, but selection must be
  coverage-first rather than head-only.

The fallback output still goes through final term-position validation.

## Compatibility

No schema change is required for v1.

Existing DB files remain compatible because:

- `tb_entries` remains the source of truth,
- `srcNorm` remains valid,
- `tb_fts` remains valid for fallback,
- no migration is needed,
- no import/export format changes are needed.

The only behavior change is runtime lookup policy for non-CJK source projects.
CJK source projects keep the existing TB path.

## Performance Constraints

The normal EN path should avoid per-segment DB query fanout:

- building or refreshing the recognizer index is tied to mounted TB state,
- scanning a segment is linear in source token count,
- DB fallback is bounded and should not run as an unbounded full scan.

Suggested initial limits:

- recognizer index uses the current project-mounted TB entry read limit unless
  that limit is separately redesigned,
- EN single-word FTS safety cap starts at 256 unique content words,
- exact fallback batch size stays around 128 to 200 terms,
- DB fallback candidate limit remains capped by the service-level TB limit.

These constants should be named as safety limits, not as recall strategy.

## Testing

Add tests at three levels.

Core text tests:

- profile resolver maps `zh`, `ja`, `ko`, `cmn`, `yue` to CJK and other source
  languages to EN/general,
- EN tokenizer preserves hard boundaries around tags,
- recognizer matches canonical, article, hyphen/space, acronym, and final
  singular/plural variants,
- recognizer does not cross tag boundaries.

Repository/service tests:

- `The Day of Birth` is recalled in the Nikki-style segment,
- the same term is recalled when placed near token 10, 50, 120, and 219,
- exact multi-word terms are not crowded out by many single-word FTS candidates,
- DB fallback candidates still require final source-position validation.

Regression tests:

- CJK source project TM behavior remains on the current CJK/default TM path,
- CJK source project TB behavior remains on the current CJK TB path,
- a non-CJK source such as `fr-FR` uses the EN/general profile by the project
  source-language rule,
- mounted TB priority and nested suppression remain stable.

## Rollout

Implement in two phases.

Phase 1:

- add shared profile resolver,
- introduce EN lookup profile boundary,
- implement in-memory recognizer index,
- keep DB fallback enabled,
- add regression tests for the Nikki failure and long-source position coverage.

Phase 2:

- measure recall latency and candidate counts,
- refine DB fallback budgets if needed,
- consider a persisted variant index only if in-memory indexing becomes the
  bottleneck.

## Success Criteria

- The Nikki `The Day of Birth` case recalls the TB entry through EN profile TB
  lookup.
- EN long-source terminology is not missed solely because it appears near the
  tail of the segment.
- CJK TM and TB tests keep passing without adopting EN recognizer behavior.
- Existing local DB files continue to open and search without migration.
- The new EN behavior is isolated behind profile dispatch and can be iterated
  without scattering language checks through repository code.
