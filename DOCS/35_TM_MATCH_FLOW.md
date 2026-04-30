# 35_TM_MATCH_FLOW

Translation Memory 匹配的完整流程。

## Last Updated

2026-04-29

## Owner

Core maintainers of `simple-cat-tool`

## 入口

`TMService.findMatches(projectId, segment)` — [TMService.ts](../apps/desktop/src/main/services/TMService.ts)

每次编辑器激活一个 Segment 时调用，返回最多 10 条匹配结果（`TMMatch[]`），包含 TM 模糊匹配和 Concordance 局部匹配。

## 完整流程

### Step 0 — 获取挂载的 TM

```
tmRepo.getProjectMountedTMs(projectId)
→ [{ id, name, type('working'|'main'), permission, priority }]
```

按 priority 排序。若无挂载 TM，直接返回空数组。

### Step 1 — 提取纯文本

```typescript
const sourceTextOnly = serializeTokensToTextOnly(segment.sourceTokens);
const sourceNormalized = normalizeForSimilarity(sourceTextOnly);
```

- `serializeTokensToTextOnly`: 过滤掉 `type === 'tag'` 的 token，只保留 `type === 'text'`，合并后 trim。
- `normalizeForSimilarity`: `toLowerCase()` + 压缩空白。

示例：

| 原始 sourceTokens | serializeTokensToTextOnly |
|---|---|
| `{1>微风绿野河畔<2}的{1>追逐奇想星挑战<2}总是失败……` | `微风绿野河畔的追逐奇想星挑战总是失败……` |
| `风荷立柱设计图` | `风荷立柱设计图` |

### Step 2 — 100% Hash 精确匹配

```typescript
for (const tm of mountedTMs) {
  const match = tmRepo.findTMEntryByHash(tm.id, segment.srcHash);
  // 命中 → similarity=100, kind='tm'
}
```

`srcHash = matchKey + ':::' + tagsSignature`，匹配文本内容和 tag 结构都完全一致的条目。

命中后记入 `seenHashes`，后续模糊搜索跳过相同 hash。

### Step 3 — 召回候选 TM 条目

`TMService.findMatches()` 调用：

```typescript
tmRepo.searchTMRecallCandidates(projectId, sourceTextOnly, tmIds, {
  scope: 'source',
  limit: 50,
});
```

这一层负责召回候选，不决定 `kind: 'tm'` 或 `kind: 'concordance'`。为了避免进入评分前的 50 条候选已经被同一种子串占满，repo 会先 overfetch 一个最多 3x 的候选池，再做 diversity cap 后返回 `limit` 条。

### Step 4 — CJK-aware recall plan

`TMRepo.searchTMRecallCandidates()` 将 source 构造成分层查询计划：

| Tier | 内容 | 用途 |
|---|---|---|
| exact terms | 清洗后的完整 term | 保留当前精确 phrase 行为 |
| primary CJK fragments | 最多 16 个 4-6 字 CJK 片段 | 召回 `风荷立柱设计图` -> `风荷立柱` 这类短条目 |
| secondary CJK fragments | 最多 12 个 3 字片段 | primary 不足时补召回 |
| short CJK fallback | 最多 4 个 2 字 term，最多 10 行 LIKE fallback | 兜底短词，不作为主路径 |

每个 tier 返回的 row 还会经过 evidence gate：

- 共享 >=4 字连续 CJK 片段，接受。
- 共享至少两个不同 3 字 CJK 片段，接受。
- 只有 2 字命中时，要求 source 或 candidate 存在短 CJK component。
- active segment 匹配只使用 source-side evidence，不接受 target-only 命中。

完成分层召回后，`searchTMRecallCandidates()` 会按 query 与候选 source（或 concordance 场景的 source/target）的最长公共 CJK 片段分桶，每个 bucket 最多保留 2 条。若短 bucket 被同一候选池中的更长 bucket 完全包含，例如 `能力套装` 被 `能力套装限时上架中` 包含，则归并到更长 bucket 计数。

### Step 5 — 相似度评分

对每个候选条目，提取纯文本并 normalize，与 source 比较：

#### 分支 A：文本完全相同（仅 tag 不同）

```
sourceNormalized === candNormalized → standardSimilarity = 99
```

#### 分支 B：文本不同

**5b-1. Local Overlap（最长公共子串）**

```typescript
computeLocalOverlapSimilarity(sourceNormalized, candNormalized)
```

- `findLongestCommonSubstring(a, b)` — 动态规划求最长公共子串
- `score = shorterCoverage × 70 + longerCoverage × 30`
- `hasSharedCjkComponent(a, b)` — 检查是否共享 ≥2 字的 CJK 组件（按非 CJK 字符切分）
  - 有共享组件 → score 下限提升到 50
  - 无共享组件且 longerCoverage < 0.45 → score 上限压到 49

**5b-2. 长度比率快速过滤**

```typescript
computeMaxLengthBound(a, b) = (1 - |lenA - lenB| / max(lenA, lenB)) × 100
```

若 < 50 → 跳过 Levenshtein 计算（长度差异过大不可能达标）。

**5b-3. 标准相似度计算**（仅 maxLengthBound ≥ 50 时）

```
levSimilarity  = (1 - levenshteinDist / maxLen) × 100
diceSimilarity = 2 × bigramOverlap / (bigramCountA + bigramCountB) × 100
bonus          = 包含关系(+4) + 前缀匹配(+2)

standardSimilarity = min(99, round(lev × 0.75 + dice × 0.25 + bonus))
```

### Step 6 — 分类结果

先检查“局部片段是否明显强于整句 fuzzy”。这用于处理 `风荷立柱设计图` → `风荷立柱` 这类完整短片段命中：

```typescript
standardSimilarity >= 50
localOverlap.score >= 80
localOverlap.score - standardSimilarity >= 15
localOverlap.entryCoverage >= 90
localOverlap.sourceCoverage < 75
→ kind: 'concordance'
```

| 条件 | 类型 | 字段 |
|---|---|---|
| 上述 local-overlap 规则命中 | `kind: 'concordance'` | `matchedSourceText`, `sourceCoverage`, `entryCoverage`, `rank = localOverlap.score` |
| `standardSimilarity >= 50` | `kind: 'tm'` | `similarity`, `rank = similarity` |
| `localOverlap.score >= 50` | `kind: 'concordance'` | `matchedSourceText`, `sourceCoverage`, `entryCoverage`, `rank = score` |
| 两者都 < 50 | 丢弃 | — |

一般 fuzzy 仍优先归类为 TM；但当完整短片段覆盖候选大部分、只覆盖 active source 一部分，并且 local overlap 分数显著高于 standard similarity 时，归类为 Concordance。

### Step 7 — 排序、多样性 & 截断

```typescript
results
  .sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;   // rank 降序
    return b.usageCount - a.usageCount;               // 同 rank 按使用次数
  })
  .diversifyByOverlapBucket({ maxPerBucket: 2 })
  .slice(0, 10);  // 最多 10 条
```

`diversifyByOverlapBucket` 使用最长公共 CJK 片段作为 bucket key。只有纯 CJK 且长度 >=4 的片段参与限制；每个 bucket 最多保留 2 条。短 bucket 被更长 bucket 完全包含时，会归并到更长 bucket。这样 `立柱设计图` 这类共享后缀不会占满整个结果列表，`风荷立柱` 这类另一组强片段仍能进入可见结果。

## Concordance Search 多样性

`TMRepo.searchConcordance(projectId, query, tmIds)` 复用 `searchTMRecallCandidates(scope: 'source-and-target', limit: 50)`，因此进入 concordance 排序前的 recall 候选已经经过 repo-level diversity cap。随后 `searchConcordance()` 再按 query 与候选 source/target 的最长公共 CJK 片段做一次最终 bucket cap，返回最多 10 条。

因此 active segment flow 与显式 concordance search 都会在 repo recall 层先避免候选池被单一子串占满；active segment flow 还会在 `TMService.findMatches()` 评分、排序后对最终 10 条结果再做一次 diversity cap。

## FTS 索引写入路径

`tm_fts` 虚拟表 schema：

```sql
CREATE VIRTUAL TABLE tm_fts USING fts5(
  tmId UNINDEXED,
  srcText,
  tgtText,
  tmEntryId UNINDEXED,
  tokenize='trigram'
);
```

| 场景 | 调用位置 | 方法 |
|---|---|---|
| 确认 Segment | `TMService.upsertFromConfirmedSegment` | `replaceTMFts` |
| 导入 TM | `TMImportService` / `tmImportWorker` | `insertTMFts` / `replaceTMFts` |
| 批量提交到主 TM | `TMBatchOpsService.commitToMainTM` | `replaceTMFts` |

当前写入路径使用 display text 或导入原始文本写入 FTS。`findMatches()` 的评分仍使用 `serializeTokensToTextOnly()`；candidate recall 通过 evidence gate 抵消 tag/display text 对召回的影响。后续若统一 FTS 写入为 text-only，应同步更新导入、确认 Segment、批量提交主 TM 三条路径。

## Trigram Tokenizer 行为

- 将文本拆分为每 3 个连续字符（Unicode code point）的重叠窗口
- `"风荷立柱"` 的 trigram 索引：`风荷立`, `荷立柱`
- FTS MATCH 引号查询 `"风荷立柱"` = 要求所有连续 trigram 按序存在 = **精确子串匹配**
- 最小查询长度 3 字符；2 字符词走 LIKE 回退

## 关键文件索引

| 文件 | 职责 |
|---|---|
| `apps/desktop/src/main/services/TMService.ts` | findMatches 主流程、相似度算法 |
| `packages/db/src/repos/TMRepo.ts` | searchTMRecallCandidates、FTS 查询构建 |
| `packages/core/src/text/tokenText.ts` | serializeTokensToTextOnly / DisplayText |
| `packages/db/src/currentSchema.ts` | tm_fts 表定义 |
