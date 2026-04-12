# TB Matching Plan

## Scope For This Execution

This change implements phase 1 only.

Included:

- create reusable term-matching helpers
- switch TB source matching to text-only matching
- switch terminology QA to text-only matching
- add `NFKC` normalization
- use `Intl.Segmenter` for locale-aware boundary checks
- add tests for tag-split terms and normalization

Deferred:

- SQLite FTS5 candidate retrieval
- schema changes
- explicit per-language variant tables
- sidecar NLP services

Note:

- when FTS candidate retrieval is introduced, short-term blind spots should be handled in the retrieval protocol itself via exact lookup, not by reintroducing service-layer short-term补扫

## Step Plan

1. Add design artifacts under `design/`.
2. Introduce a shared term-matching utility in `@cat/core`.
3. Update `TBService` to use text-only matching and the shared utility.
4. Update terminology QA to use the same shared utility.
5. Add regression tests for multilingual and tag-split scenarios.
6. Run targeted tests.

## Files Expected To Change

- `design/tb-matching-redesign.md`
- `design/tb-matching-plan.md`
- `packages/core/src/index.ts`
- `packages/core/src/termMatching.ts`
- `packages/core/src/index.test.ts`
- `apps/desktop/src/main/services/TBService.ts`
- `apps/desktop/src/main/services/TBService.test.ts`

## Success Criteria

1. TB can match a source term even when tags split the text tokens.
2. QA can validate a target TB term even when tags split the target tokens.
3. Width-normalized text such as full-width Latin characters can still match.
4. Partial-word false positives remain blocked for Latin-script terms.
5. Existing TB tests still pass after the refactor.
