# TM CJK Recall Candidate Refactor

## Problem

`TMService.findMatches()` currently depends on `TMRepo.searchConcordance()` for fuzzy TM candidates and concordance candidates. After the `tm_fts` trigram refactor, `searchConcordance()` treats contiguous CJK text as one quoted phrase. That makes recall too strict for common CAT workflows where the active source contains a reusable shorter TM source.

Examples that should recall candidates but do not:

- Active source: `前往动物变身聚会（可选）`; TM source: `动物变身聚会`
- Active source: `风荷立柱设计图`; TM source: `风荷立柱`

The scoring layer can already decide whether a recalled candidate is a fuzzy TM match or a concordance suggestion, but the current recall layer often never returns the candidate.

## Decision

Refactor TM search into a neutral candidate recall stage:

- Keep `TMService.findMatches()` as the owner of exact hash matching, fuzzy scoring, concordance classification, sorting, and final top-10 truncation.
- Add a repository-level candidate recall API named `searchTMRecallCandidates()` that returns candidate TM entries without deciding whether they are fuzzy TM matches or concordance suggestions.
- Make CJK recall use a bounded tiered query plan: exact phrase terms first, 4-6 character CJK fragments second, 3-character fragments only when needed, and 2-character fallback only as a constrained supplement.
- Apply a lightweight evidence gate before returning candidates so broad trigram matches do not flood `TMService` with noise.

The final classification rule remains:

1. Exact hash hit: `kind: 'tm'`, `similarity: 100`.
2. Same normalized text with different hash or tags: `kind: 'tm'`, `similarity: 99`.
3. Weighted fuzzy score `>= 50`: `kind: 'tm'`.
4. Weighted fuzzy score `< 50` and local-overlap score `>= 50`: `kind: 'concordance'`.
5. Otherwise discard the candidate.

## Goals

- Recall shorter CJK TM entries that are contained in a longer active source.
- Recall near-identical CJK sentences where a small prefix, suffix, or character difference prevents exact phrase MATCH.
- Keep CJK recall bounded and index-backed for the normal path.
- Preserve existing user-facing semantics: fuzzy TM matches show percentages; concordance suggestions do not.
- Keep the scoring threshold at `50`; this refactor broadens recall, not acceptance.

## Non-Goals

- Do not add a new schema table for precomputed TM fragments.
- Do not lower `TMService.MIN_SIMILARITY`.
- Do not change `tm_fts` away from `tokenize='trigram'`.
- Do not implement source-to-target fragment alignment.
- Do not make active segment matching depend on target-side FTS hits.

## Architecture

### Current Boundary

`TMService.findMatches()` calls `tmRepo.searchConcordance(projectId, query, tmIds)`. The repository method parses the query and returns up to 10 candidates. The method name implies concordance, but its result is also used for fuzzy TM scoring.

### New Boundary

Introduce a repository method with candidate-recall semantics:

```ts
searchTMRecallCandidates(
  projectId: number,
  sourceText: string,
  tmIds?: string[],
  options?: {
    scope?: 'source' | 'source-and-target';
    limit?: number;
  },
): TMEntryWithTmId[];
```

`TMService.findMatches()` calls it with:

```ts
searchTMRecallCandidates(projectId, sourceTextOnly, tmIds, {
  scope: 'source',
  limit: 50,
});
```

Manual concordance search keeps the old `searchConcordance()` API as a facade. It calls the same query-plan builder with `scope: 'source-and-target'` so UI concordance search can still search target text. Active segment fuzzy matching uses source-side recall only.

## Recall Query Plan

Create one shared private helper in `TMRepo`:

```ts
buildTMRecallQueryPlan(sourceText: string): TMRecallQueryPlan
```

The plan contains bounded tiers.

### Exact Phrase Terms

Cleaned full terms from the source. These preserve current precise behavior.

Example:

```text
风荷立柱设计图 -> 风荷立柱设计图
Translation memory test -> Translation, memory, test
```

### Primary CJK Fragments

Use 4-6 character CJK sliding windows as the main CJK recall tier.

Example:

```text
风荷立柱设计图
-> 风荷立柱, 荷立柱设, 立柱设计, 柱设计图
```

```text
前往动物变身聚会可选
-> 前往动物, 往动物变, 动物变身, 物变身聚, 变身聚会, 身聚会可, 聚会可选
```

The query plan includes 4-character sliding windows first. It then adds 5-6 character anchor windows only after the 4-character windows are selected, and the total primary fragment count must stay within the cap.

### Secondary CJK Fragments

Use 3-character windows only when exact phrase and primary fragments return too few candidates. These catch shorter shared terms but are noisier.

Example:

```text
风荷立柱设计图
-> 风荷立, 荷立柱, 立柱设, 柱设计, 设计图
```

### Short CJK Fallback Terms

Use 2-character terms only as a constrained fallback:

- Only run when FTS recall is below a small threshold.
- Limit to a few terms.
- Return only a small number of fallback candidates.
- Prefer source-side LIKE in active matching.

This preserves useful cases such as `困梦` without letting common 2-character fragments dominate.

### Latin and Mixed Terms

Latin and mixed-script terms continue to be split on whitespace and punctuation. Terms shorter than 2 characters are ignored. Pure numeric terms are ignored.

## Evidence Gate

`searchTMRecallCandidates()` should not return every row matched by a broad OR query. After each tier returns rows, the repository should inspect the active source and candidate source text and accept only candidates with enough evidence.

The initial evidence rules:

- Accept if source and candidate share a continuous CJK substring of length `>= 4`.
- Accept if source and candidate share at least two distinct 3-character CJK fragments.
- Accept a 2-character-only match only when the active source or candidate source is short, or when stronger tiers returned too few candidates.
- Reject candidates that only match weak edge or wrapper fragments such as `前往`, `可选`, or a single shared 3-character fragment.

The evidence gate is intentionally lighter than final scoring. It prevents obvious noise before the expensive scoring algorithms run, while leaving fuzzy-vs-concordance decisions to `TMService`.

## Repository Query Flow

`searchTMRecallCandidates()` should run tiers in order and stop when enough candidates have been accepted:

1. Exact phrase FTS query.
2. Primary CJK fragment FTS query.
3. Secondary 3-character CJK FTS query if accepted results are still below the target.
4. Short 2-character LIKE fallback if accepted results are still below the target and short terms exist.

Each tier deduplicates by TM entry id. The default overfetch limit is `50` accepted candidates for active matching.

For FTS tiers:

- Use `tm_fts MATCH ?` with quoted terms joined by `OR`.
- Use source-side filtering for active matching.
- Keep term counts bounded before building the MATCH expression.

For LIKE fallback:

- Use `LIKE ? ESCAPE '/'`.
- Limit term count and returned row count.
- Use it as fallback, not the normal CJK path.

## TMService Data Flow

`TMService.findMatches()` should become:

1. Get mounted TMs.
2. Extract `sourceTextOnly` and `sourceNormalized`.
3. Add exact hash matches at `100`.
4. Call `searchTMRecallCandidates()` with the text-only source and mounted TM ids.
5. Skip candidates already matched by exact hash.
6. Run the existing normalized text, local overlap, length-bound, Levenshtein, Dice, and bonus scoring.
7. Classify using the existing threshold rules.
8. Sort by `rank desc`, then `usageCount desc`, and return top 10.

`searchTMRecallCandidates()` does not produce user-facing similarity. Internal recall evidence is allowed in tests and debug logs only; UI and AI prompt code continue to rely on `TMService` output.

## Expected Case Behavior

### Case 1

```text
source: 前往动物变身聚会（可选）
tm source: 动物变身聚会
```

Primary CJK fragments include overlapping windows such as `动物变身` and `变身聚会`, so the candidate is recalled. `TMService` then decides whether its fuzzy score reaches `50`. If it does, the result is `kind: 'tm'`; otherwise the local-overlap rules can classify it as `kind: 'concordance'`.

### Case 2

```text
source: 风荷立柱设计图
tm source: 风荷立柱
```

Primary CJK fragments include `风荷立柱`, so the candidate is recalled. Existing scoring should classify it as fuzzy TM if the weighted similarity is at least `50`; otherwise it can still qualify as concordance through local overlap.

## Performance Guardrails

- Default active-match candidate limit: `50`.
- Hard cap primary CJK fragments at `16`.
- Hard cap secondary 3-character fragments at `12`.
- Run secondary and short fallback tiers only when stronger tiers did not accept enough candidates.
- Keep 2-character LIKE fallback small: no more than `4` terms and `10` fallback rows.
- Active segment matching queries source text only.
- Do not generate all substrings of a CJK source.
- Keep expensive scoring in `TMService` bounded by the accepted candidate limit.

This is expected to be more expensive than the current one-phrase trigram query, but far safer than the older full-table LIKE fragment fallback. Normal CJK recall remains FTS-backed.

## Testing

Add focused tests for the new recall behavior:

- `风荷立柱设计图` recalls `风荷立柱`.
- `前往动物变身聚会（可选）` recalls `动物变身聚会`.
- A near-identical CJK sentence with one differing first character is recalled.
- Short CJK item names such as `织云木种子` recall `柔粉织云木` and `岚绿织云木`.
- Long CJK source text produces a bounded number of recall fragments.
- 2-character fallback can recall a short term but does not crowd out stronger multi-character matches.
- Active matching does not return target-only hits.
- `TMService.findMatches()` classifies recalled candidates using existing fuzzy-first, concordance-second logic.

Update existing DB tests that currently describe "concordance" recall so they target the neutral candidate recall behavior where appropriate.

## Documentation Updates

Update `DOCS/35_TM_MATCH_FLOW.md` after implementation:

- Rename the candidate stage from concordance-only to TM recall candidates.
- Document the tiered CJK recall plan.
- Document the evidence gate and candidate limit.
- Correct the FTS write-path note to reflect the actual display-text write paths unless implementation changes them.

## Compatibility

This design can be implemented without schema migration. Existing public IPC shapes can stay unchanged because `TMService.findMatches()` still returns `TMMatch[]`. Internal repository interfaces and tests will change.

The old `searchConcordance()` name can remain for renderer concordance panel compatibility, but active segment matching should use the new candidate recall method to make the responsibility clear.
