# TM Match Performance Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate UI lag caused by expensive synchronous TM matching on every segment navigation.

**Architecture:** Four targeted fixes: deduplicate a DB query, reduce LIKE fallback pressure, add renderer memoization, and add a source-hash match cache. No changes to concordance classification logic or thresholds.

**Tech Stack:** TypeScript, Electron main/renderer, Vitest, better-sqlite3, React hooks.

---

## File Structure

- Modify `packages/db/src/repos/TMRepo.ts`: accept TM IDs as parameter, raise FTS threshold for LIKE skip, remove sliding window fragments.
- Modify `apps/desktop/src/main/services/ports.ts`: update `searchConcordance` signature.
- Modify `apps/desktop/src/main/services/TMService.ts`: pass TM IDs to `searchConcordance`.
- Modify `apps/desktop/src/main/services/adapters/SqliteTMRepository.ts`: update adapter.
- Modify `packages/db/src/index.ts`: update facade.
- Modify `apps/desktop/src/renderer/src/components/editor-row/useEditorRowDisplayModel.ts`: add `useMemo`.
- Modify `apps/desktop/src/renderer/src/components/TMPanel.tsx`: memoize `buildCombinedMatches`.
- Modify `apps/desktop/src/renderer/src/hooks/editor/useActiveSegmentMatches.ts`: add source-hash cache.
- Test: existing TMService, TMPanel, EditorRow, and db tests must continue to pass.

## Task 1: Deduplicate `getProjectMountedTMs` and Pass TM IDs to `searchConcordance`

**Files:**
- Modify: `packages/db/src/repos/TMRepo.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `apps/desktop/src/main/services/ports.ts`
- Modify: `apps/desktop/src/main/services/adapters/SqliteTMRepository.ts`
- Modify: `apps/desktop/src/main/services/TMService.ts`
- Test: `apps/desktop/src/main/services/TMService.test.ts`, `packages/db/src/index.test.ts`

- [ ] **Step 1: Add `tmIds` parameter to `TMRepo.searchConcordance`**

In `packages/db/src/repos/TMRepo.ts`, change the `searchConcordance` signature from:

```ts
public searchConcordance(projectId: number, query: string): TMEntryRow[]
```

to:

```ts
public searchConcordance(projectId: number, query: string, tmIds?: string[]): TMEntryRow[]
```

At the top of the method, replace:

```ts
const tmIds = this.getProjectMountedTMs(projectId).map((tm) => tm.id);
```

with:

```ts
const resolvedTmIds = tmIds ?? this.getProjectMountedTMs(projectId).map((tm) => tm.id);
```

Use `resolvedTmIds` throughout the method instead of `tmIds`.

- [ ] **Step 2: Update the facade and adapter**

In `packages/db/src/index.ts`, update:

```ts
public searchConcordance(projectId: number, query: string, tmIds?: string[]): TMEntryRow[] {
  return this.tmRepo.searchConcordance(projectId, query, tmIds);
}
```

In `apps/desktop/src/main/services/ports.ts`, update `TMRepository`:

```ts
searchConcordance(projectId: number, query: string, tmIds?: string[]): TMEntryWithTmId[];
```

In `apps/desktop/src/main/services/adapters/SqliteTMRepository.ts`, update:

```ts
searchConcordance(projectId: number, query: string, tmIds?: string[]): Array<TMEntry & { tmId: string }> {
  return this.db.searchConcordance(projectId, query, tmIds) as Array<TMEntry & { tmId: string }>;
}
```

- [ ] **Step 3: Pass TM IDs from `TMService.findMatches`**

In `apps/desktop/src/main/services/TMService.ts`, change line 133 from:

```ts
const candidates = this.tmRepo.searchConcordance(projectId, query);
```

to:

```ts
const tmIds = mountedTMs.map((tm) => tm.id);
const candidates = this.tmRepo.searchConcordance(projectId, query, tmIds);
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run apps/desktop/src/main/services/TMService.test.ts packages/db/src/index.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/repos/TMRepo.ts packages/db/src/index.ts apps/desktop/src/main/services/ports.ts apps/desktop/src/main/services/adapters/SqliteTMRepository.ts apps/desktop/src/main/services/TMService.ts
git commit -m "perf: pass tm ids to searchConcordance to eliminate redundant query"
```

## Task 2: Reduce LIKE Fallback Pressure

**Files:**
- Modify: `packages/db/src/repos/TMRepo.ts`
- Test: `packages/db/src/index.test.ts`

- [ ] **Step 1: Skip LIKE fallback when FTS returns enough results**

In `packages/db/src/repos/TMRepo.ts`, change the LIKE fallback gate from:

```ts
if (mergedRows.length < maxResults) {
```

to:

```ts
const LIKE_FALLBACK_THRESHOLD = 3;
if (mergedRows.length < LIKE_FALLBACK_THRESHOLD) {
```

This means: only run the expensive LIKE queries when FTS returned fewer than 3 results. Previously it ran whenever FTS returned fewer than 10 (always, in practice for CJK text).

- [ ] **Step 2: Remove sliding window fragments, keep anchor fragments only**

In `buildLikeFallbackFragments`, remove the `buildCjkWindowFragments` call and its merge. Change:

```ts
const cjkWindowFragments: string[] = [];
for (const term of terms) {
  primaryFragments.add(term);

  if (this.isCjkHeavyTerm(term) && term.length >= 3) {
    for (const fragment of this.buildCjkAnchorFragments(term)) {
      primaryFragments.add(fragment);
    }
    for (const fragment of this.buildCjkWindowFragments(term)) {
      cjkWindowFragments.push(fragment);
    }
  }
```

to:

```ts
for (const term of terms) {
  primaryFragments.add(term);

  if (this.isCjkHeavyTerm(term) && term.length >= 3) {
    for (const fragment of this.buildCjkAnchorFragments(term)) {
      primaryFragments.add(fragment);
    }
  }
```

And remove:

```ts
for (const fragment of cjkWindowFragments) {
  primaryFragments.add(fragment);
}
```

Also reduce the primary fragment cap from 12 to 8:

```ts
.slice(0, 8),
```

- [ ] **Step 3: Run db tests**

```bash
npx vitest run packages/db/src/index.test.ts
```

Expected: PASS. The CJK concordance search tests should still pass because anchor fragments (head + tail) cover the key substrings, and the long-term window sampling logic remains untouched.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/repos/TMRepo.ts
git commit -m "perf: reduce like fallback pressure in concordance search"
```

## Task 3: Memoize Renderer Computations

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/editor-row/useEditorRowDisplayModel.ts`
- Modify: `apps/desktop/src/renderer/src/components/TMPanel.tsx`
- Test: existing tests

- [ ] **Step 1: Add `useMemo` to `useEditorRowDisplayModel`**

In `apps/desktop/src/renderer/src/components/editor-row/useEditorRowDisplayModel.ts`, replace:

```ts
export function useEditorRowDisplayModel(
  params: UseEditorRowDisplayModelParams,
): EditorRowDisplayModel {
  return buildEditorRowDisplayModel(params);
}
```

with:

```ts
import { useMemo } from 'react';

export function useEditorRowDisplayModel(
  params: UseEditorRowDisplayModelParams,
): EditorRowDisplayModel {
  return useMemo(
    () => buildEditorRowDisplayModel(params),
    [
      params.segmentStatus,
      params.qaIssues,
      params.isActive,
      params.draftText,
      params.sourceEditorText,
      params.sourceTagsCount,
      params.sourceHighlightQuery,
      params.highlightMode,
      params.showNonPrintingSymbols,
    ],
  );
}
```

- [ ] **Step 2: Memoize `buildCombinedMatches` in `TMPanel`**

In `apps/desktop/src/renderer/src/components/TMPanel.tsx`, replace:

```ts
const combined = buildCombinedMatches(matches, termMatches, TM_RENDER_LIMIT);
```

with:

```ts
const combined = useMemo(
  () => buildCombinedMatches(matches, termMatches, TM_RENDER_LIMIT),
  [matches, termMatches],
);
```

Add `useMemo` to the React import.

- [ ] **Step 3: Run tests**

```bash
npx vitest run apps/desktop/src/renderer/src/components/editor-row/useEditorRowDisplayModel.test.ts apps/desktop/src/renderer/src/components/TMPanel.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/components/editor-row/useEditorRowDisplayModel.ts apps/desktop/src/renderer/src/components/TMPanel.tsx
git commit -m "perf: memoize editor row display model and tm panel combined matches"
```

## Task 4: Add Source-Hash Match Cache

**Files:**
- Modify: `apps/desktop/src/renderer/src/hooks/editor/useActiveSegmentMatches.ts`

- [ ] **Step 1: Add a cache map keyed by source hash**

In `useActiveSegmentMatches`, add a `useRef` cache for TM matches:

```ts
const matchCacheRef = useRef(new Map<string, TMMatch[]>());
```

In the TM match effect, before the `setTimeout`, check the cache:

```ts
const cached = matchCacheRef.current.get(segment.srcHash);
if (cached) {
  setActiveMatches(cached);
  return;
}
```

After successful fetch, store in cache:

```ts
matchCacheRef.current.set(segment.srcHash, matches || []);
setActiveMatches(matches || []);
```

Clear the cache when `projectId` changes by adding to the top of the effect:

```ts
// Reset is handled by the projectId dependency — stale entries from
// a previous project can't match the new project's segments.
```

Actually, keep it simple: clear the cache ref when projectId changes via a separate effect:

```ts
useEffect(() => {
  matchCacheRef.current.clear();
}, [projectId]);
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run apps/desktop/src/renderer/src/hooks/
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/hooks/editor/useActiveSegmentMatches.ts
git commit -m "perf: cache tm match results by source hash"
```

## Task 5: Verification

- [ ] **Step 1: Run targeted tests**

```bash
npx vitest run apps/desktop/src/main/services/TMService.test.ts packages/db/src/index.test.ts apps/desktop/src/renderer/src/components/editor-row/useEditorRowDisplayModel.test.ts apps/desktop/src/renderer/src/components/TMPanel.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck --workspace=apps/desktop
```

Expected: PASS.
