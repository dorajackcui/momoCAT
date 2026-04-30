# 36_TM_RECALL_DESIGN

Draft design for splitting TM fuzzy recall and concordance / CJK substring recall while reusing the same physical TM index.

## Last Updated

2026-04-30

## Status

Draft for current-round TM match recall refactor. First external review feedback incorporated.

## Current Round Scope

In scope:

- The upstream recall engine used by `TMService.findMatches()`.
- Source-side TM fuzzy recall for active segment matching.
- Source-side concordance / CJK substring recall used inside the active TM match flow.
- Candidate merge, cheap pre-scoring guards, final scoring, classification, and diversity in `TMService`.

Out of scope for this round:

- Changing the explicit `TMRepo.searchConcordance(projectId, query, tmIds)` route.
- Target-side recall for active segment matching.
- Concordance UI behavior.
- Replacing `tm_fts` with a new physical index.

The explicit concordance search API can be revisited later, after the active TM match recall engine is stable.

## Problem Statement

The current TM match flow uses `TMRepo.searchTMRecallCandidates()` as the single upstream recall function for both:

- TM fuzzy recall: find full-segment or near-full-segment translation memory matches.
- Concordance / CJK substring recall: find shorter TM entries or phrases fully contained inside the active source.

These two goals have different recall policies. The current shared function is conservative enough for fuzzy matching, but it is not reliable as a CJK substring search engine.

Example source:

```text
阿茉玻曾见证清新天王将因绝望病逝世的心愿精灵送回星空。
```

Expected concordance candidates:

```text
阿茉玻
清新天王
```

Both candidates are fully covered by the active source, but can fail to reach `4b-1 Local Overlap` because they are filtered out before scoring.

## Current Failure Mode

### `阿茉玻`

`阿茉玻` is a 3-character CJK entry. It can be generated as a `secondaryCjkFragment`, but the current evidence gate requires:

```typescript
sharedSecondaryCount >= 2
```

A TM entry whose source is exactly `阿茉玻` only contains one 3-character secondary fragment, so it is rejected even though the active source fully contains it.

### `清新天王`

`清新天王` is a 4-character CJK entry. It should be a strong concordance candidate, but primary CJK fragments are spread-sampled and capped:

```typescript
primaryCjkFragments: selectSpreadFragments(all4to6CharWindows, 16)
```

For a longer CJK source, the exact 4-character window `清新天王` may be absent from the selected primary fragments. Secondary fragments may also be capped, so the candidate can still fail `sharedSecondaryCount >= 2`.

### Root Cause

The current function mixes two policies:

| Policy | Desired behavior | Current shared behavior |
|---|---|---|
| Fuzzy recall | Precision-biased, avoid noisy candidates | Reasonable |
| Concordance recall | Recall-biased, short contained phrases must not be missed | Too strict |

The physical index is acceptable; the policy layer is not separated enough.

## Design Principle

Use the same storage and index primitives, but split recall policy.

```text
tm_entries + tm_fts
        |
        v
TM recall primitives
        |
        +--> recallTMFuzzyCandidates()
        |
        +--> recallConcordanceCandidates()
        |
        v
TMService.findMatches(): merge, score, classify, diversify
```

Do not build two independent physical indexes unless performance proves that FTS5 trigram is insufficient. The first design step should split API and policy, not storage.

## Non-Goals

- Do not change 100% hash matching semantics.
- Do not replace `tm_fts` in the first iteration.
- Do not make every CJK 2-character overlap a strong candidate.
- Do not move final scoring into the repository layer.
- Do not wait until late migration phases to measure recall latency; performance guardrails are part of phase 1.

## Existing Indexes To Reuse

### `tm_entries`

Stores canonical TM entry data:

- `srcHash`
- `matchKey`
- `tagsSignature`
- `sourceTokensJson`
- `targetTokensJson`
- `usageCount`

Used by:

- 100% hash exact match.
- Full TM entry hydration after FTS recall.

### `tm_fts`

SQLite FTS5 virtual table:

```sql
CREATE VIRTUAL TABLE tm_fts USING fts5(
  tmId UNINDEXED,
  srcText,
  tgtText,
  tmEntryId UNINDEXED,
  tokenize='trigram'
);
```

Used by:

- Source-side active segment recall.
- Existing source/target-side explicit concordance search.
- CJK substring phrase lookup for terms of length >= 3.

## Proposed Public API

### Keep Backward-Compatible Wrapper

Keep `searchTMRecallCandidates()` during migration, but treat it as a compatibility wrapper rather than the final design.

```typescript
searchTMRecallCandidates(projectId, sourceText, tmIds, options)
```

Internally it can call the fuzzy policy in phase 1.

### Add Fuzzy Recall API

```typescript
searchTMFuzzyRecallCandidates(
  projectId: number,
  sourceText: string,
  tmIds?: string[],
  options?: {
    scope?: 'source';
    limit?: number;
  },
): TMEntryRow[];
```

Policy:

- Source-side only for active TM match.
- Prefer full terms and longer CJK windows.
- Keep conservative evidence gate.
- Fallback to shorter CJK only when the longer path is sparse.
- Optimize for low noise before standard similarity scoring.

### Add Concordance Recall API

```typescript
searchTMConcordanceRecallCandidates(
  projectId: number,
  queryText: string,
  tmIds?: string[],
  options?: {
    scope?: 'source';
    limit?: number;
    rawLimit?: number;
  },
): TMEntryRow[];
```

Policy:

- Recall-biased.
- Explicitly accepts short CJK candidates fully contained in the query.
- Source-side only in the current round, because it is used by active segment TM match flow.
- Uses local overlap and coverage evidence instead of fuzzy-style multi-fragment evidence.

Future extension: allow `scope: 'source-and-target'` when the explicit concordance search route is redesigned.

## Fuzzy Recall Policy

Fuzzy recall should remain close to the current behavior.

### Query Plan

Build from `sourceText`:

- Full cleaned terms length >= 3.
- Latin / non-CJK terms length >= 3.
- Spread-sampled 4/5/6-character CJK windows.
- Spread-sampled 3-character CJK windows only if primary recall is sparse.
- Limited 2-character fallback only if recall is very sparse.

### Evidence Gate

Accept candidate if:

- It contains a primary 4-6 character CJK fragment.
- It contains at least two secondary 3-character CJK fragments.
- It contains a latin term.
- It passes controlled short fallback evidence.

This policy is allowed to miss some short contained phrases because those belong to concordance recall.

## Concordance Recall Policy

Concordance recall should be a high-recall substring search.

### Query Plan

Build a different plan from `queryText`:

- All 3-character CJK windows up to a generous per-segment cap.
- All 4-character CJK windows up to a generous per-segment cap.
- Optional 5/6-character CJK windows for stronger ranking signals.
- Latin / non-CJK terms length >= 3.
- Controlled 2-character CJK terms for later fallback only.

Unlike fuzzy recall, concordance recall should not rely on the narrow fuzzy spread sample. However, it must still have a performance budget. Initial caps:

| Window | Initial cap | Selection |
|---|---:|---|
| 4-char CJK | 64 | keep all if under cap; otherwise spread-sample |
| 3-char CJK | 48 | keep all if under cap; otherwise spread-sample |
| 5/6-char CJK | 32 | optional stronger signals |

For typical source lengths these caps keep important 3/4-character entity windows while avoiding unbounded FTS expressions.

### FTS Query Batching

Avoid a single giant FTS expression. Batch phrase terms:

```typescript
const batches = chunk(terms, 32);
for (const batch of batches) {
  queryFts(batch);
}
```

Each batch uses:

```sql
"term1" OR "term2" OR ...
```

For `scope: 'source'`:

```sql
srcText : ("term1" OR "term2" OR ...)
```

Future explicit-concordance extension: for `scope: 'source-and-target'`, search both FTS columns by omitting the column filter.

Deduplicate by `tmEntryId` across batches.

Performance guardrail:

- Measure per-segment concordance recall latency in phase 1.
- Initial soft budget: 50ms for concordance recall on a normal mounted TM set.
- If the budget is exceeded, degrade within the same request by reducing the plan to 4-character windows plus latin terms, then retry or continue with the partial result set.
- Record raw FTS query count, raw rows, accepted rows, and degraded-mode usage for later tuning.

### Concordance Evidence Gate

Use local overlap and contained-candidate evidence, not fuzzy multi-fragment evidence.

Accept candidate if any rule passes:

1. Short CJK candidate fully contained in query.

```typescript
queryText = serializeTokensToTextOnly(queryTokens)
candidateText = serializeTokensToTextOnly(candidate.sourceTokens)
normalizedQuery = normalizeForOverlap(queryText)
normalizedCandidate = normalizeForOverlap(candidateText)
normalizedCandidate is pure CJK after removing spaces
candidateLength >= 3
candidateLength <= 8
containsWithTokenBoundary(normalizedQuery, normalizedCandidate)
```

`containsWithTokenBoundary()` must not remove tag-introduced spaces. This preserves the rule that `风荷<tag>立柱` does not strongly contain `风荷立柱`. If both query and candidate contain the same tag boundary, both normalize to `风荷 立柱` and may match only as the same boundary-preserving phrase.

2. High coverage local overlap.

```typescript
entryCoverage >= 90
overlapLength >= 3
```

3. Strong longer overlap.

```typescript
overlapLength >= 4
localOverlap.score >= 50
```

This would allow:

```text
query:     阿茉玻曾见证清新天王...
candidate: 阿茉玻
candidate: 清新天王
```

Both are accepted before final scoring.

### 2-Character CJK Handling

2-character CJK is noisy and should not be treated like 3/4-character recall.

Initial design:

- Do not include all 2-character windows in the main concordance FTS path.
- Keep LIKE fallback for selected 2-character terms.
- Only accept 2-character candidates when additional evidence exists, such as:
  - candidate is a known exact TM entry with short source component;
  - candidate has high usage or exact component boundary;
  - future explicit concordance search query is exactly the 2-character term.
- Accept a 2-character candidate when the candidate source's total CJK component length is <= 4 and the whole candidate source is contained in the query with token-boundary semantics.

This allows independent short entries such as `星空` or `精灵` to be recalled, while still avoiding arbitrary internal bigrams like `的心` unless they exist as a short TM entry and pass containment.

## TMService Merge Flow

`TMService.findMatches()` should merge two candidate streams.

```typescript
const fuzzyCandidates = tmRepo.searchTMFuzzyRecallCandidates(
  projectId,
  sourceTextOnly,
  tmIds,
  { scope: 'source', limit: 50 },
);

const concordanceCandidates = tmRepo.searchTMConcordanceRecallCandidates(
  projectId,
  sourceTextOnly,
  tmIds,
  { scope: 'source', limit: 50, rawLimit: 200 },
);

const candidates = mergeByEntryId(fuzzyCandidates, concordanceCandidates);
```

Before expensive scoring, apply cheap guards:

```typescript
const boundedCandidates = candidates.filter((candidate) => {
  const candidateLength = charLength(serializeTokensToTextOnly(candidate.sourceTokens));
  const sourceLength = charLength(sourceTextOnly);
  return candidateLength <= sourceLength * 3;
});
```

The length guard protects the LCS-based local overlap pass from very long entries that cannot be good concordance matches. Fuzzy scoring can still use its existing length-bound shortcut.

Then existing scoring can remain centralized:

- Compute standard similarity.
- Compute local overlap.
- Classify as `kind: 'tm'` or `kind: 'concordance'`.
- Apply final diversity cap.
- Return top 10.

If the same candidate appears in both streams, score it once.

## Explicit Concordance Search Deferred

Do not change `TMRepo.searchConcordance(projectId, query, tmIds)` in the current round.

The current objective is to fix the active TM match flow. Explicit concordance search has related but broader requirements:

- source-side and target-side recall;
- user-entered query behavior;
- result ranking that may differ from active segment matching;
- UI expectations and existing behavior compatibility.

When explicit concordance search is revisited, it can route to the concordance recall policy:

```typescript
const candidates = searchTMConcordanceRecallCandidates(projectId, query, tmIds, {
  scope: 'source-and-target',
  limit: 50,
  rawLimit: 200,
});
```

At that future point, rank by concordance-specific signals:

- local overlap score;
- entry coverage;
- matched text length;
- usage count;
- mounted TM priority if available.

Before that future route change, snapshot current `searchConcordance()` behavior with golden tests.

## Diversity Cap

Diversity should continue to exist in two places:

1. Repo-level candidate diversity.
   - Prevent one substring family from filling the entire candidate pool.
   - Useful for both fuzzy and concordance recall, but thresholds can differ.

2. Final result diversity in `TMService`.
   - Prevent the UI top 10 from being dominated by one overlap bucket.

Bucket canonicalization should remain:

- longest common CJK substring is the bucket;
- pure CJK only;
- length >= 4 by default;
- shorter bucket contained in longer bucket maps to the longer bucket.

Concordance repo-level diversity may use length >= 3 only for short candidates with `entryCoverage >= 90`. Final result diversity should remain length >= 4 by default to avoid over-compressing common 3-character fragments such as `设计图` or `的心愿`.

## Tag Boundary Behavior

`serializeTokensToTextOnly()` should keep tag boundaries as spaces:

```text
风荷<tag>立柱 -> 风荷 立柱
```

This prevents recall from generating cross-tag fake substrings like `风荷立柱`.

This behavior affects:

- active source recall query;
- candidate text used for final scoring;
- local overlap.

It does not affect 100% hash exact match, because hash uses:

```typescript
computeMatchKey(sourceTokens)
computeTagsSignature(sourceTokens)
computeSrcHash(matchKey, tagsSignature)
```

## Migration Plan

### Phase 1: Extract Policy Functions

- Rename current internal logic to fuzzy-oriented helpers.
- Add concordance recall plan builder.
- Add concordance evidence gate.
- Add concordance recall latency instrumentation and the 50ms soft budget.
- Add degraded-mode behavior for oversized concordance plans.
- Keep `searchTMRecallCandidates()` as a wrapper for existing callers.

### Phase 2: Update `TMService.findMatches()`

- Fetch fuzzy and concordance candidates separately.
- Merge by TM entry id.
- Apply cheap pre-scoring guards, including the `candidateLength <= sourceLength * 3` guard for concordance candidates.
- Score once.
- Keep existing final classification logic.

### Phase 3: Measure And Tune Performance

Measure:

- FTS query count per segment.
- Raw rows fetched.
- Candidate rows after evidence gate.
- Time spent in local overlap scoring.
- Degraded-mode frequency.

If batched FTS over the capped 3/4-character windows is too slow, lower the initial caps before considering a new physical index.

### Deferred Phase: Update Explicit Concordance Search

- Snapshot current `searchConcordance()` behavior with golden tests before changing the route.
- Route `searchConcordance()` to concordance recall only.
- Keep final concordance diversity cap.
- Add tests for target-side recall if `scope: 'source-and-target'`.

This deferred phase is not part of the current round.

## Optional Future Index

If FTS batching is not enough, add a table like:

```sql
CREATE TABLE tm_cjk_phrases (
  tmId TEXT NOT NULL,
  phrase TEXT NOT NULL,
  phraseLength INTEGER NOT NULL,
  tmEntryId TEXT NOT NULL
);

CREATE INDEX idx_tm_cjk_phrases_lookup
  ON tm_cjk_phrases(tmId, phraseLength, phrase);
```

This would make short contained CJK recall deterministic:

```sql
WHERE tmId IN (...)
  AND phrase IN (...all query 3/4-char windows...)
```

Do not start here unless FTS5 query batching is insufficient, because it adds write-path complexity to import, confirm segment, and batch commit.

## Test Plan

### Core Recall Tests

1. 3-character contained CJK entry.

```text
query:     阿茉玻曾见证清新天王将因绝望病逝世的心愿精灵送回星空
candidate: 阿茉玻
expected: recalled as concordance candidate
```

2. 4-character contained CJK entry not present in spread-sampled primary windows.

```text
query:     阿茉玻曾见证清新天王将因绝望病逝世的心愿精灵送回星空
candidate: 清新天王
expected: recalled as concordance candidate
```

3. Existing fuzzy recall remains stable.

```text
query:     风荷立柱设计图
candidate: 台阶立柱设计图
expected: fuzzy candidate still available
```

4. Tag boundary blocks fake cross-tag recall.

```text
query tokens: 风荷 <tag> 立柱
candidate:    风荷立柱
expected: not accepted by strong contained-substring evidence
```

5. Exact hash unchanged.

```text
same source tokens + same tag signature
expected: 100% hash match still works
```

6. 2-character independent CJK entry.

```text
query:     阿茉玻曾见证清新天王将因绝望病逝世的心愿精灵送回星空
candidate: 星空
expected: recalled when candidate source total CJK length <= 4 and fully contained
```

### Concordance Ranking Tests

- Prefer full contained entry over suffix-only overlap.
- Prefer longer contained phrase when scores are otherwise close.
- Apply diversity cap when many candidates share the same suffix.
- Keep final-result diversity at a 4-character bucket threshold unless a candidate is a short, high-coverage concordance result.

### Future Explicit Concordance Golden Tests

Before the deferred explicit concordance phase, snapshot existing behavior:

- Source-side substring hit still appears.
- Target-side substring hit still appears for `scope: 'source-and-target'`.
- Multiple mounted TMs preserve priority expectations.
- Existing CJK inner-phrase cases remain recalled.
- Diversity cap still prevents one overlap family from filling the final result set.

These tests are not required to land the current active TM match recall refactor, but they are required before changing `searchConcordance()`.

### Performance Tests

- Segment length 30, 80, 150 CJK chars.
- TM sizes 1k, 50k, 200k.
- Measure recall latency and raw row counts.
- Assert degraded-mode behavior when the initial concordance plan exceeds the latency budget.

## Open Questions For Review

1. Is the initial 50ms concordance recall soft budget realistic on the expected local SQLite database sizes?
2. What is the maximum safe FTS OR batch size for SQLite FTS5 in our app?
3. How aggressive should 2-character CJK recall be in active TM match flow?
4. Should `searchTMRecallCandidates()` be deprecated after the split, or kept as a combined compatibility API?
5. Should local overlap scoring be moved into a shared helper so repo evidence and `TMService` classification use exactly the same implementation?
6. When should explicit `searchConcordance()` be scheduled for the deferred route split?

## Recommended Direction

Split the recall policies now, but keep the index shared.

The immediate bug class is not caused by missing storage. It is caused by using a fuzzy-oriented prefilter for concordance recall. A dedicated concordance recall policy can fix short contained CJK phrase recall while preserving the stricter fuzzy path.
