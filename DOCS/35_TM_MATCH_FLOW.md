# 35_TM_MATCH_FLOW

Translation Memory 匹配的完整流程。

## Last Updated

2026-04-30

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

### Step 1 — 提取带 tag 边界的纯文本

```typescript
const sourceTextOnly = serializeTokensToTextOnly(segment.sourceTokens);
const sourceNormalized = normalizeForSimilarity(sourceTextOnly);
```

- `serializeTokensToTextOnly`: 保留 `type === 'text'` 的内容，把每个 `type === 'tag'` 当作一个空格边界，再合并并压缩空白。tag 不进入相似度文本，但不会让 tag 两侧文本无缝拼接。
- `normalizeForSimilarity`: `toLowerCase()` + 压缩空白。

示例：

| 原始 sourceTokens | serializeTokensToTextOnly |
|---|---|
| `{1>微风绿野河畔<2}的{1>追逐奇想星挑战<2}总是失败……` | `微风绿野河畔 的 追逐奇想星挑战 总是失败……` |
| `风荷立柱设计图` | `风荷立柱设计图` |

这一步的输出会同时作为 `searchTMRecallCandidates()` 的 query。tag 是天然分隔符；如果直接删除 tag 并把两侧文本拼接，就会制造跨 tag 的假片段，随后 CJK window / trigram recall 可能召回原文中并不存在的连续子串。

### Step 2 — 100% Hash 精确匹配

```typescript
for (const tm of mountedTMs) {
  const match = tmRepo.findTMEntryByHash(tm.id, segment.srcHash);
  // 命中 → similarity=100, kind='tm'
}
```

`srcHash = matchKey + ':::' + tagsSignature`，匹配文本内容和 tag 结构都完全一致的条目。

命中后记入 `seenHashes`，后续模糊搜索跳过相同 hash。

### Step 3 — 上游召回：`searchTMRecallCandidates()`

`TMService.findMatches()` 调用：

```typescript
tmRepo.searchTMRecallCandidates(projectId, sourceTextOnly, tmIds, {
  scope: 'source',
  limit: 50,
});
```

这一层是整个 TM match flow 的上游，只负责把“可能有关”的 TM 条目召回给 `TMService`；它不计算最终相似度，也不决定结果是 `kind: 'tm'` 还是 `kind: 'concordance'`。

#### 3.1 输入归一化与候选池大小

`searchTMRecallCandidates(projectId, sourceText, tmIds, options)` 内部先确定几个边界：

| 变量 | 行为 |
|---|---|
| `maxResults` | `options.limit` 默认 50，最大也限制为 50；若为 0 直接返回空数组 |
| `resolvedTmIds` | 优先使用传入的 `tmIds`；否则读取当前 project 挂载的 TM |
| `scope` | 默认 `'source'`；active segment flow 使用 source-only，显式 concordance search 使用 `'source-and-target'` |
| `collectionLimit` | `min(maxResults * 3, 150)`；先收集更大的候选池，再做 diversity cap 后返回 `maxResults` |

因此 active segment flow 不是“FTS 直接拿 50 条就结束”，而是先尽量收集最多 150 条 raw recall candidate，再把重复片段压掉。

#### 3.2 构造 CJK-aware recall plan

`buildTMRecallQueryPlan(sourceText)` 会先调用 `extractSearchTerms()` 清洗 query：

- 去掉 FTS 控制字符和布尔关键字：`"`, `(`, `)`, `AND`, `OR`, `NOT`。
- 把标点转为空格，保留 `\w`、空白、CJK。
- 把 CJK 与数字之间切开，避免 `立柱2` 这类内容黏在一起。
- 只保留长度 >=2 且不是纯数字的 term。

然后对 CJK component 生成滑动窗口：

| Tier | 内容 | 用途 |
|---|---|---|
| `exactTerms` | 清洗后的完整 term，长度 >=3 | 保留完整 phrase / 普通词召回 |
| `latinTerms` | 长度 >=3 且不是纯 CJK 的 term | 召回英文、数字混合、非 CJK 词 |
| `primaryCjkFragments` | CJK component 的 4/5/6 字窗口，最多 16 个 | 主召回路径，支持 `风荷立柱设计图` -> `风荷立柱` |
| `secondaryCjkFragments` | CJK component 的 3 字窗口，最多 12 个 | primary 不足时补召回 |
| `shortCjkTerms` | CJK component 的 2 字窗口，最多 4 个，过滤弱词 | 最后兜底，走 LIKE，不作为主路径 |

窗口过多时使用 `selectSpreadFragments()` 从头到尾均匀抽样，而不是只取前几个；这样长句子中后部的片段仍有机会进入召回 query。

#### 3.3 分层收集候选

召回按固定顺序执行，并共享同一个 `accepted` 与 `seenIds`：

```typescript
collectFtsRecallTier(exactTerms + latinTerms)
collectFtsRecallTier(primaryCjkFragments)       // accepted < collectionLimit
collectFtsRecallTier(secondaryCjkFragments)     // accepted < min(collectionLimit, 8)
collectLikeRecallTier(shortCjkTerms)            // accepted < min(collectionLimit, 6)
```

这意味着：

- 完整 term、Latin term 和 4-6 字 CJK 片段是主路径。
- 3 字 secondary 只有在前面召回不足时才补上。
- 2 字 short fallback 更保守，只有前面召回很少时才触发。
- `seenIds` 会去重同一个 TM entry，避免不同 tier 重复加入同一行。

#### 3.4 FTS tier 如何查

`collectFtsRecallTier()` 会把每个 term 包成 FTS phrase，并用 `OR` 连接：

```sql
"风荷立柱" OR "立柱设计图"
```

`scope` 决定 FTS MATCH 范围：

| scope | FTS query |
|---|---|
| `'source'` | `srcText : ("term1" OR "term2")` |
| `'source-and-target'` | `"term1" OR "term2"`，即 source/target 都可命中 |

SQL 查询从 `tm_fts` join `tm_entries`，限制在指定 `tmIds` 内，按 FTS `rank` 排序，raw SQL limit 是 `max(collectionLimit * 3, 20)`。这一步拿到的是 raw rows，还不是最终候选；每一行还必须通过 evidence gate。

#### 3.5 LIKE fallback 如何查

FTS trigram 不适合 2 字查询，所以 short fallback 使用 `LIKE`：

```sql
tm_fts.srcText LIKE '%立柱%' ESCAPE '/'
```

当 `scope === 'source-and-target'` 时，source 和 target 都会查；active segment recall 只查 source。LIKE fallback 只使用最多 4 个 2 字 term，排除 `前往`、`可选` 这类弱词，最多补 `TM_RECALL_SHORT_ROW_LIMIT` 条 accepted rows；SQL 层会按剩余额度的 3x 做 raw overfetch。

#### 3.6 Evidence gate

FTS/LIKE 命中只是“可能相关”。每个 raw row 还要经过 `hasRecallEvidence()`：

| 条件 | 结果 |
|---|---|
| candidate 包含任意 primary CJK fragment（4-6 字） | 接受 |
| candidate 包含至少两个 secondary CJK fragment（3 字） | 接受 |
| candidate 包含任意 latin term（长度 >=3） | 接受 |
| short fallback 已启用，且命中至少两个 2 字 short term | 接受 |
| short fallback 已启用，且单个 2 字 term 出现在 source 或 candidate 的短 CJK component 中 | 接受 |
| 其他情况 | 丢弃 |

active segment flow 的 `scope: 'source'` 只检查候选 source text，不接受 target-only 命中；显式 concordance search 的 `scope: 'source-and-target'` 会在 source 与 target 中任选一个满足 evidence 即接受。

#### 3.7 Repo-level diversity cap

分层收集完成后，`diversifyRecallRows()` 会先对候选池做一次多样性限制，再返回给上层评分：

1. 对每个 candidate 计算 query 与候选文本的最长公共子串。
2. 只有“纯 CJK 且长度 >=4”的公共子串会成为 diversity bucket。
3. `scope: 'source'` 只用候选 source 计算 bucket；`source-and-target` 会从 source/target 中选择最长 bucket。
4. 如果短 bucket 被同一候选池中的更长 bucket 完全包含，例如 `能力套装` 被 `能力套装限时上架中` 包含，则短 bucket 归并到更长 bucket。
5. 每个 bucket 最多保留 2 条；没有强 CJK bucket 的候选不参与 cap。
6. 接受到 `maxResults` 条后停止，并把 DB row 转回 `TMEntryRow`。

这个 cap 是为了防止 `立柱设计图` 这类共享子串在进入 `TMService.findMatches()` 之前就占满全部 50 条候选。上层 `TMService` 仍会在评分、排序后对最终 10 条结果再做一次 diversity cap。

### Step 4 — 相似度评分

对每个候选条目，提取纯文本并 normalize，与 source 比较：

#### 分支 A：文本完全相同（仅 tag 不同）

```
sourceNormalized === candNormalized → standardSimilarity = 99
```

#### 分支 B：文本不同

**4b-1. Local Overlap（最长公共子串）**

```typescript
computeLocalOverlapSimilarity(sourceNormalized, candNormalized)
```

- `findLongestCommonSubstring(a, b)` — 动态规划求最长公共子串
- `score = shorterCoverage × 70 + longerCoverage × 30`
- `hasSharedCjkComponent(a, b)` — 检查是否共享 ≥2 字的 CJK 组件（按非 CJK 字符切分）
  - 有共享组件 → score 下限提升到 50
  - 无共享组件且 longerCoverage < 0.45 → score 上限压到 49

**4b-2. 长度比率快速过滤**

```typescript
computeMaxLengthBound(a, b) = (1 - |lenA - lenB| / max(lenA, lenB)) × 100
```

若 < 50 → 跳过 Levenshtein 计算（长度差异过大不可能达标）。

**4b-3. 标准相似度计算**（仅 maxLengthBound ≥ 50 时）

```
levSimilarity  = (1 - levenshteinDist / maxLen) × 100
diceSimilarity = 2 × bigramOverlap / (bigramCountA + bigramCountB) × 100
bonus          = 包含关系(+4) + 前缀匹配(+2)

standardSimilarity = min(99, round(lev × 0.75 + dice × 0.25 + bonus))
```

### Step 5 — 分类结果

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

### Step 6 — 排序、多样性 & 截断

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
