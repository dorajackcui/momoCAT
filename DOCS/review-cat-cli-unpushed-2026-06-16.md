# Code Review: cat-cli 未推送 Commits

> **日期:** 2026-06-16  
> **分支:** `cat-cli`  
> **范围:** `origin/cat-cli..HEAD`（13 commits, 16 files, +1791 / -8 lines）  
> **审查方:** Claude Opus 4.6 (3-agent parallel review)

---

## 变更概述

本批 commits 实现了 **English TM Concordance Phrase Lane** 功能，并在此基础上增加了 **TM FTS 批量替换** 能力。涉及三个层级：

| 层级 | 关键文件 | 变更内容 |
|------|---------|---------|
| Core Text | `packages/core/src/text/tmMatchingProfiles.ts` | 新增英文短语提取器、大写专有名词识别、句边界检测、复数/单数归一化 |
| DB/Repo | `packages/db/src/repos/TMRepo.ts` | 新增 `replaceTMFtsBatch`、FTS recall 查询支持 phrase terms、CJK 窗口构建 |
| Service/Worker | `TMImportService.ts`, `tmImportWorker.ts`, `ports.ts` | Import 流程集成 batch FTS 替换，接口扩展 `listTMEntries` / `getTMStats` |

---

## 发现列表

### Bug（需修复）

#### B1: 双 z 结尾词的复数/单数化错误

- **文件:** `packages/core/src/text/tmMatchingProfiles.ts` L355-369
- **严重度:** Bug（低频但会导致匹配失败）
- **描述:** `pluralizeRegularWord("buzz")` 生成 `"buzzzes"`（应为 `"buzzes"`），`singularizeRegularWord("buzzes")` 生成 `"buz"`（应为 `"buzz"`）。原因是 `/z$/i` 规则在 `/(s|x|z|ch|sh)$/i` 之前匹配，走错了分支。
- **影响:** 含 buzz/fizz/jazz/frizz 等词的 TM 条目相似度计算失败；`buildEnglishTMRecallTerms` 会生成无效的召回词。
- **建议修复:**
  - `pluralizeRegularWord`: 在 `/z$/i` 前添加 `/zz$/i` 检查，路由到 `+ "es"` 而非 `+ "zes"`
  - `singularizeRegularWord`: 区分 single-z 词根（quiz→quizzes, slice 3）和 double-z 词根（buzz→buzzes, slice 2）

#### B2: `buildCjkWindows` 中的死代码分支

- **文件:** `packages/db/src/repos/TMRepo.ts` L1338-1339
- **严重度:** Bug（无实际影响，但逻辑混乱）
- **描述:**
  ```ts
  if (chars.length < size) return chars.length === size ? [text] : [];
  ```
  当 `chars.length < size` 为 true 时，内部 `chars.length === size` 不可能为 true，该 ternary 是死代码。实际行为依靠后续循环兜底是正确的。
- **建议修复:** 拆分为两个清晰的 guard：
  ```ts
  if (chars.length < size) return [];
  if (chars.length === size) return [text];
  ```

---

### Warning（建议处理）

#### W1: `replaceTMFtsBatch` 未包裹在事务中

- **文件:** `packages/db/src/repos/TMRepo.ts` L215-234
- **严重度:** Warning（数据一致性风险）
- **描述:** 方法内先 DELETE 再 INSERT，但未用 `runInTransaction` 包裹。如果进程在 DELETE 之后 INSERT 之前崩溃，FTS 索引会缺失已删除的行。`better-sqlite3` 是同步的，所以单次事件循环内不会被异步中断，但这依赖于实现细节。
- **建议修复:** 用 `CATDatabase.runInTransaction` 包裹整个方法体。

#### W2: `deleteTM` 不级联删除 FTS 行

- **文件:** `packages/db/src/repos/TMRepo.ts` L1463
- **严重度:** Warning（存储泄漏）
- **描述:** `tm_entries` 通过外键 `ON DELETE CASCADE` 级联删除，但 FTS5 虚拟表不支持外键约束，`tm_fts` 中的对应行会变成孤立数据。当前查询用 `tmId IN (...)` 过滤已挂载 TM，所以不会返回错误结果，但会浪费存储。
- **建议修复:** 在 `deleteTM` 中先执行 `DELETE FROM tm_fts WHERE tmId IN (SELECT id FROM tm_entries WHERE tmId = ?)`。

#### W3: 接口漂移 — localization 包缺失 `listTMEntries`

- **文件:** `packages/localization/src/ports.ts` 对比 `apps/desktop/src/main/services/ports.ts`
- **严重度:** Warning（维护风险）
- **描述:** Desktop 的 `TMRepository` 接口新增了 `listTMEntries(tmId, limit?, offset?)`，但 localization 包的对应接口和 `SqliteTMRepository` 实现中未同步。两个包的 `TMRepository` 接口已经分叉。
- **建议修复:** 将 `listTMEntries` 同步到 `packages/localization/src/ports.ts`，并在 `SqliteTMRepository` 中补充实现。

#### W4: Chunk 事务失败时计数器静默丢失

- **文件:** `apps/desktop/src/main/services/modules/tm/TMImportService.ts` L167-231, `apps/desktop/src/main/tmImportWorker.ts` L74-142
- **严重度:** Warning（用户可见的数据不准确）
- **描述:** 如果某个 chunk 的 `runInTransaction` 回滚，该 chunk 内累积的 `success`/`skipped` 计数丢失，但外层循环继续处理后续 chunk。最终返回的总计数会偏低，且无日志记录失败。
- **建议修复:** 捕获 chunk 级别的事务异常，记录日志，并在返回结果中标注是否有部分失败。

#### W5: FTS5 查询转义正确但缺少集中校验点

- **文件:** `packages/db/src/repos/TMRepo.ts` L976
- **严重度:** Warning（防御性不足）
- **描述:** `buildFtsRecallQuery` 用 `""` 转义引号，`extractSearchTerms` 在上游剥离特殊字符，当前路径安全。但没有集中的 FTS 输入校验层，如果未来新增调用方绕过 `extractSearchTerms` 直接传入原始用户输入，可能导致 FTS 查询注入。
- **建议:** 考虑在 `buildFtsRecallQuery` 内部增加一层防御性校验（如断言 term 中不含 FTS5 操作符）。

---

### Nit（可选优化）

| # | 描述 | 文件 |
|---|------|------|
| N1 | SQL `LIMIT` 用模板字面量拼接（值安全但风格不一致），建议改为 `?` 参数化 | `TMRepo.ts` L894, L1024 |
| N2 | `tm_entries` 表上非唯一索引 `idx_tm_entries_tm_srcHash` 被唯一索引完全覆盖，可删除 | DB schema |
| N3 | Worker 线程本地定义 `TMFtsReplacement` 类型而非从共享位置导入 | `tmImportWorker.ts` L18-23 |
| N4 | `TMBatchOpsService.saveSegmentsToWorkingTM` 仍逐条调用 `replaceTMFts`，未利用新的 batch 方法 | `TMBatchOpsService.ts` L44 |
| N5 | `buildEnglishTMConcordancePhraseTerms` 在 exactPhrases 和 ftsPhrases 均达上限后未 early break | `tmMatchingProfiles.ts` L125-169 |
| N6 | `hasEnglishTMConcordanceEvidence` 中 `candidateTokens` 仅用于 `.length === 0` 检查，可简化 | `tmMatchingProfiles.ts` L180 |

---

### 测试覆盖缺口

| 缺口 | 说明 |
|------|------|
| FTS 特殊字符输入 | 无测试验证 `extractSearchTerms` 对 `"`, `*`, `NEAR`, `AND`, `OR`, `NOT` 等 FTS5 操作符的剥离行为 |
| `deleteTM` + FTS 孤立行 | 无测试验证删除 TM 后 FTS 虚拟表中的行是否被清理 |
| `replaceTMFtsBatch` 多批次 | 批次大小常量 `TM_FTS_REPLACE_DELETE_BATCH_SIZE = 900`，但测试仅覆盖 2 行的小批量 |
| Import 端到端集成 | 批量 FTS 替换仅在 DB 层有单元测试，无 `TMImportService` 级别的集成测试 |
| 双 z 词变形 | 无针对 buzz/fizz/jazz 等词的复数化/单数化测试 |

---

## 已验证无问题的区域

以下区域经审查确认 **正确**：

- **WORD_RE 字符类** — 正确匹配句点、撇号、U+2019 右单引号、U+2010-U+2013 连字符，无意外范围重叠
- **句边界检测** — 正确区分缩写句点（`U.S. `）和句尾句点（`end. `），带句点缩写不触发假边界
- **Unicode 归一化** — NFKC 在正则匹配前一致应用
- **正则回溯风险** — WORD_RE 语法无二义性，不会引发灾难性回溯
- **空输入/边缘情况** — 空字符串、单字符、纯标点输入均优雅处理
- **FTS 去重逻辑** — `dedupeTMFtsReplacementRows` 通过 Map last-wins 策略正确处理同一 `tmEntryId` 的多次出现，与 `upsertTMEntryBySrcHash` 的覆盖语义一致
- **`getTMStats` 返回类型扩展** — 后向兼容的 widening，现有调用方不受影响
- **28 个现有测试** — 全部 pass，测试期望与实现行为一致

---

## 优先级建议

| 优先级 | 项目 | 工作量 |
|--------|------|--------|
| **P0** | B1: 修复双 z 词变形 + 补充测试 | ~30 min |
| **P1** | W1: `replaceTMFtsBatch` 包裹事务 | ~10 min |
| **P1** | W2: `deleteTM` 级联删除 FTS 行 | ~15 min |
| **P2** | W3: 同步 localization 包接口 | ~20 min |
| **P2** | W4: Chunk 失败日志 + 返回值标注 | ~20 min |
| **P3** | 补充测试覆盖（FTS 特殊字符、多批次、端到端） | ~1-2 hr |
| **P3** | N1-N6 代码清理 | ~30 min |

---

## 总结

整体代码质量良好，核心匹配逻辑、Unicode 处理、FTS 查询构造均经验证正确。主要风险集中在：

1. **数据一致性** — FTS 批量替换缺少事务保护、TM 删除不清理 FTS 孤立行
2. **边缘文本处理** — 双 z 结尾词的英文变形错误
3. **维护性** — localization 与 desktop 包的接口漂移

建议在推送前至少处理 P0 和 P1 项目。
