# TM Concordance Semantics Design

## Context

`TMService.findMatches()` currently returns one `TMMatch[]` list for several different behaviors:

- exact source-hash matches
- same normalized source text with different tags
- whole-segment fuzzy matches
- concordance-derived local-overlap suggestions

The last category is useful, but it is currently exposed as a percentage `similarity`. For example, a source segment `麦浪农场` can match a longer TM source such as `据说，叫“麦浪农场”这个名字，是为了纪念一位艺术家在这里画下名作《麦与浪》。` and receive a score around `73`. That result should be recalled, but `73% TM match` incorrectly implies whole-segment similarity.

## Goal

Make the semantic difference between standard TM matches and concordance suggestions explicit while preserving the current useful recall behavior.

This design intentionally does not implement fragment translation extraction or memoQ-style full LSC alignment. It only classifies and presents the local-overlap results that already exist.

## Definitions

### Standard TM Match

A standard TM match means the score represents whole-segment similarity between the active source segment and a TM source segment.

Included cases:

- exact hash match: `similarity = 100`
- same normalized source text with different tags/hash: `similarity = 99`
- whole-segment fuzzy match using Levenshtein, Dice, and bonus scoring: `similarity = 50..99`

Standard TM matches may display percentage similarity and may appear under AI `TM References`.

### Concordance Suggestion

A concordance suggestion means the result was recalled because the active source and TM source share a strong local expression. Its ranking score is useful for ordering, but it is not whole-segment similarity.

Included cases for this iteration:

- a short source appears inside a longer TM source
- two sources share a strong local expression

Example:

```text
source: 麦浪农场
TM source: 据说，叫“麦浪农场”这个名字，是为了纪念一位艺术家在这里画下名作《麦与浪》。
matchedSourceText: 麦浪农场
kind: concordance
```

Concordance suggestions should not display percentage similarity. They should show a concordance label such as `C` or `Concordance`, and may appear under a separate AI `Concordance Suggestions` section.

## Proposed Data Shape

Use a wider suggestion type instead of treating every result as a standard TM match.

```ts
type TMSuggestionKind = 'tm' | 'concordance';

interface TMSuggestion extends TMEntry {
  kind: TMSuggestionKind;
  rank: number;
  tmName: string;
  tmType: 'working' | 'main';

  // Present only for standard TM matches.
  similarity?: number;

  // Present for concordance suggestions when available.
  matchedSourceText?: string;
  sourceCoverage?: number;
  entryCoverage?: number;
}
```

`rank` is an internal ordering score. For standard TM matches, `rank` can equal `similarity`. For concordance suggestions, `rank` can reuse the existing local-overlap score.

`similarity` is only displayed and prompt-rendered for `kind: 'tm'`.

## Classification Rules

`TMService.findMatches()` should classify candidates after scoring:

1. Exact hash hit: `kind = 'tm'`, `similarity = 100`, `rank = 100`.
2. Same normalized text with different tags/hash: `kind = 'tm'`, `similarity = 99`, `rank = 99`.
3. Weighted whole-segment fuzzy score meets the threshold: `kind = 'tm'`, `similarity = weightedSimilarity`, `rank = weightedSimilarity`.
4. Local-overlap score meets the threshold but whole-segment fuzzy does not: `kind = 'concordance'`, `rank = localOverlapScore`, with matched text and coverage metadata.

If both weighted fuzzy and local overlap meet the threshold, prefer `kind = 'tm'` when the weighted whole-segment score is the winning score. Prefer `kind = 'concordance'` when the candidate only qualifies because of local overlap.

## UI Behavior

The existing TM panel can keep a mixed list so translators do not lose useful context.

Display rules:

- `kind: 'tm'`: show the numeric similarity badge.
- `kind: 'concordance'`: show a `C` or `Concordance` badge, styled differently from TM percentages.
- Concordance rows should still show the TM source and target context.
- Double-click behavior can remain unchanged in this iteration, but the UI should not imply the target is a whole-segment TM replacement.

## AI Prompt Behavior

Prompt references should separate the two categories:

- `TM References`: standard TM matches only, rendered with percentage similarity.
- `Concordance Suggestions`: concordance results, rendered with matched source text, TM source, TM target, and TM name.

This prevents prompts such as `Similarity: 73%` for a result that is actually a concordance hit.

## Out Of Scope

The following are explicitly out of scope for this iteration:

- extracting a translated fragment from a longer TM target
- aligning source substrings to target substrings
- building full fragment assembly or patchwork translation
- adding a separate concordance API for active-segment suggestions
- changing TM storage schema

## Testing

Add or update focused tests for:

- exact hash remains `kind: 'tm'` with `similarity = 100`
- same normalized text with tag/hash differences remains `kind: 'tm'` with `similarity = 99`
- whole-segment fuzzy results remain `kind: 'tm'`
- `麦浪农场` inside a longer TM source becomes `kind: 'concordance'`, has matched source metadata, and does not expose a displayed similarity
- shared strong local expressions become `kind: 'concordance'`
- prompt references render standard TM and concordance suggestions in separate sections
- TM panel displays concordance suggestions with a non-percentage badge

## Compatibility

The IPC shape currently names the result `TMMatch` and requires `similarity`. Implementation can either:

- introduce optional fields in a backwards-compatible way first, then migrate renderer and AI consumers; or
- rename to `TMSuggestion` across shared IPC and consumers in one coordinated change.

The implementation plan should choose the smallest coherent migration that keeps type safety and avoids showing concordance `rank` as `similarity`.
