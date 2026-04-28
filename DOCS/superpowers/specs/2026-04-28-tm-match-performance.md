# TM Match Performance Fix

## Context

After the TM concordance semantics feature landed, the entire UI has become noticeably laggy. The lag is most apparent when navigating between segments: the app freezes briefly on each segment change.

## Root Cause Analysis

The performance bottleneck is in the TM match pipeline that runs on every segment activation:

1. **Segment activation** triggers `useActiveSegmentMatches` (150ms debounce).
2. IPC call to `TMService.findMatches()` in the main process.
3. `findMatches()` calls `tmRepo.searchConcordance()` synchronously.
4. `searchConcordance()` runs FTS, then falls back to expensive LIKE queries with many CJK sliding-window fragments.
5. For each candidate returned, `findMatches()` computes Levenshtein, Dice, bigram counts, and O(n*m) longest common substring.
6. All of this blocks the Electron main process — no UI updates until complete.

### Specific Hotspots

#### 1. Redundant `getProjectMountedTMs` calls

`findMatches()` calls `getProjectMountedTMs(projectId)` at line 99. Then `searchConcordance()` calls it again internally at line 170. This is a wasted SQL query per invocation.

#### 2. Excessive LIKE fragment generation

`buildCjkWindowFragments()` generates all sliding windows of sizes 2, 3, 4 for each CJK term. A 20-character term produces ~54 fragments. These become LIKE clauses that each require a full scan. The fragments are capped at 12 primary + 4 secondary, but this still means up to 16 LIKE patterns with `%fragment%` — each one a table scan.

#### 3. O(n*m) longest common substring per candidate

`findLongestCommonSubstring()` allocates two arrays per iteration and runs nested loops over every character pair. With 10 candidates of moderate length, this is significant.

#### 4. No result caching across segment visits

Navigating back to a previously-viewed segment reruns the entire pipeline. There is no cache keyed by source hash.

#### 5. Missing renderer memoization

`useEditorRowDisplayModel` calls `buildEditorRowDisplayModel()` on every render with no `useMemo`. `TMPanel` calls `buildCombinedMatches()` (with token serialization + sort) on every render.

## Goal

Eliminate the UI lag by reducing main-process blocking time and avoiding redundant work, without changing the concordance semantics or match quality.

## Proposed Fixes

### Fix 1: Pass mounted TMs into `searchConcordance`

Remove the internal `getProjectMountedTMs` call from `searchConcordance`. Have the caller pass the TM IDs directly.

### Fix 2: Reduce LIKE fallback pressure

When FTS returns >= 3 results, skip the LIKE fallback entirely. When LIKE fallback is needed, limit the total fragment count more aggressively — anchor fragments only (head + tail of each window size), no sliding window.

### Fix 3: Add source-hash-keyed match cache

Cache `findMatches` results in `useActiveSegmentMatches` by `activeSegmentSourceHash`. Clear on project change.

### Fix 4: Memoize renderer computations

Add `useMemo` to `useEditorRowDisplayModel`. Memoize `buildCombinedMatches` in `TMPanel`.

## Out of Scope

- Changing the concordance classification logic or thresholds.
- Moving TM matching to a worker thread (future optimization).
- Changing the FTS tokenizer or schema.
- Virtualizing the segment list.

## Testing

- Existing TMService tests must continue to pass (match quality unchanged).
- Existing TMPanel tests must continue to pass.
- Existing EditorRow tests must continue to pass.
- Manual verification: navigating segments should feel responsive.
