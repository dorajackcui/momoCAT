# 45_TM_CONCORDANCE_TODO

## Purpose

Record what was finished in the previous TM concordance recall round, plus the open TODO/question to continue from next time.

## Last Updated

2026-04-30

## Previous Round Summary

Latest commit:

```text
6c8f165 feat: add exact source limit and enhance TM concordance recall
```

Completed items:

1. Added an exact-source tier for active TM concordance recall in `packages/db/src/repos/TMRepo.ts`.
2. The new tier runs before broad FTS/LIKE recall and queries exact TM source text with `tm_fts.srcText IN (...)`.
3. Added `TM_CONCORDANCE_RECALL_EXACT_SOURCE_LIMIT = 64` to protect short exact CJK TM entries in crowded recall scenarios.
4. Updated `DOCS/35_TM_MATCH_FLOW.md` to document the exact-source limit, query plan, and tier order.
5. Added regression coverage in `apps/desktop/src/main/services/TMMatchFlow.test.ts` and `packages/db/src/index.test.ts`.
6. Added `npm run test:tm-flow` in `package.json` for focused active TM flow verification.

## TODO: Concordance Research Coverage

Question:

TM match 里面的 concordance research，希望覆盖三类场景。

### 1. Source 是 TM 的完整子片段

Example:

```text
source: 滑翔吧！飞花
expected recall tm: 完成主线任务【滑翔吧！飞花】后可触发
```

Goal:

When the current source is a complete fragment inside a longer TM source, concordance recall should find the longer TM source.

### 2. TM 是 Source 的完整子片段

Example:

```text
source: 阿茉玻曾见证清新天王将因绝望病逝世的心愿精灵送回星空。
expected recall tm: 阿茉玻
expected recall tm: 清新天王
```

Goal:

When a TM source is a complete fragment inside the current source, concordance recall should find the shorter exact TM source entries.

Note:

The previous round's exact-source tier was mainly added to protect this category for active TM concordance recall. It still needs explicit verification for the intended Concordance Research/Search path.

### 3. TM 和 Source 结构相似

Examples:

```text
source: 晴日裱花·困梦
expected recall tm: 萦叶绕絮·困梦

source: 织云木种子
expected recall tm: 薄紫织云木
```

Goal:

When TM and source share a similar structure or meaningful partial overlap, concordance recall should still return useful related TM entries.

## Suggested Next Steps

1. Confirm whether this TODO targets the active TM match flow, the explicit Concordance Search panel, or both.
2. Add focused fixtures/tests for all three categories above.
3. Verify the explicit Concordance Search path, because it currently uses `TMRepo.searchConcordance()` through the compatibility wrapper rather than the active flow's `searchTMConcordanceRecallCandidates()`.
4. Tune ranking/gating only after the three categories have failing/passing tests that describe the desired behavior.
