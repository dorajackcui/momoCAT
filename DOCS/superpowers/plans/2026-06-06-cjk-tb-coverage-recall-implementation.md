# CJK TB Coverage Recall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix CJK TB candidate recall misses in long source segments by preserving token boundaries and adding CJK coverage recall, while keeping English profile matching behavior unchanged.

**Architecture:** The fix stays in the text/TB recall path. `serializeTokensToSearchText` preserves tag boundaries as spaces, strict CJK search-plan generation recalls 2-8 character exact terms and distributes FTS fragments across the full CJK source, and `TBService` continues to final-filter candidates with `findTermPositionsInTextForLocale`.

**Tech Stack:** TypeScript, Vitest, npm workspaces, `better-sqlite3`, existing CAT core/db/localization packages.

---

## File Structure

- Modify `packages/core/src/text/tokenText.ts`
  - Owns token-to-text serialization helpers.
  - Update only `serializeTokensToSearchText` so non-text tokens become whitespace boundaries.

- Modify `packages/core/src/text/termMatching.ts`
  - Owns strict terminology normalization, search-plan construction, FTS fragments, and exact lookup terms.
  - Add CJK exact n-gram coverage for lengths 2-8.
  - Add a distributed CJK fragment picker for FTS coverage.
  - Do not modify `termMatchingProfiles.ts`.

- Modify `packages/core/src/text/index.test.ts`
  - Add/adjust token boundary tests.
  - Add/adjust CJK exact coverage tests.
  - Add CJK FTS positional coverage tests.
  - Keep existing English profile expectations.

- Modify `apps/desktop/src/main/services/TBMatchFlow.test.ts`
  - Add one zh-CN TB flow regression using the garden-style source segment and a focused `喵居商店` TB entry.
  - Keep existing English profile flow tests unchanged.

- Do not modify `packages/localization/src/services/TBService.ts`
  - Candidate recall must be fixed before `TBService`; no new normal-path full scan must be introduced.

- Do not modify `packages/core/src/text/termMatchingProfiles.ts`
  - English alias/plural/acronym logic must remain unchanged.

---

## Task 1: Preserve Search Text Boundaries and Reproduce the Garden TB Miss

**Files:**
- Modify: `packages/core/src/text/index.test.ts`
- Modify: `packages/core/src/text/tokenText.ts`
- Modify: `apps/desktop/src/main/services/TBMatchFlow.test.ts`

- [ ] **Step 1: Add failing token-boundary expectations**

In `packages/core/src/text/index.test.ts`, replace the existing test named `drops tags but preserves text spacing for TB matching` with:

```ts
  it('drops tags but keeps search boundaries around non-text tokens', () => {
    const inlineTaggedText = serializeTokensToSearchText([
      { type: 'text', content: 'API' },
      { type: 'tag', content: '<b>' },
      { type: 'text', content: 'key' },
      { type: 'tag', content: '</b>' },
    ]);

    expect(inlineTaggedText).toBe('API key');

    const cjkTaggedText = serializeTokensToSearchText([
      { type: 'text', content: '喵居商店购买获得' },
      { type: 'tag', content: '{1}', meta: { id: '{1}' } },
      { type: 'tag', content: '{1}', meta: { id: '{1}' } },
      { type: 'text', content: '5.当任意单个小鱼干' },
    ]);

    expect(cjkTaggedText).toBe('喵居商店购买获得 5.当任意单个小鱼干');
  });
```

- [ ] **Step 2: Add a failing garden TB flow regression**

In `apps/desktop/src/main/services/TBMatchFlow.test.ts`, add this test before `it('tb-flow-env-trace', ...)`:

```ts
  it('recalls CJK terms across tag boundaries in long source text', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Trace CJK Garden TB Match', 'zh-CN', 'fr-FR');
      const tbId = db.createTermBase('Garden CJK Terms', 'zh-CN', 'fr-FR');
      db.mountTermBaseToProject(projectId, tbId, 1);

      for (const entry of [
        ['tb-garden-shop', '喵居商店', 'Boutique Miaou Maison'],
        ['tb-swap-cat', '交换喵', 'Chat Échangeur'],
        ['tb-snack-cat', '偷吃喵', 'Chat Gourmand'],
        ['tb-dried-fish', '小鱼干', 'Petit Poisson Séché'],
      ] as const) {
        const [id, srcTerm, tgtTerm] = entry;
        db.insertTBEntryIfAbsentBySrcTerm({
          id,
          tbId,
          srcLang: 'zh-CN',
          srcTerm,
          tgtTerm,
        });
      }

      const segment: Segment = {
        segmentId: 'tb-garden-cjk-coverage',
        fileId: 1,
        orderIndex: 0,
        sourceTokens: [
          {
            type: 'text',
            content:
              '1.划动荧幕时，使木架上所有小鱼干向指定方向移动{1}{1}2.每次移动会随机出现新的一个数量为2或4的小鱼干{1}{1}3.相同数量的小鱼干移动相碰时会合成升级为更多数量的小鱼干{1}{1}4.小游戏中可以使用道具来帮助整理小鱼干：{1}（1）交换喵：选中任意两个上下或左右相邻的小鱼干后，可以使其相互交换位置{1}（2）偷吃喵：选中任意一个小鱼干，可以让橘喵将它偷走吃掉{1}（3）每局游戏中每种道具最多可使用3次{1}（4）小游戏道具可通过喵居商店购买获得',
          },
          { type: 'tag', content: '{1}', meta: { id: '{1}' } },
          { type: 'tag', content: '{1}', meta: { id: '{1}' } },
          {
            type: 'text',
            content:
              '5.当任意单个小鱼干达到指定数量时，会使本局喵币的奖励翻倍{1}{1}6.结算时根据木架内整理的所有小鱼干数量来获得对应的游戏分数，并通过游戏分数计算得到喵币{1}{1}7.单局分数低于10分无法获得喵币奖励',
          },
        ],
        targetTokens: [],
        status: 'new',
        tagsSignature: '{1}',
        matchKey: 'tb-garden-cjk-coverage',
        srcHash: 'tb-garden-cjk-coverage',
        meta: { updatedAt: new Date().toISOString() },
      };

      const trace = await traceTBMatchFlow({
        db,
        projectId,
        segment,
        focusSrcTerms: ['喵居商店'],
      });

      expect(trace.step3RepoCandidateRecall.focusCandidates.map((entry) => entry.srcTerm)).toEqual([
        '喵居商店',
      ]);
      expect(trace.step4FallbackScan.wouldUseFullMountedScan).toBe(false);
      expect(trace.step6FinalMatches.focusMatches.map((match) => match.tgtTerm)).toEqual([
        'Boutique Miaou Maison',
      ]);
    } finally {
      db.close();
    }
  });
```

- [ ] **Step 3: Run the focused tests and verify they fail**

Run:

```bash
npx vitest run packages/core/src/text/index.test.ts -t "drops tags but keeps search boundaries around non-text tokens"
```

Expected: FAIL because `serializeTokensToSearchText` currently returns `APIkey` or concatenates CJK text across tags.

Run:

```bash
npm run rebuild:test && npx vitest run apps/desktop/src/main/services/TBMatchFlow.test.ts -t "recalls CJK terms across tag boundaries in long source text"
```

Expected: FAIL because `喵居商店` is present in the mounted TB but is absent from `step3RepoCandidateRecall.focusCandidates` and `step6FinalMatches.focusMatches`.

- [ ] **Step 4: Implement boundary-preserving search serialization**

In `packages/core/src/text/tokenText.ts`, replace `serializeTokensToSearchText` with:

```ts
export function serializeTokensToSearchText(tokens: Token[]): string {
  return tokens
    .map((token) => (token.type === 'text' ? token.content : ' '))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}
```

- [ ] **Step 5: Run focused tests and verify they pass**

Run:

```bash
npx vitest run packages/core/src/text/index.test.ts -t "drops tags but keeps search boundaries around non-text tokens"
```

Expected: PASS.

Run:

```bash
npm run rebuild:test && npx vitest run apps/desktop/src/main/services/TBMatchFlow.test.ts -t "recalls CJK terms across tag boundaries in long source text"
```

Expected: PASS; `喵居商店` appears in candidate recall and final matches without triggering full mounted scan.

- [ ] **Step 6: Commit Task 1**

```bash
git add packages/core/src/text/index.test.ts packages/core/src/text/tokenText.ts apps/desktop/src/main/services/TBMatchFlow.test.ts
git commit -m "fix: preserve term search token boundaries"
```

---

## Task 2: Add CJK Exact Lookup Coverage for 2-8 Character Terms

**Files:**
- Modify: `packages/core/src/text/index.test.ts`
- Modify: `packages/core/src/text/termMatching.ts`

- [ ] **Step 1: Update exact lookup tests to require 2-8 CJK coverage and reject single-character CJK coverage**

In `packages/core/src/text/index.test.ts`, update the test named `builds a unified search plan with exact lookup terms for FTS blind spots` so its exact expectation is:

```ts
    expect(plan.exactLookupTerms).toEqual(
      expect.arrayContaining(['示例项', '通用标题', '示例', '标题']),
    );
    expect(plan.exactLookupTerms).not.toEqual(expect.arrayContaining(['示', '题']));
```

In the test named `adds short non-cjk and mixed-script exact lookup terms without falling back to substrings`, update the expectations to:

```ts
    expect(plan.exactLookupTerms).toEqual(expect.arrayContaining(['ai', '3d', 'a股']));
    expect(plan.exactLookupTerms).not.toEqual(expect.arrayContaining(['a', '股', '奖']));
```

Then add this new test after `builds a unified search plan with exact lookup terms for FTS blind spots`:

```ts
  it('builds 2-8 character CJK exact lookup coverage for long source terminology', () => {
    const plan = buildTermSearchPlan(
      '小游戏道具可通过喵居商店购买获得，当任意单个小鱼干达到指定数量时，活动限定商店入口开放。',
      {
        locale: 'zh-CN',
        maxFragments: 12,
      },
    );

    expect(plan.exactLookupTerms).toEqual(
      expect.arrayContaining([
        '小鱼干',
        '喵居商店',
        '小游戏道具可',
        '活动限定商店入口',
      ]),
    );
    expect(plan.exactLookupTerms).not.toEqual(expect.arrayContaining(['喵', '店', '奖']));
  });
```

- [ ] **Step 2: Run exact lookup tests and verify they fail**

Run:

```bash
npx vitest run packages/core/src/text/index.test.ts -t "exact lookup"
```

Expected: FAIL because current CJK exact lookup covers only `[4, 3, 2, 1]`, includes one-character CJK terms, and does not include 6-8 character CJK terms.

- [ ] **Step 3: Implement 2-8 CJK exact lookup coverage**

In `packages/core/src/text/termMatching.ts`, replace:

```ts
const CJK_EXACT_TERM_SIZES = [4, 3, 2, 1];
```

with:

```ts
const CJK_EXACT_TERM_MIN_SIZE = 2;
const CJK_EXACT_TERM_MAX_SIZE = 8;
```

Add this helper near `buildNgramFragments`:

```ts
function buildCjkExactLookupTerms(tokens: string[]): string[] {
  const groups: string[][] = [];

  for (let size = CJK_EXACT_TERM_MAX_SIZE; size >= CJK_EXACT_TERM_MIN_SIZE; size -= 1) {
    groups.push(flattenRoundRobin(tokens.map((token) => buildNgramFragments(token, size))));
  }

  return flattenRoundRobin(groups.map((group) => group.slice()));
}
```

Then replace `buildExactLookupTerms` with:

```ts
function buildExactLookupTerms(tokens: string[]): string[] {
  const shortExactTokens = tokens.filter((token) => !isPureCjkToken(token) && token.length <= 3);
  const cjkTokens = tokens.filter((token) => isPureCjkToken(token));
  if (cjkTokens.length === 0 && shortExactTokens.length === 0) return [];

  const groups = [buildCjkExactLookupTerms(cjkTokens), shortExactTokens];

  return flattenRoundRobin(groups.map((group) => group.slice()));
}
```

- [ ] **Step 4: Run exact lookup tests and verify they pass**

Run:

```bash
npx vitest run packages/core/src/text/index.test.ts -t "exact lookup"
```

Expected: PASS.

- [ ] **Step 5: Run the garden TB flow again**

Run:

```bash
npm run rebuild:test && npx vitest run apps/desktop/src/main/services/TBMatchFlow.test.ts -t "recalls CJK terms across tag boundaries in long source text"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add packages/core/src/text/index.test.ts packages/core/src/text/termMatching.ts
git commit -m "fix: expand cjk exact term recall"
```

---

## Task 3: Distribute CJK FTS Fragments Across the Full Source

**Files:**
- Modify: `packages/core/src/text/index.test.ts`
- Modify: `packages/core/src/text/termMatching.ts`

- [ ] **Step 1: Add a failing FTS positional coverage test**

In `packages/core/src/text/index.test.ts`, add this test after `returns mixed 2/3/4-character CJK fragments for long Chinese source text`:

```ts
  it('distributes CJK FTS fragments across later source regions under a small budget', () => {
    const fragments = buildTermSearchFragments(
      '前段说明文字用于消耗片段预算，中段继续提供更多普通描述内容，后段仍然需要覆盖结尾片段',
      {
        locale: 'zh-CN',
        maxFragments: 12,
      },
    );

    expect(fragments.length).toBeLessThanOrEqual(12);
    expect(fragments).toEqual(expect.arrayContaining(['前段说', '结尾片']));
  });
```

- [ ] **Step 2: Run the FTS coverage test and verify it fails**

Run:

```bash
npx vitest run packages/core/src/text/index.test.ts -t "distributes CJK FTS fragments"
```

Expected: FAIL because current CJK FTS selection consumes the earliest available fragments and does not guarantee later source coverage under a small budget.

- [ ] **Step 3: Add distributed fragment selection helpers**

In `packages/core/src/text/termMatching.ts`, add these helpers after `takeFragments`:

```ts
function findNearestUnusedFragmentIndex(
  source: string[],
  preferredIndex: number,
  seen: Set<string>,
  usedIndices: Set<number>,
): number | null {
  for (let distance = 0; distance < source.length; distance += 1) {
    const left = preferredIndex - distance;
    if (left >= 0 && !usedIndices.has(left) && !seen.has(source[left])) return left;

    const right = preferredIndex + distance;
    if (right < source.length && !usedIndices.has(right) && !seen.has(source[right])) {
      return right;
    }
  }

  return null;
}

function takeDistributedFragments(
  target: string[],
  source: string[],
  count: number,
  seen: Set<string>,
): number {
  if (count <= 0 || source.length === 0) return 0;
  if (count >= source.length) return takeFragments(target, source, count, seen);

  const usedIndices = new Set<number>();
  let taken = 0;

  for (let slot = 0; slot < count; slot += 1) {
    const preferredIndex =
      count === 1 ? 0 : Math.round(((source.length - 1) * slot) / (count - 1));
    const index = findNearestUnusedFragmentIndex(source, preferredIndex, seen, usedIndices);
    if (index === null) continue;

    usedIndices.add(index);
    seen.add(source[index]);
    target.push(source[index]);
    taken += 1;
  }

  if (taken < count) {
    taken += takeFragments(target, source, count - taken, seen);
  }

  return taken;
}
```

- [ ] **Step 4: Use distributed selection for CJK FTS budgets**

In `buildFtsSearchFragments`, replace the CJK budget block:

```ts
    takeFragments(selected, cjkLength3, length3Budget, seen);
    takeFragments(selected, cjkLength4, length4Budget, seen);
    takeFragments(selected, cjkLong, longBudget, seen);
    takeFragments(selected, cjkLength2, length2Budget, seen);
```

with:

```ts
    takeDistributedFragments(selected, cjkLength3, length3Budget, seen);
    takeDistributedFragments(selected, cjkLength4, length4Budget, seen);
    takeDistributedFragments(selected, cjkLong, longBudget, seen);
    takeDistributedFragments(selected, cjkLength2, length2Budget, seen);
```

Then replace the `fillOrder` loop:

```ts
  for (const candidates of fillOrder) {
    if (selected.length >= maxFragments) break;
    takeFragments(selected, candidates, maxFragments - selected.length, seen);
  }
```

with:

```ts
  for (const candidates of fillOrder) {
    if (selected.length >= maxFragments) break;
    const remaining = maxFragments - selected.length;
    if (candidates === cjkLength3 || candidates === cjkLength4 || candidates === cjkLong || candidates === cjkLength2) {
      takeDistributedFragments(selected, candidates, remaining, seen);
    } else {
      takeFragments(selected, candidates, remaining, seen);
    }
  }
```

If the line length violates local formatting, run Prettier or manually split the condition across lines.

- [ ] **Step 5: Run FTS and existing CJK fragment tests**

Run:

```bash
npx vitest run packages/core/src/text/index.test.ts -t "CJK fragments|distributes CJK FTS fragments|builds bounded search fragments"
```

Expected: PASS. Existing multilingual and CJK fragment expectations still pass, and the new later-region coverage test passes.

- [ ] **Step 6: Run English search-plan alias tests**

Run:

```bash
npx vitest run packages/core/src/text/index.test.ts -t "adds English search-plan aliases without changing CJK plans"
```

Expected: PASS. This confirms English alias merge still wraps the strict plan without changing en-profile semantics.

- [ ] **Step 7: Commit Task 3**

```bash
git add packages/core/src/text/index.test.ts packages/core/src/text/termMatching.ts
git commit -m "fix: distribute cjk fts recall fragments"
```

---

## Task 4: Full Regression and Real Local Trace Verification

**Files:**
- No production code changes.
- May modify tests only if a regression exposes a real expectation mismatch from Tasks 1-3.

- [ ] **Step 1: Run the full core text test file**

Run:

```bash
npx vitest run packages/core/src/text/index.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the full TB match flow test file**

Run:

```bash
npm run rebuild:test && npx vitest run apps/desktop/src/main/services/TBMatchFlow.test.ts
```

Expected: PASS, including:

- `recalls CJK terms across tag boundaries in long source text`,
- `recalls English profile alias candidates before final matching`,
- `recalls English multi-word final-word plurals through repo candidates`,
- `keeps exact alias candidates ahead of noisy FTS recall before final matching`,
- `does not use English alias recall for non-English project source locale`.

- [ ] **Step 3: Run the installed local DB trace for the original garden segment**

Run:

```bash
npm run trace:tb-flow -- --db "$HOME/Library/Application Support/simple-cat-tool/cat_v1.db" --project-id 3 --segment-id 5e592ca2-9383-4956-8751-80d8514276e5 --focus-src-term "喵居商店"
```

Expected: PASS test command and trace output where:

- `step3RepoCandidateRecall.focusCandidates` contains `喵居商店`,
- `step4FallbackScan.wouldUseFullMountedScan` is `false`,
- `step6FinalMatches.focusMatches` contains `喵居商店`.

- [ ] **Step 4: Run a broader relevant test sweep**

Run:

```bash
npm run rebuild:test && npx vitest run packages/core/src/text/index.test.ts apps/desktop/src/main/services/TBMatchFlow.test.ts packages/db/src/index.test.ts
```

Expected: PASS.

- [ ] **Step 5: Restore Electron native build if needed**

If the next workflow is Electron dev/build/pack, run:

```bash
npm run rebuild:electron
```

Expected: `better-sqlite3` is rebuilt for Electron 28.3.3. This is not required for Node/Vitest verification, but it avoids leaving the workspace in a test-only native build state before desktop app work.

- [ ] **Step 6: Check git status**

Run:

```bash
git status --short
```

Expected: only intentional source/test files are changed, or the working tree is clean if all task commits have been made.

- [ ] **Step 7: Final commit if Task 4 required changes**

If Task 4 required any test expectation correction or small verification-related fix, commit it:

```bash
git add packages/core/src/text/index.test.ts apps/desktop/src/main/services/TBMatchFlow.test.ts packages/core/src/text/termMatching.ts packages/core/src/text/tokenText.ts
git commit -m "test: verify cjk tb recall regression coverage"
```

If Task 4 made no changes, skip this commit.

---

## Implementation Notes

- Keep `TBService.findMatches` unchanged. The service must continue to final-filter candidates and must not add a non-empty-candidate full scan fallback.
- Keep `termMatchingProfiles.ts` unchanged. The English profile is protected by existing tests and must not be refactored in this change.
- The distributed FTS picker is only for CJK fragment arrays. General and English fragments must keep their current selection behavior.
- The CJK exact coverage intentionally excludes one-character CJK terms. If an existing test expects a one-character CJK exact term, update that test to match the new design.
- The garden TB flow regression must pass because `喵居商店` is recalled through exact source norm after tag boundaries become spaces.

## Self-Review Checklist

- [x] The plan implements the approved design spec at `DOCS/superpowers/specs/2026-06-06-cjk-tb-coverage-recall-design.md`.
- [x] Every production change has a failing test before implementation.
- [x] The plan does not alter AI retry behavior.
- [x] The plan does not introduce normal-path full mounted TB scans.
- [x] The plan does not modify English profile code.
- [x] The plan verifies the original installed local DB trace.
