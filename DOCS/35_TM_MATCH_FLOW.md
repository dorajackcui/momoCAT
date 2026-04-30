# 35_TM_MATCH_FLOW

Translation Memory 匹配的当前 runtime 流程说明。

## Last Updated

2026-04-30

## Owner

Core maintainers of `simple-cat-tool`

## 范围

本文描述编辑器激活 segment 时，右侧 TM panel 使用的 active TM match flow：

```typescript
TMService.findMatches(projectId, segment)
```

返回值最多 10 条 `TMMatch[]`，包含：

- `kind: 'tm'`: 100% hash 命中或 fuzzy TM match。
- `kind: 'concordance'`: 当前 source 内部的局部片段命中。

注意：显式 Concordance Search 面板的入口是 `TMRepo.searchConcordance()`。它当前仍走兼容 wrapper `searchTMRecallCandidates(scope: 'source-and-target')`，不走 active flow 新增的 `searchTMConcordanceRecallCandidates()`。

## Step 0 - 获取挂载 TM

```typescript
const mountedTMs = tmRepo.getProjectMountedTMs(projectId);
```

`getProjectMountedTMs()` 只返回启用中的 TM，并按 `project_tms.priority ASC` 排序。若当前 project 没有挂载 TM，`findMatches()` 直接返回空数组。

每个 mounted TM 带有：

| 字段 | 用途 |
|---|---|
| `id` | 后续 hash lookup 和 recall 查询的 TM 范围 |
| `name` | 返回给 UI 的 `tmName` |
| `type` | 返回给 UI 的 `tmType`，值为 `working` 或 `main` |
| `permission` | 当前 flow 只读，不在 `findMatches()` 内过滤 |
| `priority` | mounted TM 排序来源 |

## Step 1 - 提取带 tag 边界的 text-only source

```typescript
const sourceTextOnly = serializeTokensToTextOnly(segment.sourceTokens);
const sourceNormalized = normalizeForSimilarity(sourceTextOnly);
```

`serializeTokensToTextOnly()` 当前行为：

- `type === 'text'`: 保留原内容。
- `type === 'tag'`: 替换成一个空格。
- 最后压缩连续空白并 `trim()`。

这意味着 tag 不参与相似度文本，但 tag 是天然分隔符，不会把 tag 两侧的文本无缝拼接成一个不存在的连续子串。

示例：

| sourceTokens 语义 | `serializeTokensToTextOnly()` |
|---|---|
| `风荷<tag>立柱` | `风荷 立柱` |
| `风荷立柱设计图` | `风荷立柱设计图` |

`normalizeForSimilarity()` 继续做：

```typescript
text.toLowerCase().replace(/\s+/g, ' ').trim()
```

这个 `sourceTextOnly` 会同时进入 hash 之外的两个上游 recall：

- `searchTMFuzzyRecallCandidates()`
- `searchTMConcordanceRecallCandidates()`

## Step 2 - 100% hash 精确匹配

```typescript
for (const tm of mountedTMs) {
  const match = tmRepo.findTMEntryByHash(tm.id, segment.srcHash);
}
```

命中后直接产生：

```typescript
{
  kind: 'tm',
  similarity: 100,
  rank: 100
}
```

并把 `match.srcHash` 记录到 `seenHashes`，后续 fuzzy/concordance 候选如果拥有相同 `srcHash` 会被跳过。

### hash 的含义

`segment.srcHash` 来自：

```typescript
computeSrcHash(matchKey, tagsSignature)
```

其中：

- `matchKey` 由 `computeMatchKey(sourceTokens)` 生成。
- text token 会被 lower-case 并 trim。
- tag token 会以 `{TAG}` 形式参与 `matchKey`。
- `tagsSignature` 记录 tag 结构。

所以 Step 2 是 source text 与 tag 结构都一致的 100% match。Step 1 把 tag 转成空格不会影响 hash lookup，因为 hash 已经在 segment import/creation 阶段算好。

## Step 3 - Active flow 的两个 recall 上游

当前 `findMatches()` 不再只依赖一个 `searchTMRecallCandidates()`。

实际调用是：

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
```

`searchTMRecallCandidates()` 仍保留为兼容 wrapper，目前等价于：

```typescript
return searchTMFuzzyRecallCandidates(projectId, sourceText, tmIds, options);
```

因此，读代码时需要区分：

| 方法 | 当前用途 |
|---|---|
| `searchTMRecallCandidates()` | legacy wrapper；显式 Concordance Search 仍通过它进入 fuzzy-oriented recall |
| `searchTMFuzzyRecallCandidates()` | active TM flow 的整句/近整句 fuzzy recall |
| `searchTMConcordanceRecallCandidates()` | active TM flow 的 source-side concordance/CJK substring recall |

## Step 3A - Fuzzy recall: `searchTMFuzzyRecallCandidates()`

这一路目标是找整句或近整句 TM 候选。它较保守，不保证召回所有短 CJK 子串。

### 3A.1 输入边界

| 变量 | runtime 行为 |
|---|---|
| `maxResults` | `options.limit` 默认 50，最大 50；为 0 时返回空数组 |
| `resolvedTmIds` | 优先使用传入的 `tmIds`，否则读取 project mounted TMs |
| `scope` | active flow 使用 `'source'`，只接受 source-side evidence |
| `collectionLimit` | `min(maxResults * 3, 150)`；先收集更大的池，再做 repo-level diversity |

### 3A.2 构造 query plan

`buildTMRecallQueryPlan(sourceText)` 先调用 `extractSearchTerms()`：

- 移除 FTS 控制字符和布尔关键字：`"`, `(`, `)`, `AND`, `OR`, `NOT`。
- 标点转为空格，保留 `\w`、空白、CJK。
- CJK 与数字之间切开，避免 `立柱2` 这类内容粘在一起。
- 只保留长度 `>= 2` 且不是纯数字的 term。

然后从 CJK component 生成窗口：

| plan 字段 | 内容 | 上限 |
|---|---|---|
| `exactTerms` | 清洗后的完整 term，长度 `>= 3` | 不额外 spread cap |
| `latinTerms` | 长度 `>= 3` 且不是纯 CJK 的 term | 不额外 spread cap |
| `primaryCjkFragments` | CJK 4/5/6 字窗口 | 16 |
| `secondaryCjkFragments` | CJK 3 字窗口 | 12 |
| `shortCjkTerms` | CJK 2 字窗口，排除弱短词 | 4 |

窗口过多时用 `selectSpreadFragments()` 做头尾均匀抽样，而不是只截取前 N 个。

### 3A.3 分层收集

Fuzzy recall 按固定顺序收集，并共享 `accepted` 与 `seenIds`：

```typescript
collectFtsRecallTier(exactTerms + latinTerms)
collectFtsRecallTier(primaryCjkFragments)
collectFtsRecallTier(secondaryCjkFragments) // accepted < min(collectionLimit, 8)
collectLikeRecallTier(shortCjkTerms)        // accepted < min(collectionLimit, 6)
```

含义：

- 完整 term、Latin term、4-6 字 CJK 是主 recall 路径。
- 3 字 CJK 只是前面召回不足时的补充。
- 2 字 CJK 走 LIKE fallback，更保守。
- `seenIds` 防止同一个 TM entry 从不同 tier 重复进入候选池。

### 3A.4 FTS 查询

`collectFtsRecallTier()` 把 term 包成 FTS phrase 并用 `OR` 连接：

```sql
"风荷立柱" OR "立柱设计"
```

active flow 的 `scope: 'source'` 会生成：

```sql
srcText : ("term1" OR "term2")
```

SQL 从 `tm_fts` join `tm_entries`，限定 `tmId IN (...)`，按 FTS `rank` 排序，raw SQL limit 是：

```typescript
Math.max(maxResults * 3, 20)
```

FTS 命中只是 raw row，还必须经过 evidence gate。

### 3A.5 LIKE fallback

2 字 CJK 不适合 trigram FTS，所以 short tier 使用：

```sql
tm_fts.srcText LIKE '%立柱%' ESCAPE '/'
```

active flow 只查 `srcText`。显式 Concordance Search 因为使用 `scope: 'source-and-target'`，legacy fuzzy recall 的 LIKE fallback 会同时查 `srcText` 和 `tgtText`。

### 3A.6 Fuzzy evidence gate

`hasRecallEvidence()` 按 scope 选择 source 或 source+target 文本。active flow 只检查 `ftsSrcText`。

接受条件：

| 条件 | 结果 |
|---|---|
| candidate 包含任意 primary CJK fragment，4-6 字 | 接受 |
| candidate 包含至少两个 secondary CJK fragment，3 字 | 接受 |
| candidate 包含任意 latin term，长度 `>= 3` | 接受 |
| short fallback 已启用，命中至少两个 2 字 short term | 接受 |
| short fallback 已启用，单个 2 字 term 出现在 source 或 candidate 的短 CJK component 中 | 接受 |
| 其他情况 | 丢弃 |

这解释了为什么 fuzzy recall 本身不是完整的 CJK substring 搜索引擎：3 字片段需要较多 evidence，2 字片段只作为兜底。

## Step 3B - Active concordance recall: `searchTMConcordanceRecallCandidates()`

这一路是 active TM panel 专用的 source-side concordance/CJK substring recall。它复用同一张 `tm_fts` 物理索引，但采用更适合短 CJK 片段的 recall policy。

调用参数：

```typescript
{
  scope: 'source',
  limit: 50,
  rawLimit: 200
}
```

当前 `TMConcordanceRecallOptions.scope` 只允许 `'source'`。这一路不查 target。

### 3B.1 输入边界与性能保护

| 变量 | runtime 行为 |
|---|---|
| `maxResults` | 默认 50，最大 50 |
| `rawLimit` | 默认 200；至少为 `maxResults`，最大 1000 |
| batch size | 每批最多 32 个 FTS/LIKE term |
| per-batch raw limit | 每批最多拉 64 条 raw row |
| exact-source limit | FTS 前最多拉 64 条 `tm_fts.srcText IN (...)` 精确源文候选 |
| soft budget | 50ms；超过后后续 tier 会 degraded 停止 |

`rawLimit` 是整个 concordance recall 的 raw row 总预算，per-batch raw limit 防止前面的 4 字窗口把全部 raw row 吃满，导致后面的 3 字窗口没有机会执行。

### 3B.2 Concordance query plan

`buildTMConcordanceRecallQueryPlan(queryText)` 也基于 `extractSearchTerms()` 与 CJK component。

| plan 字段 | 内容 | 上限 |
|---|---|---|
| `cjk4Fragments` | CJK 4 字窗口 | 64 |
| `cjk3Fragments` | CJK 3 字窗口 | 48 |
| `longCjkFragments` | CJK 5/6 字窗口 | 32 |
| `latinTerms` | 长度 `>= 3` 且不是纯 CJK 的 term | 32 |
| `shortCjkTerms` | CJK 2 字窗口，排除弱短词 | 16 |

相比 fuzzy recall，这一路给 3/4 字 CJK 更宽的采样上限。

### 3B.3 Concordance tier 顺序

```typescript
tier -1: exact source lookup with tm_fts.srcText IN (...)
tier 0: cjk4Fragments + latinTerms
tier 1: longCjkFragments
tier 2: cjk3Fragments
fallback: shortCjkTerms LIKE
```

Exact source lookup 使用 `shortCjkTerms`、`cjk3Fragments`、`cjk4Fragments`、`longCjkFragments` 的合集，在 broad OR FTS 之前先查：

```sql
tm_fts.srcText IN ('阿茉玻', '清新天王', ...)
```

这一步是为了保护“TM entry 本身就是 active source 的完整短片段”的场景。否则在真实大 TM 里，`"阿茉玻"` 这种 3 字 exact entry 可能被 `清新天王`、`心愿精灵` 等大量更长句子的 FTS rank 挤到 raw limit 之外。

每个 FTS tier 按 batch 查询：

```sql
srcText : ("term1" OR "term2" OR ...)
```

LIKE fallback 只查 source：

```sql
tm_fts.srcText LIKE '%短词%' ESCAPE '/'
```

每批 raw rows 进入 `acceptConcordanceRecallRows()`，先去重，再跑 concordance evidence gate。

### 3B.4 Concordance evidence gate

`hasConcordanceRecallEvidence(queryText, row)` 使用 normalized query 和 `row.ftsSrcText`。它只判断 source-side evidence。

当前接受规则：

| 条件 | 结果 |
|---|---|
| candidate 只包含 CJK 和空格，CJK 总长度 3-8，且 query 包含 candidate | 接受 |
| candidate 只包含 CJK 和空格，CJK 总长度 2，candidate 的 CJK component 总长度 `<= 4`，且 query 包含 candidate | 接受 |
| 最长公共子串长度 `>= 3`，且覆盖 candidate `>= 90%` | 接受 |
| 最长公共子串长度 `>= 4` | 接受 |
| 其他情况 | 丢弃 |

这里的 `query.includes(candidate)` 在 normalized text 上执行。因为 Step 1 已把 tag 变成空格，跨 tag 拼出来的假连续子串不会被当成包含关系。

例子：

```text
query:     风荷 立柱
candidate: 风荷立柱
```

`query.includes(candidate)` 为 false，所以不会把跨 tag 的 `风荷立柱` 误认为 source 中真实存在的连续片段。

### 3B.5 Concordance recall diversity

concordance recall 收集完 raw accepted rows 后，仍调用：

```typescript
diversifyRecallRows(queryText, rows, maxResults, 'source')
```

规则与 fuzzy recall 的 repo-level diversity 相同：

- 找 query 与 candidate source 的最长公共 CJK 子串。
- 只有纯 CJK 且长度 `>= 4` 的 bucket 参与限制。
- 短 bucket 如果被同一候选池内更长 bucket 完全包含，会归并到更长 bucket。
- 每个 bucket 最多保留 2 条。

因此，`立柱设计图` 这类共同后缀不会在进入 `TMService` 前占满全部 50 个候选。

## Step 4 - 合并两路 recall candidate

`TMService.findMatches()` 以 TM entry `id` 合并两路候选：

```typescript
Map<id, { candidate, fromFuzzy, fromConcordance }>
```

合并规则：

- fuzzy 先写入 map，标记 `fromFuzzy: true`。
- concordance 如果命中同一 id，只补 `fromConcordance: true`。
- concordance-only candidate 会以 `fromFuzzy: false, fromConcordance: true` 加入。
- 已经被 100% hash 命中的 `srcHash` 会被跳过。

随后对 concordance-only 候选做一个 cheap reject：

```typescript
if (!fromFuzzy && fromConcordance && candidateLength > sourceLength * 3) {
  continue;
}
```

这是为了避免非常长的 source entry 被 active source 的短片段误召回后进入较贵的 scoring。

## Step 5 - 相似度与 local overlap scoring

每个候选会再次从 `sourceTokens` 提取 text-only：

```typescript
const candTextOnly = serializeTokensToTextOnly(cand.sourceTokens);
const candNormalized = normalizeForSimilarity(candTextOnly);
```

### 5.1 normalized 文本完全相同

```typescript
if (sourceNormalized === candNormalized) {
  standardSimilarity = 99;
}
```

这是非 hash 的 exact normalized match。例如 tag 结构不同但 text-only 相同，不会给 100%，而是 99%。

### 5.2 local overlap

文本不完全相同时，先计算最长公共子串：

```typescript
localOverlap = computeLocalOverlapSimilarity(sourceNormalized, candNormalized);
```

核心公式：

```text
score = shorterCoverage * 70 + longerCoverage * 30
```

其中：

- `shorterCoverage = overlapLength / shorterLength`
- `longerCoverage = overlapLength / longerLength`

CJK 安全规则：

| 条件 | 行为 |
|---|---|
| 两边有完全相同的 CJK component，component 长度 `>= 2` | score 至少为 50 |
| 没有共享 CJK component 且 `longerCoverage < 0.45` | score 最高压到 49 |

这里的 component 是按非 CJK 字符切分出来的完整 CJK 段，不是任意包含关系。

### 5.3 concordance-contained 保底

如果候选来自 concordance recall，local overlap 之后还会执行：

```typescript
promoteContainedConcordanceOverlap(localOverlap)
```

保底条件：

| 条件 | 行为 |
|---|---|
| overlap 长度 `>= 3` |
| `entryCoverage >= 90` |
| 当前 `localOverlap.score < 50` |

满足时把 `localOverlap.score` 提升到 50。

这用于处理未分词 CJK 长句中的短 TM entry，例如：

```text
source: 阿茉玻曾见证清新天王将因绝望病逝世的心愿精灵送回星空。
entry:  阿茉玻
entry:  清新天王
```

这些 entry 被 active source 完整覆盖，但因为整句是一个长 CJK component，普通 local overlap 会被 sparse-overlap guard 压到 49。只有来自 concordance recall 的候选才会触发这个保底，fuzzy-only 候选不会因此放宽。

### 5.4 标准 fuzzy 相似度

如果长度差距允许：

```typescript
computeMaxLengthBound(a, b) >= 50
```

则计算：

```text
levSimilarity  = (1 - levenshteinDist / maxLen) * 100
diceSimilarity = 2 * bigramOverlap / (bigramCountA + bigramCountB) * 100
bonus          = 包含关系 +4，前缀匹配 +2

standardSimilarity = min(99, round(lev * 0.75 + dice * 0.25 + bonus))
```

如果 `computeMaxLengthBound()` 小于 50，则跳过 Levenshtein/Dice，`standardSimilarity` 保持 0。

## Step 6 - 分类为 TM 或 Concordance

分类顺序如下。

### 6.1 local overlap 明显强于 fuzzy

```typescript
standardSimilarity >= 50
localOverlap.score >= 80
localOverlap.score - standardSimilarity >= 15
localOverlap.entryCoverage >= 90
localOverlap.sourceCoverage < 75
```

满足时，即使 standard similarity 达标，也归类为：

```typescript
kind: 'concordance'
rank: localOverlap.score
```

这是为了把“完整短片段命中”从 fuzzy TM match 中分出来。

### 6.2 standard similarity 达标

```typescript
standardSimilarity >= 50
```

归类为：

```typescript
kind: 'tm'
similarity: standardSimilarity
rank: standardSimilarity
```

### 6.3 local overlap 达标

```typescript
localOverlap.score >= 50
```

归类为：

```typescript
kind: 'concordance'
rank: localOverlap.score
matchedSourceText
sourceCoverage
entryCoverage
```

### 6.4 两者都不达标

候选被丢弃。

## Step 7 - 排序与 service-level diversity

所有通过 scoring 的结果先排序：

```typescript
results.sort((a, b) => {
  if (b.match.rank !== a.match.rank) return b.match.rank - a.match.rank;
  return b.match.usageCount - a.match.usageCount;
});
```

然后执行 `diversifyRankedMatches()`，最后截断到 10 条：

```typescript
return diversifyRankedMatches(sortedResults).slice(0, 10);
```

### 7.1 service-level bucket 来源

| candidate 类型 | diversity bucket |
|---|---|
| exact normalized match | 从 `sourceNormalized` 中取最长的强 CJK component |
| 非 exact match | 使用 `localOverlap.matchedSourceText` |

强 CJK bucket 的定义：

- 必须是纯 CJK。
- 长度 `>= 4`。

### 7.2 canonical bucket

`buildCanonicalDiversityBuckets()` 会把短 bucket 归并到包含它的更长 bucket。

例子：

```text
能力套装
能力套装限时上架中
```

`能力套装` 会归并到 `能力套装限时上架中`，并共享同一个 cap。

### 7.3 cap

每个 canonical bucket 最多保留 2 条。没有强 CJK bucket 的结果不参与 cap。

这套 cap 在两个地方生效：

| 层级 | 作用 |
|---|---|
| repo-level `diversifyRecallRows()` | 防止进入 scoring 前候选池被同一种 substring 占满 |
| service-level `diversifyRankedMatches()` | 防止最终 top 10 被同一种 substring 占满 |

## 显式 Concordance Search 当前状态

显式 Concordance Search 调用：

```typescript
TMRepo.searchConcordance(projectId, query, tmIds)
```

当前实现：

```typescript
const candidates = searchTMRecallCandidates(projectId, query, tmIds, {
  scope: 'source-and-target',
  limit: 50,
});

return diversifyConcordanceRows(query, candidates, 10);
```

因为 `searchTMRecallCandidates()` 现在是 `searchTMFuzzyRecallCandidates()` 的 wrapper，所以显式 Concordance Search 当前仍使用 legacy fuzzy-oriented recall，只是 scope 是 `source-and-target`，可以召回 source 或 target 命中的条目。

本轮新增的 `searchTMConcordanceRecallCandidates()` 只接入 active TM match flow，尚未替换显式 Concordance Search。

## FTS 索引写入路径

物理索引：

```sql
CREATE VIRTUAL TABLE tm_fts USING fts5(
  tmId UNINDEXED,
  srcText,
  tgtText,
  tmEntryId UNINDEXED,
  tokenize='trigram'
);
```

写入路径：

| 场景 | 位置 | FTS 文本 |
|---|---|---|
| confirmed segment 写入 Working TM | `TMService.upsertFromConfirmedSegment()` | `serializeTokensToDisplayText(sourceTokens/targetTokens)` |
| 批量提交到 Main TM | `TMBatchOpsService.commitToMainTM()` | `serializeTokensToDisplayText(sourceTokens/targetTokens)` |
| 导入 TM | `TMImportService` | 导入文件中的 source/target display text |
| repo 直接 upsert | `TMRepo.upsertTMEntry()` | `token.content` 直接拼接 |

当前 FTS 写入的是 display/raw text，而不是 Step 1 的 tag-to-space text-only。最终 scoring 使用 `serializeTokensToTextOnly()`，active concordance evidence 也会在 normalized text 上处理 tag 空格边界。

如果后续要统一 FTS 写入为 text-only，需要同步更新：

- confirmed segment 写入 Working TM
- 批量提交 Main TM
- TM import
- repo 直接 upsert 的 FTS 写入

## Trigram tokenizer 行为

`tm_fts` 使用 SQLite FTS5 trigram tokenizer。

核心行为：

- 文本会被拆成连续 3 个 Unicode code point 的窗口。
- FTS phrase 查询如 `"风荷立柱"` 等价于要求连续 trigram 按顺序存在，适合精确子串匹配。
- 最小有效 CJK 查询长度实际是 3 字符；2 字符 CJK 需要 LIKE fallback。

这也是 active concordance recall 同时使用 3/4 字 FTS 窗口和 2 字 LIKE fallback 的原因。

## 关键文件索引

| 文件 | 职责 |
|---|---|
| `apps/desktop/src/main/services/TMService.ts` | active TM match 主流程、两路 recall merge、scoring、classification、service-level diversity |
| `packages/db/src/repos/TMRepo.ts` | fuzzy recall、active concordance recall、FTS/LIKE 查询、repo-level diversity |
| `packages/db/src/types.ts` | `TMRecallOptions`、`TMConcordanceRecallOptions` |
| `apps/desktop/src/main/services/ports.ts` | `TMRepository` port 方法声明 |
| `packages/core/src/text/tokenText.ts` | token text 序列化、match key、src hash |
| `packages/db/src/currentSchema.ts` | `tm_fts` schema |
