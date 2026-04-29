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
| `风荷立柱��计图` | `风荷立柱设计图` |

### Step 2 — 100% Hash 精确匹配

```typescript
for (const tm of mountedTMs) {
  const match = tmRepo.findTMEntryByHash(tm.id, segment.srcHash);
  // 命中 → similarity=100, kind='tm'
}
```

`srcHash = matchKey + ':::' + tagsSignature`，匹配文本内容和 tag 结构都完全一致的条目。

命中后记入 `seenHashes`，后续模糊搜索跳过相同 hash。

### Step 3 — 构建 FTS 查询字符串

```typescript
const query = sourceTextOnly
  .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')       // 去除标点（保留 CJK 和 \w）
  .replace(/([\u4e00-\u9fa5])(\d)/g, '$1 $2')  // CJK/数字边界插入空格
  .replace(/(\d)([\u4e00-\u9fa5])/g, '$1 $2')  // 数字/CJK 边界插入空格
  .split(/\s+/)                                 // 按空格拆词
  .filter((w) => w.length >= 2 && !/^\d+$/.test(w)) // 去除单字和纯数字
  .join(' ');                                   // 空格拼接
```

示例：

| 输入 | 输出 query |
|---|---|
| `风荷立柱设计图` | `风荷立柱设计图` (单一 term) |
| `消耗380个金币` | `消耗 380 个金币` → filter → `���耗 个金币` |
| `Translation memory test` | `Translation memory test` |

> **注意**：纯 CJK 文本无空格分隔，整段成为一个 term。这会导致 FTS 搜索过于严格（精确子串匹配），是已知的可优化点。

### Step 4 — searchConcordance

`TMRepo.searchConcordance(projectId, query, tmIds)` — [TMRepo.ts](../packages/db/src/repos/TMRepo.ts)

#### 4a. 提取搜索词

```typescript
extractSearchTerms(query)
  .replace(/["()]/g, ' ')                   // 去除 FTS 运算符
  .replace(/\b(?:AND|OR|NOT)\b/gi, ' ')     // 去除布尔关键字
  .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')    // 保留 CJK 和 \w
  .split(/\s+/)
  .filter((t) => t.length >= 2)
```

#### 4b. 分类

```
ftsTerms   = terms.filter(t => t.length >= 3)    // trigram FTS 最小 3 字符
shortTerms = terms.filter(t => 2 <= t.length < 3) // LIKE 回退
```

#### 4c. FTS5 trigram 查询

```typescript
const ftsQuery = ftsTerms.map(t => `"${t}"`).join(' OR ');
// 例: '"风荷立柱设计图"' 或 '"Translation" OR "memory" OR "test"'
```

引号包裹 → trigram tokenizer 执行**精确子串匹配**。

```sql
SELECT tm_entries.*
FROM tm_fts
JOIN tm_entries ON tm_fts.tmEntryId = tm_entries.id
WHERE tm_fts.tmId IN (?, ?, ...) AND tm_fts MATCH ?
ORDER BY rank
LIMIT 10
```

#### 4d. LIKE 回退（短词补充）

当 FTS 结果不足 10 条且存在 shortTerms（2 字符词）时，补充 LIKE 查询：

```sql
WHERE tm_fts.tmId IN (...)
  AND (tm_fts.srcText LIKE '%term%' OR tm_fts.tgtText LIKE '%term%')
ORDER BY usageCount DESC, updatedAt DESC
LIMIT remaining
```

#### 4e. 返回候选

合并 FTS + LIKE 结果，去重，最多 10 条 `TMEntry[]`。

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

| 条件 | 类型 | 字段 |
|---|---|---|
| `standardSimilarity >= 50` | `kind: 'tm'` | `similarity`, `rank = similarity` |
| `localOverlap.score >= 50` | `kind: 'concordance'` | `matchedSourceText`, `sourceCoverage`, `entryCoverage`, `rank = score` |
| 两者都 < 50 | 丢弃 | — |

优先判断 standardSimilarity，达标即归类为 TM 匹配，不再检查 concordance。

### Step 7 — 排序 & 截断

```typescript
results
  .sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;   // rank 降序
    return b.usageCount - a.usageCount;               // 同 rank 按使用次数
  })
  .slice(0, 10);  // 最多 10 条
```

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

所有路径使用 `serializeTokensToTextOnly()` 提取纯文本写入 FTS，确保与查询端一致（无 tag 标记干扰 trigram 序列）。

## Trigram Tokenizer 行为

- 将文本拆分为每 3 个连续字符（Unicode code point）的重叠窗口
- `"风荷立柱"` 的 trigram 索引：`风荷立`, `荷立柱`
- FTS MATCH 引号查询 `"风荷立柱"` = 要求所有连续 trigram 按序存在 = **精确子串匹配**
- 最小查询长度 3 字符；2 字符词走 LIKE 回退

## 关键文件索引

| 文件 | 职责 |
|---|---|
| `apps/desktop/src/main/services/TMService.ts` | findMatches 主流程、相似度算法 |
| `packages/db/src/repos/TMRepo.ts` | searchConcordance、FTS 查询构建 |
| `packages/core/src/text/tokenText.ts` | serializeTokensToTextOnly / DisplayText |
| `packages/db/src/currentSchema.ts` | tm_fts 表定义 |
